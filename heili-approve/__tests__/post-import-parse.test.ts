import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ALLOWED_MEDIA, MAX_UPLOAD_BYTES } from "../lib/storage";
import { MAX_MEDIA_PER_POST } from "../lib/posts";
import {
  MAX_FILE_BYTES,
  MAX_IMAGES_PER_ROW,
  MEDIA_BY_EXTENSION,
  describeFile,
  fileKey,
  formatWhen,
  matchFile,
  parseDateCell,
  parseNetworksCell,
  parseTimeCell,
  splitImageNames,
  titleFromText,
} from "../lib/post-import/rows";
import {
  ImportParseError,
  parseDelimited,
  parsePastedRows,
  parseSheetFile,
  readXlsx,
  tableToRows,
} from "../lib/post-import/table";
import { buildTemplateCsv, buildTemplateXlsx } from "../lib/post-import/template";

const today = { year: 2026, month: 10, day: 10 };
const ok = <T extends { ok: boolean }>(result: T) => {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
};

describe("limits stay in step with the upload and the post rules", () => {
  it("same size limit, media count and file types as the server", () => {
    expect(MAX_FILE_BYTES).toBe(MAX_UPLOAD_BYTES);
    expect(MAX_IMAGES_PER_ROW).toBe(MAX_MEDIA_PER_POST);
    const server = Object.entries(ALLOWED_MEDIA).map(([mime, { ext }]) => [ext, mime]).sort();
    const here = Object.entries(MEDIA_BY_EXTENSION)
      .filter(([ext]) => ext !== "jpeg")
      .map(([ext, { mimeType }]) => [ext, mimeType])
      .sort();
    expect(here).toEqual(server);
  });
});

describe("dates", () => {
  const read = (raw: string) => parseDateCell(raw, today, "Europe/Rome");

  it("reads Italian dates", () => {
    expect(ok(read("15/10/2026")).value).toMatchObject({ year: 2026, month: 10, day: 15 });
    expect(ok(read("5-11-26")).value).toMatchObject({ year: 2026, month: 11, day: 5 });
    expect(ok(read("15.10.2026")).value).toMatchObject({ year: 2026, month: 10, day: 15 });
    expect(ok(read("  ven 16/10/2026 ")).value).toMatchObject({ day: 16, month: 10 });
    expect(ok(read("2026-10-15")).value).toMatchObject({ year: 2026, month: 10, day: 15 });
  });

  it("uses this year without one, or the next when the month is over", () => {
    expect(ok(read("15/10")).value).toMatchObject({ year: 2026, month: 10, day: 15 });
    expect(ok(read("5/10")).value).toMatchObject({ year: 2026, month: 10, day: 5 });
    expect(ok(read("3/1")).value).toMatchObject({ year: 2027, month: 1, day: 3 });
  });

  it("reads dates with the month in words", () => {
    expect(ok(read("15 ottobre 2026")).value).toMatchObject({ year: 2026, month: 10, day: 15 });
    expect(ok(read("Ven 16 ott")).value).toMatchObject({ year: 2026, month: 10, day: 16 });
    expect(ok(read("1° gennaio 2027")).value).toMatchObject({ year: 2027, month: 1, day: 1 });
  });

  it("reads Excel serials, with and without a time", () => {
    // 46310 = 15 Oct 2026 in the 1900 system.
    expect(ok(read("46310")).value).toMatchObject({ year: 2026, month: 10, day: 15 });
    const withTime = ok(read("46310.4375")).value;
    expect(withTime).toMatchObject({ year: 2026, month: 10, day: 15, time: { hour: 10, minute: 30 } });
  });

  it("converts an ISO instant to the client's wall clock (automation publish_at)", () => {
    const value = ok(read("2026-10-15T10:30:00+02:00")).value;
    expect(value).toMatchObject({ month: 10, day: 15, time: { hour: 10, minute: 30 } });
    const utc = ok(read("2026-10-15T23:30:00Z")).value;
    expect(utc).toMatchObject({ day: 16, time: { hour: 1, minute: 30 } });
  });

  it("explains what it cannot read", () => {
    expect(read("")).toEqual({ ok: false, message: "Manca la data." });
    expect(read("domani")).toMatchObject({ ok: false, message: expect.stringContaining("15/10/2026") });
    expect(read("31/02/2026")).toEqual({ ok: false, message: "La data 31/02/2026 non esiste." });
  });
});

