/**
 * "Importa post" — what one row of a sheet means (pure, safe in client
 * components and on the server).
 *
 * A row is what the person typed: text cells (Data, Ora, Reti, Testo…).
 * `evaluateRow` turns it into a post draft — the date and time read in the
 * client's time zone, the networks by name, the pictures by file name — and
 * lists every reason it cannot be a draft, in Italian. The preview grid runs
 * it on every keystroke; the server runs the very same function again before
 * creating anything, and adds the checks that need the database
 * (lib/post-import/service.ts → lib/automation/drafts.ts).
 *
 * The publishing rules (past date, text length per network, Instagram needs
 * a picture…) are not repeated here: they are `validateForNetworks`, the
 * function the editor and the Metricool worker use.
 */

import { NETWORKS, NETWORK_FORMATS, NETWORK_LABELS, isNetwork, type MediaItem, type Network, type NetworkOptions } from "@/lib/domain";
import {
  isValidTimeZone,
  toZonedDateTimeString,
  validateForNetworks,
  zonedDateTimeToUtc,
  type ValidationField,
} from "@/lib/metricool/payload";

/**
 * Rows per server request (check or create): the bound of the server action.
 * A longer sheet is read whole and sent in batches of this size (QA-11).
 */
export const MAX_IMPORT_ROWS = 200;
/** Rows one sheet may have; above this the file is refused with a clear message. */
export const MAX_SHEET_ROWS = 2000;

