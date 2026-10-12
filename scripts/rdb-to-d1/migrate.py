#!/usr/bin/env python3
"""Convert only Redis db 2 to bounded, insert-only D1 SQL (stdlib + Docker)."""
import argparse
from contextlib import contextmanager
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time


CHUNK_BYTES = 40000  # Hex doubles the size; stay below D1's 100,000-byte statement limit.
TABLE = "_rdb_to_d1_chunks"
HEADER = (f"CREATE TABLE IF NOT EXISTS {TABLE} "
          "(part INTEGER PRIMARY KEY, data BLOB NOT NULL);\n")
FOOTER = f"DROP TABLE IF EXISTS {TABLE};\n"


class Redis:
    """Small binary-safe RESP2 client; no paste data in argv or error messages."""
    def __init__(self, path):
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.settimeout(30)
        self.socket.connect(str(path))
        self.stream = self.socket.makefile("rb")

    def close(self):
        self.stream.close()
        self.socket.close()

    def command(self, *args):
        args = [a if isinstance(a, bytes) else str(a).encode() for a in args]
        self.socket.sendall(b"*%d\r\n" % len(args) + b"".join(
            b"$%d\r\n" % len(a) + a + b"\r\n" for a in args))
        return self._read()

    def _read(self):
        line = self.stream.readline()
        if not line.endswith(b"\r\n"):
            raise RuntimeError("Redis connection closed")
        kind, body = line[:1], line[1:-2]
        if kind == b"-":
            raise RuntimeError("Redis command failed (check RDB compatibility and key types)")
        if kind == b"+":
            return body
        if kind == b":":
            return int(body)
        if kind == b"$":
            size = int(body)
            if size == -1:
                return None
            data = self.stream.read(size)
            if len(data) != size or self.stream.read(2) != b"\r\n":
                raise RuntimeError("Incomplete Redis response")
            return data
        if kind == b"*":
            return [self._read() for _ in range(int(body))]
        raise RuntimeError("Unsupported Redis response")