describe("times", () => {
  it("reads the usual ways of writing a time", () => {
    for (const [raw, hour, minute] of [
      ["10:30", 10, 30], ["10.30", 10, 30], ["10h30", 10, 30], ["9", 9, 0], ["09:05:00", 9, 5],
      ["0,4375", 10, 30], ["3:30 pm", 15, 30], ["12:00 am", 0, 0],
    ] as const) {
      expect(parseTimeCell(raw), raw).toEqual({ ok: true, hour, minute });
    }
  });

  it("rejects what is not a time", () => {
    expect(parseTimeCell("")).toMatchObject({ ok: false });
    expect(parseTimeCell("25:00")).toMatchObject({ ok: false, message: expect.stringContaining("10:30") });
    expect(parseTimeCell("mattina")).toMatchObject({ ok: false });
  });

  it("shows a wall clock in Italian", () => {
    expect(formatWhen("2026-10-16T10:30")).toBe("ven 16 ott 2026, 10:30");
  });
});

describe("networks", () => {
  it("reads Italian and English names in any case and separator", () => {
    expect(parseNetworksCell("Instagram, Facebook", [])).toEqual({ networks: ["instagram", "facebook"], unknown: [] });
    expect(parseNetworksCell("instagram|facebook", []).networks).toEqual(["instagram", "facebook"]);
    expect(parseNetworksCell("LINKEDIN; Tik Tok / X", []).networks).toEqual(["linkedin", "tiktok", "twitter"]);
    expect(parseNetworksCell("Google Business e Bluesky", []).networks).toEqual(["gmb", "bluesky"]);
    expect(parseNetworksCell("IG, ig, Instagram", []).networks).toEqual(["instagram"]);
  });

  it("returns unknown names apart, and expands «tutte» to the client's networks", () => {
    expect(parseNetworksCell("Instagram, Snapchat", [])).toEqual({ networks: ["instagram"], unknown: ["Snapchat"] });
    expect(parseNetworksCell("Tutte", ["instagram", "facebook"]).networks).toEqual(["instagram", "facebook"]);
  });
});

describe("files and titles", () => {
  const files = [
    { name: "Foto-1.JPG", size: 10, type: "image", mimeType: "image/jpeg" },
    { name: "reel.mp4", size: 10, type: "video", mimeType: "video/mp4" },
  ] as const;

  it("splits the Immagini cell on commas and bars, once per file", () => {
    expect(splitImageNames("foto-1.jpg, reel.mp4 | FOTO-1.JPG;")).toEqual(["foto-1.jpg", "reel.mp4"]);
    expect(splitImageNames("C:\\foto\\a.png|cartella/b.png")).toEqual(["C:\\foto\\a.png", "cartella/b.png"]);
  });

  it("matches by name, case-insensitively, ignoring folders and (when unique) the extension", () => {
    expect(matchFile("foto-1.jpg", files)?.name).toBe("Foto-1.JPG");
    expect(matchFile("C:\\x\\FOTO-1.jpg", files)?.name).toBe("Foto-1.JPG");
    expect(matchFile("reel", files)?.name).toBe("reel.mp4");
    expect(matchFile("manca.jpg", files)).toBeNull();
    expect(fileKey("Città.JPG".normalize("NFD"))).toBe("città.jpg");
  });

  it("describes only the file types the upload accepts", () => {
    expect(describeFile({ name: "a.JPEG", size: 5, type: "" })).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    expect(describeFile({ name: "a.mov", size: 5, type: "" })).toMatchObject({ type: "video" });
    expect(describeFile({ name: "a.pdf", size: 5, type: "application/pdf" })).toBeNull();
  });

  it("derives the title from the first words of the text", () => {
    expect(titleFromText("Scopri la nuova collezione\nSeconda riga")).toBe("Scopri la nuova collezione");
    expect(titleFromText("Una frase molto lunga che continua per parecchie parole di seguito senza fermarsi mai davvero")).toMatch(/…$/);
    expect(titleFromText("")).toBe("");
  });
});

