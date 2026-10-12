/**
 * "Importa post" — the template people download and fill in: an .xlsx with
 * the Italian headers, an example row and an "Istruzioni" sheet, or the same
 * as .csv. Built here (pure, jszip) so there is no file to keep in sync with
 * the parser: a test reads the template back with the importer's own reader.
 */

import { TEMPLATE_HEADERS } from "./table";

export interface TemplateOptions {
  /** Example day, "DD/MM/YYYY" (a future date, so the example is importable as it is). */
  exampleDate: string;
}

const EXAMPLE = (date: string): string[] => [
  date,
  "10:30",
  "Instagram, Facebook",
  "Scopri la nuova collezione autunnale.\nDisponibile da oggi in negozio e online.\n#autunno #novità",
  "Link in bio per ordinare",
  "Lancio collezione autunno",
  "collezione-1.jpg, collezione-2.jpg",
];

const INSTRUCTIONS: Array<[string, string]> = [
  ["Come si compila", "Una riga per ogni post. Non cambiare i titoli delle colonne. Le righe vuote vengono saltate."],
  ["Data", "Il giorno di pubblicazione: 15/10/2026, oppure 15/10 (anno in corso; se il mese è già passato, l'anno dopo). Va bene anche una data di Excel."],
  ["Ora", "L'ora di pubblicazione, nel fuso orario del cliente: 10:30."],
  ["Reti", "Una o più reti separate da virgola o da |: Instagram, Facebook. Maiuscole e minuscole non contano. Reti possibili: Instagram, Facebook, LinkedIn, TikTok, X, Threads, Pinterest, YouTube, Google Business, Bluesky. «Tutte» usa le reti del cliente."],
  ["Testo", "Il testo completo del post, con gli a capo e gli hashtag. Ogni rete ha il suo limite di caratteri: l'anteprima ti avvisa."],
  ["Primo commento", "Facoltativo: il commento da pubblicare subito sotto il post."],
  ["Titolo", "Facoltativo: il titolo della bozza, visibile anche al cliente (portale ed email). Se lo lasci vuoto usiamo le prime parole del testo."],
  ["Immagini", "Facoltativo: i nomi dei file, separati da virgola o da |: foto-1.jpg, foto-2.jpg. Poi trascina i file (foto o video) nella pagina di importazione insieme al foglio: li abbiniamo per nome. Formati: JPG, PNG, WebP, GIF, MP4, MOV, WebM, fino a 300 MB."],
  ["Cosa succede", "Si creano sempre e solo bozze. Nulla viene inviato al cliente, approvato o programmato: lo fai tu dopo, dal piano o dall'elenco dei post. Importare lo stesso foglio due volte non duplica i post."],
];

function csvCell(value: string): string {
  return /[",\n\r;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 CSV with a BOM, so Excel shows the accents correctly. */
export function buildTemplateCsv({ exampleDate }: TemplateOptions): string {
  const lines = [[...TEMPLATE_HEADERS], EXAMPLE(exampleDate)].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c as "&"]);
}

function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** One inline-string cell: text stays text, so Excel never turns 15/10 or 10:30 into something else. */
function textCell(reference: string, value: string, style: number): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows: string[][], widths: number[], styles: { header: number; body: number }): string {
  const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
  const body = rows
    .map((row, r) => {
      const style = r === 0 ? styles.header : styles.body;
      return `<row r="${r + 1}">${row.map((value, c) => textCell(`${columnLetter(c)}${r + 1}`, value, style)).join("")}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF003141"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;

/** The .xlsx template: sheet «Post» (headers + one example) and sheet «Istruzioni». */
export async function buildTemplateXlsx({ exampleDate }: TemplateOptions): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Post" sheetId="1" r:id="rId1"/><sheet name="Istruzioni" sheetId="2" r:id="rId2"/></sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  zip.file("xl/styles.xml", STYLES_XML);
  zip.file("xl/worksheets/sheet1.xml", sheetXml([[...TEMPLATE_HEADERS], EXAMPLE(exampleDate)], [14, 9, 24, 60, 30, 28, 34], { header: 1, body: 0 }));
  zip.file(
    "xl/worksheets/sheet2.xml",
    sheetXml([["Colonna", "Come si compila"], ...INSTRUCTIONS.map(([a, b]) => [a, b])], [18, 110], { header: 1, body: 2 })
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
