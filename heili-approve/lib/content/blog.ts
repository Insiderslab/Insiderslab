/**
 * Blog articles (Post.kind = BLOG_ARTICLE): content schema, review
 * validation, SEO checks, safe Markdown rendering, word-level diffs, text
 * anchoring of client comments and the export builders.
 *
 * Pure and isomorphic: the agency editor and the client reader import it in
 * the browser, the services and the export route on the server. No I/O.
 *
 * Markdown is only ever turned into HTML by renderMarkdownSafe (marked +
 * sanitize-html with an allowlist): nothing else in the app may inject
 * article HTML into a page.
 */

import { diffWordsWithSpace } from "diff";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import type { MediaItem } from "@/lib/domain";
import { ValidationError } from "@/lib/errors";
import {
  countWords,
  decodeEntities,
  escapeHtml,
  findAnchor,
  formatReadingTime,
  htmlToTextWithBlocks,
  normalizeForMatch,
  readingMinutesForWords,
  type AnchorMatch,
} from "./blog-text";
import type { BlogAnchor, BlogContent } from "./types";

export type { BlogAnchor, BlogContent } from "./types";
export {
  ANCHOR_CONTEXT_CHARS,
  MAX_ANCHOR_QUOTE,
  WORDS_PER_MINUTE,
  buildAnchor,
  countWords,
  decodeEntities,
  escapeHtml,
  findAnchor,
  formatReadingTime,
  htmlToTextWithBlocks,
  normalizeForMatch,
  readingMinutesForWords,
  textSimilarity,
  type AnchorMatch,
} from "./blog-text";

// ─── Limits ──────────────────────────────────────────────────────────────────

export const BLOG_LIMITS = {
  headline: 200,
  headlineReview: 120,
  slug: 100,
  body: 200_000,
  excerpt: 600,
  metaTitle: 200,
  metaTitleReview: 70,
  metaDescription: 500,
  focusKeyword: 100,
  author: 120,
  listItem: 60,
  listItems: 30,
} as const;

/** Meta description range required to send an article to the client. */
export const META_DESCRIPTION_MIN = 50;
export const META_DESCRIPTION_MAX = 160;
/** Google shows about this many characters of a title. */
export const META_TITLE_IDEAL_MAX = 60;
/** Minimum body length to send an article to the client. */
export const MIN_REVIEW_WORDS = 100;
/** Sentences longer than this count as "long" for readability. */
export const LONG_SENTENCE_WORDS = 25;
export const LONG_PARAGRAPH_WORDS = 150;

/** Valid slug: lowercase ASCII letters and digits separated by single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─── Schema ──────────────────────────────────────────────────────────────────

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => isHttpUrl(value), "URL dell'immagine non valido");

const featuredImageSchema = z
  .object({
    url: httpUrl,
    type: z.enum(["image", "video"]),
    mimeType: z.string().trim().min(1).max(100),
    assetId: z.string().min(1).max(64).optional(),
    alt: z.string().trim().max(1000).optional(),
    durationSec: z.number().positive().optional(),
    posterUrl: httpUrl.optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .refine((item) => item.type === "image", "L'immagine in evidenza deve essere un'immagine, non un video");

const labelList = (what: string) =>
  z
    .array(z.string().trim().max(BLOG_LIMITS.listItem, `${what}: massimo ${BLOG_LIMITS.listItem} caratteri ciascuno`))
    .max(BLOG_LIMITS.listItems, `${what}: massimo ${BLOG_LIMITS.listItems}`)
    .transform(dedupeLabels);

/**
 * BlogContent as stored in PostVersion.content. Lenient on purpose (drafts
 * are saved while half-written): every field has a default and only shape
 * and size are checked here. What an article needs before the client sees
 * it is validateBlogForReview's job.
 */
export const blogContentSchema = z.object({
  headline: z.string().trim().max(BLOG_LIMITS.headline, "Titolo dell'articolo troppo lungo").default(""),
  slug: z.string().trim().max(BLOG_LIMITS.slug, "Slug troppo lungo").default(""),
  bodyMarkdown: z.string().max(BLOG_LIMITS.body, "Testo dell'articolo troppo lungo").default(""),
  excerpt: z.string().trim().max(BLOG_LIMITS.excerpt, "Riassunto troppo lungo").default(""),
  metaTitle: z.string().trim().max(BLOG_LIMITS.metaTitle, "Titolo SEO troppo lungo").default(""),
  metaDescription: z.string().trim().max(BLOG_LIMITS.metaDescription, "Meta description troppo lunga").default(""),
  focusKeyword: z.string().trim().max(BLOG_LIMITS.focusKeyword, "Parola chiave troppo lunga").default(""),
  featuredImage: featuredImageSchema.nullable().default(null),
  categories: labelList("Categorie").default([]),
  tags: labelList("Tag").default([]),
  author: z.string().trim().max(BLOG_LIMITS.author, "Nome dell'autore troppo lungo").default(""),
});

/** A client comment's anchor (PostComment.anchor), as sent by BlogReader. */
export const blogAnchorSchema = z.object({
  quote: z
    .string()
    .max(2000, "Seleziona un passaggio più breve")
    .refine((quote) => quote.trim().length > 0, "Seleziona il testo da commentare"),
  prefix: z.string().max(200).default(""),
  suffix: z.string().max(200).default(""),
  blockIndex: z.number().int().min(0).max(100_000).nullable().default(null),
});

export function emptyBlogContent(): BlogContent {
  return {
    headline: "",
    slug: "",
    bodyMarkdown: "",
    excerpt: "",
    metaTitle: "",
    metaDescription: "",
    focusKeyword: "",
    featuredImage: null,
    categories: [],
    tags: [],
    author: "",
  };
}

function toBlogContent(data: z.output<typeof blogContentSchema>): BlogContent {
  const { featuredImage, ...rest } = data;
  return { ...rest, featuredImage: featuredImage ? stripUndefined(featuredImage) : null };
}

