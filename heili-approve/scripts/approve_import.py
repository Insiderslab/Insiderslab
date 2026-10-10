#!/usr/bin/env python3
"""Portable, dependency-free importer for Approve by Heili.

The program intentionally prints one JSON document to stdout for every command.
It is designed to be called by people, Codex, Claude, or another local agent.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import difflib
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import ssl
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


VERSION = "1.0.0"
API_PREFIX = "/api/automation/v1"
ALLOWED_HEADERS = {
    "source_id",
    "client_id",
    "title",
    "publish_at",
    "networks",
    "text",
    "first_comment",
    "media_files",
    "media_durations",
    "kind",
    "network_options",
}
REQUIRED_HEADERS = {"source_id", "client_id", "title", "publish_at", "networks", "text"}
MAX_ROWS = 10_000
MAX_CELLS = 250_000
MAX_COLUMNS = 128
MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_ZIP_UNCOMPRESSED = 100 * 1024 * 1024
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
MAX_MEDIA_BYTES = 300 * 1024 * 1024
DATE_FORMAT_IDS = {14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
EXTERNAL_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$")


class ImporterError(Exception):
    """An expected, safe-to-display importer failure."""


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        json_print({"success": False, "error": {"message": message}})
        raise SystemExit(2)


@dataclass(frozen=True)
class ExcelDate:
    value: dt.datetime


@dataclass(frozen=True)
class MediaFile:
    path: Path
    duration: float | None
    mime_type: str
    size: int
    sha256: str


@dataclass
class ParsedRow:
    row_number: int
    external_id: str
    post: dict[str, Any]
    media: list[MediaFile]


def json_print(payload: dict[str, Any]) -> None:
    # ASCII JSON escapes preserve Unicode paths/copy on Windows code pages too.
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":"), default=str))


def redact(value: str, token: str | None) -> str:
    text = value
    if token:
        text = text.replace(token, "[REDACTED]")
    return re.sub(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+", r"\1[REDACTED]", text)


def normalized_base_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(raw)
    except ValueError as exc:
        raise ImporterError(f"APPROVE_BASE_URL non valido: {exc}") from exc
    if not parsed.scheme or not parsed.hostname:
        raise ImporterError("APPROVE_BASE_URL deve essere un URL assoluto")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ImporterError("APPROVE_BASE_URL non può contenere credenziali, query o frammenti")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in LOCAL_HOSTS):
        raise ImporterError("APPROVE_BASE_URL deve usare HTTPS; HTTP è ammesso solo su localhost")
    path = parsed.path.rstrip("/")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


class ApiClient:
    def __init__(self, base_url: str, token: str, timeout: float) -> None:
        self.base_url = normalized_base_url(base_url)
        if not token.strip():
            raise ImporterError("APPROVE_API_TOKEN mancante")
        self.token = token.strip()
        if not 1 <= timeout <= 120:
            raise ImporterError("--timeout deve essere compreso tra 1 e 120 secondi")
        self.timeout = timeout
        self.opener = urllib.request.build_opener(
            NoRedirectHandler(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        binary_body: bytes | Iterable[bytes] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        if not path.startswith("/"):
            raise ImporterError("Percorso API interno non valido")
        data: bytes | None = None
        request_headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "User-Agent": f"approve-import/{VERSION}",
        }
        if json_body is not None:
            data = json.dumps(json_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        elif binary_body is not None:
            data = binary_body
        if headers:
            request_headers.update(headers)
        request = urllib.request.Request(self.base_url + path, data=data, headers=request_headers, method=method)
        try:
            # Redirects are rejected so the bearer token can never be forwarded
            # to another origin through a malicious or accidental Location.
            with self.opener.open(request, timeout=self.timeout) as response:
                status = response.status
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                raw = exc.read(MAX_RESPONSE_BYTES + 1)
            finally:
                exc.close()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ImporterError(f"Connessione API fallita: {redact(str(exc), self.token)}") from exc
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ImporterError("Risposta API troppo grande")
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ImporterError(f"Risposta API non JSON (HTTP {status})") from exc
        if not isinstance(payload, dict):
            raise ImporterError(f"Risposta API inattesa (HTTP {status})")
        return status, payload

    def get(self, path: str) -> dict[str, Any]:
        status, payload = self.request("GET", path)
        if not 200 <= status < 300:
            raise api_error(status, payload)
        return payload

    def post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        status, payload = self.request("POST", path, json_body=body)
        if not 200 <= status < 300:
            raise api_error(status, payload)
        return payload


def api_error(status: int, payload: dict[str, Any]) -> ImporterError:
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("code")
    else:
        message = error
    if not isinstance(message, str) or not message.strip():
        message = payload.get("message") if isinstance(payload.get("message"), str) else "richiesta rifiutata"
    return ImporterError(f"API HTTP {status}: {message}")


def read_limited(path: Path) -> bytes:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise ImporterError(f"Impossibile leggere {path}: {exc}") from exc
    if size > MAX_INPUT_BYTES:
        raise ImporterError(f"File di input troppo grande ({size} byte; massimo {MAX_INPUT_BYTES})")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise ImporterError(f"Impossibile leggere {path}: {exc}") from exc


def validate_headers(headers: list[str]) -> list[str]:
    normalized = [str(value).strip().lower() for value in headers]
    if any(not header for header in normalized):
        raise ImporterError("Tutte le colonne devono avere un'intestazione")
    if len(set(normalized)) != len(normalized):
        raise ImporterError("Intestazioni duplicate nel file")
    unknown = [header for header in normalized if header and header not in ALLOWED_HEADERS]
    if unknown:
        suggestions = []
        for header in unknown:
            match = difflib.get_close_matches(header, sorted(ALLOWED_HEADERS), n=1, cutoff=0.55)
            suggestions.append(f"{header} -> {match[0]}" if match else header)
        raise ImporterError("Intestazioni sconosciute: " + ", ".join(suggestions))
    missing = sorted(REQUIRED_HEADERS - set(normalized))
    if missing:
        raise ImporterError("Intestazioni obbligatorie mancanti: " + ", ".join(missing))
    return normalized


def load_csv(path: Path) -> list[dict[str, Any]]:
    raw = read_limited(path)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImporterError("Il CSV deve essere UTF-8 (è accettato anche il BOM)") from exc
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text, newline=""), dialect)
    try:
        raw_headers = next(reader)
    except StopIteration:
        raise ImporterError("Il CSV è vuoto")
    headers = validate_headers(raw_headers)
    rows: list[dict[str, Any]] = []
    for row_number, values in enumerate(reader, start=2):
        if row_number > MAX_ROWS + 1:
            raise ImporterError(f"Il file supera il limite di {MAX_ROWS} righe")
        if not any(str(value).strip() for value in values):
            continue
        if len(values) > len(headers):
            raise ImporterError(f"Riga {row_number}: ci sono più celle delle intestazioni")
        values = [value.replace("\r\n", "\n").replace("\r", "\n") for value in values]
        values.extend([""] * (len(headers) - len(values)))
        rows.append({"__row__": row_number, **dict(zip(headers, values, strict=True))})
    return rows


def load_json(path: Path) -> list[dict[str, Any]]:
    raw = read_limited(path)
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ImporterError(f"JSON non valido: {exc}") from exc
    if isinstance(payload, dict) and "posts" in payload:
        payload = payload["posts"]
    if not isinstance(payload, list):
        raise ImporterError("Il JSON deve essere un array o un oggetto con proprietà posts")
    if len(payload) > MAX_ROWS:
        raise ImporterError(f"Il file supera il limite di {MAX_ROWS} righe")
    rows: list[dict[str, Any]] = []
    all_headers: set[str] = set()
    for index, value in enumerate(payload, start=1):
        if not isinstance(value, dict):
            raise ImporterError(f"Elemento JSON {index}: atteso un oggetto")
        normalized_keys = [str(key).strip().lower() for key in value]
        if len(normalized_keys) != len(set(normalized_keys)):
            raise ImporterError(f"Elemento JSON {index}: proprietà duplicate dopo la normalizzazione")
        all_headers.update(normalized_keys)
    validate_headers(sorted(all_headers))
    for index, value in enumerate(payload, start=1):
        normalized = {str(key).strip().lower(): item for key, item in value.items()}
        rows.append({"__row__": index, **normalized})
    return rows


def safe_zip(path: Path) -> zipfile.ZipFile:
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise ImporterError(f"XLSX troppo grande; massimo {MAX_INPUT_BYTES} byte")
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise ImporterError(f"XLSX non valido: {exc}") from exc
    total = 0
    for info in archive.infolist():
        pure = Path(info.filename.replace("\\", "/"))
        if pure.is_absolute() or ".." in pure.parts:
            archive.close()
            raise ImporterError("XLSX contiene un percorso ZIP non sicuro")
        if info.flag_bits & 0x1:
            archive.close()
            raise ImporterError("XLSX cifrati non sono supportati")
        total += info.file_size
        if total > MAX_ZIP_UNCOMPRESSED:
            archive.close()
            raise ImporterError("XLSX espanso troppo grande")
        lowered = info.filename.lower()
        if any(marker in lowered for marker in ("vbaproject", "externalinks/", "embeddings/", "oleobject")):
            archive.close()
            raise ImporterError("XLSX con macro, collegamenti esterni o oggetti incorporati non supportato")
        if lowered.endswith(".rels"):
            try:
                relations = ET.fromstring(archive.read(info))
            except ET.ParseError as exc:
                archive.close()
                raise ImporterError(f"Relazioni XLSX non valide in {info.filename}") from exc
            if any(node.attrib.get("TargetMode", "").lower() == "external" for node in relations):
                archive.close()
                raise ImporterError("XLSX con relazioni esterne non supportato")
    return archive


def xml_root(archive: zipfile.ZipFile, name: str, *, required: bool = True) -> ET.Element | None:
    try:
        raw = archive.read(name)
    except KeyError:
        if required:
            raise ImporterError(f"XLSX incompleto: manca {name}")
        return None
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ImporterError(f"XML XLSX non valido in {name}: {exc}") from exc


def local_tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    root = xml_root(archive, "xl/sharedStrings.xml", required=False)
    if root is None:
        return []
    values: list[str] = []
    for item in root:
        if local_tag(item) != "si":
            continue
        values.append("".join(node.text or "" for node in item.iter() if local_tag(node) == "t"))
        if len(values) > MAX_CELLS:
            raise ImporterError("XLSX contiene troppe stringhe condivise")
    return values


def date_style_indexes(archive: zipfile.ZipFile) -> set[int]:
    root = xml_root(archive, "xl/styles.xml", required=False)
    if root is None:
        return set()
    custom: set[int] = set()
    for node in root.iter():
        if local_tag(node) == "numFmt":
            try:
                num_id = int(node.attrib.get("numFmtId", "-1"))
            except ValueError:
                continue
            code = re.sub(r'"[^\"]*"|\\.|\[[^\]]*\]', "", node.attrib.get("formatCode", ""))
            if re.search(r"(?i)(?:^|[^a-z])[ymdhis]+", code):
                custom.add(num_id)
    result: set[int] = set()
    cell_xfs = next((node for node in root.iter() if local_tag(node) == "cellXfs"), None)
    if cell_xfs is not None:
        for index, xf in enumerate(cell_xfs):
            try:
                num_id = int(xf.attrib.get("numFmtId", "0"))
            except ValueError:
                num_id = 0
            if num_id in DATE_FORMAT_IDS or num_id in custom:
                result.add(index)
    return result


def excel_serial(value: str, date_1904: bool) -> ExcelDate:
    try:
        serial = float(value)
    except ValueError as exc:
        raise ImporterError(f"Valore data Excel non valido: {value}") from exc
    whole = int(serial)
    fraction = serial - whole
    if not date_1904 and whole == 60:
        raise ImporterError("La data fittizia Excel 1900-02-29 non è supportata")
    if date_1904:
        return ExcelDate(dt.datetime(1904, 1, 1) + dt.timedelta(days=serial))
    # Excel pretends 1900 was a leap year. Serial 60 is rejected above; dates
    # before it need a different epoch from dates after it.
    base = dt.datetime(1899, 12, 31) if whole < 60 else dt.datetime(1899, 12, 30)
    return ExcelDate(base + dt.timedelta(days=serial))


def workbook_sheet(archive: zipfile.ZipFile) -> tuple[str, bool]:
    workbook = xml_root(archive, "xl/workbook.xml")
    assert workbook is not None
    date_1904 = False
    relationship_id: str | None = None
    for node in workbook.iter():
        if local_tag(node) == "workbookPr":
            date_1904 = node.attrib.get("date1904", "0").lower() in {"1", "true"}
        if local_tag(node) == "sheet" and relationship_id is None:
            relationship_id = next((value for key, value in node.attrib.items() if key.endswith("}id")), None)
    if not relationship_id:
        raise ImporterError("XLSX senza fogli")
    rels = xml_root(archive, "xl/_rels/workbook.xml.rels")
    assert rels is not None
    target: str | None = None
    for relation in rels:
        if relation.attrib.get("Id") == relationship_id:
            if relation.attrib.get("TargetMode", "").lower() == "external":
                raise ImporterError("XLSX con relazione esterna non supportato")
            target = relation.attrib.get("Target")
            break
    if not target:
        raise ImporterError("XLSX: foglio non risolvibile")
    normalized = target.replace("\\", "/").lstrip("/")
    if normalized.startswith("../") or "/../" in normalized:
        raise ImporterError("XLSX: percorso foglio non sicuro")
    if not normalized.startswith("xl/"):
        normalized = "xl/" + normalized
    return normalized, date_1904


def column_index(reference: str) -> int:
    match = re.match(r"^([A-Z]+)", reference.upper())
    if not match:
        raise ImporterError(f"Riferimento cella XLSX non valido: {reference}")
    value = 0
    for character in match.group(1):
        value = value * 26 + ord(character) - 64
    if value < 1 or value > MAX_COLUMNS:
        raise ImporterError(f"XLSX supera il limite di {MAX_COLUMNS} colonne")
    return value - 1


def parse_xlsx_cell(cell: ET.Element, strings: list[str], date_styles: set[int], date_1904: bool) -> Any:
    if any(local_tag(node) == "f" for node in cell):
        raise ImporterError("Le formule XLSX non sono supportate: sostituirle con valori")
    cell_type = cell.attrib.get("t", "n")
    value_node = next((node for node in cell if local_tag(node) == "v"), None)
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter() if local_tag(node) == "t")
    value = value_node.text if value_node is not None and value_node.text is not None else ""
    if cell_type == "s":
        try:
            return strings[int(value)]
        except (ValueError, IndexError) as exc:
            raise ImporterError("Indice sharedStrings XLSX non valido") from exc
    if cell_type in {"str", "d"}:
        return value
    if cell_type == "b":
        return value == "1"
    try:
        style = int(cell.attrib.get("s", "0"))
    except ValueError:
        style = 0
    if value and style in date_styles:
        return excel_serial(value, date_1904)
    return value


def load_xlsx(path: Path) -> list[dict[str, Any]]:
    with safe_zip(path) as archive:
        sheet_name, date_1904 = workbook_sheet(archive)
        strings = shared_strings(archive)
        date_styles = date_style_indexes(archive)
        root = xml_root(archive, sheet_name)
        assert root is not None
        parsed_rows: list[tuple[int, list[Any]]] = []
        cell_count = 0
        for row_node in (node for node in root.iter() if local_tag(node) == "row"):
            if len(parsed_rows) > MAX_ROWS:
                raise ImporterError(f"XLSX supera il limite di {MAX_ROWS} righe")
            try:
                row_number = int(row_node.attrib.get("r", str(len(parsed_rows) + 1)))
            except ValueError:
                row_number = len(parsed_rows) + 1
            values: list[Any] = []
            for cell in (node for node in row_node if local_tag(node) == "c"):
                cell_count += 1
                if cell_count > MAX_CELLS:
                    raise ImporterError(f"XLSX supera il limite di {MAX_CELLS} celle")
                index = column_index(cell.attrib.get("r", "A1"))
                if len(values) <= index:
                    values.extend([""] * (index + 1 - len(values)))
                values[index] = parse_xlsx_cell(cell, strings, date_styles, date_1904)
            if any(value != "" for value in values):
                parsed_rows.append((row_number, values))
    if not parsed_rows:
        raise ImporterError("XLSX vuoto")
    headers = validate_headers([str(value) for value in parsed_rows[0][1]])
    rows: list[dict[str, Any]] = []
    for row_number, values in parsed_rows[1:]:
        if len(values) > len(headers) and any(value != "" for value in values[len(headers):]):
            raise ImporterError(f"Riga {row_number}: ci sono più celle delle intestazioni")
        values = values[: len(headers)] + [""] * max(0, len(headers) - len(values))
        rows.append({"__row__": row_number, **dict(zip(headers, values, strict=True))})
    return rows


def load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise ImporterError(f"File di input non trovato: {path}")
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return load_csv(path)
    if suffix == ".json":
        return load_json(path)
    if suffix == ".xlsx":
        return load_xlsx(path)
    raise ImporterError("Formato non supportato: usare .csv, .json o .xlsx")


def required_text(value: Any, field: str, row_number: int, *, max_length: int | None = None) -> str:
    text = str(value).strip() if value is not None else ""
    if not text:
        raise ImporterError(f"Riga {row_number}: {field} è obbligatorio")
    if max_length is not None and len(text) > max_length:
        raise ImporterError(f"Riga {row_number}: {field} supera {max_length} caratteri")
    return text


def split_list(value: Any, field: str, row_number: int) -> list[str]:
    if isinstance(value, list):
        items = value
    else:
        items = re.split(r"[|,]", str(value or ""))
    result = [str(item).strip() for item in items if str(item).strip()]
    if field == "networks":
        result = [item.lower() for item in result]
    if field == "networks" and not result:
        raise ImporterError(f"Riga {row_number}: networks è obbligatorio")
    return result


def json_object(value: Any, field: str, row_number: int) -> dict[str, Any] | None:
    if value in (None, ""):
        return None
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError as exc:
        raise ImporterError(f"Riga {row_number}: {field} deve essere JSON valido") from exc
    if not isinstance(parsed, dict):
        raise ImporterError(f"Riga {row_number}: {field} deve essere un oggetto JSON")
    return parsed


def localized_datetime(value: dt.datetime, timezone_name: str | None, row_number: int) -> str:
    if value.tzinfo is not None and value.utcoffset() is not None:
        return value.isoformat(timespec="seconds")
    if not timezone_name:
        raise ImporterError(
            f"Riga {row_number}: data/ora senza offset. Usare ISO 8601 con offset o specificare --timezone"
        )
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        fallback = fallback_local_datetime(value, timezone_name, row_number)
        if fallback is not None:
            return fallback
        raise ImporterError(
            f"Timezone {timezone_name} non disponibile in questa installazione Python; "
            "usare una data ISO con offset esplicito"
        ) from exc
    candidates: list[dt.datetime] = []
    for fold in (0, 1):
        aware = value.replace(tzinfo=zone, fold=fold)
        roundtrip = aware.astimezone(dt.timezone.utc).astimezone(zone).replace(tzinfo=None)
        if roundtrip == value:
            candidates.append(aware)
    offsets = {candidate.utcoffset() for candidate in candidates}
    if not candidates:
        raise ImporterError(f"Riga {row_number}: ora locale inesistente per il cambio DST; fornire un offset esplicito")
    if len(offsets) > 1:
        raise ImporterError(f"Riga {row_number}: ora locale ambigua per il cambio DST; fornire un offset esplicito")
    return candidates[0].isoformat(timespec="seconds")


def last_sunday(year: int, month: int) -> dt.date:
    if month == 12:
        following = dt.date(year + 1, 1, 1)
    else:
        following = dt.date(year, month + 1, 1)
    final_day = following - dt.timedelta(days=1)
    return final_day - dt.timedelta(days=(final_day.weekday() + 1) % 7)


def fallback_local_datetime(value: dt.datetime, timezone_name: str, row_number: int) -> str | None:
    """Small fallback for the deployment's primary timezone on Windows.

    CPython on Windows does not bundle the IANA database. UTC and Europe/Rome
    remain available without adding a package; every other zone still uses the
    operating system database when present and otherwise requires an offset.
    """
    if timezone_name in {"UTC", "Etc/UTC"}:
        return value.replace(tzinfo=dt.timezone.utc).isoformat(timespec="seconds")
    if timezone_name != "Europe/Rome":
        return None
    start = dt.datetime.combine(last_sunday(value.year, 3), dt.time(2, 0))
    end = dt.datetime.combine(last_sunday(value.year, 10), dt.time(3, 0))
    if start <= value < start + dt.timedelta(hours=1):
        raise ImporterError(f"Riga {row_number}: ora locale inesistente per il cambio DST; fornire un offset esplicito")
    if end - dt.timedelta(hours=1) <= value < end:
        raise ImporterError(f"Riga {row_number}: ora locale ambigua per il cambio DST; fornire un offset esplicito")
    offset = dt.timedelta(hours=2 if start + dt.timedelta(hours=1) <= value < end - dt.timedelta(hours=1) else 1)
    return value.replace(tzinfo=dt.timezone(offset)).isoformat(timespec="seconds")


def normalize_publish_at(value: Any, timezone_name: str | None, row_number: int) -> str:
    if isinstance(value, ExcelDate):
        return localized_datetime(value.value, timezone_name, row_number)
    text = required_text(value, "publish_at", row_number)
    candidate = text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
    try:
        parsed = dt.datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ImporterError(f"Riga {row_number}: publish_at deve essere ISO 8601") from exc
    return localized_datetime(parsed, timezone_name, row_number)


def media_root_for(input_path: Path, requested: str | None) -> Path:
    root = Path(requested).expanduser() if requested else input_path.parent
    try:
        resolved = root.resolve(strict=True)
    except OSError as exc:
        raise ImporterError(f"Media root non accessibile: {root}: {exc}") from exc
    if not resolved.is_dir():
        raise ImporterError(f"Media root non è una cartella: {resolved}")
    return resolved


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    except OSError as exc:
        raise ImporterError(f"Impossibile leggere media {path}: {exc}") from exc
    return digest.hexdigest()


def resolve_media(raw: Any, durations_raw: Any, root: Path, row_number: int) -> list[MediaFile]:
    files = split_list(raw, "media_files", row_number)
    if isinstance(durations_raw, list):
        durations_text = [str(value).strip() for value in durations_raw]
    elif durations_raw not in (None, ""):
        durations_text = [value.strip() for value in str(durations_raw).split("|")]
    else:
        durations_text = []
    if durations_text and len(durations_text) != len(files):
        raise ImporterError(f"Riga {row_number}: media_durations deve avere lo stesso numero di elementi di media_files")
    results: list[MediaFile] = []
    for index, name in enumerate(files):
        parsed_url = urllib.parse.urlsplit(name)
        if parsed_url.scheme or parsed_url.netloc:
            raise ImporterError(f"Riga {row_number}: i media remoti non sono ammessi ({name})")
        candidate = Path(name).expanduser()
        if not candidate.is_absolute():
            candidate = root / candidate
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(root)
        except (OSError, ValueError) as exc:
            raise ImporterError(f"Riga {row_number}: media fuori dalla cartella consentita o inesistente ({name})") from exc
        if not resolved.is_file():
            raise ImporterError(f"Riga {row_number}: media non è un file ({name})")
        size = resolved.stat().st_size
        if size > MAX_MEDIA_BYTES:
            raise ImporterError(f"Riga {row_number}: media supera {MAX_MEDIA_BYTES} byte ({name})")
        mime_type = mimetypes.guess_type(resolved.name)[0] or ""
        if not (mime_type.startswith("image/") or mime_type.startswith("video/")):
            raise ImporterError(f"Riga {row_number}: formato media non riconosciuto ({name})")
        duration: float | None = None
        if durations_text:
            try:
                duration = float(durations_text[index]) if durations_text[index] else None
            except ValueError as exc:
                raise ImporterError(f"Riga {row_number}: durata media non numerica ({durations_text[index]})") from exc
            if duration is not None and duration <= 0:
                raise ImporterError(f"Riga {row_number}: la durata media deve essere positiva")
        results.append(MediaFile(resolved, duration, mime_type, size, file_sha256(resolved)))
    return results


def parse_rows(input_path: Path, timezone_name: str | None, media_root: str | None) -> list[ParsedRow]:
    raw_rows = load_rows(input_path)
    root = media_root_for(input_path, media_root)
    parsed: list[ParsedRow] = []
    seen: dict[str, int] = {}
    for raw in raw_rows:
        row_number = int(raw["__row__"])
        external_id = required_text(raw.get("source_id"), "source_id", row_number, max_length=128)
        if not EXTERNAL_ID_RE.fullmatch(external_id):
            raise ImporterError(
                f"Riga {row_number}: source_id deve iniziare con una lettera o cifra e usare solo lettere, cifre, _ . : / -"
            )
        if external_id in seen:
            raise ImporterError(
                f"source_id duplicato: {external_id} alle righe {seen[external_id]} e {row_number}"
            )
        seen[external_id] = row_number
        kind = str(raw.get("kind") or "SOCIAL_POST").strip().upper()
        if kind != "SOCIAL_POST":
            raise ImporterError(f"Riga {row_number}: in v1 kind deve essere SOCIAL_POST")
        post: dict[str, Any] = {
            "clientId": required_text(raw.get("client_id"), "client_id", row_number),
            "title": required_text(raw.get("title"), "title", row_number),
            "publishAt": normalize_publish_at(raw.get("publish_at"), timezone_name, row_number),
            "kind": kind,
            "networks": split_list(raw.get("networks"), "networks", row_number),
            "text": required_text(raw.get("text"), "text", row_number),
            "media": [],
        }
        first_comment = str(raw.get("first_comment") or "").strip()
        if first_comment:
            post["firstCommentText"] = first_comment
        network_options = json_object(raw.get("network_options"), "network_options", row_number)
        if network_options is not None:
            post["networkOptions"] = network_options
        media = resolve_media(raw.get("media_files"), raw.get("media_durations"), root, row_number)
        parsed.append(ParsedRow(row_number, external_id, post, media))
    if not parsed:
        raise ImporterError("Il file non contiene righe da importare")
    return parsed


class UploadManifest:
    def __init__(self, path: Path | None, base_url: str, token: str) -> None:
        self.path = path.resolve() if path else None
        self.base_url = base_url
        self.token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        self.data: dict[str, Any] = {
            "version": 1,
            "baseUrl": base_url,
            "tokenSha256": self.token_hash,
            "uploads": {},
        }
        if self.path and self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ImporterError(f"Manifest non leggibile: {self.path}: {exc}") from exc
            if not isinstance(loaded, dict) or loaded.get("version") != 1:
                raise ImporterError("Manifest non valido o versione non supportata")
            if loaded.get("baseUrl") != base_url or loaded.get("tokenSha256") != self.token_hash:
                raise ImporterError("Manifest legato a un altro server o token")
            if not isinstance(loaded.get("uploads"), dict):
                raise ImporterError("Manifest uploads non valido")
            self.data = loaded

    @staticmethod
    def key(workspace_id: str, client_id: str, media: MediaFile) -> str:
        duration = "" if media.duration is None else format(media.duration, ".9g")
        material = f"{workspace_id}\0{client_id}\0{media.sha256}\0{duration}\0{media.mime_type}\0{media.size}"
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def get(self, workspace_id: str, client_id: str, media: MediaFile) -> dict[str, Any] | None:
        value = self.data["uploads"].get(self.key(workspace_id, client_id, media))
        return value.get("media") if isinstance(value, dict) and isinstance(value.get("media"), dict) else None

    def put(self, workspace_id: str, client_id: str, media: MediaFile, uploaded: dict[str, Any]) -> None:
        self.data["uploads"][self.key(workspace_id, client_id, media)] = {
            "workspaceId": workspace_id,
            "clientId": client_id,
            "fileSha256": media.sha256,
            "duration": media.duration,
            "mimeType": media.mime_type,
            "size": media.size,
            "media": uploaded,
        }
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=self.path.name + ".", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                json.dump(self.data, stream, ensure_ascii=False, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_name, self.path)
        except Exception:
            try:
                os.unlink(temporary_name)
            except OSError:
                pass
            raise


def envelope_data(payload: dict[str, Any], context: str) -> dict[str, Any]:
    if payload.get("success") is not True or not isinstance(payload.get("data"), dict):
        raise ImporterError(f"Risposta API inattesa durante {context}")
    return payload["data"]


def validation_body(row: ParsedRow, media: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    post = dict(row.post)
    post["media"] = media or []
    return {"externalId": row.external_id, "post": post}


def validate_remote(client: ApiClient, rows: list[ParsedRow]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = client.post_json(API_PREFIX + "/posts/validate", validation_body(row))
            data = envelope_data(payload, "la validazione")
            if data.get("valid") is not True:
                raise ImporterError("la validazione API non ha confermato valid=true")
            results.append(
                {
                    "row": row.row_number,
                    "externalId": row.external_id,
                    "ok": True,
                    "mediaDeferred": bool(row.media),
                    "mediaCount": len(row.media),
                }
            )
        except ImporterError as exc:
            results.append(
                {
                    "row": row.row_number,
                    "externalId": row.external_id,
                    "ok": False,
                    "mediaDeferred": bool(row.media),
                    "error": str(exc),
                }
            )
    return results


def accessible_client_workspaces(client: ApiClient) -> dict[str, str]:
    """Return membership-scoped client/workspace pairs for manifest binding."""
    result: dict[str, str] = {}
    cursor: str | None = None
    pages = 0
    while True:
        query = {"limit": "100"}
        if cursor:
            query["cursor"] = cursor
        data = envelope_data(
            client.get(API_PREFIX + "/clients?" + urllib.parse.urlencode(query)),
            "la verifica accesso clienti",
        )
        clients = data.get("clients")
        if not isinstance(clients, list):
            raise ImporterError("Risposta clienti inattesa")
        page_workspace_id = data.get("workspaceId")
        if not isinstance(page_workspace_id, str) or not page_workspace_id:
            raise ImporterError("Risposta clienti priva di workspaceId")
        for item in clients:
            if not isinstance(item, dict):
                continue
            client_id = item.get("id")
            if isinstance(client_id, str):
                result[client_id] = page_workspace_id
        next_cursor = data.get("nextCursor")
        if not isinstance(next_cursor, str) or not next_cursor:
            return result
        pages += 1
        if pages >= 100:
            raise ImporterError("Paginazione clienti eccessiva")
        cursor = next_cursor


def upload_media(client: ApiClient, media: MediaFile) -> dict[str, Any]:
    headers = {
        "Content-Type": media.mime_type,
        "X-File-Name": urllib.parse.quote(media.path.name, safe=""),
        "Content-Length": str(media.size),
    }
    if media.duration is not None:
        headers["X-Duration-Sec"] = format(media.duration, ".9g")
    def chunks() -> Iterable[bytes]:
        try:
            with media.path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    yield chunk
        except OSError as exc:
            raise ImporterError(f"Impossibile leggere media {media.path}: {exc}") from exc

    status, payload = client.request("POST", API_PREFIX + "/media", binary_body=chunks(), headers=headers)
    if status != 201:
        raise api_error(status, payload)
    data = envelope_data(payload, "l'upload media")
    uploaded = data.get("media")
    if not isinstance(uploaded, dict) or not isinstance(uploaded.get("url"), str):
        raise ImporterError("Risposta upload priva di media.url")
    return uploaded


def commit_rows(
    client: ApiClient,
    rows: list[ParsedRow],
    manifest_path: str | None,
    workspace_by_client: dict[str, str],
) -> list[dict[str, Any]]:
    manifest = UploadManifest(Path(manifest_path).expanduser() if manifest_path else None, client.base_url, client.token)
    results: list[dict[str, Any]] = []
    for row in rows:
        uploaded_media: list[dict[str, Any]] = []
        uploaded_count = 0
        cached_count = 0
        try:
            client_id = row.post["clientId"]
            workspace_id = workspace_by_client.get(client_id)
            if not workspace_id:
                raise ImporterError(f"client_id non accessibile al token o privo di workspaceId: {client_id}")
            for media in row.media:
                if media.path.stat().st_size != media.size or file_sha256(media.path) != media.sha256:
                    raise ImporterError(f"Il media è cambiato dopo la validazione locale: {media.path}")
                cached = manifest.get(workspace_id, client_id, media)
                if cached is not None:
                    uploaded_media.append(cached)
                    cached_count += 1
                    continue
                uploaded = upload_media(client, media)
                manifest.put(workspace_id, client_id, media, uploaded)
                uploaded_media.append(uploaded)
                uploaded_count += 1
            payload = client.post_json(API_PREFIX + "/posts", validation_body(row, uploaded_media))
            data = envelope_data(payload, "la creazione del post")
            post = data.get("post")
            if not isinstance(post, dict) or not isinstance(post.get("id"), str):
                raise ImporterError("Risposta creazione priva di post.id")
            if post.get("status") != "DRAFT":
                raise ImporterError("Il post creato non è in stato DRAFT")
            results.append(
                {
                    "row": row.row_number,
                    "externalId": row.external_id,
                    "ok": True,
                    "postId": post["id"],
                    "status": post["status"],
                    "replayed": bool(data.get("replayed")),
                    "uploadedMedia": uploaded_count,
                    "cachedMedia": cached_count,
                }
            )
        except ImporterError as exc:
            results.append(
                {
                    "row": row.row_number,
                    "externalId": row.external_id,
                    "ok": False,
                    "uploadedMedia": uploaded_count,
                    "cachedMedia": cached_count,
                    "error": str(exc),
                }
            )
    return results


def config_from_args(args: argparse.Namespace) -> tuple[str, str, float]:
    base_url = args.base_url or os.environ.get("APPROVE_BASE_URL", "")
    token = args.token or os.environ.get("APPROVE_API_TOKEN", "")
    if not base_url:
        raise ImporterError("APPROVE_BASE_URL mancante")
    if not token:
        raise ImporterError("APPROVE_API_TOKEN mancante")
    return base_url, token, args.timeout


def make_client(args: argparse.Namespace) -> ApiClient:
    base_url, token, timeout = config_from_args(args)
    return ApiClient(base_url, token, timeout)


def clients_command(args: argparse.Namespace) -> dict[str, Any]:
    client = make_client(args)
    query = {"limit": str(args.limit)}
    if args.query:
        query["q"] = args.query
    path = API_PREFIX + "/clients?" + urllib.parse.urlencode(query)
    return envelope_data(client.get(path), "la lettura clienti")


def resolve_command(args: argparse.Namespace) -> dict[str, Any]:
    client = make_client(args)
    path = API_PREFIX + "/clients?" + urllib.parse.urlencode({"q": args.name, "limit": "100"})
    data = envelope_data(client.get(path), "la ricerca cliente")
    clients = data.get("clients")
    if not isinstance(clients, list):
        raise ImporterError("Risposta clienti inattesa")
    exact = [item for item in clients if isinstance(item, dict) and str(item.get("name", "")).casefold() == args.name.casefold()]
    choices = exact or [item for item in clients if isinstance(item, dict)]
    if len(choices) != 1:
        return {"resolved": False, "query": args.name, "matches": choices}
    return {"resolved": True, "query": args.name, "client": choices[0]}


def post_command(args: argparse.Namespace) -> dict[str, Any]:
    client = make_client(args)
    quoted_id = urllib.parse.quote(args.post_id, safe="")
    return envelope_data(client.get(API_PREFIX + "/posts/" + quoted_id), "la lettura post")


def doctor_command(args: argparse.Namespace) -> dict[str, Any]:
    base_url, token, timeout = config_from_args(args)
    client = ApiClient(base_url, token, timeout)
    data = envelope_data(client.get(API_PREFIX + "/clients?limit=1"), "il controllo connessione")
    return {
        "healthy": True,
        "version": VERSION,
        "baseUrl": client.base_url,
        "tokenConfigured": True,
        "apiReachable": True,
        "clientsVisible": len(data.get("clients", [])) if isinstance(data.get("clients"), list) else None,
    }


def import_command(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    client = make_client(args)
    input_path = Path(args.input).expanduser().resolve()
    rows = parse_rows(input_path, args.timezone, args.media_root)
    validation = validate_remote(client, rows)
    valid = all(result["ok"] for result in validation)
    mode = "commit" if args.commit else "dry-run"
    if not valid or not args.commit:
        result = {
            "mode": mode,
            "input": str(input_path),
            "ok": valid,
            "rows": validation,
            "summary": {
                "total": len(rows),
                "valid": sum(1 for item in validation if item["ok"]),
                "errors": sum(1 for item in validation if not item["ok"]),
                "writes": 0,
            },
        }
        return result, valid
    workspace_by_client = accessible_client_workspaces(client)
    manifest_path = args.manifest or str(input_path.with_name(input_path.name + ".approve-import-state.json"))
    committed = commit_rows(client, rows, manifest_path, workspace_by_client)
    ok = all(result["ok"] for result in committed)
    return {
        "mode": mode,
        "input": str(input_path),
        "manifest": str(Path(manifest_path).expanduser().resolve()),
        "ok": ok,
        "rows": committed,
        "summary": {
            "total": len(rows),
            "createdOrReplayed": sum(1 for item in committed if item["ok"]),
            "errors": sum(1 for item in committed if not item["ok"]),
            "uploadedMedia": sum(int(item.get("uploadedMedia", 0)) for item in committed),
        },
    }, ok


def template_command(args: argparse.Namespace) -> dict[str, Any]:
    source = Path(__file__).resolve().parent.parent / "docs" / "templates" / "approve-posts.csv"
    if not source.is_file():
        raise ImporterError(f"Template non trovato: {source}")
    if not args.output:
        return {"template": str(source), "copied": False}
    destination = Path(args.output).expanduser().resolve()
    if destination.exists() and not args.force:
        raise ImporterError(f"Il file esiste già: {destination}; usare --force per sovrascriverlo")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return {"template": str(destination), "copied": True}


def parser() -> argparse.ArgumentParser:
    result = JsonArgumentParser(
        prog="approve_import.py",
        description="Valida e importa bozze Approve da CSV, JSON o XLSX. Output sempre JSON.",
    )
    result.add_argument("--base-url", help="Override di APPROVE_BASE_URL")
    result.add_argument("--token", help=argparse.SUPPRESS)
    result.add_argument("--timeout", type=float, default=20.0, help="Timeout HTTP in secondi (default: 20)")
    result.add_argument("--version", action="version", version=VERSION)
    commands = result.add_subparsers(dest="command", required=True, parser_class=JsonArgumentParser)

    commands.add_parser("doctor", help="Verifica configurazione, autenticazione e raggiungibilità API")

    clients = commands.add_parser("clients", help="Elenca o cerca i clienti accessibili al token")
    clients.add_argument("--query", "-q", help="Ricerca per nome")
    clients.add_argument("--limit", type=int, default=50, choices=range(1, 101), metavar="1-100")

    resolve = commands.add_parser("resolve", help="Risolve un nome cliente in un client_id")
    resolve.add_argument("name", help="Nome cliente esatto o query univoca")

    post = commands.add_parser("post", help="Legge un post accessibile al token")
    post.add_argument("post_id")

    for name, help_text in (
        ("validate", "Valida un file senza caricare media o creare post"),
        ("import", "Valida un file; crea bozze soltanto con --commit"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("input", help="File .csv, .json o .xlsx")
        command.add_argument("--timezone", help="Timezone IANA per date Excel o ISO senza offset, es. Europe/Rome")
        command.add_argument("--media-root", help="Cartella esplicita entro cui devono trovarsi tutti i media")
        command.add_argument("--manifest", help="Manifest esplicito per riutilizzare upload già completati")
        if name == "import":
            mode = command.add_mutually_exclusive_group()
            mode.add_argument("--dry-run", action="store_false", dest="commit", help="Valida senza scritture (default)")
            mode.add_argument("--commit", action="store_true", help="Esegue upload e creazione delle sole bozze")
            command.set_defaults(commit=False)
        else:
            command.set_defaults(commit=False)

    template = commands.add_parser("template", help="Mostra o copia il template CSV")
    template.add_argument("--output", "-o", help="Percorso in cui copiare il template")
    template.add_argument("--force", action="store_true", help="Sovrascrive il file di destinazione")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    token = args.token or os.environ.get("APPROVE_API_TOKEN")
    try:
        if args.command == "doctor":
            payload, ok = doctor_command(args), True
        elif args.command == "clients":
            payload, ok = clients_command(args), True
        elif args.command == "resolve":
            payload = resolve_command(args)
            ok = bool(payload.get("resolved"))
        elif args.command == "post":
            payload, ok = post_command(args), True
        elif args.command in {"validate", "import"}:
            payload, ok = import_command(args)
        elif args.command == "template":
            payload, ok = template_command(args), True
        else:
            raise ImporterError("Comando sconosciuto")
        json_print({"success": ok, "data": payload})
        return 0 if ok else 2
    except ImporterError as exc:
        json_print({"success": False, "error": {"message": redact(str(exc), token)}})
        return 2
    except KeyboardInterrupt:
        json_print({"success": False, "error": {"message": "Operazione interrotta"}})
        return 130
    except Exception as exc:  # Defensive: stdout remains machine-readable and token-free.
        json_print({"success": False, "error": {"message": "Errore inatteso: " + redact(str(exc), token)}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
