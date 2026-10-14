/**
 * "Importa post" — from a file or pasted cells to rows (pure; runs in the
 * browser, so the sheet never has to be uploaded).
 *
 * Reads .xlsx (the first sheet, through jszip and plain XML, like
 * scripts/approve_import.py), .csv / .tsv (comma, semicolon or tab) and
 * cells copied from Excel or Google Sheets (tab separated). The columns are
 * found by their header, Italian or English (docs/AGENT-IMPORT.md); without
 * a header the standard order is assumed.
 */

import type { RawRow } from "./rows";
import { MAX_IMPORT_ROWS } from "./rows";

/** Italian message safe to show: the file cannot be read as a sheet of posts. */
export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

export const MAX_SHEET_BYTES = 5 * 1024 * 1024;
const MAX_CELLS = 100_000;
const MAX_XML_CHARS = 40 * 1024 * 1024;

export type Table = string[][];

// ─── Columns ─────────────────────────────────────────────────────────────────

type Column = "date" | "time" | "networks" | "text" | "firstComment" | "title" | "images" | "format" | "kind" | "networkOptions";

/** Standard order of the template. */
export const TEMPLATE_HEADERS = ["Data", "Ora", "Reti", "Testo", "Primo commento", "Titolo", "Immagini", "Formato"] as const;
const DEFAULT_ORDER: Column[] = ["date", "time", "networks", "text", "firstComment", "title", "images"];

/** Header → column, both languages (folded: no accents, spaces or punctuation). */
const HEADER_ALIASES: Record<string, Column> = {
  data: "date", giorno: "date", datapubblicazione: "date", date: "date", publishat: "date",
  ora: "time", orario: "time", orapubblicazione: "time", time: "time", hour: "time",
  reti: "networks", rete: "networks", social: "networks", canali: "networks", network: "networks", networks: "networks", piattaforme: "networks",
  testo: "text", copy: "text", didascalia: "text", caption: "text", text: "text", contenuto: "text",
  primocommento: "firstComment", commento: "firstComment", firstcomment: "firstComment", firstcommenttext: "firstComment",
  titolo: "title", title: "title", nome: "title",
  immagini: "images", immagine: "images", media: "images", mediafiles: "images", file: "images", files: "images", foto: "images", image: "images", images: "images", video: "images",
  formato: "format", format: "format",
  kind: "kind", tipo: "kind",
  networkoptions: "networkOptions",
};
/** Columns of the automation file that mean nothing here: ignored without a warning. */
const SILENT_COLUMNS = new Set(["sourceid", "clientid", "mediadurations", "cliente", "n", "numero", "note"]);

function foldHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export interface ParsedSheet {
  rows: RawRow[];
  /** Headers that are not known and were left out. */
  ignoredColumns: string[];
  /** No header row recognized: the standard column order was assumed. */
  assumedOrder: boolean;
}

/**
 * Rows of a table. `sourceRow` is the row number as the person sees it in
 * the sheet (1 = header). Rows with no cell at all are skipped.
 */