/**
 * Validates untrusted input (editor payload, stored JSON) and returns a clean
 * BlogContent. null/undefined = empty article. Throws ValidationError with an
 * Italian message on malformed input.
 */
export function parseBlogContent(value: unknown): BlogContent {
  const result = blogContentSchema.safeParse(value ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Contenuto dell'articolo non valido");
  }
  return toBlogContent(result.data);
}

export function safeParseBlogContent(
  value: unknown
): { ok: true; content: BlogContent } | { ok: false; error: string } {
  try {
    return { ok: true, content: parseBlogContent(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Contenuto dell'articolo non valido" };
  }
}

/**
 * Never throws: reads whatever is stored in PostVersion.content for display,
 * keeping every valid field and defaulting the others. Use parseBlogContent
 * for input.
 */
export function coerceBlogContent(value: unknown): BlogContent {
  const parsed = blogContentSchema.safeParse(value ?? {});
  if (parsed.success) return toBlogContent(parsed.data);
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(blogContentSchema.shape)) {
    const one = (field as z.ZodType).safeParse(source[key]);
    result[key] = one.success ? one.data : (field as z.ZodType).parse(undefined);
  }
  return toBlogContent(result as z.output<typeof blogContentSchema>);
}

/** Validated anchor, or null when the value is not a usable anchor. */
export function parseBlogAnchor(value: unknown): BlogAnchor | null {
  if (value === null || value === undefined) return null;
  const result = blogAnchorSchema.safeParse(value);
  return result.success ? result.data : null;
}

// ─── Small text helpers ──────────────────────────────────────────────────────

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function dedupeLabels(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLocaleLowerCase("it-IT");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Characters as users count them (an emoji or "è" is one). */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/**
 * URL slug from any title: "Perché è così" → "perche-e-cosi".
 * Accents are dropped, "&" reads "e", apostrophes split words ("l'arte" →
 * "l-arte"), and the result is cut at a dash to at most `maxLength`.
 */
export function slugify(text: string, maxLength = 80): string {
  const slug = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .replace(/ø/gi, "o")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength + 1);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > maxLength / 2 ? cut.slice(0, lastDash) : slug.slice(0, maxLength)).replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= BLOG_LIMITS.slug && SLUG_PATTERN.test(slug);
}

// ─── Safe Markdown rendering ─────────────────────────────────────────────────

const marked = new Marked({ gfm: true, breaks: false, async: false });

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "blockquote", "pre", "code",
    "strong", "b", "em", "i", "u", "s", "del", "ins", "sup", "sub", "mark", "small", "span",
    "ul", "ol", "li",
    "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    ol: ["start"],
    th: ["align", "colspan", "rowspan"],
    td: ["align", "colspan", "rowspan"],
    code: ["class"],
  },
  allowedClasses: { code: ["language-*"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => {
      const { href, title } = attribs;
      const next: sanitizeHtml.Attributes = {};
      if (href !== undefined) next.href = href;
      if (title) next.title = title;
      // External links open in a new tab without handing it our window.
      if (href && /^https?:\/\//i.test(href.trim())) {
        next.rel = "noopener noreferrer";
        next.target = "_blank";
      }
      return { tagName, attribs: next };
    },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
  },
};

/** sanitize-html with the article allowlist (no scripts, styles, handlers, javascript: links). */
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

type MarkdownTableCell = { tokens?: MarkdownToken[] };
type MarkdownToken = {
  type: string;
  raw: string;
  text?: string;
  href?: string;
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
  header?: MarkdownTableCell[];
  rows?: MarkdownTableCell[][];
};

/**
 * Same verdict as the sanitizer for a Markdown link target (relative, http(s),
 * mailto, tel). marked keeps HTML entities in `href` (a CommonMark renderer
 * decodes them, so "&#106;avascript:" is javascript:), therefore the href is
 * handed to sanitize-html as an attribute, entities and all: sanitize-html
 * decodes them, strips control characters and applies the article scheme
 * allowlist, exactly as for the rendered article.
 */
function isSafeMarkdownHref(href: string, tag: "a" | "img" = "a"): boolean {
  const attr = href.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const probe = tag === "img" ? `<img src="${attr}" alt="">` : `<a href="${attr}">x</a>`;
  return new RegExp(`\\b${tag === "img" ? "src" : "href"}="`).test(sanitizeArticleHtml(probe));
}

/** Children of a token, in source order (table cells included). */
function markdownChildren(token: MarkdownToken): MarkdownToken[] {
  const cells = [...(token.header ?? []), ...(token.rows ?? []).flat()];
  return [...(token.tokens ?? []), ...(token.items ?? []), ...cells.flatMap((cell) => cell.tokens ?? [])];
}

/**
 * The token's Markdown with unsafe parts neutralised, or null when a child
 * that needs changing cannot be located exactly in the parent's raw text
 * (blockquote and list children are lexed without their "> " / indent, table
 * cells without escaped pipes…). The caller then falls back to sanitized HTML.
 */
