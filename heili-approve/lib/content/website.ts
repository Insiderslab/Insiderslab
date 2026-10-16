/**
 * Websites under review (Post.kind = WEBSITE, docs/SITO-WEB.md): content
 * schema, review validation, page URLs, comment anchors on the real site
 * (LiveAnchor) and the "what changed" lines between rounds.
 *
 * Pure and isomorphic: the agency editor and the portal import it in the
 * browser, lib/posts and the /api/site/v1 routes on the server. No I/O.
 *
 * Only «Sul sito» (mode "live") is accepted for now; «Istantanee» (server
 * photos) is postponed with the capture-worker, and the shapes keep room for it.
 */

import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { normalizeOrigin, originAllowed, originOf } from "@/lib/website/origins";
import {
  WEBSITE_DEVICES,
  type LiveAnchor,
  type WebsiteContent,
  type WebsiteDevice,
  type WebsitePage,
} from "./types";

export type { LiveAnchor, WebsiteContent, WebsiteDevice, WebsitePage } from "./types";
export { WEBSITE_DEVICES, WEBSITE_MODES, WEBSITE_VIEWPORTS } from "./types";

// ─── Limits ──────────────────────────────────────────────────────────────────

export const WEBSITE_LIMITS = {
  url: 2048,
  pages: 20,
  pageTitle: 120,
  pageNote: 500,
  roundNote: 1000,
  round: 999,
  selector: 300,
  textSnippet: 160,
  sectionHeading: 120,
} as const;

/** Below this viewport width a comment counts as made on a phone. */
export const PHONE_MAX_WIDTH = 767;

export const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export const DEVICE_LABELS: Record<WebsiteDevice, string> = { desktop: "Computer", phone: "Telefono" };

export const SNAPSHOT_POSTPONED_MESSAGE =
  "Le «Istantanee» (foto delle pagine di siti di altri) non sono ancora disponibili: usa «Sul sito».";

// ─── URLs ────────────────────────────────────────────────────────────────────

/** Query parameters never kept in a page address (tracking and anything credential-like). */
export const SENSITIVE_PARAM = /^(utm_.*|fbclid|gclid|msclkid|mc_eid)$|token|key|session|auth|pass|secret/i;

/**
 * A page address as it may be stored or shown: no hash, no credentials, no
 * tracking or credential-like parameters (`token`, `key`, `session`, `auth`,
 * `pass`…). null when it is not an http(s) URL.
 */
export function sanitizePageUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  for (const name of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAM.test(name)) url.searchParams.delete(name);
  }
  return url.toString();
}

/**
 * Normalises what the agency typed for a page: an absolute URL, or a path
 * ("/chi-siamo") resolved on siteUrl. Throws ValidationError in Italian.
 */
export function normalizePageUrl(input: string, siteUrl: string): string {
  const raw = input.trim();
  if (!raw) return "";
  let absolute: string;
  try {
    absolute = raw.startsWith("/") && siteUrl ? new URL(raw, siteUrl).toString() : new URL(raw).toString();
  } catch {
    throw new ValidationError(`Indirizzo della pagina non valido: ${raw.slice(0, 80)}`);
  }
  const clean = sanitizePageUrl(absolute);
  if (!clean) throw new ValidationError(`Indirizzo della pagina non valido: ${raw.slice(0, 80)}`);
  return clean;
}

/** "/chi-siamo" for chips and lists ("/" for the home). */
export function pagePath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return value;
  }
}

function sameOriginAs(url: string, siteUrl: string): boolean {
  const a = originOf(url);
  return a !== null && a === originOf(siteUrl);
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const urlField = (label: string) =>
  z
    .string()
    .trim()
    .max(WEBSITE_LIMITS.url, `${label}: indirizzo troppo lungo`)
    .refine((value) => value === "" || sanitizePageUrl(value) !== null, `${label}: indirizzo non valido (usa https://…)`)
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return !url.username && !url.password;
      } catch {
        return false;
      }
    }, `${label}: togli nome utente e password dall'indirizzo`);

const pageSchema = z.object({
  id: z.string().regex(PAGE_ID_PATTERN, "Identificativo della pagina non valido"),
  title: z.string().trim().max(WEBSITE_LIMITS.pageTitle, "Nome della pagina troppo lungo").default(""),
  url: urlField("Pagina"),
  note: z.string().trim().max(WEBSITE_LIMITS.pageNote, "Nota della pagina troppo lunga").default(""),
  // «Istantanee» (postponed): kept as stored, never produced by the editor.
  captures: z.record(z.enum(WEBSITE_DEVICES), z.unknown()).optional(),
});