/** Splits rows into the batches the server accepts, in order. */
export function importBatches<T>(items: readonly T[], size: number = MAX_IMPORT_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * For each draft, the index of an earlier draft of the same sheet that would
 * create the very same post (null if none). The server flags these within a
 * batch; this covers the whole sheet when it is sent in several batches.
 */
export function sheetDuplicates(clientId: string, drafts: ReadonlyArray<RowDraft | null>): Array<number | null> {
  const first = new Map<string, number>();
  return drafts.map((draft, index) => {
    if (!draft) return null;
    const fingerprint = draftFingerprint(clientId, draft);
    const seen = first.get(fingerprint);
    if (seen === undefined) {
      first.set(fingerprint, index);
      return null;
    }
    return seen;
  });
}
/** Same as MAX_MEDIA_PER_POST in lib/posts.ts (a test keeps them equal). */
export const MAX_IMAGES_PER_ROW = 20;
/** Same as MAX_UPLOAD_BYTES in lib/storage.ts (a test keeps them equal). */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
const MAX_TITLE = 200;
const MAX_FIRST_COMMENT = 10_000;

/** File types the upload accepts (lib/storage.ts ALLOWED_MEDIA), by extension. */
export const MEDIA_BY_EXTENSION: Record<string, { mimeType: string; type: "image" | "video" }> = {
  jpg: { mimeType: "image/jpeg", type: "image" },
  jpeg: { mimeType: "image/jpeg", type: "image" },
  png: { mimeType: "image/png", type: "image" },
  webp: { mimeType: "image/webp", type: "image" },
  gif: { mimeType: "image/gif", type: "image" },
  mp4: { mimeType: "video/mp4", type: "video" },
  mov: { mimeType: "video/quicktime", type: "video" },
  webm: { mimeType: "video/webm", type: "video" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

/** The cells of one row, as typed (the preview grid edits these). */
export interface RawRow {
  /** Row number in the sheet (header = 1), for messages. */
  sourceRow: number;
  date: string;
  time: string;
  networks: string;
  text: string;
  firstComment: string;
  title: string;
  /** File names separated by "," or "|". */
  images: string;
  /** English `kind` column: only social posts are imported. */
  kind?: string;
  /** Optional «Formato» column: "Post", "Reel", "Storia" or "Rete: Formato". */
  format?: string;
  /** English `network_options` column: JSON object, passed through. */
  networkOptions?: string;
}

/** A picture or video the person dropped on the page. */
export interface FileRef {
  name: string;
  size: number;
  type: "image" | "video";
  mimeType: string;
}

export type RowField = "date" | "time" | "networks" | "format" | "text" | "title" | "firstComment" | "images" | "row";

export interface RowIssue {
  field: RowField;
  message: string;
}

export interface EvalContext {
  /** The client's IANA time zone: dates and times are read in it. */
  timeZone: string;
  now: Date;
  /** Networks enabled for the client; empty = all (the server's rule too). */
  clientNetworks: readonly string[];
  /** Files available for the "Immagini" column. */
  files: readonly FileRef[];
}

export interface RowDraft {
  publishAt: Date;
  /** "YYYY-MM-DDTHH:mm" wall clock in the client's zone. */
  localDateTime: string;
  networks: Network[];
  title: string;
  text: string;
  firstComment: string | null;
  files: FileRef[];
  networkOptions: NetworkOptions;
}

export interface RowEvaluation {
  /** Null while there are issues. */
  draft: RowDraft | null;
  issues: RowIssue[];
  /** "ven 16 ott 2026, 10:30" once date and time are understood. */
  when: string | null;
  /** The networks that were recognized, in the order written. */
  networks: Network[];
  /** One entry per name in "Immagini": the file it matched, or null. */
  images: Array<{ name: string; file: FileRef | null }>;
  /** The title the post will get (typed, or the first words of the text). */
  title: string;
  /** What the «Formato» column was read as, per network ("Instagram" → "Reel"); empty when blank or wrong. */
  formats: Array<{ network: Network; label: string }>;
}

// ─── Text helpers ────────────────────────────────────────────────────────────

/** Lowercase, no accents, NFC-stable: how names are compared. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

// ─── Dates and times ─────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  gennaio: 1, gen: 1, febbraio: 2, feb: 2, marzo: 3, mar: 3, aprile: 4, apr: 4, maggio: 5, mag: 5,
  giugno: 6, giu: 6, luglio: 7, lug: 7, agosto: 8, ago: 8, settembre: 9, set: 9, sett: 9,
  ottobre: 10, ott: 10, novembre: 11, nov: 11, dicembre: 12, dic: 12,
};

interface Ymd {
  year: number;
  month: number;
  day: number;
}

interface DateCell extends Ymd {
  /** Set when the cell carried a time too (Excel date-time, ISO). */
  time?: { hour: number; minute: number };
}

function isRealDate({ year, month, day }: Ymd): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Excel serial (1900 system, the one in CSV exports) → date and time. */
function fromSerial(serial: number): DateCell | null {
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return null;
  const whole = Math.floor(serial);
  const minutes = Math.round((serial - whole) * 1440);
  // 1899-12-30 is serial 0 once Excel's phantom 1900-02-29 is accounted for.
  const date = new Date(Date.UTC(1899, 11, 30) + whole * 86_400_000 + minutes * 60_000);
  const result: DateCell = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  if (minutes > 0) result.time = { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  return result;
}

const WEEKDAY_PREFIX = /^(?:lun|mar|mer|gio|ven|sab|dom)[a-z]*\.?,?\s+(?=\d)/;

/**
 * Reads a date cell: 15/10/2026, 15-10-26, 15.10, 2026-10-15, "ven 16 ottobre",
 * an Excel serial or an ISO date-time with offset (the `publish_at` column of
 * the automation file). Without a year it is this year, or the next one when
 * that month is already over.
 */
export function parseDateCell(
  raw: string,
  today: Ymd,
  timeZone: string
): { ok: true; value: DateCell } | { ok: false; message: string } {
  const text = fold(raw).trim().replace(/\s+/g, " ");
  if (!text) return { ok: false, message: "Manca la data." };
  const bad = { ok: false as const, message: `Data non riconosciuta: «${raw.trim()}». Scrivila come 15/10/2026.` };
  const done = (value: DateCell) =>
    isRealDate(value)
      ? { ok: true as const, value }
      : { ok: false as const, message: `La data ${pad(value.day)}/${pad(value.month)}/${value.year} non esiste.` };
  const withYear = (day: number, month: number, year?: number): DateCell => ({
    year: year ?? (month < today.month ? today.year + 1 : today.year),
    month,
    day,
  });

  // 2026-10-15, 2026-10-15T10:30[:00][+02:00|Z]
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (iso) {
    const [, y, mo, d, h, mi, offset] = iso;
    if (h !== undefined && offset !== undefined) {
      // An instant: show it as the wall clock of the client's zone.
      const normalized = offset === "z" ? "Z" : offset.length === 5 ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
      const instant = new Date(`${y}-${mo}-${d}T${h}:${mi}:00${normalized}`);
      if (Number.isNaN(instant.getTime())) return bad;
      const local = toZonedDateTimeString(instant, timeZone);
      return {
        ok: true,
        value: {
          year: Number(local.slice(0, 4)),
          month: Number(local.slice(5, 7)),
          day: Number(local.slice(8, 10)),
          time: { hour: Number(local.slice(11, 13)), minute: Number(local.slice(14, 16)) },
        },
      };
    }
    const value: DateCell = { year: Number(y), month: Number(mo), day: Number(d) };
    if (h !== undefined) value.time = { hour: Number(h), minute: Number(mi) };
    return done(value);
  }

  const serial = /^(\d{5,6})(?:[.,](\d+))?$/.exec(text);
  if (serial) {
    const value = fromSerial(Number(`${serial[1]}.${serial[2] ?? "0"}`));
    return value ? done(value) : bad;
  }

  const stripped = text.replace(WEEKDAY_PREFIX, "");
  const numeric = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2}|\d{4}))?$/.exec(stripped);
  if (numeric) {
    const year = numeric[3] === undefined ? undefined : numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return done(withYear(Number(numeric[1]), Number(numeric[2]), year));
  }

  const named = /^(\d{1,2})(?:\s*°|st|nd|rd|th)?\s+(?:di\s+)?([a-z]+)\.?(?:\s+(\d{4}|\d{2}))?$/.exec(stripped);
  if (named && MONTHS[named[2]]) {
    const year = named[3] === undefined ? undefined : named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]);
    return done(withYear(Number(named[1]), MONTHS[named[2]], year));
  }
  return bad;
}