describe("columns", () => {
  it("maps Italian headers", () => {
    const { rows, ignoredColumns, assumedOrder } = tableToRows([
      ["Data", "Ora", "Reti", "Testo", "Primo commento", "Titolo", "Immagini", "Boh"],
      ["15/10/2026", "10:30", "Instagram", "Ciao", "Commento", "Titolo", "a.jpg", "x"],
      ["", "", "", "", "", "", "", ""],
      ["16/10/2026", "11:00", "Facebook", "Testo 2"],
    ]);
    expect(assumedOrder).toBe(false);
    expect(ignoredColumns).toEqual(["Boh"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sourceRow: 2, date: "15/10/2026", time: "10:30", networks: "Instagram", firstComment: "Commento", title: "Titolo", images: "a.jpg" });
    expect(rows[1]).toMatchObject({ sourceRow: 4, text: "Testo 2", images: "" });
  });

  it("maps the English headers of docs/AGENT-IMPORT.md and ignores source_id / client_id", () => {
    const { rows, ignoredColumns } = tableToRows([
      ["source_id", "client_id", "title", "publish_at", "networks", "text", "first_comment", "media_files", "media_durations", "kind", "network_options"],
      ["a-1", "cl1", "Post", "2026-10-15T10:30:00+02:00", "instagram|facebook", "Testo", "Primo", "x.jpg|y.jpg", "", "SOCIAL_POST", "{}"],
    ]);
    expect(ignoredColumns).toEqual([]);
    expect(rows[0]).toMatchObject({
      title: "Post", date: "2026-10-15T10:30:00+02:00", networks: "instagram|facebook", firstComment: "Primo", images: "x.jpg|y.jpg", kind: "SOCIAL_POST", networkOptions: "{}",
    });
  });

  it("assumes the template order when the first row is data (pasted without headers)", () => {
    const { rows, assumedOrder } = tableToRows([["15/10/2026", "10:30", "Instagram", "Ciao", "", "", "a.jpg"]]);
    expect(assumedOrder).toBe(true);
    expect(rows[0]).toMatchObject({ sourceRow: 1, date: "15/10/2026", images: "a.jpg" });
  });

  it("treats a first row with one known header as headers, even under the threshold", () => {
    // "Giorno" is a known header, "Quando" and "Post" are not: with the old
    // threshold this row would have been imported as a post.
    expect(() => tableToRows([["Giorno", "Quando", "Post"], ["15/10/2026", "10:30", "Ciao"]])).toThrow(
      /mancano le colonne: Reti, Testo/
    );
    // …but a first cell that already is a date stays data (standard order).
    const { rows, assumedOrder } = tableToRows([["15/10/2026", "10:30", "Instagram", "Testo", "", "", "", ""]]);
    expect(assumedOrder).toBe(true);
    expect(rows[0].date).toBe("15/10/2026");
  });

  it("says which required columns are missing, and refuses empty or huge sheets", () => {
    expect(() => tableToRows([["Data", "Testo"], ["15/10", "x"]])).toThrow(/mancano le colonne: Reti/);
    expect(() => tableToRows([])).toThrow(ImportParseError);
    expect(() => tableToRows([["Data", "Ora", "Reti", "Testo"]])).toThrow(/solo l'intestazione/);
    const many = [["Data", "Ora", "Reti", "Testo"], ...Array.from({ length: 201 }, () => ["15/10", "10:00", "Instagram", "x"])];
    expect(() => tableToRows(many)).toThrow(/Troppe righe/);
  });
});

describe("csv and pasted cells", () => {
  it("reads quoted cells with commas, quotes and line breaks", () => {
    const table = parseDelimited('Data,Testo\r\n15/10,"Ciao, ""mondo""\nsecondo rigo"\r\n16/10,x');
    expect(table).toEqual([["Data", "Testo"], ["15/10", 'Ciao, "mondo"\nsecondo rigo'], ["16/10", "x"]]);
  });

  it("detects semicolon and tab delimiters and drops the BOM", () => {
    expect(parseDelimited("\uFEFFData;Testo\n15/10;a, b")).toEqual([["Data", "Testo"], ["15/10", "a, b"]]);
    expect(parseDelimited("Data\tTesto\n15/10\ta, b; c")).toEqual([["Data", "Testo"], ["15/10", "a, b; c"]]);
  });

  it("reads rows pasted from Excel (tab separated, multi-line cell quoted)", () => {
    const pasted = 'Data\tOra\tReti\tTesto\n15/10/2026\t10:30\tInstagram, Facebook\t"Riga uno\nRiga due"\n';
    const { rows } = parsePastedRows(pasted);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ networks: "Instagram, Facebook", text: "Riga uno\nRiga due" });
    expect(() => parsePastedRows("  ")).toThrow(/Incolla/);
  });

  it("reads a Windows-1252 CSV", async () => {
    const bytes = Uint8Array.from([...Buffer.from("Data;Ora;Reti;Testo\n15/10/2026;10:30;Instagram;Caff", "latin1"), 0xe8]);
    const { rows } = await parseSheetFile("piano.csv", bytes.buffer);
    expect(rows[0].text).toBe("Caffè");
  });
});