/**
 * WebsiteContent as stored in PostVersion.content. Lenient on purpose
 * (drafts are saved half-written): what the client needs is
 * validateWebsiteForReview's job.
 */
export const websiteContentSchema = z
  .object({
    mode: z.enum(["live", "snapshot"]).default("live"),
    siteUrl: urlField("Sito").default(""),
    siteId: z.string().min(1).max(64).nullable().default(null),
    round: z.number().int().min(1).max(WEBSITE_LIMITS.round).default(1),
    roundNote: z.string().trim().max(WEBSITE_LIMITS.roundNote, "Nota del giro troppo lunga").default(""),
    devices: z
      .array(z.enum(WEBSITE_DEVICES))
      .max(2)
      .transform((list) => WEBSITE_DEVICES.filter((d) => list.includes(d)))
      .default(["desktop", "phone"]),
    pages: z.array(pageSchema).max(WEBSITE_LIMITS.pages, `Massimo ${WEBSITE_LIMITS.pages} pagine per giro`).default([]),
  })
  .superRefine((content, ctx) => {
    const ids = new Set<string>();
    for (const [index, page] of content.pages.entries()) {
      if (ids.has(page.id)) ctx.addIssue({ code: "custom", path: ["pages", index, "id"], message: "Pagine duplicate" });
      ids.add(page.id);
      if (page.url && content.siteUrl && !sameOriginAs(page.url, content.siteUrl)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "url"],
          message: `La pagina «${page.title || page.url}» deve stare sullo stesso sito (${originOf(content.siteUrl)})`,
        });
      }
    }
  });

export function emptyWebsiteContent(): WebsiteContent {
  return {
    mode: "live",
    siteUrl: "",
    siteId: null,
    round: 1,
    roundNote: "",
    devices: ["desktop", "phone"],
    pages: [{ id: "p1", title: "Home", url: "", note: "" }],
  };
}

function toWebsiteContent(data: z.output<typeof websiteContentSchema>): WebsiteContent {
  return {
    mode: data.mode,
    siteUrl: data.siteUrl ? (sanitizePageUrl(data.siteUrl) ?? data.siteUrl) : "",
    siteId: data.siteId,
    round: data.round,
    roundNote: data.roundNote,
    devices: data.devices,
    pages: data.pages.map((page) => ({
      id: page.id,
      title: page.title,
      url: page.url ? (sanitizePageUrl(page.url) ?? page.url) : "",
      note: page.note,
      ...(page.captures ? { captures: page.captures as WebsitePage["captures"] } : {}),
    })),
  };
}

/**
 * Validates untrusted input (editor payload, stored JSON) and returns a clean
 * WebsiteContent; null/undefined = empty. Throws ValidationError in Italian.
 * «Istantanee» are refused until the capture-worker exists.
 */
export function parseWebsiteContent(value: unknown): WebsiteContent {
  const result = websiteContentSchema.safeParse(value ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Contenuto del sito non valido");
  }
  if (result.data.mode === "snapshot") throw new ValidationError(SNAPSHOT_POSTPONED_MESSAGE);
  return toWebsiteContent(result.data);
}

/** Never throws: what is stored, for display (an unreadable row reads as empty). */
export function coerceWebsiteContent(value: unknown): WebsiteContent {
  const parsed = websiteContentSchema.safeParse(value ?? {});
  return parsed.success ? toWebsiteContent(parsed.data) : emptyWebsiteContent();
}

/** Next free page id ("p3"). */
export function newPage(existing: readonly Pick<WebsitePage, "id">[], url = ""): WebsitePage {
  const ids = new Set(existing.map((p) => p.id));
  let n = existing.length + 1;
  while (ids.has(`p${n}`)) n += 1;
  return { id: `p${n}`, title: "", url, note: "" };
}

// ─── Review readiness ────────────────────────────────────────────────────────

/** The registered site as the checks need it (WebsiteSite row). */
export interface WebsiteSiteState {
  origins: readonly string[];
  revokedAt: Date | string | null;
  verifiedAt: Date | string | null;
  /** The agency confirmed it cannot verify (site behind a password or an IP list). */
  verifyWaivedAt?: Date | string | null;
}

