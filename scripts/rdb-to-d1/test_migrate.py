"""Public CLI regression test; requires Docker, no Cloudflare credentials."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest


HERE = Path(__file__).resolve().parent
SCHEMA = """
CREATE TABLE documents (key TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER);
CREATE INDEX documents_expires_at ON documents(expires_at);
"""


class MigrationTest(unittest.TestCase):
    def test_dump_round_trip_and_replay(self):
        with tempfile.TemporaryDirectory(prefix="rdb-test-") as directory:
            root = Path(directory)
            container = subprocess.check_output([
                "docker", "run", "--detach", "--network", "none",
                "--user", f"{os.getuid()}:{os.getgid()}",
                "--volume", f"{root}:/data", "redis:8.4-alpine",
                "redis-server", "--save", "", "--appendonly", "no",
            ], text=True).strip()
            try:
                for _ in range(100):
                    ping = subprocess.run(["docker", "exec", container, "redis-cli", "PING"],
                                          capture_output=True)
                    if ping.stdout.strip() == b"PONG":
                        break
                    time.sleep(0.1)
                else:
                    self.fail("fixture Redis failed to start")
                dump_time = int(time.time())
                # Multibyte characters cross SQL chunk boundaries; embedded NULs,
                # quotes and SQL-looking text must survive without interpretation.
                large = ("漢😀'\x00;--\n".encode() * 40000)[:400000]
                expected = {
                    b"large": (large, dump_time + 3),
                    "clé'😀".encode(): (("café'; DROP TABLE documents; --\n" * 4000).encode(),
                                           dump_time + 86401),
                    b"empty": (b"", None),
                    b"no-ttl": (b"line 1\r\nline 2\\end", None),
                }
                commands = [[b"SELECT", b"0"], [b"SET", b"other-app", b"do not migrate"],
                            [b"SELECT", b"2"]]
                for key, (value, expiry) in expected.items():
                    commands.append([b"SET", key, value])
                    if expiry is not None:
                        # Check both sides of Redis TTL's 500ms rounding boundary.
                        millis = (expiry - 1) * 1000 + 987 if key == b"large" else expiry * 1000 + 123
                        commands.append([b"PEXPIREAT", key, str(millis).encode()])
                commands.append([b"SAVE"])
                wire = b"".join(
                    b"*%d\r\n" % len(command) + b"".join(
                        b"$%d\r\n" % len(arg) + arg + b"\r\n" for arg in command)
                    for command in commands)
                subprocess.run(["docker", "exec", "-i", container, "redis-cli", "--pipe"],
                               input=wire, check=True, capture_output=True)
            finally:
                subprocess.run(["docker", "rm", "--force", container],
                               check=True, capture_output=True)
            # A master-mode load would now discard the short-TTL document.
            time.sleep(3)
            result = subprocess.run([
                sys.executable, str(HERE / "migrate.py"), str(root / "dump.rdb"),
                "--dump-time", str(dump_time), "--output", str(root / "sql"),
                "--max-file-bytes", "900000",
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout)
            self.assertEqual(summary["keys"], 4)
            self.assertEqual(summary["keys_without_ttl"], 2)
            self.assertEqual(summary["largest_value_bytes"], 400000)
            files = sorted((root / "sql").glob("*.sql"))
            self.assertGreater(len(files), 1)
            wrangler = os.environ.get("WRANGLER_BIN")
            if wrangler:
                config = root / "wrangler.json"
                config.write_text(json.dumps({
                    "name": "rdb-test", "compatibility_date": "2026-10-12",
                    "d1_databases": [{"binding": "DB", "database_name": "rdb-test",
                                      "database_id": "00000000-0000-0000-0000-000000000001"}],
                }))
                schema = root / "schema.sql"
                schema.write_text(SCHEMA)
                env = {k: v for k, v in os.environ.items() if not k.startswith("CLOUDFLARE_")}
                env.update(WRANGLER_SEND_METRICS="false", XDG_CONFIG_HOME=str(root / "config"))
                for path in [schema, *files, *files]:
                    imported = subprocess.run([
                        wrangler, "d1", "execute", "rdb-test", "--local", "--config", str(config),
                        "--persist-to", str(root / "d1"), "--file", str(path),
                    ], capture_output=True, text=True, env=env)
                    self.assertEqual(imported.returncode, 0, imported.stderr)
                databases = [p for p in (root / "d1" / "v3" / "d1").rglob("*.sqlite")
                             if p.name != "metadata.sqlite"]
                self.assertEqual(len(databases), 1)
                with sqlite3.connect(databases[0]) as local_d1:
                    actual = local_d1.execute("SELECT CAST(key AS BLOB), CAST(data AS BLOB), "
                                              "expires_at FROM documents").fetchall()
                    self.assertEqual({k: (v, e) for k, v, e in actual}, expected)
            db = sqlite3.connect(":memory:")
            db.executescript(SCHEMA)
            for replay in range(2):
                for path in files:
                    self.assertLessEqual(path.stat().st_size, 900000)
                    sql = path.read_text()
                    for statement in sql.split(";\n"):
                        self.assertLess(len(statement.encode()), 100000)
                    db.executescript(sql)
                rows = db.execute("SELECT CAST(key AS BLOB), CAST(data AS BLOB), expires_at "
                                  "FROM documents").fetchall()
                if replay == 0:
                    self.assertEqual({k: (v, e) for k, v, e in rows}, expected)
                    # Replays must preserve a document already renewed/changed by D1.
                    db.execute("UPDATE documents SET data = 'newer', expires_at = 7 "
                               "WHERE key = 'large'")
                else:
                    self.assertEqual(len(rows), 4)
                    self.assertEqual(db.execute("SELECT data, expires_at FROM documents "
                                                "WHERE key = 'large'").fetchone(), ("newer", 7))
            self.assertEqual(db.execute("SELECT count(*) FROM sqlite_schema "
                                        "WHERE name = '_rdb_to_d1_chunks'").fetchone()[0], 0)
            failed = subprocess.run([
                sys.executable, str(HERE / "migrate.py"), str(root / "dump.rdb"),
                "--dump-time", str(dump_time), "--output", str(root / "too-small"),
                "--max-file-bytes", "80000",
            ], capture_output=True, text=True)
            self.assertEqual(failed.returncode, 1)
            self.assertIn("--max-file-bytes", failed.stderr)
            self.assertFalse((root / "too-small").exists())


if __name__ == "__main__":
    unittest.main()
