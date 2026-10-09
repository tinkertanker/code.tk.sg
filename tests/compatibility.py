"""Black-box contracts, using real HTTP and isolated legacy-format storage.

Run after cargo build: python3 tests/compatibility.py
Requires redis-server and redis-cli. Never connects to production Redis.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import shlex
import socket
import struct
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Server(unittest.TestCase):
    backend = "file"
    rate = None
    options = {}

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.work = Path(cls.temp.name)
        for name in ["static", "about.md"]:
            (cls.work / name).symlink_to(ROOT / name)
        cls.port = free_port()
        config = {
            "host": "127.0.0.1", "port": cls.port,
            "keyLength": 10, "maxLength": 32,
            "keyGenerator": {"type": "phonetic"},
            "staticMaxAge": 86400, "logging": {"level": "error"},
            "baseUrl": "https://code.tk.sg",
            "documents": {"about": "./about.md"},
            "storage": {"type": cls.backend},
        }
        config.update(cls.options)
        if cls.rate:
            config["rateLimits"] = cls.rate
        cls.legacy_key = "legacykey"
        cls.legacy_data = "old paste\né <&>\n"
        if cls.backend == "redis":
            cls.redis_port = free_port()
            redis = subprocess.Popen([
                "redis-server", "--bind", "127.0.0.1", "--port", str(cls.redis_port),
                "--save", "", "--appendonly", "no", "--dir", cls.temp.name,
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            cls.addClassCleanup(cls.stop, redis)
            for _ in range(100):
                try:
                    if cls.redis("PING").strip() == "PONG":
                        break
                except subprocess.CalledProcessError:
                    pass
                time.sleep(0.05)
            else:
                raise RuntimeError("Test Redis did not start")
            config["storage"].update({"expire": 60, "redisOptions": {
                "host": "127.0.0.1", "port": cls.redis_port, "db": 2,
            }})
            cls.redis("SET", cls.legacy_key, cls.legacy_data, "EX", "20")
        else:
            config["storage"]["path"] = "./data"
            (cls.work / "data").mkdir()
            digest = hashlib.md5(cls.legacy_key.encode()).hexdigest()
            (cls.work / "data" / digest).write_text(cls.legacy_data)
        (cls.work / "config.json").write_text(json.dumps(config))
        # Override the executable for release and Docker test builds.
        command = shlex.split(os.environ.get("SERVER_COMMAND", str(ROOT / "target/debug/code-tk")))
        cls.log = open(cls.work / "server.log", "w+")
        cls.addClassCleanup(cls.log.close)
        cls.process = subprocess.Popen(command, cwd=cls.work, stdout=cls.log, stderr=cls.log)
        cls.addClassCleanup(cls.stop, cls.process)
        for _ in range(200):
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.1):
                    return
            except OSError:
                if cls.process.poll() is not None:
                    break
                time.sleep(0.05)
        cls.log.seek(0)
        raise RuntimeError("Test server did not start: " + cls.log.read())

    @staticmethod
    def stop(process):
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

    @classmethod
    def redis(cls, *args):
        return subprocess.check_output([
            "redis-cli", "-p", str(cls.redis_port), "-n", "2", "--raw", *args
        ], text=True, stderr=subprocess.DEVNULL)

    def request(self, path, body=None, content_type="text/plain", method=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        conn.request(method or ("POST" if body is not None else "GET"), path, body,
                     {"Content-Type": content_type, **(headers or {})})
        response = conn.getresponse()
        result = response.status, response.headers, response.read()
        conn.close()
        return result


class FileContracts(Server):
    def test_existing_storage_and_extension_urls(self):
        status, _, body = self.request("/documents/legacykey.py?unused[x]=1")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"key": self.legacy_key, "data": self.legacy_data})
        status, headers, body = self.request("/raw/legacykey.txt")
        self.assertEqual((status, body.decode()), (200, self.legacy_data))
        self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")

    def test_legacy_route_matching(self):
        for path in ["/RAW/legacykey.txt", "/Raw/legacykey/", "/raw/legacykey/"]:
            status, _, body = self.request(path)
            self.assertEqual((status, body.decode()), (200, self.legacy_data))
        for path in ["/DOCUMENTS/legacykey.py", "/documents/legacykey/"]:
            status, _, body = self.request(path)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["data"], self.legacy_data)
        for path in ["/documents", "/documents/"]:
            self.assertEqual(self.request(path)[0], 200)
        status, _, body = self.request("/DOCUMENTS/", b"slash upload")
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/raw/" + json.loads(body)["key"])[2], b"slash upload")
        self.assertEqual(self.request("/documents/legacykey", b"wrong method")[0], 404)

    def test_upload_roundtrip_and_byte_limits(self):
        value = "é" + "x" * 30
        status, _, body = self.request("/documents", value.encode(), "application/json")
        self.assertEqual(status, 200)
        key = json.loads(body)["key"]
        self.assertRegex(key, r"^[a-z]{10}$")
        self.assertEqual(self.request("/raw/" + key)[2].decode(), value)
        if self.backend == "file":
            self.assertEqual((self.work / "data" / hashlib.md5(key.encode()).hexdigest()).read_text(), value)
        else:
            self.assertEqual(self.redis("GET", key).rstrip("\n"), value)
            self.assertGreater(int(self.redis("TTL", key)), 55)
        for data, expected, message in [
            (b"", 411, "Length required."),
            ((value + "x").encode(), 413, "Document exceeds maximum length."),
        ]:
            status, _, body = self.request("/documents", data)
            self.assertEqual(status, expected)
            self.assertEqual(json.loads(body), {"message": message})

    def test_chunked_utf8_and_early_limit_rejection(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.putrequest("POST", "/documents")
        conn.putheader("Transfer-Encoding", "chunked")
        conn.endheaders()
        for chunk in [b"\xc3", b"\xa9" + b"a" * 30]:
            conn.send(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
        conn.send(b"0\r\n\r\n")
        response = conn.getresponse()
        self.assertEqual(response.status, 200)
        key = json.loads(response.read())["key"]
        conn.close()
        self.assertEqual(self.request("/raw/" + key)[2], "é".encode() + b"a" * 30)

        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.putrequest("POST", "/documents")
        conn.putheader("Transfer-Encoding", "chunked")
        conn.endheaders()
        conn.send(b"21\r\n" + b"x" * 33 + b"\r\n")
        # No terminating chunk: waiting for EOF instead of enforcing the limit fails.
        response = conn.getresponse()
        self.assertEqual(response.status, 413)
        self.assertEqual(json.loads(response.read())["message"], "Document exceeds maximum length.")
        conn.close()

    def test_multipart_contract(self):
        def form(parts, closing=True):
            return ("".join("--test\r\nContent-Disposition: form-data; " + disposition +
                            "\r\n\r\n" + value + "\r\n" for disposition, value in parts) +
                    ("--test--\r\n" if closing else "")).encode()
        ct = "multipart/form-data; boundary=test"
        for parts, expected, message in [
            ([("name=\"data\"", "é" + "x" * 30)], 200, None),
            ([("name=\"data\"", "é" + "x" * 31)], 413, "Document exceeds maximum length."),
            ([("name=\"wrong\"", "abc")], 400, "Expected a data field."),
            ([("name=\"data\"", "a"), ("name=\"data\"", "b")], 413, "Document exceeds maximum length."),
            ([("name=\"data\"; filename=\"x.txt\"", "abc")], 400, "File uploads are not supported."),
        ]:
            with self.subTest(parts=parts):
                status, _, body = self.request("/documents", form(parts), ct)
                self.assertEqual(status, expected)
                if message:
                    self.assertEqual(json.loads(body)["message"], message)
                else:
                    key = json.loads(body)["key"]
                    self.assertEqual(self.request("/raw/" + key)[2].decode(), parts[0][1])
        for charset, value, expected in [
            ("utf-8", b"\xef\xbb\xbfa", "\ufeffa"),
            ("ISO-8859-1", b"caf\xe9\x80", "café\x80"),
            ("utf-16le", b"\xff\xfea\x00\xe9\x00x", "\ufeffaé"),
            ("base64", b"abc", "YWJj"),
            ("shift_jis", b"\x93\xfa\x96\x7b", None),
        ]:
            with self.subTest(charset=charset):
                encoded = (b'--test\r\nContent-Disposition: form-data; name="data"\r\n'
                           b'Content-Type: text/plain; charset=' + charset.encode() +
                           b'\r\n\r\n' + value + b'\r\n--test--\r\n')
                status, _, body = self.request("/documents", encoded, ct)
                if expected is None:
                    self.assertEqual((status, json.loads(body)),
                                     (400, {"message": "Invalid multipart request."}))
                    continue
                self.assertEqual(status, 200)
                key = json.loads(body)["key"]
                self.assertEqual(self.request("/raw/" + key)[2].decode(), expected)
        self.assertEqual(self.request("/documents", b"", "multipart/form-data")[0], 400)
        self.assertEqual(self.request("/documents", form([('name="data"', "abc")], False), ct)[0], 400)

    def test_multipart_preamble_limit_rejects_before_eof(self):
        ct = "multipart/form-data; boundary=test"
        valid = (b"ignored preamble\r\n" * 200 +
                 b'--test\r\nContent-Disposition: form-data; name="data"\r\n\r\n' +
                 b"x" * 32 + b"\r\n--test--\r\n")
        status, _, body = self.request("/documents", valid, ct)
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/raw/" + json.loads(body)["key"])[2], b"x" * 32)

        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.putrequest("POST", "/documents")
            conn.putheader("Content-Type", ct)
            conn.putheader("Transfer-Encoding", "chunked")
            conn.endheaders()
            preamble = b"x" * (20 * 1024)
            conn.send(f"{len(preamble):x}\r\n".encode() + preamble + b"\r\n")
            # No first boundary or EOF: per-field limits alone leave this buffered.
            response = conn.getresponse()
            self.assertEqual(response.status, 413)
            self.assertEqual(json.loads(response.read())["message"], "Document exceeds maximum length.")
        finally:
            conn.close()

    def test_missing_and_static_routes(self):
        for path in ["/raw/notfound", "/documents/notfound"]:
            status, _, body = self.request(path)
            self.assertEqual(status, 404)
            self.assertEqual(json.loads(body), {"message": "Document not found."})
        for path in ["/", "/notfound", "/notfound.py"]:
            status, _, body = self.request(path)
            self.assertEqual(status, 200)
            self.assertIn(b"<title>code.tk.sg</title>", body)
        self.assertEqual(self.request("/application.css")[2], (ROOT / "static/application.css").read_bytes())
        self.assertEqual(self.request("/nested/missing")[0], 404)
        self.assertEqual(self.request("/raw/about")[2], (ROOT / "about.md").read_bytes())
        if self.backend == "file":
            data = self.work / "data"
            data.rename(self.work / "saved-data")
            data.write_text("not a directory")
            try:
                self.assertEqual(self.request("/raw/about")[0], 404)
                status, _, body = self.request("/documents", b"cannot save")
                self.assertEqual(status, 500)
                self.assertEqual(json.loads(body), {
                    "message": "Internal server error occured while adding document."
                })
            finally:
                data.unlink()
                (self.work / "saved-data").rename(data)

    def test_preview_metadata_and_png(self):
        status, headers, body = self.request("/legacykey.py")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "public, max-age=300")
        self.assertIn(b'content="https://code.tk.sg/preview/legacykey.py.png"', body)
        self.assertIn('content="old paste é &lt;&amp;&gt;"'.encode(), body)
        for suffix in [".py", ".txt", ".unknown", ""]:
            status, headers, png = self.request("/preview/legacykey" + suffix + ".png")
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Type"], "image/png")
            self.assertEqual(headers["Cache-Control"], "public, max-age=86400")
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(struct.unpack(">II", png[16:24]), (1200, 900))

    def test_head(self):
        status, headers, body = self.request("/raw/legacykey", method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")


class RedisContracts(FileContracts):
    backend = "redis"

    def test_sliding_expiry_only_on_document_reads(self):
        self.redis("SET", "ttlkey", "unchanged", "EX", "20")
        for path in ["/ttlkey.py", "/preview/ttlkey.py.png"]:
            self.assertEqual(self.request(path)[0], 200)
            self.assertLessEqual(int(self.redis("TTL", "ttlkey")), 20)
        self.assertEqual(self.request("/documents/ttlkey.py")[0], 200)
        self.assertGreater(int(self.redis("TTL", "ttlkey")), 55)
        self.redis("EXPIRE", "ttlkey", "20")
        self.assertEqual(self.request("/raw/ttlkey")[0], 200)
        self.assertGreater(int(self.redis("TTL", "ttlkey")), 55)
        self.assertEqual(int(self.redis("TTL", "about")), -1)
        self.request("/raw/about")
        self.assertEqual(int(self.redis("TTL", "about")), -1)


class RateLimitContracts(Server):
    rate = {"windowMs": 60000, "max": 2}

    def test_all_routes_share_limit_without_trusting_forwarded_headers(self):
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/raw/about")[0], 200)
        status, headers, body = self.request("/application.css", headers={"X-Forwarded-For": "8.8.8.8"})
        self.assertEqual(status, 429)
        self.assertEqual(body, b"Too many requests, please try again later.")
        self.assertEqual(headers["X-RateLimit-Limit"], "2")
        self.assertEqual(headers["X-RateLimit-Remaining"], "0")
        self.assertGreaterEqual(int(headers["Retry-After"]), 1)


class RateLimitResetContracts(Server):
    rate = {"windowMs": 500, "max": 1}

    def test_window_resets(self):
        self.assertEqual(self.request("/")[0], 200)
        time.sleep(0.6)
        self.assertEqual(self.request("/")[0], 200)


class CollisionContracts(Server):
    options = {"keyLength": 1, "keyGenerator": {"type": "random", "keyspace": "AB"}}

    def test_simultaneous_saves_never_overwrite_and_exhaustion_fails(self):
        def save(value):
            status, _, body = self.request("/documents", value)
            self.assertEqual(status, 200)
            return json.loads(body)["key"], value
        with ThreadPoolExecutor(max_workers=2) as workers:
            saved = list(workers.map(save, [b"first", b"second"]))
        self.assertEqual({key for key, _ in saved}, {"A", "B"})
        self.assertEqual(self.request("/documents", b"must not replace")[0], 503)
        for key, value in saved:
            self.assertEqual(self.request("/raw/" + key)[2], value)


class RedisCollisionContracts(CollisionContracts):
    backend = "redis"


class HostOriginContracts(Server):
    options = {"baseUrl": None}

    def test_request_host_is_used_and_content_is_escaped(self):
        status, _, body = self.request("/documents", b'\"><script>alert(1)</script>')
        self.assertEqual(status, 200)
        key = json.loads(body)["key"]
        status, _, html = self.request("/" + key + ".txt", headers={"Host": "paste.example:7777"})
        self.assertEqual(status, 200)
        self.assertIn(f'content="http://paste.example:7777/{key}.txt"'.encode(), html)
        self.assertIn(b'content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"', html)
        self.assertNotIn(b'<script>alert(1)</script>', html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