function cleanMarkdownToken(token: MarkdownToken): string | null {
  if (token.type === "html") {
    // Keep the whitespace around a raw HTML block, sanitize the markup.
    const leading = /^\s*/.exec(token.raw)?.[0] ?? "";
    const trailing = /\s*$/.exec(token.raw)?.[0] ?? "";
    const raw = token.raw.trim();
    let clean = sanitizeArticleHtml(raw)
      // Text inside an HTML block may still be read as Markdown by some CMSs.
      .replace(/\]\(\s*(?:javascript|vbscript|data):.*?\)(?=\s|$)/gim, "](#)");
    // An inline closing tag comes alone too: kept when the tag is allowed.
    const closing = /^<\/([a-z][a-z0-9]*)\s*>$/i.exec(raw);
    if (closing) {
      return (SANITIZE_OPTIONS.allowedTags || []).includes(closing[1].toLowerCase()) ? token.raw : "";
    }
    // An inline opening tag comes alone: drop the closing tag the sanitizer added.
    const opening = /^<([a-z][a-z0-9]*)\b[^>]*>$/i.exec(raw);
    if (opening) clean = clean.replace(new RegExp(`</${opening[1]}>$`, "i"), "");
    return clean ? `${leading}${clean}${trailing}` : trailing.includes("\n") ? trailing : "";
  }
  if ((token.type === "link" || token.type === "image") && token.href !== undefined) {
    if (!isSafeMarkdownHref(token.href, token.type === "image" ? "img" : "a")) return token.text ?? "";
  }
  if (token.type === "def" && token.href !== undefined && !isSafeMarkdownHref(token.href)) {
    return /\n\s*$/.test(token.raw) ? "\n" : "";
  }
  const children = markdownChildren(token);
  if (children.length === 0) return token.raw;
  // Children's raw text appears in order inside the parent's raw text.
  let out = "";
  let cursor = 0;
  for (const child of children) {
    const clean = cleanMarkdownToken(child);
    if (clean === null) return null;
    if (clean === child.raw) continue; // unchanged: the parent's raw text already holds it
    const at = child.raw ? token.raw.indexOf(child.raw, cursor) : -1;
    if (at === -1) return null;
    out += token.raw.slice(cursor, at) + clean;
    cursor = at + child.raw.length;
  }
  return out + token.raw.slice(cursor);
}

/**
 * A top-level block whose Markdown cannot be rewritten exactly, exported as
 * its sanitized HTML: what the client saw. Blank lines inside it would end the
 * HTML block in a CommonMark renderer (and let the rest be read as Markdown
 * again), so they are kept as "&#10;".
 */
function blockAsSanitizedHtml(token: MarkdownToken): string {
  const html = sanitizeArticleHtml(marked.parser([token as never])).trim();
  return html ? `${html.replace(/\n(?=[ \t]*\n)/g, "&#10;")}\n\n` : "";
}

/**
 * The article Markdown with the same protection as the rendered HTML: raw
 * HTML goes through the article allowlist (no scripts, handlers, iframes…)
 * and links/images with a disallowed scheme (javascript:, data:…) keep only
 * their text. Ordinary Markdown is returned unchanged; a block that cannot be
 * rewritten in place (unsafe content in a table, a multi-line blockquote or an
 * indented list block) is exported as its sanitized HTML. Used by the export,
 * so a CMS that renders raw HTML gets nothing the client did not see.
 */
export function sanitizeMarkdown(markdown: string): string {
  const tokens = marked.lexer(markdown ?? "") as unknown as MarkdownToken[];
  return tokens.map((token) => cleanMarkdownToken(token) ?? blockAsSanitizedHtml(token)).join("");
}

/**
 * Markdown → sanitized HTML. With `blockMarkers` (default) every top-level
 * block (paragraph, heading, list…) carries `data-block="n"`, the hint the
 * reader stores in BlogAnchor.blockIndex. Exports pass `blockMarkers: false`.
 */
export function renderMarkdownSafe(markdown: string, options: { blockMarkers?: boolean } = {}): string {
  const blockMarkers = options.blockMarkers ?? true;
  const tokens = marked.lexer(markdown ?? "");
  const out: string[] = [];
  let index = 0;
  for (const token of tokens) {
    if (token.type === "space" || token.type === "def") continue;
    // Each block is rendered and sanitized on its own, so the marker is added
    // after sanitizing and the author's raw HTML can never forge one.
    const clean = sanitizeArticleHtml(marked.parser([token])).trim();
    if (!clean) continue;
    out.push(blockMarkers ? markBlock(clean, index) : clean);
    index++;
  }
  return out.join("\n");
}

function markBlock(html: string, index: number): string {
  const match = /^<([a-zA-Z][a-zA-Z0-9]*)(?=[\s>/])/.exec(html);
  if (match) return `<${match[1]} data-block="${index}"${html.slice(match[0].length)}`;
  return `<div data-block="${index}">${html}</div>`;
}

/**
 * Readable plain text of an article body (paragraphs separated by a blank
 * line, list items with "•", images as "[Immagine: alt]"): used for word
 * counts, readability and the client-facing diff.
 */
export function markdownToPlainText(markdown: string): string {
  return htmlToReadableText(renderMarkdownSafe(markdown, { blockMarkers: false }));
}

function htmlToReadableText(html: string): string {
  const text = html
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = decodeEntities(/\balt="([^"]*)"/.exec(tag)?.[1] ?? "").trim();
      return alt ? `[Immagine: ${alt}]` : "[Immagine]";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/li>\s*/gi, "\n")
    .replace(/<\/(p|h[1-6]|blockquote|pre|table|ul|ol|figure|div)>/gi, "\n\n")
    .replace(/<\/(tr)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<hr\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wordCount(markdown: string): number {
  return countWords(markdownToPlainText(markdown));
}

/** Minutes of reading at WORDS_PER_MINUTE, at least 1 for a non-empty text. */
export function readingTime(markdown: string): number {
  return readingMinutesForWords(wordCount(markdown));
}

// ─── Body analysis (SEO) ─────────────────────────────────────────────────────

export interface BlogBodyAnalysis {
  words: number;
  plainText: string;
  headings: Array<{ level: number; text: string }>;
  images: Array<{ src: string; alt: string }>;
  links: Array<{ href: string; internal: boolean }>;
  /** Text of the first real paragraph (not an image-only one). */
  firstParagraph: string;
  paragraphs: string[];
  sentences: string[];
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return match ? decodeEntities(match[1]) : null;
}

function isInternalHref(href: string, siteHost: string | null): boolean {
  const value = href.trim();
  if (/^(mailto|tel):/i.test(value)) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return true; // relative: /servizi, ../chi-siamo, #faq
  if (!siteHost) return false;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === siteHost.replace(/^www\./, "");
  } catch {
    return false;
  }
}

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+(?=["«“(]?[\p{Lu}\d])/u))
    .map((s) => s.replace(/^•\s*/, "").trim())
    .filter((s) => countWords(s) > 0);
}

export function analyzeBody(markdown: string, options: { siteHost?: string | null } = {}): BlogBodyAnalysis {
  const html = renderMarkdownSafe(markdown, { blockMarkers: false });
  const plainText = htmlToReadableText(html);
  const siteHost = options.siteHost ?? null;

  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({
    level: Number(m[1]),
    text: textOf(m[2]),
  }));
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => ({
    src: attr(m[0], "src") ?? "",
    alt: (attr(m[0], "alt") ?? "").trim(),
  }));
  const links = [...html.matchAll(/<a\b[^>]*>/gi)]
    .map((m) => attr(m[0], "href"))
    .filter((href): href is string => !!href && !/^(mailto|tel):/i.test(href))
    .map((href) => ({ href, internal: isInternalHref(href, siteHost) }));
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => textOf(m[1])).filter(Boolean);

  return {
    words: countWords(plainText),
    plainText,
    headings,
    images,
    links,
    firstParagraph: paragraphs[0] ?? "",
    paragraphs,
    sentences: splitSentences(plainText.replace(/\[Immagine(?:: [^\]]*)?\]/g, "")),
  };
}