/** Reads a time cell: 10:30, 10.30, 10h30, 10, 10:30:00, 3:30 pm, or an Excel fraction (0,4375). */
export function parseTimeCell(raw: string): { ok: true; hour: number; minute: number } | { ok: false; message: string } {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return { ok: false, message: "Manca l'ora (per esempio 10:30)." };
  const bad = { ok: false as const, message: `Ora non valida: «${raw.trim()}». Scrivila come 10:30.` };

  let hour: number;
  let minute: number;
  const fraction = /^0[.,]\d+$/.exec(text);
  const clock = /^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?(?:\s*[:.]\s*\d{2})?\s*(am|pm)?$/.exec(text);
  if (fraction) {
    const minutes = Math.round(Number(text.replace(",", ".")) * 1440);
    hour = Math.floor(minutes / 60) % 24;
    minute = minutes % 60;
  } else if (clock) {
    hour = Number(clock[1]);
    minute = clock[2] === undefined ? 0 : Number(clock[2]);
    if (clock[3]) {
      if (hour < 1 || hour > 12) return bad;
      hour = (hour % 12) + (clock[3] === "pm" ? 12 : 0);
    }
  } else {
    return bad;
  }
  if (hour > 23 || minute > 59) return bad;
  return { ok: true, hour, minute };
}

/** "ven 16 ott 2026, 10:30" from a "YYYY-MM-DDTHH:mm" wall clock. */
export function formatWhen(localDateTime: string): string {
  const [date, time] = localDateTime.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const label = new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return `${label}, ${time}`;
}

// ─── Networks ────────────────────────────────────────────────────────────────

const NETWORK_ALIASES: Record<string, Network> = {
  instagram: "instagram", insta: "instagram", ig: "instagram",
  facebook: "facebook", fb: "facebook",
  linkedin: "linkedin",
  tiktok: "tiktok",
  twitter: "twitter", x: "twitter", xtwitter: "twitter", twitterx: "twitter",
  threads: "threads",
  pinterest: "pinterest",
  youtube: "youtube", yt: "youtube",
  gmb: "gmb", googlebusiness: "gmb", googlemybusiness: "gmb", googlebusinessprofile: "gmb", gbp: "gmb",
  bluesky: "bluesky", bsky: "bluesky",
};
for (const network of NETWORKS) NETWORK_ALIASES[network] = network;

