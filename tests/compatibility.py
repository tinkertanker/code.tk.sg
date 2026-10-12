"""Black-box HTTP contracts for the code.tk.sg Worker.

Run against local wrangler dev (see worker/README.md):
    WORKER_URL=http://127.0.0.1:8787 python3 tests/compatibility.py
Storage, expiry, rate-limit and collision contracts live in the Worker's
Vitest suite (worker/test/compatibility.test.ts).
"""
import http.client
import json
import os
from pathlib import Path
import struct
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        endpoint = urlsplit(os.environ.get("WORKER_URL", ""))
        if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1":
            raise RuntimeError("Set WORKER_URL=http://127.0.0.1:<port> (npm --prefix worker run dev:compat)")
        cls.port = endpoint.port or 80
        cls.legacy_key = "legacykey"
        cls.legacy_data = "old paste\né <&>\n"

    def request(self, path, body=None, content_type="text/plain", method=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        conn.request(method or ("POST" if body is not None else "GET"), path, body,
                     {"Content-Type": content_type, **(headers or {})})
        response = conn.getresponse()
        result = response.status, response.headers, response.read()
        conn.close()
        return result


class HttpContracts(Server):
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
    def test_preview_metadata_and_png(self):
        status, headers, body = self.request("/legacykey.py")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "public, max-age=300")
        origin = os.environ["WORKER_URL"].rstrip("/")
        self.assertIn(f'content="{origin}/preview/legacykey.py.png"'.encode(), body)
        self.assertIn('content="old paste é &lt;&amp;&gt;"'.encode(), body)

    @unittest.skipIf(os.environ.get("WORKER_SKIP_PREVIEW") == "1",
                     "Phase-1 Worker preview stub; PNG requires phase-2 integration")
    def test_preview_png(self):
        for suffix in [".py", ".txt", ".unknown", ""]:
            status, headers, png = self.request("/preview/legacykey" + suffix + ".png")
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Type"], "image/png")
            self.assertEqual(headers["Cache-Control"], "public, max-age=300")
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(struct.unpack(">II", png[16:24]), (1200, 900))
        # Ruby's character literal grammar can split an astral character between spans.
        status, _, body = self.request("/documents", "puts ?😀".encode())
        self.assertEqual(status, 200)
        key = json.loads(body)["key"]
        status, _, png = self.request("/preview/" + key + ".rb.png")
        self.assertEqual(status, 200)
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")

    def test_head(self):
        status, headers, body = self.request("/raw/legacykey", method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")


class HostOriginContracts(Server):
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