/**
 * Gulpease readability index, the standard for Italian text (0–100):
 * 89 + (300 · frasi − 10 · lettere) / parole. Above 60 easy for most adults,
 * 40–60 fine for readers with a high-school education, below 40 hard.
 */
export function gulpeaseIndex(text: string): number | null {
  const words = countWords(text);
  if (words === 0) return null;
  const sentences = Math.max(1, splitSentences(text).length);
  const letters = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return Math.max(0, Math.min(100, Math.round(89 + (300 * sentences - 10 * letters) / words)));
}

// ─── Review validation ───────────────────────────────────────────────────────

export type BlogField = keyof BlogContent;

export interface BlogValidationIssue {
  field: BlogField;
  message: string;
}

/**
 * Everything that must be fixed before the client sees the article, in
 * Italian. Empty = ready for review. Used by submitForReview and the editor.
 */
export function validateBlogForReview(content: BlogContent): BlogValidationIssue[] {
  const issues: BlogValidationIssue[] = [];
  const add = (field: BlogField, message: string) => issues.push({ field, message });

  const headline = content.headline.trim();
  if (!headline) add("headline", "Inserisci il titolo dell'articolo.");
  else if (charCount(headline) > BLOG_LIMITS.headlineReview) {
    add("headline", `Il titolo è troppo lungo: ${charCount(headline)} caratteri, al massimo ${BLOG_LIMITS.headlineReview}.`);
  }

  const slug = content.slug.trim();
  if (!slug) add("slug", "Inserisci lo slug, cioè l'indirizzo dell'articolo (es. perche-e-cosi).");
  else if (!SLUG_PATTERN.test(slug)) {
    add("slug", "Lo slug può contenere solo lettere minuscole senza accenti, numeri e trattini (es. perche-e-cosi).");
  } else if (slug.length > BLOG_LIMITS.slug) {
    add("slug", `Lo slug è troppo lungo: al massimo ${BLOG_LIMITS.slug} caratteri.`);
  }

  const words = wordCount(content.bodyMarkdown);
  if (words === 0) add("bodyMarkdown", "Scrivi il testo dell'articolo.");
  else if (words < MIN_REVIEW_WORDS) {
    add("bodyMarkdown", `Il testo è troppo corto: ${words} ${words === 1 ? "parola" : "parole"}, ne servono almeno ${MIN_REVIEW_WORDS}.`);
  }

  const meta = content.metaDescription.trim();
  const metaLength = charCount(meta);
  if (!meta) {
    add("metaDescription", `Scrivi la meta description (tra ${META_DESCRIPTION_MIN} e ${META_DESCRIPTION_MAX} caratteri).`);
  } else if (metaLength < META_DESCRIPTION_MIN || metaLength > META_DESCRIPTION_MAX) {
    add(
      "metaDescription",
      `La meta description deve avere tra ${META_DESCRIPTION_MIN} e ${META_DESCRIPTION_MAX} caratteri (ora ${metaLength}).`
    );
  }

  if (charCount(content.metaTitle.trim()) > BLOG_LIMITS.metaTitleReview) {
    add("metaTitle", `Il titolo SEO è troppo lungo: al massimo ${BLOG_LIMITS.metaTitleReview} caratteri.`);
  }

  if (content.featuredImage && !content.featuredImage.alt?.trim()) {
    add("featuredImage", "Aggiungi il testo alternativo all'immagine in evidenza.");
  }

  return issues;
}

// ─── SEO checks ──────────────────────────────────────────────────────────────

export type SeoStatus = "ok" | "warning" | "error";

export const SEO_STATUS_LABELS: Record<SeoStatus, string> = {
  ok: "Ok",
  warning: "Avviso",
  error: "Errore",
};

export interface SeoCheck {
  id: string;
  label: string;
  status: SeoStatus;
  /** One line in Italian: what was found and, if needed, what to do. */
  message: string;
}

function includesKeyword(haystack: string, keyword: string): boolean {
  const k = normalizeForMatch(keyword);
  return k.length > 0 && normalizeForMatch(haystack).includes(k);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * SEO and readability checks for the editor's SEO panel (and the agency
 * view). Advisory: only validateBlogForReview blocks sending to the client.
 * `siteHost` (e.g. "rossi.it") lets absolute links to the client's own site
 * count as internal; without it only relative links (/servizi) do.
 */
