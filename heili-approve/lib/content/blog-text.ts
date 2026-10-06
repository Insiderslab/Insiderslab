/**
 * Text side of blog articles, with no dependencies: entity decoding, the
 * textContent of rendered article HTML, word counts and the text-quote
 * anchoring of client comments (buildAnchor / findAnchor).
 *
 * Split from lib/content/blog.ts (which re-exports all of it) so the client
 * reader can anchor comments without bundling marked and sanitize-html: the
 * portal gets the article HTML already rendered on the server.
 */

import type { BlogAnchor } from "./types";

/** Italian silent reading speed used for "x min di lettura". */
export const WORDS_PER_MINUTE = 200;

/** Minutes of reading, at least 1 for a non-empty text. */
export function readingMinutesForWords(words: number): number {
  return words <= 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export function formatReadingTime(minutes: number): string {
  return minutes <= 1 ? "1 min di lettura" : `${minutes} min di lettura`;
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Words as a reader counts them ("l'arte" is one, "3,5" counts). */
export function countWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

/** Lowercase, no accents, typographic quotes folded, single spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The text a browser exposes as `element.textContent` for sanitized article
 * HTML, plus where each `data-block` starts in it. The reader's selection
 * offsets and findAnchor work on this same string.
 */
export function htmlToTextWithBlocks(html: string): { text: string; blockStarts: number[] } {
  let text = "";
  const blockStarts: number[] = [];
  const re = /<[^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const token = match[0];
    if (token[0] === "<") {
      const block = /\sdata-block="(\d+)"/.exec(token);
      if (block && token[1] !== "/") blockStarts[Number(block[1])] = text.length;
    } else {
      text += decodeEntities(token);
    }
  }
  return { text, blockStarts };
}


// ─── Text anchoring of comments ──────────────────────────────────────────────

/** Characters of context kept on each side of a quote. */
export const ANCHOR_CONTEXT_CHARS = 32;
export const MAX_ANCHOR_QUOTE = 2000;

/**
 * Anchor for the selection [start, end) of `text` (the article's
 * textContent). Surrounding whitespace is trimmed off the quote; null when
 * nothing but whitespace is selected or the selection is too long.
 */
export function buildAnchor(text: string, start: number, end: number, blockIndex: number | null): BlogAnchor | null {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(text.length, Math.max(start, end));
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s >= e || e - s > MAX_ANCHOR_QUOTE) return null;
  return {
    quote: text.slice(s, e),
    prefix: text.slice(Math.max(0, s - ANCHOR_CONTEXT_CHARS), s),
    suffix: text.slice(e, e + ANCHOR_CONTEXT_CHARS),
    blockIndex,
  };
}

export interface AnchorMatch {
  /** Offsets in the searched text (textContent of the rendered article). */
  start: number;
  end: number;
  /** false = the quote was edited and this is the closest passage. */
  exact: boolean;
}

interface Normalized {
  norm: string;
  /** Start / end offset in the original string of each normalized char. */
  from: number[];
  to: number[];
}

function normalizeWithMap(source: string): Normalized {
  const norm: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let offset = 0;
  for (const ch of source) {
    const start = offset;
    offset += ch.length;
    if (/\s/.test(ch)) {
      if (norm.length > 0 && norm[norm.length - 1] !== " ") {
        norm.push(" ");
        from.push(start);
        to.push(offset);
      }
      continue;
    }
    const folded = ch
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[“”«»]/g, '"')
      .replace(/[–—]/g, "-");
    for (const unit of folded) {
      norm.push(unit);
      from.push(start);
      to.push(offset);
    }
  }
  while (norm.length > 0 && norm[norm.length - 1] === " ") {
    norm.pop();
    from.pop();
    to.pop();
  }
  return { norm: norm.join(""), from, to };
}

function normalizedString(text: string): string {
  return normalizeWithMap(text).norm;
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    map.set(pair, (map.get(pair) ?? 0) + 1);
  }
  return map;
}