const ALL_NETWORKS_WORDS = new Set(["tutte", "tutti", "tutte le reti", "all", "tutti i social", "tutte le reti del cliente"]);

/**
 * Reads the "Reti" cell: names separated by "," ";" "|" "/" or "e", any case,
 * Italian or English ("Instagram, Facebook", "instagram|facebook").
 * Unknown names are returned apart, so the message can quote them.
 */
export function parseNetworksCell(
  raw: string,
  clientNetworks: readonly string[]
): { networks: Network[]; unknown: string[] } {
  const networks: Network[] = [];
  const unknown: string[] = [];
  const add = (network: Network) => {
    if (!networks.includes(network)) networks.push(network);
  };
  for (const token of raw.split(/[,;|/\n+&]|\s+e\s+/)) {
    const label = token.trim();
    if (!label) continue;
    const key = fold(label).replace(/[^a-z0-9]+/g, "");
    if (ALL_NETWORKS_WORDS.has(fold(label).replace(/\s+/g, " "))) {
      for (const network of clientNetworks.filter(isNetwork)) add(network);
      continue;
    }
    const network = NETWORK_ALIASES[key];
    if (network) add(network);
    else unknown.push(label);
  }
  return { networks, unknown };
}

function networkList(networks: readonly string[]): string {
  return networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", ");
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** Lowercase file name without folders, as the "Immagini" column and the files are compared. */
export function fileKey(name: string): string {
  return name.normalize("NFC").trim().replace(/^.*[\\/]/, "").toLowerCase();
}

function stem(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot > 0 ? key.slice(0, dot) : key;
}

/** What the browser tells about a file: its kind, or null when the upload would refuse it. */
export function describeFile(file: { name: string; size: number; type: string }): FileRef | null {
  const extension = fileKey(file.name).split(".").pop() ?? "";
  const known = MEDIA_BY_EXTENSION[extension];
  if (!known) return null;
  return { name: file.name.normalize("NFC"), size: file.size, type: known.type, mimeType: known.mimeType };
}