export type WebsiteField = "siteUrl" | "pages" | "site" | "mode";

export interface WebsiteValidationIssue {
  field: WebsiteField;
  message: string;
}

/**
 * What must be true before the client sees the site. `site` is the
 * registered site of the content (null = none yet); omitted = not checked
 * (agency editor before the post exists).
 */
export function validateWebsiteForReview(
  content: WebsiteContent,
  site?: WebsiteSiteState | null
): WebsiteValidationIssue[] {
  const issues: WebsiteValidationIssue[] = [];
  if (content.mode !== "live") issues.push({ field: "mode", message: SNAPSHOT_POSTPONED_MESSAGE });
  if (!content.siteUrl) {
    issues.push({ field: "siteUrl", message: "Inserisci l'indirizzo del sito di prova." });
  }
  const pages = content.pages.filter((p) => p.url);
  if (pages.length === 0) {
    issues.push({ field: "pages", message: "Aggiungi almeno una pagina da rivedere, con il suo indirizzo." });
  }
  const untitled = content.pages.filter((p) => p.url && !p.title.trim()).length;
  if (untitled > 0) {
    issues.push({ field: "pages", message: "Dai un nome a ogni pagina (es. «Home», «Chi siamo»)." });
  }
  const empty = content.pages.filter((p) => !p.url).length;
  if (empty > 0 && pages.length > 0) {
    issues.push({ field: "pages", message: "Completa o togli le pagine senza indirizzo." });
  }
  if (site === undefined || !content.siteUrl) return issues;

  if (!site || !content.siteId) {
    issues.push({ field: "site", message: "Prepara la riga di codice «Sul sito» e installala sul sito di prova." });
    return issues;
  }
  if (site.revokedAt) {
    issues.push({ field: "site", message: "La chiave del sito è stata revocata: crea una nuova chiave in «Sul sito»." });
    return issues;
  }
  const origin = originOf(content.siteUrl);
  if (!originAllowed(origin, site.origins)) {
    issues.push({
      field: "site",
      message: `Aggiungi ${origin ?? "l'indirizzo del sito"} agli indirizzi consentiti in «Sul sito».`,
    });
  }
  if (!site.verifiedAt && !site.verifyWaivedAt) {
    issues.push({
      field: "site",
      message: "Usa «Verifica installazione» per controllare che la riga di codice sia sul sito.",
    });
  }
  return issues;
}

// ─── Anchors («Sul sito») ────────────────────────────────────────────────────

const finite = z.number().refine(Number.isFinite, "Numero non valido");

/** A comment's anchor as the site iframe sends it (strict: no unknown fields). */
export const liveAnchorSchema = z
  .object({
    pageUrl: z
      .string()
      .trim()
      .max(WEBSITE_LIMITS.url)
      .refine((value) => sanitizePageUrl(value) !== null, "Indirizzo della pagina non valido"),
    device: z.enum(WEBSITE_DEVICES),
    viewport: z.object({ w: finite.pipe(z.number().int().min(200).max(4000)), h: finite.pipe(z.number().int().min(200).max(4000)) }).strict(),
    selector: z.string().trim().min(1, "Elemento non indicato").max(WEBSITE_LIMITS.selector),
    textSnippet: z.string().max(WEBSITE_LIMITS.textSnippet * 2).transform((t) => clipText(t, WEBSITE_LIMITS.textSnippet)),
    tag: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/).optional(),
    sectionHeading: z.string().max(WEBSITE_LIMITS.sectionHeading * 2).transform((t) => clipText(t, WEBSITE_LIMITS.sectionHeading)).optional(),
    offsetX: finite.pipe(z.number().min(0).max(1)),
    offsetY: finite.pipe(z.number().min(0).max(1)),
    scrollY: finite.pipe(z.number().int().min(0).max(1_000_000)),
    captureRef: z.string().min(1).max(64).optional(),
  })
  .strict()
  .transform((anchor): LiveAnchor => ({
    ...anchor,
    pageUrl: sanitizePageUrl(anchor.pageUrl) ?? anchor.pageUrl,
    // The width decides, whatever the browser claimed.
    device: anchor.viewport.w <= PHONE_MAX_WIDTH ? "phone" : "desktop",
  }));

/** Single line, trimmed, at most `max` characters (with "…"). */
export function clipText(value: string, max: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : line;
}