export function tableToRows(table: Table): ParsedSheet {
  const used = table
    .map((cells, index) => ({ cells, row: index + 1 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));
  if (used.length === 0) throw new ImportParseError("Il file è vuoto: non c'è nessuna riga da leggere.");

  const first = used[0].cells.map(foldHeader);
  const known = first.filter((header) => header in HEADER_ALIASES);
  // A first row holding at least one known header is a header row even under
  // the usual threshold (a model with custom names, "Giorno | Quando | Post"):
  // treated as data it would just fail with a bogus date error on row 1. The
  // exception: its first cell already looks like a date/serial — then it is
  // data in the standard order, as before.
  const firstCellLooksLikeData = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?|\d+(\.\d+)?)$/.test(
    used[0].cells[0]?.trim() ?? ""
  );
  const hasHeader = known.length >= 2 || (known.length === 1 && (first.length <= 2 || !firstCellLooksLikeData));

  let columns: Array<Column | null>;
  let body = used;
  const ignored: string[] = [];
  if (hasHeader) {
    columns = first.map((header, index) => {
      const column = HEADER_ALIASES[header];
      if (!column) {
        if (header && !SILENT_COLUMNS.has(header)) ignored.push(used[0].cells[index].trim());
        return null;
      }
      return column;
    });
    const seen = new Set<Column>();
    columns = columns.map((column) => {
      if (!column || seen.has(column)) return null;
      seen.add(column);
      return column;
    });
    const missing: string[] = [];
    if (!seen.has("date")) missing.push("Data");
    if (!seen.has("networks")) missing.push("Reti");
    if (!seen.has("text")) missing.push("Testo");
    if (missing.length > 0) {
      throw new ImportParseError(
        `Nella prima riga mancano le colonne: ${missing.join(", ")}. Le intestazioni sono: ${TEMPLATE_HEADERS.join(", ")}.`
      );
    }
    body = used.slice(1);
  } else {
    columns = DEFAULT_ORDER;
  }

  if (body.length === 0) throw new ImportParseError("Il file ha solo l'intestazione: aggiungi le righe dei post.");
  if (body.length > MAX_IMPORT_ROWS) {
    throw new ImportParseError(`Troppe righe: ne puoi importare ${MAX_IMPORT_ROWS} alla volta (il file ne ha ${body.length}).`);
  }

  const rows = body.map(({ cells, row }) => {
    const result: RawRow = { sourceRow: row, date: "", time: "", networks: "", text: "", firstComment: "", title: "", images: "" };
    columns.forEach((column, index) => {
      if (column && cells[index] !== undefined) result[column] = cells[index].trim() === "" ? "" : cells[index];
    });
    return result;
  });
  return { rows, ignoredColumns: ignored, assumedOrder: !hasHeader };
}

// ─── CSV / pasted cells ──────────────────────────────────────────────────────

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let quoted = false;
  const counts: Record<string, number> = { "\t": 0, ";": 0, ",": 0 };
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char]++;
  }
  // A tab means cells copied from a spreadsheet; commas also appear inside texts.
  if (counts["\t"] > 0) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/** RFC 4180 reader: quoted cells may hold the delimiter, quotes ("") and line breaks. */
export function parseDelimited(input: string, delimiter?: string): Table {
  const text = input.replace(/^﻿/, "");
  const separator = delimiter ?? detectDelimiter(text);
  const table: Table = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cells = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
    if (++cells > MAX_CELLS) throw new ImportParseError("Il file è troppo grande per essere letto.");
  };
  const endRow = () => {
    endCell();
    table.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === separator) endCell();
    else if (char === "\n") endRow();
    else if (char === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) endRow();
  return table;
}

/** Cells pasted from Excel / Google Sheets (or a CSV text). */
export function parsePastedRows(text: string): ParsedSheet {
  if (!text.trim()) throw new ImportParseError("Incolla prima le righe copiate dal foglio.");
  return tableToRows(parseDelimited(text));
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

function decodeXml(value: string): string {
  return value
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (_, hex?: string, dec?: string, named?: string) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number(dec));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named as "amp"];
    });
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) result[match[1]] = decodeXml(match[2]);
  return result;
}

/** All text of an element: every <t> (rich text runs), without phonetic hints. */
function textOf(xml: string): string {
  let text = "";
  for (const match of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    text += decodeXml(match[1] ?? "");
  }
  return text;
}

/** Built-in number formats that show a date or a time. */
function isBuiltinDateFormat(id: number): boolean {
  return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
}

function dateStyleIndexes(stylesXml: string | null): Set<number> {
  const result = new Set<number>();
  if (!stylesXml) return result;
  const custom = new Set<number>();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1]);
    const code = (attrs.formatCode ?? "").replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
    if (/[dmyhs]/i.test(code)) custom.add(Number(attrs.numFmtId));
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(attributes(match[1]).numFmtId ?? "0");
    if (isBuiltinDateFormat(id) || custom.has(id)) result.add(index);
    index++;
  }
  return result;
}

/**
 * A numeric cell with a date format → "15/10/2026", "10:30" or "15/10/2026
 * 10:30" (1900 or 1904 system). The Italian day-first form, the same the
 * person sees in Excel and the placeholder suggests ("15/10/2026").
 */
function serialToText(value: string, date1904: boolean): string {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return value;
  const whole = Math.floor(serial);
  const minutes = Math.round((serial - whole) * 1440);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + whole * 86_400_000 + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  const clock = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (whole === 0) return clock;
  return minutes === 0 ? day : `${day} ${clock}`;
}