/** Sørensen–Dice similarity on character bigrams (0..1). */
export function textSimilarity(a: string, b: string, aBigrams?: Map<string, number>): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = aBigrams ?? bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const [pair, count] of right) overlap += Math.min(count, left.get(pair) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function blockAt(blockStarts: number[] | undefined, offset: number): number | null {
  if (!blockStarts || blockStarts.length === 0) return null;
  let found: number | null = null;
  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i];
    if (start === undefined) continue;
    if (start <= offset) found = i;
    else break;
  }
  return found;
}

const FUZZY_THRESHOLD = 0.72;
const BRIDGE_THRESHOLD = 0.45;
const FUZZY_BUDGET = 4_000_000;

/**
 * Re-anchors a comment in (possibly edited) article text: exact quote first
 * (disambiguated by prefix/suffix and the block hint), then the same ignoring
 * case, accents and whitespace, then the passage between the unchanged
 * prefix and suffix, then the most similar passage of similar length.
 * null = the passage is gone: show the comment under "Commenti su testo
 * modificato".
 *
 * `source` is the article's text (textContent). Sanitized article HTML from
 * renderMarkdownSafe is accepted too: it is converted with
 * htmlToTextWithBlocks, and offsets refer to that text.
 */
export function findAnchor(
  source: string,
  anchor: BlogAnchor,
  options: { blockStarts?: number[] } = {}
): AnchorMatch | null {
  let text = source;
  let blockStarts = options.blockStarts;
  if (looksLikeArticleHtml(source)) {
    const converted = htmlToTextWithBlocks(source);
    text = converted.text;
    blockStarts = blockStarts ?? converted.blockStarts;
  }
  if (!anchor.quote.trim() || !text) return null;

  const hint = anchor.blockIndex;
  const blockBonus = (start: number) => {
    if (hint === null || hint === undefined) return 0;
    const block = blockAt(blockStarts, start);
    if (block === null) return 0;
    return block === hint ? 3 : -Math.min(2, Math.abs(block - hint) * 0.1);
  };

  // 1. Exact quote.
  const exact: number[] = [];
  for (let at = text.indexOf(anchor.quote); at >= 0; at = text.indexOf(anchor.quote, at + 1)) {
    exact.push(at);
    if (exact.length > 500) break;
  }
  if (exact.length > 0) {
    let best = exact[0];
    let bestScore = -Infinity;
    for (const at of exact) {
      const end = at + anchor.quote.length;
      const score =
        commonSuffixLength(text.slice(Math.max(0, at - anchor.prefix.length), at), anchor.prefix) +
        commonPrefixLength(text.slice(end, end + anchor.suffix.length), anchor.suffix) +
        blockBonus(at);
      if (score > bestScore) {
        best = at;
        bestScore = score;
      }
    }
    return { start: best, end: best + anchor.quote.length, exact: true };
  }

  const n = normalizeWithMap(text);
  const quote = normalizedString(anchor.quote);
  if (!quote) return null;
  const prefix = normalizedString(anchor.prefix);
  const suffix = normalizedString(anchor.suffix);
  const toOriginal = (s: number, e: number): AnchorMatch => ({ start: n.from[s], end: n.to[e - 1], exact: false });

  // 2. Same text, ignoring case, accents, quotes style and whitespace.
  const loose: number[] = [];
  for (let at = n.norm.indexOf(quote); at >= 0; at = n.norm.indexOf(quote, at + 1)) {
    loose.push(at);
    if (loose.length > 500) break;
  }
  if (loose.length > 0) {
    let best = loose[0];
    let bestScore = -Infinity;
    for (const at of loose) {
      const end = at + quote.length;
      const score =
        commonSuffixLength(n.norm.slice(Math.max(0, at - prefix.length - 1), at).trimEnd(), prefix) +
        commonPrefixLength(n.norm.slice(end, end + suffix.length + 1).trimStart(), suffix) +
        blockBonus(n.from[at]);
      if (score > bestScore) {
        best = at;
        bestScore = score;
      }
    }
    return { ...toOriginal(best, best + quote.length), exact: true };
  }

  // 3. The quote was edited but its surroundings were not.
  const bridged = findBetweenContext(n.norm, quote, prefix, suffix);
  if (bridged) return toOriginal(bridged.start, bridged.end);

  // 4. The most similar passage of similar length.
  if (quote.length < 12) return null;
  const range = fuzzyRange(n, blockStarts, hint, quote.length);
  const fuzzy = findSimilar(n.norm, quote, prefix, suffix, range.from, range.to);
  return fuzzy ? toOriginal(fuzzy.start, fuzzy.end) : null;
}