/** Stored anchor for reads, or null when absent/malformed. */
export function parseWebsiteAnchor(value: unknown): LiveAnchor | null {
  if (value === null || value === undefined) return null;
  const result = liveAnchorSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Validates a new anchor for a WEBSITE comment (throws ValidationError): the
 * shape, and the page on one of the allowed origins — the address comes from
 * the client's browser and must never point somewhere else.
 */
export function parseLiveAnchorForSite(value: unknown, allowedOrigins: readonly string[]): LiveAnchor {
  const result = liveAnchorSchema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message || "Elemento del sito non valido");
  if (!originAllowed(originOf(result.data.pageUrl), allowedOrigins)) {
    throw new ValidationError("La pagina commentata non è su uno degli indirizzi del sito");
  }
  return result.data;
}

/** Origins a comment of this content may point at: the registered ones, else the site's own. */
export function commentOriginsFor(content: WebsiteContent, siteOrigins: readonly string[] | null): string[] {
  const own = originOf(content.siteUrl);
  return [...new Set([...(siteOrigins ?? []), ...(own ? [own] : [])])];
}

/** Title of the page an anchor is on («Home»), else its path. */
export function anchorPageLabel(anchor: Pick<LiveAnchor, "pageUrl">, pages: readonly WebsitePage[]): string {
  const target = sanitizePageUrl(anchor.pageUrl);
  const page = pages.find((p) => p.url && sanitizePageUrl(p.url) === target);
  return page?.title.trim() || pagePath(anchor.pageUrl);
}

/** «Home · Telefono · «Scopri la collezione»» — the chip of a comment on the site. */
export function anchorChip(anchor: LiveAnchor, pages: readonly WebsitePage[]): string {
  const parts = [anchorPageLabel(anchor, pages), DEVICE_LABELS[anchor.device]];
  const text = anchor.textSnippet.trim();
  if (text) parts.push(`«${clipText(text, 60)}»`);
  else if (anchor.tag) parts.push(`<${anchor.tag}>`);
  return parts.join(" · ");
}

// ─── Changes between rounds ──────────────────────────────────────────────────

/** Italian lines for what changed between two versions of a website review. */
export function websiteContentChanges(before: unknown, after: unknown): string[] {
  const a = coerceWebsiteContent(before);
  const b = coerceWebsiteContent(after);
  const lines: string[] = [];
  if (b.round !== a.round) lines.push(`Giro ${b.round}`);
  if (b.roundNote !== a.roundNote && b.roundNote) lines.push("Nota del giro aggiornata");
  if (originOf(a.siteUrl) !== originOf(b.siteUrl) || a.siteUrl !== b.siteUrl) {
    if (a.siteUrl && b.siteUrl) lines.push("Indirizzo del sito cambiato");
  }
  const name = (p: WebsitePage) => p.title.trim() || pagePath(p.url) || p.id;
  const beforeIds = a.pages.map((p) => p.id);
  const afterIds = b.pages.map((p) => p.id);
  const added = b.pages.filter((p) => !beforeIds.includes(p.id));
  const removed = a.pages.filter((p) => !afterIds.includes(p.id));
  if (added.length === 1) lines.push(`Pagina aggiunta: ${name(added[0])}`);
  if (added.length > 1) lines.push(`Pagine aggiunte: ${added.map(name).join(", ")}`);
  if (removed.length === 1) lines.push(`Pagina tolta: ${name(removed[0])}`);
  if (removed.length > 1) lines.push(`Pagine tolte: ${removed.map(name).join(", ")}`);
  const kept = afterIds.filter((id) => beforeIds.includes(id));
  if (beforeIds.filter((id) => afterIds.includes(id)).some((id, i) => kept[i] !== id)) {
    lines.push("Ordine delle pagine cambiato");
  }
  for (const page of b.pages) {
    const previous = a.pages.find((p) => p.id === page.id);
    if (!previous) continue;
    const fields = [
      previous.title !== page.title ? "nome" : null,
      previous.url !== page.url ? "indirizzo" : null,
      previous.note !== page.note ? "nota" : null,
    ].filter(Boolean);
    if (fields.length > 0) lines.push(`Pagina ${name(page)} modificata: ${fields.join(", ")}`);
  }
  if (a.devices.join(",") !== b.devices.join(",")) lines.push("Dispositivi da controllare cambiati");
  return lines;
}

/** Re-exported for the agency editor's origin hints. */
export { normalizeOrigin, originOf };