function columnIndex(reference: string): number {
  const letters = /^[A-Za-z]+/.exec(reference)?.[0].toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** The first sheet of an .xlsx, as a table of the cell texts shown in Excel. */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<Table> {
  const size = data instanceof ArrayBuffer ? data.byteLength : data.length;
  if (size > MAX_SHEET_BYTES) throw new ImportParseError("Il file è troppo grande: un foglio di post non supera 5 MB.");
  const { default: JSZip } = await import("jszip");
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ImportParseError("Il file non è un .xlsx valido. Salvalo di nuovo da Excel come «Cartella di lavoro di Excel (.xlsx)».");
  }
  const read = async (path: string): Promise<string | null> => {
    const entry = zip.file(path);
    if (!entry) return null;
    const xml = await entry.async("string");
    if (xml.length > MAX_XML_CHARS) throw new ImportParseError("Il foglio è troppo grande per essere letto.");
    return xml;
  };
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new ImportParseError("Il file non è un .xlsx valido.");
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbook);

  // The first sheet of the workbook, through its relationship.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstSheet = /<sheet\b([^>]*?)\/?>/.exec(workbook);
  const relationshipId = firstSheet ? attributes(firstSheet[1])["r:id"] : undefined;
  if (relationshipId) {
    const rels = (await read("xl/_rels/workbook.xml.rels")) ?? "";
    for (const match of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const attrs = attributes(match[1]);
      if (attrs.Id === relationshipId && attrs.Target) {
        sheetPath = attrs.Target.startsWith("/") ? attrs.Target.slice(1) : `xl/${attrs.Target.replace(/^\.\//, "")}`;
      }
    }
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new ImportParseError("Non trovo il foglio dei post nel file.");

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((match) => textOf(match[1] ?? "")) : [];
  const dateStyles = dateStyleIndexes(await read("xl/styles.xml"));

  const table: Table = [];
  let cells = 0;
  let nextRow = 0;
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttrs = attributes(rowMatch[1]);
    const rowIndex = rowAttrs.r ? Number(rowAttrs.r) - 1 : nextRow;
    nextRow = rowIndex + 1;
    if (rowIndex > MAX_IMPORT_ROWS + 1000) throw new ImportParseError("Il foglio ha troppe righe.");
    const values: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (++cells > MAX_CELLS) throw new ImportParseError("Il foglio è troppo grande per essere letto.");
      const attrs = attributes(cellMatch[1]);
      const inner = cellMatch[2] ?? "";
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const type = attrs.t ?? "n";
      let value = "";
      if (type === "inlineStr") value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "b") value = raw === "1" ? "VERO" : "FALSO";
      else if (type === "e") value = "";
      else if (raw !== undefined) {
        value = decodeXml(raw);
        if (type === "n" && value !== "" && dateStyles.has(Number(attrs.s ?? "0"))) value = serialToText(value, date1904);
      }
      const index = attrs.r ? columnIndex(attrs.r) : values.length;
      while (values.length < index) values.push("");
      values[index] = value;
    }
    while (table.length < rowIndex) table.push([]);
    table[rowIndex] = values;
  }
  return table;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** A sheet file (.xlsx, .csv, .tsv, .txt) as rows. */
export async function parseSheetFile(name: string, data: ArrayBuffer): Promise<ParsedSheet> {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (extension === "xlsx") return tableToRows(await readXlsx(data));
  if (extension === "xls") {
    throw new ImportParseError("I file .xls (Excel 97-2003) non sono supportati: aprilo in Excel e salvalo come .xlsx o .csv.");
  }
  if (extension === "csv" || extension === "tsv" || extension === "txt") {
    if (data.byteLength > MAX_SHEET_BYTES) throw new ImportParseError("Il file è troppo grande: un foglio di post non supera 5 MB.");
    const bytes = new Uint8Array(data);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Excel's "CSV" on Windows is often Windows-1252.
      text = new TextDecoder("windows-1252").decode(bytes);
    }
    return tableToRows(parseDelimited(text));
  }
  throw new ImportParseError(`Formato non supportato: «${name}». Usa un file .xlsx o .csv.`);
}
