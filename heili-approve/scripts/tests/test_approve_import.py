from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import approve_import as importer  # noqa: E402


HEADERS = "source_id,client_id,title,publish_at,networks,text,first_comment,media_files,media_durations\n"


class ApiHandler(BaseHTTPRequestHandler):
    uploads = 0
    creates = 0
    validates = 0

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/api/automation/v1/clients"):
            self._json(
                200,
                {"success": True, "data": {"workspaceId": "workspace-1", "clients": [{"id": "client-1", "name": "Acme", "timezone": "Europe/Rome", "services": []}]}},
            )
            return
        self._json(404, {"success": False, "error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        if self.path == "/api/automation/v1/posts/validate":
            type(self).validates += 1
            parsed = json.loads(body)
            self._json(200, {"success": True, "data": {"valid": True, "externalId": parsed["externalId"], "post": parsed["post"]}})
            return
        if self.path == "/api/automation/v1/media":
            type(self).uploads += 1
            self._json(
                201,
                {
                    "success": True,
                    "data": {
                        "media": {"url": f"/media/{type(self).uploads}", "type": "IMAGE", "mimeType": self.headers["content-type"], "assetId": f"asset-{type(self).uploads}"},
                        "asset": {"id": f"asset-{type(self).uploads}"},
                    },
                },
            )
            return
        if self.path == "/api/automation/v1/posts":
            type(self).creates += 1
            parsed = json.loads(body)
            self._json(200, {"success": True, "data": {"post": {"id": "post-1", "status": "DRAFT", **parsed["post"]}, "replayed": type(self).creates > 1}})
            return
        self._json(404, {"success": False, "error": {"message": "not found"}})


class ImporterTests(unittest.TestCase):
    def setUp(self) -> None:
        ApiHandler.uploads = 0
        ApiHandler.creates = 0
        ApiHandler.validates = 0
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def write(self, name: str, content: str | bytes) -> Path:
        path = self.root / name
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
        return path

    def run_main(self, arguments: list[str], base_url: str) -> tuple[int, dict[str, object]]:
        old_base = os.environ.get("APPROVE_BASE_URL")
        old_token = os.environ.get("APPROVE_API_TOKEN")
        os.environ["APPROVE_BASE_URL"] = base_url
        os.environ["APPROVE_API_TOKEN"] = "unit-test-secret-token"
        output = io.StringIO()
        try:
            with contextlib.redirect_stdout(output):
                code = importer.main(arguments)
        finally:
            if old_base is None:
                os.environ.pop("APPROVE_BASE_URL", None)
            else:
                os.environ["APPROVE_BASE_URL"] = old_base
            if old_token is None:
                os.environ.pop("APPROVE_API_TOKEN", None)
            else:
                os.environ["APPROVE_API_TOKEN"] = old_token
        return code, json.loads(output.getvalue())

    @contextlib.contextmanager
    def server(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), ApiHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_csv_bom_semicolon_and_timezone(self) -> None:
        path = self.write(
            "posts.csv",
            "\ufeffsource_id;client_id;title;publish_at;networks;text\nrow-1;client-1;Titolo;2026-10-09 10:30;INSTAGRAM|FACEBOOK;Testo\n",
        )
        rows = importer.parse_rows(path, "Europe/Rome", None)
        self.assertEqual(rows[0].external_id, "row-1")
        self.assertEqual(rows[0].post["networks"], ["instagram", "facebook"])
        self.assertEqual(rows[0].post["publishAt"], "2026-10-09T10:30:00+02:00")

    def test_duplicate_external_id_rejected_before_api(self) -> None:
        path = self.write(
            "posts.csv",
            HEADERS
            + "same,client-1,Uno,2026-10-09T10:00:00+02:00,INSTAGRAM,Testo,,,\n"
            + "same,client-1,Due,2026-10-10T10:00:00+02:00,INSTAGRAM,Testo,,,\n",
        )
        with self.assertRaisesRegex(importer.ImporterError, "source_id duplicato"):
            importer.parse_rows(path, None, None)

    def test_unknown_header_has_suggestion(self) -> None:
        path = self.write(
            "posts.csv",
            "source_id,client_id,title,publish_at,netwroks,text\na,b,c,2026-10-09T10:00:00+02:00,INSTAGRAM,x\n",
        )
        with self.assertRaisesRegex(importer.ImporterError, "netwroks -> networks"):
            importer.load_csv(path)

    def test_csv_preserves_newlines_inside_quoted_text(self) -> None:
        path = self.write(
            "posts.csv",
            HEADERS + 'one,client-1,Uno,2026-10-09T10:00:00+02:00,INSTAGRAM,"Prima riga\nSeconda riga",,,\n',
        )
        rows = importer.parse_rows(path, None, None)
        self.assertEqual(rows[0].post["text"], "Prima riga\nSeconda riga")

    def test_media_cannot_escape_root_or_use_symlink(self) -> None:
        outside = Path(self.tempdir.name).parent / "outside-import-test.jpg"
        outside.write_bytes(b"jpeg")
        try:
            path = self.write(
                "posts.csv",
                HEADERS + "one,client-1,Uno,2026-10-09T10:00:00+02:00,INSTAGRAM,Testo,,../outside-import-test.jpg,\n",
            )
            with self.assertRaisesRegex(importer.ImporterError, "fuori dalla cartella"):
                importer.parse_rows(path, None, None)
        finally:
            outside.unlink(missing_ok=True)

    def test_dry_run_never_uploads_or_creates(self) -> None:
        self.write("photo.jpg", b"fake-image")
        path = self.write(
            "posts.csv",
            HEADERS + "one,client-1,Uno,2026-10-09T10:00:00+02:00,INSTAGRAM,Testo,,photo.jpg,\n",
        )
        with self.server() as base_url:
            code, payload = self.run_main(["import", str(path)], base_url)
        self.assertEqual(code, 0)
        self.assertTrue(payload["success"])
        self.assertEqual(ApiHandler.validates, 1)
        self.assertEqual(ApiHandler.uploads, 0)
        self.assertEqual(ApiHandler.creates, 0)
        self.assertTrue(payload["data"]["rows"][0]["mediaDeferred"])

    def test_commit_and_manifest_reuse_uploaded_media(self) -> None:
        self.write("photo.jpg", b"fake-image")
        path = self.write(
            "posts.csv",
            HEADERS + "one,client-1,Uno,2026-10-09T10:00:00+02:00,INSTAGRAM,Testo,,photo.jpg,\n",
        )
        manifest = self.root / "resume.json"
        with self.server() as base_url:
            first_code, first = self.run_main(["import", str(path), "--commit", "--manifest", str(manifest)], base_url)
            second_code, second = self.run_main(["import", str(path), "--commit", "--manifest", str(manifest)], base_url)
        self.assertEqual((first_code, second_code), (0, 0))
        self.assertTrue(first["success"])
        self.assertTrue(second["success"])
        self.assertEqual(ApiHandler.uploads, 1)
        self.assertEqual(ApiHandler.creates, 2)
        self.assertEqual(second["data"]["rows"][0]["cachedMedia"], 1)
        manifest_text = manifest.read_text(encoding="utf-8")
        self.assertNotIn("unit-test-secret-token", manifest_text)

    def test_commit_creates_default_sidecar_manifest(self) -> None:
        self.write("photo.jpg", b"fake-image")
        path = self.write(
            "posts.csv",
            HEADERS + "one,client-1,Uno,2026-10-09T10:00:00+02:00,INSTAGRAM,Testo,,photo.jpg,\n",
        )
        expected_manifest = path.with_name(path.name + ".approve-import-state.json")
        with self.server() as base_url:
            code, payload = self.run_main(["import", str(path), "--commit"], base_url)
        self.assertEqual(code, 0)
        self.assertTrue(expected_manifest.is_file())
        self.assertEqual(payload["data"]["manifest"], str(expected_manifest))

    def write_xlsx(self, *, formula: bool = False, date_1904: bool = False) -> Path:
        path = self.root / "posts.xlsx"
        workbook_pr = '<workbookPr date1904="1"/>' if date_1904 else "<workbookPr/>"
        headers = ["source_id", "client_id", "title", "publish_at", "networks", "text"]
        header_cells = "".join(
            f'<c r="{chr(65 + index)}1" t="inlineStr"><is><t>{value}</t></is></c>'
            for index, value in enumerate(headers)
        )
        publish_cell = '<c r="D2"><f>NOW()</f><v>1</v></c>' if formula else '<c r="D2" s="1"><v>1.5</v></c>'
        row_cells = (
            '<c r="A2" t="inlineStr"><is><t>xlsx-1</t></is></c>'
            '<c r="B2" t="inlineStr"><is><t>client-1</t></is></c>'
            '<c r="C2" t="inlineStr"><is><t>Title</t></is></c>'
            + publish_cell
            + '<c r="E2" t="inlineStr"><is><t>INSTAGRAM</t></is></c>'
            '<c r="F2" t="inlineStr"><is><t>Text</t></is></c>'
        )
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "xl/workbook.xml",
                f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{workbook_pr}<sheets><sheet name="Posts" sheetId="1" r:id="rId1"/></sheets></workbook>',
            )
            archive.writestr(
                "xl/_rels/workbook.xml.rels",
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
            )
            archive.writestr(
                "xl/styles.xml",
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
            )
            archive.writestr(
                "xl/worksheets/sheet1.xml",
                f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">{header_cells}</row><row r="2">{row_cells}</row></sheetData></worksheet>',
            )
        return path

    def test_xlsx_1904_date_cell(self) -> None:
        rows = importer.parse_rows(self.write_xlsx(date_1904=True), "UTC", None)
        self.assertEqual(rows[0].post["publishAt"], "1904-01-02T12:00:00+00:00")

    def test_xlsx_formula_rejected(self) -> None:
        with self.assertRaisesRegex(importer.ImporterError, "formule XLSX"):
            importer.load_xlsx(self.write_xlsx(formula=True))

    def test_http_requires_https_outside_localhost(self) -> None:
        with self.assertRaisesRegex(importer.ImporterError, "HTTPS"):
            importer.normalized_base_url("http://approve.example.com")

    def test_external_id_contract_is_checked_locally(self) -> None:
        path = self.write(
            "posts.csv",
            HEADERS + "not allowed,client-1,Uno,2026-10-09T10:00:00+02:00,INSTAGRAM,Testo,,,\n",
        )
        with self.assertRaisesRegex(importer.ImporterError, "source_id deve iniziare"):
            importer.parse_rows(path, None, None)

    def test_redirect_is_rejected_without_forwarding_token(self) -> None:
        class Receiver(BaseHTTPRequestHandler):
            hits = 0

            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802
                type(self).hits += 1
                self.send_response(200)
                self.end_headers()

        receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)

        class Redirector(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{receiver.server_port}/steal")
                self.end_headers()

        redirector = ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
        receiver_thread = threading.Thread(target=receiver.serve_forever, daemon=True)
        redirect_thread = threading.Thread(target=redirector.serve_forever, daemon=True)
        receiver_thread.start()
        redirect_thread.start()
        try:
            client = importer.ApiClient(f"http://127.0.0.1:{redirector.server_port}", "secret", 2)
            with self.assertRaises(importer.ImporterError):
                client.get("/redirect")
            self.assertEqual(Receiver.hits, 0)
        finally:
            redirector.shutdown()
            receiver.shutdown()
            redirect_thread.join()
            receiver_thread.join()
            redirector.server_close()
            receiver.server_close()


if __name__ == "__main__":
    unittest.main()