@contextmanager
def load_dump(dump, image):
    with tempfile.TemporaryDirectory(prefix="rdb-d1-") as directory:
        root = Path(directory)
        shutil.copyfile(dump, root / "dump.rdb")
        os.chmod(root / "dump.rdb", 0o600)
        container = None
        client = None
        try:
            # Replica mode preserves keys that expired after the snapshot, even
            # when importing an old RDB. No network or published TCP ports.
            result = subprocess.run([
                "docker", "run", "--detach", "--network", "none", "--log-driver", "none",
                "--user", f"{os.getuid()}:{os.getgid()}", "--volume", f"{root}:/data",
                image, "redis-server", "--port", "0", "--unixsocket", "/data/redis.sock",
                "--unixsocketperm", "600", "--save", "", "--appendonly", "no",
                "--replicaof", "127.0.0.1", "1", "--enable-debug-command", "local",
            ], capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError("Docker could not start Redis; check Docker access and image availability")
            container = result.stdout.strip()
            for _ in range(600):
                try:
                    client = Redis(root / "redis.sock")
                    client.command("PING")
                    break
                except (OSError, RuntimeError):
                    if client:
                        client.close()
                        client = None
                    state = subprocess.check_output(
                        ["docker", "inspect", "--format", "{{.State.Running}}", container],
                        stderr=subprocess.DEVNULL).strip()
                    if state != b"true":
                        raise RuntimeError("Redis failed to load the RDB; use an image supporting its RDB version")
                    time.sleep(0.1)
            else:
                raise RuntimeError("Timed out loading RDB")
            # Replica reads/SCAN still hide expired keys unless this Redis 8.4+
            # debug flag is enabled. The server is isolated on a private socket.
            client.command("DEBUG", "SET-ACTIVE-EXPIRE", 0)
            client.command("DEBUG", "SET-ALLOW-ACCESS-EXPIRED", 1)
            client.command("SELECT", 2)
            yield client
        finally:
            if client:
                client.close()
            if container:
                subprocess.run(["docker", "rm", "--force", container],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def documents(redis, dump_time):
    keys = set()
    cursor = b"0"
    while True:
        cursor, batch = redis.command("SCAN", cursor, "COUNT", 1000)
        keys.update(batch)
        if cursor == b"0":
            break
    for key in sorted(keys):
        # RDB stores absolute millisecond expiries. Reconstruct TTL at dump_time,
        # not at import time; round to whole seconds like Redis TTL (+500ms).
        expires_ms = redis.command("PEXPIRETIME", key)
        if expires_ms == -2:
            raise RuntimeError("A snapshot key disappeared")
        if expires_ms >= 0 and expires_ms <= dump_time * 1000:
            yield key, None, "expired"
            continue
        value = redis.command("GET", key)
        if value is None:
            raise RuntimeError("Could not read a snapshot key")
        try:
            key.decode("utf-8")
            value.decode("utf-8")
        except UnicodeDecodeError:
            raise RuntimeError("Non-UTF-8 key/value cannot be migrated to the Worker's TEXT contract") from None
        expiry = None if expires_ms == -1 else dump_time + (expires_ms - dump_time * 1000 + 500) // 1000
        yield key, value, expiry


def document_sql(key, value, expiry):
    key_sql = f"CAST(X'{key.hex()}' AS TEXT)"
    expiry_sql = "NULL" if expiry is None else str(expiry)
    insert = "INSERT INTO documents (key, data, expires_at) "
    # Documents are immutable, so an existing row keeps its data. Its expiry only
    # ever extends: the later of the two, or NULL (never) if either is NULL. This
    # carries over renewals made on the old server between dumps, and never
    # shortens one made by the Worker. Replays are idempotent.
    upsert = (" ON CONFLICT(key) DO UPDATE SET expires_at = CASE"
              " WHEN documents.expires_at IS NULL OR excluded.expires_at IS NULL THEN NULL"
              " ELSE MAX(documents.expires_at, excluded.expires_at) END")
    if len(value) <= CHUNK_BYTES:
        return f"{insert}VALUES ({key_sql}, CAST(X'{value.hex()}' AS TEXT), {expiry_sql}){upsert};\n"
    # A single 400KB literal would exceed D1's statement limit. Assemble BLOB
    # chunks in order, then cast once to TEXT (UTF-8 may cross chunk boundaries).
    sql = [f"DELETE FROM {TABLE};\n"]
    for part, offset in enumerate(range(0, len(value), CHUNK_BYTES)):
        chunk = value[offset:offset + CHUNK_BYTES]
        sql.append(f"INSERT OR IGNORE INTO {TABLE} VALUES ({part}, X'{chunk.hex()}');\n")
    # "WHERE true" lets SQLite parse ON CONFLICT after INSERT ... SELECT.
    sql.append(f"{insert}SELECT {key_sql}, CAST(group_concat(data, '') AS TEXT), {expiry_sql} "
               f"FROM (SELECT data FROM {TABLE} ORDER BY part) WHERE true{upsert};\n")
    sql.append(f"DELETE FROM {TABLE};\n")
    return "".join(sql)


def convert(args):
    output = args.output.resolve()
    if output.exists():
        raise RuntimeError("Output path already exists; use a new private directory")
    if not output.parent.is_dir():
        raise RuntimeError("Output parent directory must exist")
    summary = {"db": 2, "dump_time": args.dump_time, "keys": 0, "keys_with_ttl": 0,
               "keys_without_ttl": 0, "keys_expired_at_dump": 0, "largest_value_bytes": 0,
               "value_bytes": 0, "sql_files": 0}
    # Publish only a complete conversion; errors leave no partial SQL output.
    with tempfile.TemporaryDirectory(prefix=".rdb-sql-", dir=output.parent) as directory:
        staging = Path(directory)
        sql = HEADER
        with load_dump(args.dump, args.redis_image) as redis:
            for key, value, expiry in documents(redis, args.dump_time):
                if expiry == "expired":
                    summary["keys_expired_at_dump"] += 1
                    continue
                statements = document_sql(key, value, expiry)
                if any(len(s.encode()) + 2 > 100000 for s in statements.split(";\n")):
                    raise RuntimeError("Key/value generated a statement over D1's 100KB limit")
                if len((HEADER + statements + FOOTER).encode()) > args.max_file_bytes:
                    raise RuntimeError("A document exceeds --max-file-bytes; increase the file limit")
                if len((sql + statements + FOOTER).encode()) > args.max_file_bytes:
                    summary["sql_files"] += 1
                    (staging / f"{summary['sql_files']:06d}.sql").write_text(sql + FOOTER, encoding="utf-8")
                    sql = HEADER
                sql += statements
                summary["keys"] += 1
                summary["keys_without_ttl" if expiry is None else "keys_with_ttl"] += 1
                summary["largest_value_bytes"] = max(summary["largest_value_bytes"], len(value))
                summary["value_bytes"] += len(value)
        if sql != HEADER:
            summary["sql_files"] += 1
            (staging / f"{summary['sql_files']:06d}.sql").write_text(sql + FOOTER, encoding="utf-8")
        staging.rename(output)
    return summary


def timestamp(value):
    if value.isdigit():
        return int(value)
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None or date.microsecond:
        raise argparse.ArgumentTypeError("Use Unix seconds or a timezone-qualified ISO timestamp in whole seconds")
    return int(date.timestamp())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dump", type=Path)
    parser.add_argument("--dump-time", required=True, type=timestamp,
                        help="RDB snapshot time: Unix seconds or ISO-8601 with timezone")
    parser.add_argument("--output", required=True, type=Path, help="New private directory for SQL files")
    parser.add_argument("--max-file-bytes", type=int, default=4000000)
    parser.add_argument("--redis-image", default="redis:8.4-alpine")
    args = parser.parse_args()
    os.umask(0o077)
    # Treat termination like Ctrl-C so context managers remove private copies.
    def terminate(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminate)
    try:
        print(json.dumps(convert(args), sort_keys=True))
    except KeyboardInterrupt:
        print("Migration interrupted; temporary files/container cleaned up", file=sys.stderr)
        return 130
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Migration failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