export function seoChecks(content: BlogContent, options: { siteHost?: string | null } = {}): SeoCheck[] {
  const checks: SeoCheck[] = [];
  const add = (id: string, label: string, status: SeoStatus, message: string) =>
    checks.push({ id, label, status, message });

  const body = analyzeBody(content.bodyMarkdown, options);
  const keyword = content.focusKeyword.trim();
  const headline = content.headline.trim();
  const effectiveTitle = content.metaTitle.trim() || headline;
  const meta = content.metaDescription.trim();
  const slug = content.slug.trim();

  // Focus keyword
  if (!keyword) {
    add("keyword", "Parola chiave", "warning", "Imposta una parola chiave per attivare i controlli che la riguardano.");
  } else {
    add("keyword", "Parola chiave", "ok", `Parola chiave: "${keyword}".`);
    add(
      "keyword-title",
      "Parola chiave nel titolo",
      includesKeyword(effectiveTitle, keyword) || includesKeyword(headline, keyword) ? "ok" : "warning",
      includesKeyword(effectiveTitle, keyword) || includesKeyword(headline, keyword)
        ? "Il titolo contiene la parola chiave."
        : "Il titolo non contiene la parola chiave: è il segnale più forte per Google."
    );
    add(
      "keyword-intro",
      "Parola chiave nell'introduzione",
      includesKeyword(body.firstParagraph, keyword) ? "ok" : "warning",
      includesKeyword(body.firstParagraph, keyword)
        ? "Il primo paragrafo contiene la parola chiave."
        : "Usa la parola chiave nel primo paragrafo, così il tema è chiaro da subito."
    );
    add(
      "keyword-meta",
      "Parola chiave nella meta description",
      includesKeyword(meta, keyword) ? "ok" : "warning",
      includesKeyword(meta, keyword)
        ? "La meta description contiene la parola chiave (Google la evidenzia in grassetto)."
        : "Aggiungi la parola chiave alla meta description: Google la evidenzia nei risultati."
    );
    const keywordSlug = slugify(keyword);
    add(
      "keyword-slug",
      "Parola chiave nello slug",
      keywordSlug && slug.includes(keywordSlug) ? "ok" : "warning",
      keywordSlug && slug.includes(keywordSlug)
        ? "Lo slug contiene la parola chiave."
        : `Lo slug non contiene la parola chiave (es. "${keywordSlug || "parola-chiave"}").`
    );
    const subheadings = body.headings.filter((h) => h.level === 2 || h.level === 3);
    if (subheadings.length > 0) {
      const inSub = subheadings.some((h) => includesKeyword(h.text, keyword));
      add(
        "keyword-subheading",
        "Parola chiave nei sottotitoli",
        inSub ? "ok" : "warning",
        inSub
          ? "Almeno un sottotitolo contiene la parola chiave."
          : "Nessun sottotitolo (H2/H3) contiene la parola chiave o una sua variante."
      );
    }
    if (body.words > 0) {
      const occurrences = countOccurrences(normalizeForMatch(body.plainText), normalizeForMatch(keyword));
      const keywordWords = Math.max(1, countWords(keyword));
      const density = ((occurrences * keywordWords) / body.words) * 100;
      const densityLabel = density.toLocaleString("it-IT", { maximumFractionDigits: 1 });
      if (occurrences === 0) {
        add("keyword-density", "Densità della parola chiave", "error", "La parola chiave non compare mai nel testo.");
      } else if (density > 3) {
        add(
          "keyword-density",
          "Densità della parola chiave",
          "warning",
          `Ripetuta ${occurrences} volte (${densityLabel}%): sembra forzata, usa sinonimi.`
        );
      } else if (density < 0.3 && body.words >= 300) {
        add(
          "keyword-density",
          "Densità della parola chiave",
          "warning",
          `Compare solo ${occurrences === 1 ? "una volta" : `${occurrences} volte`} (${densityLabel}%): usala qualche volta in più.`
        );
      } else {
        add(
          "keyword-density",
          "Densità della parola chiave",
          "ok",
          `Compare ${occurrences === 1 ? "una volta" : `${occurrences} volte`} (${densityLabel}%).`
        );
      }
    }
  }

  // Title tag
  const titleLength = charCount(effectiveTitle);
  if (!effectiveTitle) {
    add("meta-title", "Titolo SEO", "error", "Manca il titolo: scrivi il titolo dell'articolo o un titolo SEO.");
  } else if (titleLength > META_TITLE_IDEAL_MAX) {
    add(
      "meta-title",
      "Titolo SEO",
      "warning",
      `${titleLength} caratteri: Google mostra circa ${META_TITLE_IDEAL_MAX} caratteri, il resto viene tagliato.`
    );
  } else if (titleLength < 30) {
    add("meta-title", "Titolo SEO", "warning", `${titleLength} caratteri: un titolo tra 30 e 60 caratteri attira più clic.`);
  } else {
    add(
      "meta-title",
      "Titolo SEO",
      "ok",
      content.metaTitle.trim() ? `${titleLength} caratteri.` : `${titleLength} caratteri (usa il titolo dell'articolo).`
    );
  }

  // Meta description
  const metaLength = charCount(meta);
  if (!meta) {
    add("meta-description", "Meta description", "error", "Manca la meta description: Google mostrerà un pezzo di testo a caso.");
  } else if (metaLength < META_DESCRIPTION_MIN || metaLength > META_DESCRIPTION_MAX) {
    add(
      "meta-description",
      "Meta description",
      "error",
      metaLength < META_DESCRIPTION_MIN
        ? `${metaLength} caratteri: troppo corta, ne servono almeno ${META_DESCRIPTION_MIN}.`
        : `${metaLength} caratteri: troppo lunga, Google la taglia dopo circa ${META_DESCRIPTION_MAX}.`
    );
  } else {
    add("meta-description", "Meta description", "ok", `${metaLength} caratteri.`);
  }

  // Slug
  if (!slug) add("slug", "Slug", "error", "Manca lo slug (l'indirizzo dell'articolo).");
  else if (!SLUG_PATTERN.test(slug)) {
    add("slug", "Slug", "error", "Solo lettere minuscole senza accenti, numeri e trattini.");
  } else if (slug.length > 75 || slug.split("-").length > 8) {
    add("slug", "Slug", "warning", "Slug lungo: gli indirizzi brevi (3–5 parole) sono più facili da leggere e condividere.");
  } else {
    add("slug", "Slug", "ok", `/${slug}`);
  }

  // Length
  if (body.words === 0) {
    add("length", "Lunghezza del testo", "error", "Il testo è vuoto.");
  } else if (body.words < MIN_REVIEW_WORDS) {
    add("length", "Lunghezza del testo", "error", `${body.words} parole: troppo poche per posizionarsi.`);
  } else if (body.words < 300) {
    add("length", "Lunghezza del testo", "warning", `${body.words} parole: sotto le 300 è difficile posizionarsi.`);
  } else {
    add("length", "Lunghezza del testo", "ok", `${body.words} parole, ${formatReadingTime(readingTime(content.bodyMarkdown))}.`);
  }

  // Headings
  const h1InBody = body.headings.some((h) => h.level === 1);
  const h2Count = body.headings.filter((h) => h.level === 2).length;
  if (h1InBody) {
    add("headings", "Sottotitoli", "warning", "Il testo contiene un H1: il titolo è già l'H1, usa H2 e H3 per le sezioni.");
  } else if (h2Count === 0 && body.words >= 300) {
    add("headings", "Sottotitoli", "warning", "Nessun sottotitolo H2: dividi il testo in sezioni per lettori e motori di ricerca.");
  } else if (h2Count === 0) {
    add("headings", "Sottotitoli", "ok", "Testo breve: i sottotitoli non sono necessari.");
  } else {
    add("headings", "Sottotitoli", "ok", `${h2Count} ${h2Count === 1 ? "sottotitolo H2" : "sottotitoli H2"}.`);
  }

  // Images and alternative text
  const missingAlt = body.images.filter((image) => !image.alt).length;
  if (!content.featuredImage) {
    add("images", "Immagini", "warning", "Manca l'immagine in evidenza: serve per la condivisione sui social.");
  } else if (!content.featuredImage.alt?.trim()) {
    add("images", "Immagini", "warning", "L'immagine in evidenza non ha il testo alternativo.");
  } else if (missingAlt > 0) {
    add(
      "images",
      "Immagini",
      "warning",
      missingAlt === 1
        ? "Un'immagine nel testo non ha il testo alternativo."
        : `${missingAlt} immagini nel testo non hanno il testo alternativo.`
    );
  } else {
    const total = body.images.length + 1;
    add("images", "Immagini", "ok", `${total === 1 ? "Un'immagine" : `${total} immagini`}, tutte con testo alternativo.`);
  }

  // Links
  const internal = body.links.filter((l) => l.internal).length;
  const external = body.links.length - internal;
  add(
    "internal-links",
    "Link interni",
    internal > 0 ? "ok" : "warning",
    internal > 0
      ? `${internal} ${internal === 1 ? "link interno" : "link interni"}.`
      : "Nessun link ad altre pagine del sito: aggiungine almeno uno (es. /servizi)."
  );
  add(
    "external-links",
    "Link esterni",
    external > 0 ? "ok" : "warning",
    external > 0
      ? `${external} ${external === 1 ? "link esterno" : "link esterni"}.`
      : "Nessun link a fonti esterne: citare fonti autorevoli aumenta la credibilità."
  );

  // Readability
  if (body.sentences.length > 0) {
    const long = body.sentences.filter((s) => countWords(s) > LONG_SENTENCE_WORDS).length;
    const share = long / body.sentences.length;
    add(
      "long-sentences",
      "Frasi lunghe",
      share > 0.25 ? "warning" : "ok",
      share > 0.25
        ? `${Math.round(share * 100)}% delle frasi supera le ${LONG_SENTENCE_WORDS} parole: spezzale per renderle più leggibili.`
        : long === 0
          ? "Nessuna frase troppo lunga."
          : `${long} ${long === 1 ? "frase supera" : "frasi superano"} le ${LONG_SENTENCE_WORDS} parole, va bene.`
    );
    const longParagraphs = body.paragraphs.filter((p) => countWords(p) > LONG_PARAGRAPH_WORDS).length;
    if (longParagraphs > 0) {
      add(
        "long-paragraphs",
        "Paragrafi lunghi",
        "warning",
        `${longParagraphs === 1 ? "Un paragrafo supera" : `${longParagraphs} paragrafi superano`} le ${LONG_PARAGRAPH_WORDS} parole: sul telefono diventano muri di testo.`
      );
    }
    const gulpease = gulpeaseIndex(body.plainText);
    if (gulpease !== null && body.words >= 50) {
      add(
        "readability",
        "Leggibilità (indice Gulpease)",
        gulpease >= 50 ? "ok" : "warning",
        gulpease >= 60
          ? `${gulpease}/100: facile da leggere.`
          : gulpease >= 50
            ? `${gulpease}/100: leggibile per la maggior parte dei lettori.`
            : `${gulpease}/100: testo difficile, usa frasi e parole più brevi.`
      );
    }
  }

  // Excerpt
  add(
    "excerpt",
    "Riassunto",
    content.excerpt.trim() ? "ok" : "warning",
    content.excerpt.trim()
      ? "Presente: compare negli elenchi e nelle condivisioni."
      : "Manca il riassunto che compare negli elenchi del blog e nelle condivisioni."
  );

  return checks;
}