describe("xlsx", () => {
  async function workbook(sheet: string, { shared = "", styles = "", workbookPr = "" } = {}) {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", `<workbook xmlns:r="r"><workbookPr ${workbookPr}/><sheets><sheet name="Piano" sheetId="1" r:id="rId9"/></sheets></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/foglio.xml"/></Relationships>`);
    zip.file("xl/worksheets/foglio.xml", `<worksheet><sheetData>${sheet}</sheetData></worksheet>`);
    if (shared) zip.file("xl/sharedStrings.xml", shared);
    if (styles) zip.file("xl/styles.xml", styles);
    return zip.generateAsync({ type: "uint8array" });
  }

  it("reads shared and inline strings, entities and rich text, skipping empty columns", async () => {
    const data = await workbook(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Testo</t></is></c></row>` +
        `<row r="3"><c r="A3" t="inlineStr"><is><t>15/10/2026</t></is></c><c r="D3" t="s"><v>2</v></c></row>`,
      { shared: `<sst><si><t>Data</t></si><si><t>Ora</t></si><si><r><t>Caff</t></r><r><t xml:space="preserve">è &amp; co.</t></r><rPh><t>x</t></rPh></si></sst>` }
    );
    expect(await readXlsx(data)).toEqual([["Data", "Ora", "", "Testo"], [], ["15/10/2026", "", "", "Caffè & co."]]);
  });

  it("turns date-formatted numbers into dates and times, in the 1900 and the 1904 system", async () => {
    const styles = `<styleSheet><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="20"/></cellXfs></styleSheet>`;
    const cells = `<row r="1"><c r="A1" s="1"><v>46310</v></c><c r="B1" s="2"><v>0.4375</v></c><c r="C1"><v>46310</v></c></row>`;
    expect(await readXlsx(await workbook(cells, { styles }))).toEqual([["15/10/2026", "10:30", "46310"]]);
    // The same serial in the 1904 system is four years and a day later.
    expect(await readXlsx(await workbook(cells, { styles, workbookPr: 'date1904="1"' }))).toEqual([["16/10/2030", "10:30", "46310"]]);
  });

  it("explains files that are not workbooks", async () => {
    await expect(readXlsx(new TextEncoder().encode("non sono uno zip"))).rejects.toThrow(/non è un \.xlsx valido/);
    await expect(parseSheetFile("vecchio.xls", new ArrayBuffer(4))).rejects.toThrow(/\.xls/);
    await expect(parseSheetFile("foto.png", new ArrayBuffer(4))).rejects.toThrow(/Formato non supportato/);
  });
});

describe("template", () => {
  it("is read back by the importer: same headers, one example row", async () => {
    const xlsx = await buildTemplateXlsx({ exampleDate: "15/10/2026" });
    const { rows, ignoredColumns } = await parseSheetFile("modello.xlsx", xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer);
    expect(ignoredColumns).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "15/10/2026", time: "10:30", networks: "Instagram, Facebook", images: "collezione-1.jpg, collezione-2.jpg", format: "Post" });
    expect(rows[0].text).toContain("\n");

    const zip = await JSZip.loadAsync(xlsx);
    expect(Object.keys(zip.files)).toContain("xl/worksheets/sheet2.xml");
    expect(await zip.file("xl/workbook.xml")!.async("string")).toContain('name="Istruzioni"');
  });

  it("csv version has a BOM, the Italian «;» separator, and reads back the same", async () => {
    const csv = buildTemplateCsv({ exampleDate: "15/10/2026" });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    // Italian Excel opens it in columns: ";" is its list separator.
    expect(csv.split("\r\n", 1)[0]).toContain(";");
    const { rows } = parsePastedRows(csv);
    expect(rows[0]).toMatchObject({ date: "15/10/2026", networks: "Instagram, Facebook" });
  });
});