function looksLikeArticleHtml(source: string): boolean {
  return /^\s*<(?:[a-z][a-z0-9]*)[\s>/]/i.test(source) && /<\/[a-z][a-z0-9]*>/i.test(source);
}

function findBetweenContext(
  norm: string,
  quote: string,
  prefix: string,
  suffix: string
): { start: number; end: number } | null {
  const pre = prefix.slice(-24).trim();
  const suf = suffix.slice(0, 24).trim();
  if (pre.length < 6 || suf.length < 6) return null;
  const maxGap = Math.max(quote.length * 2, quote.length + 80);
  const quoteBigrams = bigrams(quote);
  let best: { start: number; end: number; score: number } | null = null;
  for (let p = norm.indexOf(pre); p >= 0; p = norm.indexOf(pre, p + 1)) {
    let start = p + pre.length;
    const s = norm.indexOf(suf, start);
    if (s < 0) break;
    if (s - start > maxGap) continue;
    let end = s;
    while (start < end && norm[start] === " ") start++;
    while (end > start && norm[end - 1] === " ") end--;
    if (end <= start) continue;
    const score = textSimilarity(quote, norm.slice(start, end), quoteBigrams);
    if (score >= BRIDGE_THRESHOLD && (!best || score > best.score)) best = { start, end, score };
  }
  return best;
}

function fuzzyRange(
  n: Normalized,
  blockStarts: number[] | undefined,
  hint: number | null,
  quoteLength: number
): { from: number; to: number } {
  const whole = { from: 0, to: n.norm.length };
  if (n.norm.length * quoteLength * 3 <= FUZZY_BUDGET || hint === null || !blockStarts) return whole;
  // Long article: look around the block the comment was made on.
  const original = (block: number) => {
    for (let b = block; b >= 0; b--) if (blockStarts[b] !== undefined) return blockStarts[b];
    return 0;
  };
  const fromOriginal = original(Math.max(0, hint - 2));
  const toOriginal = blockStarts[hint + 3] ?? Number.POSITIVE_INFINITY;
  let from = 0;
  while (from < n.from.length && n.from[from] < fromOriginal) from++;
  let to = from;
  while (to < n.from.length && n.from[to] < toOriginal) to++;
  return { from, to };
}

function findSimilar(
  norm: string,
  quote: string,
  prefix: string,
  suffix: string,
  rangeFrom: number,
  rangeTo: number
): { start: number; end: number } | null {
  const minLength = Math.floor(quote.length * 0.75);
  const maxLength = Math.ceil(quote.length * 1.3);
  if ((rangeTo - rangeFrom) * quote.length * 3 > FUZZY_BUDGET * 4) return null;

  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = rangeFrom; i < rangeTo; i++) {
    if (norm[i] !== " " && (i === 0 || norm[i - 1] === " ")) starts.push(i);
    if (norm[i] !== " " && (i + 1 === norm.length || norm[i + 1] === " ")) ends.push(i + 1);
  }

  const quoteBigrams = bigrams(quote);
  let best: { start: number; end: number; score: number } | null = null;
  let endIndex = 0;
  for (const start of starts) {
    while (endIndex < ends.length && ends[endIndex] - start < minLength) endIndex++;
    for (let k = endIndex; k < ends.length && ends[k] - start <= maxLength; k++) {
      const end = ends[k];
      let score = textSimilarity(quote, norm.slice(start, end), quoteBigrams);
      if (score < FUZZY_THRESHOLD - 0.1) continue;
      // Context nudges ties toward the original spot.
      if (prefix) score += 0.05 * (commonSuffixLength(norm.slice(Math.max(0, start - prefix.length - 1), start).trimEnd(), prefix) / prefix.length);
      if (suffix) score += 0.05 * (commonPrefixLength(norm.slice(end, end + suffix.length + 1).trimStart(), suffix) / suffix.length);
      if (!best || score > best.score) best = { start, end, score };
    }
  }
  return best && best.score >= FUZZY_THRESHOLD ? best : null;
}