/** Counts by status, for the panel header ("9 ok · 2 avvisi · 1 errore"). */
export function summarizeSeo(checks: SeoCheck[]): Record<SeoStatus, number> {
  const counts: Record<SeoStatus, number> = { ok: 0, warning: 0, error: 0 };
  for (const check of checks) counts[check.status]++;
  return counts;
}

// ─── Word-level diff ─────────────────────────────────────────────────────────

/** Same shape as DiffSegment in lib/posts.ts (that module is server-only). */
export type WordDiffSegment = { type: "same" | "added" | "removed"; value: string };

/**
 * Word-level diff for "cosa è cambiato". Whitespace between two changed
 * words is folded into the change, so a rewritten phrase reads as one
 * struck-through phrase followed by its replacement instead of a word-by-word
 * zebra. Joining same+removed gives `before`, same+added gives `after`.
 */
export function diffWords(before: string, after: string): WordDiffSegment[] {
  if (before === after) return before ? [{ type: "same", value: before }] : [];
  if (!before) return [{ type: "added", value: after }];
  if (!after) return [{ type: "removed", value: before }];

  const changes = diffWordsWithSpace(before, after, { timeout: 1500 });
  if (!changes) {
    return [
      { type: "removed", value: before },
      { type: "added", value: after },
    ];
  }
  const raw: WordDiffSegment[] = changes.map((c) => ({
    type: c.added ? "added" : c.removed ? "removed" : "same",
    value: c.value,
  }));
  return groupChanges(raw);
}