export function splitImageNames(raw: string): string[] {
  const names: string[] = [];
  for (const part of raw.split(/[|,;\n]/)) {
    const name = part.trim().replace(/^["']|["']$/g, "").trim();
    if (name && !names.some((n) => fileKey(n) === fileKey(name))) names.push(name);
  }
  return names;
}

/** The file for a name: same name in any case, or the same name without extension when only one fits. */
export function matchFile(name: string, files: readonly FileRef[]): FileRef | null {
  const key = fileKey(name);
  const exact = files.find((file) => fileKey(file.name) === key);
  if (exact) return exact;
  if (key.includes(".")) return null;
  const same = files.filter((file) => stem(fileKey(file.name)) === key);
  return same.length === 1 ? same[0] : null;
}

// ─── Title ───────────────────────────────────────────────────────────────────

/** First words of the text, on one line: "Scopri la nuova collezione autunno…". */
export function titleFromText(text: string, maxLength = 60): string {
  const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
  const words = firstLine.replace(/https?:\/\/\S+/g, "").trim().split(/\s+/).filter(Boolean);
  const full = words.join(" ");
  let title = "";
  for (const word of words.slice(0, 10)) {
    const next = title ? `${title} ${word}` : word;
    if (next.length > maxLength) break;
    title = next;
  }
  if (!title && words[0]) title = words[0].slice(0, maxLength);
  return title && title.length < full.length ? `${title}…` : title;
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

const FIELD_OF: Record<ValidationField, RowField> = {
  networks: "networks",
  text: "text",
  media: "images",
  options: "networks",
  publishAt: "date",
  timezone: "row",
};

const PLACEHOLDER_ORIGIN = "https://approve.invalid/pending/";

/** Placeholder media: the rules only look at how many there are, and of which type. */
function placeholderMedia(files: Array<{ name: string; type: "image" | "video"; mimeType: string }>): MediaItem[] {
  return files.map((file) => ({
    url: `${PLACEHOLDER_ORIGIN}${encodeURIComponent(file.name)}`,
    type: file.type,
    mimeType: file.mimeType,
  }));
}

function parseNetworkOptions(raw: string | undefined): { value: NetworkOptions; error?: string } {
  if (!raw || !raw.trim()) return { value: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      const valid = entries.every(
        ([key, value]) => /^[a-z]+Data$/.test(key) && value && typeof value === "object" && !Array.isArray(value)
      );
      if (valid) return { value: parsed as NetworkOptions };
    }
  } catch {
    // Falls through to the message.
  }
  return { value: {}, error: "Le opzioni di rete devono essere un oggetto JSON come {\"instagramData\": {\"type\": \"POST\"}}." };
}

/** Friendly names of the «Formato» column → Metricool `<network>Data.type`. */
const FORMAT_VALUES: Record<string, string> = {
  post: "POST",
  reel: "REEL",
  storia: "STORY",
  story: "STORY",
};

/** Words of the «Formato» menu, and what each means in Metricool terms. */
export const FORMAT_CHOICES = [
  { value: "Post", type: "POST" },
  { value: "Reel", type: "REEL" },
  { value: "Storia", type: "STORY" },
] as const;

/**
 * Which entry of the «Formato» menu a typed cell is: "" (blank), "Post",
 * "Reel" or "Storia" (also «story», any case), or null for anything else
 * ("Instagram: Reel", "Video"…), which the menu shows as it is.
 */
export function formatChoice(raw: string | undefined): "" | "Post" | "Reel" | "Storia" | null {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const type = FORMAT_VALUES[fold(value)];
  return FORMAT_CHOICES.find((choice) => choice.type === type)?.value ?? null;
}

/**
 * The «Formato» column: "Post", "Reel" or "Storia" for every network of the
 * row that offers it (Instagram and Facebook), or "Rete: Formato" for one
 * network only ("Instagram: Reel"; several entries with "|"). Merged OVER the
 * JSON `network_options`: the visible column wins.
 */
function parseFormatColumn(raw: string | undefined, networks: Network[]): { value: NetworkOptions; error?: string } {
  const value = (raw ?? "").trim();
  if (!value) return { value: {} };
  const options: NetworkOptions = {};
  for (const entry of value.split("|")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [maybeNetwork, maybeFormat] = trimmed.includes(":") ? trimmed.split(":", 2) : [null, trimmed];
    const format = FORMAT_VALUES[fold((maybeFormat ?? "").trim())];
    if (!format) {
      return { value: {}, error: `Formato non riconosciuto: «${trimmed}». Usa Post, Reel o Storia (per esempio «Instagram: Reel»).` };
    }
    const targets: Network[] = [];
    if (maybeNetwork === null) {
      targets.push(...networks.filter((network) => NETWORK_FORMATS[network]?.includes(format)));
    } else {
      const wanted = fold(maybeNetwork.trim());
      const network = networks.find((candidate) => fold(NETWORK_LABELS[candidate]) === wanted || candidate === wanted);
      if (!network) return { value: {}, error: `Il formato «${trimmed}» riguarda una rete che non è nella riga.` };
      if (!NETWORK_FORMATS[network]?.includes(format)) {
        return { value: {}, error: `${NETWORK_LABELS[network]} non ha il formato «${format}».` };
      }
      targets.push(network);
    }
    if (targets.length === 0) {
      return { value: {}, error: `Il formato «${format}» non vale per nessuna rete della riga (lo offrono Instagram e Facebook).` };
    }
    for (const network of targets) {
      options[`${network}Data`] = { ...options[`${network}Data`], type: format };
    }
  }
  return { value: options };
}

/**
 * Everything the pure rules say about one row. `draft` is set only when there
 * are no issues. `now` and the zone come from the caller so tests and the
 * server decide what "past" means.
 */
export function evaluateRow(raw: RawRow, context: EvalContext): RowEvaluation {
  const issues: RowIssue[] = [];
  const add = (field: RowField, message: string) => {
    if (!issues.some((issue) => issue.field === field && issue.message === message)) issues.push({ field, message });
  };

  const text = raw.text.replace(/\r\n?/g, "\n").trim();
  const firstComment = raw.firstComment.replace(/\r\n?/g, "\n").trim();
  const title = raw.title.trim() || titleFromText(text);

  // Date and time, in the client's zone.
  const zone = isValidTimeZone(context.timeZone) ? context.timeZone : null;
  if (!zone) add("row", `Il fuso orario del cliente («${context.timeZone}») non è valido: correggilo nella scheda del cliente.`);
  const todayLocal = toZonedDateTimeString(context.now, zone ?? "UTC");
  const today: Ymd = { year: Number(todayLocal.slice(0, 4)), month: Number(todayLocal.slice(5, 7)), day: Number(todayLocal.slice(8, 10)) };
  let dateText = raw.date;
  let timeText = raw.time;
  let dateCell = parseDateCell(dateText, today, zone ?? "UTC");
  // "15/10/2026 10:30" in one cell, with no time of its own.
  const joined = /^(.*\S)\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*[ap]m)?)$/i.exec(raw.date.trim());
  if (!dateCell.ok && joined && !raw.time.trim()) {
    dateText = joined[1];
    timeText = joined[2];
    dateCell = parseDateCell(dateText, today, zone ?? "UTC");
  }
  if (!dateCell.ok) add("date", dateCell.message);

  let time: { hour: number; minute: number } | null = null;
  if (timeText.trim()) {
    const parsed = parseTimeCell(timeText);
    if (parsed.ok) time = { hour: parsed.hour, minute: parsed.minute };
    else add("time", parsed.message);
  } else if (dateCell.ok && dateCell.value.time) {
    time = dateCell.value.time;
  } else {
    add("time", "Manca l'ora (per esempio 10:30).");
  }

  let localDateTime: string | null = null;
  let publishAt: Date | null = null;
  if (zone && dateCell.ok && time) {
    const { year, month, day } = dateCell.value;
    localDateTime = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(time.hour)}:${pad(time.minute)}`;
    publishAt = zonedDateTimeToUtc(localDateTime, zone);
    // A wall-clock time skipped by the spring-forward jump does not exist.
    if (publishAt && toZonedDateTimeString(publishAt, zone).slice(0, 16) !== localDateTime) {
      add("time", "Quest'ora non esiste quel giorno (cambio dell'ora legale): scegline un'altra.");
      publishAt = null;
    }
  }

  // Networks.
  const clientNetworks = context.clientNetworks;
  const { networks, unknown } = parseNetworksCell(raw.networks, clientNetworks);
  if (unknown.length > 0) {
    add(
      "networks",
      `Rete non riconosciuta: ${unknown.map((u) => `«${u}»`).join(", ")}. Reti disponibili: ${networkList(clientNetworks.length ? clientNetworks : NETWORKS)}.`
    );
  }
  if (networks.length === 0 && unknown.length === 0) {
    add("networks", raw.networks.trim() ? "Nessuna rete valida: i nomi tutte/tutti richiedono reti impostate nel cliente." : "Indica almeno una rete (per esempio Instagram, Facebook).");
  }
  const notAllowed = clientNetworks.length ? networks.filter((n) => !clientNetworks.includes(n)) : [];
  if (notAllowed.length > 0) {
    add("networks", `${notAllowed.map((n) => NETWORK_LABELS[n]).join(", ")} non ${notAllowed.length === 1 ? "è abilitata" : "sono abilitate"} per questo cliente (reti: ${networkList(clientNetworks)}).`);
  }

  // Pictures and videos, by file name.
  const names = splitImageNames(raw.images);
  const images = names.map((name) => ({ name, file: matchFile(name, context.files) }));
  if (names.length > MAX_IMAGES_PER_ROW) add("images", `Massimo ${MAX_IMAGES_PER_ROW} immagini per post.`);
  for (const { name, file } of images) {
    if (!file) {
      const extension = fileKey(name).split(".").pop() ?? "";
      add(
        "images",
        fileKey(name).includes(".") && !MEDIA_BY_EXTENSION[extension]
          ? `«${name}»: formato non supportato (si accettano JPG, PNG, WebP, GIF, MP4, MOV, WebM).`
          : `Immagine non trovata: «${name}». Trascina il file in questa pagina.`
      );
    } else if (file.size > MAX_FILE_BYTES) {
      add("images", `«${file.name}» supera il limite di 300 MB.`);
    } else if (file.size === 0) {
      add("images", `«${file.name}» è vuoto.`);
    }
  }

  // Short fields.
  if (title.length > MAX_TITLE) add("title", `Il titolo supera i ${MAX_TITLE} caratteri.`);
  if (firstComment.length > MAX_FIRST_COMMENT) add("firstComment", `Il primo commento supera i ${MAX_FIRST_COMMENT.toLocaleString("it-IT")} caratteri.`);
  if (raw.kind?.trim() && !/^(social_post|social|post social|post)$/.test(fold(raw.kind).trim())) {
    add("row", "In questa versione si importano solo post social.");
  }
  const options = parseNetworkOptions(raw.networkOptions);
  if (options.error) add("row", options.error);
  const formatOptions = parseFormatColumn(raw.format, networks);
  if (formatOptions.error) add("format", formatOptions.error);
  const formats = Object.entries(formatOptions.value).flatMap(([key, data]) => {
    const network = networks.find((candidate) => `${candidate}Data` === key);
    const label = FORMAT_CHOICES.find((choice) => choice.type === data.type)?.value;
    return network && label ? [{ network, label }] : [];
  });
  // The friendly «Formato» column merges over the JSON network_options, per network.
  const networkOptions: NetworkOptions = { ...options.value };
  for (const [key, data] of Object.entries(formatOptions.value)) {
    networkOptions[key] = { ...networkOptions[key], ...data };
  }

  // The publishing rules, the same ones the editor and the worker apply.
  if (publishAt) {
    const known = images.map(({ name, file }) => {
      if (file) return file;
      const extension = fileKey(name).split(".").pop() ?? "";
      const guess = MEDIA_BY_EXTENSION[extension];
      return { name, size: 1, type: guess?.type ?? "image", mimeType: guess?.mimeType ?? "image/jpeg" } satisfies FileRef;
    });
    const rules = validateForNetworks({
      networks,
      networkOptions,
      text,
      firstCommentText: firstComment || null,
      media: placeholderMedia(known),
      publishAt,
      timezone: zone ?? undefined,
      now: context.now,
    });
    for (const issue of rules) {
      // Networks are already reported above; without any, only the date and the rest still count.
      if (networks.length === 0 && (issue.field === "networks" || issue.field === "media")) continue;
      add(FIELD_OF[issue.field], issue.message);
    }
  }

  const matched = images.flatMap(({ file }) => (file ? [file] : []));
  const draft: RowDraft | null =
    issues.length === 0 && publishAt && localDateTime
      ? { publishAt, localDateTime, networks, title, text, firstComment: firstComment || null, files: matched, networkOptions }
      : null;
  return { draft, issues, when: localDateTime ? formatWhen(localDateTime) : null, networks, images, title, formats };
}

/**
 * Month ("YYYY-MM") of a draft in the client's zone — what the plan option
 * needs. It is the date as typed, not the UTC date.
 */
export function draftMonth(draft: Pick<RowDraft, "localDateTime">): string {
  return draft.localDateTime.slice(0, 7);
}

/**
 * What identifies a post in an import, whatever its row number: the same row
 * imported twice has the same fingerprint (the server hashes it into the
 * post's importKey, so a second import cannot duplicate it).
 */
export function draftFingerprint(clientId: string, draft: RowDraft): string {
  return JSON.stringify([
    clientId,
    draft.publishAt.toISOString(),
    [...draft.networks].sort(),
    draft.title,
    draft.text,
    draft.firstComment,
    draft.files.map((file) => [fileKey(file.name), file.size]),
    draft.networkOptions,
  ]);
}