function groupChanges(segments: WordDiffSegment[]): WordDiffSegment[] {
  const out: WordDiffSegment[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed) out.push({ type: "removed", value: removed });
    if (added) out.push({ type: "added", value: added });
    removed = "";
    added = "";
  };
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type === "removed") removed += segment.value;
    else if (segment.type === "added") added += segment.value;
    else {
      const next = segments[i + 1];
      // Bridge only a replacement (both sides pending), so "il gatto" →
      // "un cane" reads as one change; a bare insertion keeps its spaces.
      const bridging = removed && added && next && next.type !== "same" && /^[ \t]+$/.test(segment.value);
      if (bridging) {
        removed += segment.value;
        added += segment.value;
      } else {
        flush();
        const last = out[out.length - 1];
        if (last && last.type === "same") last.value += segment.value;
        else out.push({ ...segment });
      }
    }
  }
  flush();
  return out;
}

/**
 * Splits a diff of plain text into paragraphs (on blank lines in unchanged
 * text), so a long article can show only the paragraphs that changed.
 */
export function splitDiffIntoParagraphs(
  segments: WordDiffSegment[]
): Array<{ changed: boolean; segments: WordDiffSegment[] }> {
  const paragraphs: Array<{ changed: boolean; segments: WordDiffSegment[] }> = [];
  let current: WordDiffSegment[] = [];
  const close = () => {
    if (current.some((s) => s.value.trim())) {
      paragraphs.push({ changed: current.some((s) => s.type !== "same"), segments: current });
    }
    current = [];
  };
  for (const segment of segments) {
    if (segment.type !== "same") {
      current.push(segment);
      continue;
    }
    const parts = segment.value.split(/\n{2,}/);
    parts.forEach((part, i) => {
      if (i > 0) close();
      if (part) current.push({ type: "same", value: part });
    });
  }
  close();
  return paragraphs;
}

export const BLOG_FIELD_LABELS: Record<BlogField, string> = {
  headline: "Titolo",
  slug: "Slug (indirizzo)",
  bodyMarkdown: "Testo",
  excerpt: "Riassunto",
  metaTitle: "Titolo SEO",
  metaDescription: "Meta description",
  focusKeyword: "Parola chiave",
  featuredImage: "Immagine in evidenza",
  categories: "Categorie",
  tags: "Tag",
  author: "Autore",
};

const DIFFED_TEXT_FIELDS = [
  "headline",
  "excerpt",
  "metaTitle",
  "metaDescription",
  "focusKeyword",
  "slug",
  "author",
  "categories",
  "tags",
] as const;

export type BlogDiffField = (typeof DIFFED_TEXT_FIELDS)[number];

export interface BlogContentDiff {
  changed: boolean;
  /** Changed short fields, in display order, each with its word diff. */
  fields: Array<{ field: BlogDiffField; label: string; segments: WordDiffSegment[] }>;
  /** Readable-text diff of the body (null = body unchanged). */
  body: WordDiffSegment[] | null;
  /** Raw Markdown diff of the body, for the agency (null = unchanged). */
  bodyMarkdown: WordDiffSegment[] | null;
  /** Number of body paragraphs that changed. */
  changedParagraphs: number;
  featuredImage: { before: MediaItem | null; after: MediaItem | null; altOnly: boolean } | null;
  /** "Titolo modificato", "Testo: 2 paragrafi modificati"… */
  summary: string[];
}

function fieldText(content: BlogContent, field: BlogDiffField): string {
  const value = content[field];
  return Array.isArray(value) ? value.join(", ") : value;
}

/** What changed between two versions of an article, field by field. */
export function diffBlogContent(before: BlogContent, after: BlogContent): BlogContentDiff {
  const fields: BlogContentDiff["fields"] = [];
  const summary: string[] = [];

  for (const field of DIFFED_TEXT_FIELDS) {
    const a = fieldText(before, field);
    const b = fieldText(after, field);
    if (a === b) continue;
    fields.push({ field, label: BLOG_FIELD_LABELS[field], segments: diffWords(a, b) });
    summary.push(`${BLOG_FIELD_LABELS[field]} ${field === "tags" || field === "categories" ? "modificati" : "modificato"}`);
  }

  let body: WordDiffSegment[] | null = null;
  let bodyMarkdown: WordDiffSegment[] | null = null;
  let changedParagraphs = 0;
  if (before.bodyMarkdown !== after.bodyMarkdown) {
    bodyMarkdown = diffWords(before.bodyMarkdown, after.bodyMarkdown);
    const plainBefore = markdownToPlainText(before.bodyMarkdown);
    const plainAfter = markdownToPlainText(after.bodyMarkdown);
    if (plainBefore !== plainAfter) {
      body = diffWords(plainBefore, plainAfter);
      changedParagraphs = splitDiffIntoParagraphs(body).filter((p) => p.changed).length;
      summary.push(
        changedParagraphs === 1 ? "Testo: 1 paragrafo modificato" : `Testo: ${changedParagraphs} paragrafi modificati`
      );
    } else {
      summary.push("Testo: modificata la formattazione o i link");
    }
  }

  let featuredImage: BlogContentDiff["featuredImage"] = null;
  const fa = before.featuredImage;
  const fb = after.featuredImage;
  if ((fa?.url ?? null) !== (fb?.url ?? null)) {
    featuredImage = { before: fa, after: fb, altOnly: false };
    summary.push(!fb ? "Immagine in evidenza rimossa" : fa ? "Immagine in evidenza cambiata" : "Immagine in evidenza aggiunta");
  } else if (fa && fb && (fa.alt ?? "") !== (fb.alt ?? "")) {
    featuredImage = { before: fa, after: fb, altOnly: true };
    summary.push("Testo alternativo dell'immagine modificato");
  }

  return {
    changed: fields.length > 0 || bodyMarkdown !== null || featuredImage !== null,
    fields,
    body,
    bodyMarkdown,
    changedParagraphs,
    featuredImage,
    summary,
  };
}

// ─── Comment placement ───────────────────────────────────────────────────────

/**
 * Where each comment lands in an article version: "exact", "moved" (quote
 * edited, closest passage found) or "missing". For server pages that list
 * comments next to the article (agency view, portal), from rendered HTML.
 */
export function locateAnchors<T extends { id: string; anchor: BlogAnchor | null }>(
  html: string,
  comments: T[]
): Map<string, { status: "exact" | "moved" | "missing"; match: AnchorMatch | null }> {
  const { text, blockStarts } = htmlToTextWithBlocks(html);
  const result = new Map<string, { status: "exact" | "moved" | "missing"; match: AnchorMatch | null }>();
  for (const comment of comments) {
    if (!comment.anchor) continue;
    const match = findAnchor(text, comment.anchor, { blockStarts });
    result.set(comment.id, { status: match ? (match.exact ? "exact" : "moved") : "missing", match });
  }
  return result;
}

// ─── Export builders ─────────────────────────────────────────────────────────

export interface BlogExportMeta {
  /** Planned publication date (Post.publishAt). */
  publishAt: Date | null;
  versionNumber: number;
  /** true when this is the version the client approved. */
  approved: boolean;
  /** Fallback for an empty slug/headline (Post.title). */
  postTitle: string;
}

/** YAML double-quoted scalar: JSON escapes are valid YAML, plus the line separators YAML would fold. */
export function yamlString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function yamlList(key: string, items: string[]): string {
  return items.length === 0 ? `${key}: []` : `${key}:\n${items.map((item) => `  - ${yamlString(item)}`).join("\n")}`;
}

/** File name (without extension) for an exported article. */
export function blogExportBaseName(content: BlogContent, fallbackTitle: string): string {
  const slug = isValidSlug(content.slug) ? content.slug : slugify(content.headline || fallbackTitle);
  return slug || "articolo";
}

/** Markdown file with YAML front matter (Hugo, Jekyll, Astro, Next…). */
export function buildBlogMarkdownExport(content: BlogContent, meta: BlogExportMeta): string {
  const headline = content.headline.trim() || meta.postTitle;
  const lines = [
    "---",
    `title: ${yamlString(headline)}`,
    `slug: ${yamlString(blogExportBaseName(content, meta.postTitle))}`,
  ];
  if (meta.publishAt) lines.push(`date: ${yamlString(meta.publishAt.toISOString())}`);
  if (content.excerpt.trim()) lines.push(`excerpt: ${yamlString(content.excerpt.trim())}`);
  if (content.author.trim()) lines.push(`author: ${yamlString(content.author.trim())}`);
  lines.push(`meta_title: ${yamlString(content.metaTitle.trim() || headline)}`);
  lines.push(`meta_description: ${yamlString(content.metaDescription.trim())}`);
  if (content.focusKeyword.trim()) lines.push(`focus_keyword: ${yamlString(content.focusKeyword.trim())}`);
  lines.push(yamlList("categories", content.categories));
  lines.push(yamlList("tags", content.tags));
  if (content.featuredImage && isHttpUrl(content.featuredImage.url)) {
    lines.push(`featured_image: ${yamlString(content.featuredImage.url)}`);
    lines.push(`featured_image_alt: ${yamlString(content.featuredImage.alt?.trim() ?? "")}`);
  }
  lines.push(`approved: ${meta.approved ? "true" : "false"}`);
  lines.push(`version: ${Math.max(1, Math.floor(meta.versionNumber))}`);
  lines.push("---", "");
  const body = sanitizeMarkdown(content.bodyMarkdown.replace(/\r\n?/g, "\n")).trim();
  return `${lines.join("\n")}\n${body}\n`;
}

/**
 * Clean HTML page: <h1>, featured image with alt, the sanitized body. The
 * <article> element is what goes into WordPress (Editor di codice).
 */
export function buildBlogHtmlExport(content: BlogContent, meta: BlogExportMeta): string {
  const headline = content.headline.trim() || meta.postTitle;
  const title = content.metaTitle.trim() || headline;
  const parts: string[] = [`<h1>${escapeHtml(headline)}</h1>`];
  const image = content.featuredImage;
  if (image && image.type === "image" && isHttpUrl(image.url)) {
    parts.push(
      `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt?.trim() ?? "")}"${
        image.width && image.height ? ` width="${image.width}" height="${image.height}"` : ""
      }></figure>`
    );
  }
  if (content.excerpt.trim()) parts.push(`<p><em>${escapeHtml(content.excerpt.trim())}</em></p>`);
  parts.push(renderMarkdownSafe(content.bodyMarkdown, { blockMarkers: false }));

  const notice = meta.approved
    ? `Versione ${meta.versionNumber}, approvata dal cliente.`
    : `ATTENZIONE: versione ${meta.versionNumber}, NON ancora approvata dal cliente.`;
  return [
    "<!doctype html>",
    '<html lang="it">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(content.metaDescription.trim())}">`,
    "</head>",
    "<body>",
    `<!-- Approve by Heili. ${notice} Per WordPress copia il contenuto di <article> nell'editor di codice. -->`,
    "<article>",
    parts.join("\n"),
    "</article>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
