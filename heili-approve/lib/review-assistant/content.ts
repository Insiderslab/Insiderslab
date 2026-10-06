/**
 * Review assistant — what each content kind gives the assistant to work with.
 *
 * Server-only (renders the article Markdown with lib/content/blog). Pure
 * otherwise: no Prisma, no SDK, unit-tested.
 *
 * - Blog: the article's text exactly as the client reads it (the textContent
 *   of the sanitized HTML, the same string BlogReader anchors comments on),
 *   split into its top-level blocks for the prompt. A quote the model copies
 *   from it becomes a BlogAnchor, so the agency sees the comment highlighted.
 * - Ads: the variants (id, name, media) the action items can point at.
 */

import type { ContentKind } from "@/app/generated/prisma/client";
import { coerceAdContent, variantDisplayName } from "@/lib/content/ads";
import { buildAnchor, coerceBlogContent, findAnchor, htmlToTextWithBlocks, normalizeForMatch, renderMarkdownSafe } from "@/lib/content/blog";
import type { AdContent, BlogAnchor, BlogContent } from "@/lib/content/types";
import type { MediaItem } from "@/lib/domain";
import type { RequestChangesActionItem } from "@/lib/posts";
import type { ActionItem, ActionItemLabels } from "./shared";

/** Longest passage kept as an action item's anchorQuote. */
export const MAX_ANCHOR_QUOTE_LENGTH = 500;

// ─── Article text ────────────────────────────────────────────────────────────

export interface ArticleTextModel {
  /** textContent of the rendered article (what anchors are computed on). */
  text: string;
  /** Start offset of each top-level block (data-block) in `text`. */
  blockStarts: number[];
  /** The blocks' text, trimmed (paragraphs, headings, list items…). */
  blocks: string[];
}

/** The article body as the reader renders it, as text and blocks. */
export function articleTextModel(bodyMarkdown: string): ArticleTextModel {
  const { text, blockStarts } = htmlToTextWithBlocks(renderMarkdownSafe(bodyMarkdown ?? ""));
  const starts = blockStarts.filter((s): s is number => typeof s === "number");
  const blocks: string[] = [];
  starts.forEach((start, i) => {
    const block = text.slice(start, i + 1 < starts.length ? starts[i + 1] : text.length).trim();
    if (block) blocks.push(block);
  });
  if (blocks.length === 0 && text.trim()) blocks.push(text.trim());
  return { text, blockStarts: starts, blocks };
}

function blockIndexAt(blockStarts: number[], offset: number): number | null {
  let index: number | null = null;
  for (let i = 0; i < blockStarts.length; i++) {
    if (blockStarts[i] <= offset) index = i;
    else break;
  }
  return index;
}

/** Strips what the model tends to wrap a quote in (guillemets, quotes, ellipses). */
function cleanQuote(quote: string): string {
  return quote
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[«"“'‘]+|[»"”'’]+$/g, "")
    .replace(/^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$/g, "")
    .trim();
}

/**
 * The passage of the article a quote refers to, as it appears in the text
 * (exact, or ignoring case, accents, quote style and spacing), or null when
 * the article does not contain it. A long quote keeps its first part.
 */
export function locateQuote(model: Pick<ArticleTextModel, "text">, quote: string | null): { start: number; end: number } | null {
  if (!quote) return null;
  let clean = cleanQuote(quote);
  if (!clean) return null;
  const chars = Array.from(clean);
  if (chars.length > MAX_ANCHOR_QUOTE_LENGTH) clean = chars.slice(0, MAX_ANCHOR_QUOTE_LENGTH).join("").trimEnd();

  const at = model.text.indexOf(clean);
  if (at >= 0) return { start: at, end: at + clean.length };
  // Loose match only when the normalized text really contains it: findAnchor
  // would otherwise fall back to "the most similar passage".
  if (!normalizeForMatch(model.text).includes(normalizeForMatch(clean))) return null;
  const match = findAnchor(model.text, { quote: clean, prefix: "", suffix: "", blockIndex: null });
  return match ? { start: match.start, end: match.end } : null;
}

/** The quote as it appears in the article, or null (see locateQuote). */
export function resolveArticleQuote(model: Pick<ArticleTextModel, "text">, quote: string | null): string | null {
  const range = locateQuote(model, quote);
  return range ? model.text.slice(range.start, range.end) : null;
}

/** BlogAnchor (with context and block) for a quote, or null when not in the article. */
export function anchorForQuote(model: ArticleTextModel, quote: string | null): BlogAnchor | null {
  const range = locateQuote(model, quote);
  if (!range) return null;
  return buildAnchor(model.text, range.start, range.end, blockIndexAt(model.blockStarts, range.start));
}

// ─── Targets ─────────────────────────────────────────────────────────────────

/** What the action-item rules need to know about a media. */
export type AssistantMediaRef = Pick<MediaItem, "type" | "durationSec">;

/** What a kind's action items may point at (see rules.sanitizeActionItemsFor). */
export type AssistantItemTarget =
  | { kind: "SOCIAL_POST"; media: AssistantMediaRef[] }
  | { kind: "BLOG_ARTICLE"; articleText: string }
  | { kind: "AD_CREATIVE"; variants: Array<{ id: string; name: string; media: AssistantMediaRef[] }> };

/** The version as the assistant needs it, whatever its kind. */
export interface AssistantVersionInput {
  media: MediaItem[];
  /** ReviewerPostVersion.content (BlogContent / AdContent / null). */
  content: unknown;
}

export function blogContentOf(content: unknown): BlogContent {
  return coerceBlogContent(content);
}

export function adContentOf(content: unknown): AdContent {
  return coerceAdContent(content);
}

export function itemTargetFor(kind: ContentKind, version: AssistantVersionInput): AssistantItemTarget {
  if (kind === "BLOG_ARTICLE") {
    return { kind, articleText: articleTextModel(blogContentOf(version.content).bodyMarkdown).text };
  }
  if (kind === "AD_CREATIVE") {
    return {
      kind,
      variants: adContentOf(version.content).variants.map((v) => ({ id: v.id, name: variantDisplayName(v), media: v.media })),
    };
  }
  return { kind: "SOCIAL_POST", media: version.media };
}

/** Variant names for the messages and summaries (ads only). */
export function itemLabelsFor(kind: ContentKind, content: unknown): ActionItemLabels {
  if (kind !== "AD_CREATIVE") return {};
  return {
    variantNames: Object.fromEntries(adContentOf(content).variants.map((v) => [v.id, variantDisplayName(v)])),
  };
}

// ─── Change request ──────────────────────────────────────────────────────────

/**
 * The session's action items as lib/posts requestChanges takes them: ads
 * items keep their variant (and media / moment of that variant); blog items
 * get the BlogAnchor of their passage in this version, so each becomes a
 * comment highlighted in the article. Social items are unchanged.
 */
export function toRequestChangesItems(
  kind: ContentKind,
  version: Pick<AssistantVersionInput, "content">,
  items: ActionItem[]
): RequestChangesActionItem[] {
  const model = kind === "BLOG_ARTICLE" ? articleTextModel(blogContentOf(version.content).bodyMarkdown) : null;
  return items.map((item) => ({
    area: item.area,
    mediaIndex: kind === "BLOG_ARTICLE" ? null : item.mediaIndex,
    timeSec: kind === "BLOG_ARTICLE" ? null : item.timeSec,
    timeEndSec: kind === "BLOG_ARTICLE" ? null : item.timeEndSec,
    request: item.request,
    priority: item.priority,
    variantId: kind === "AD_CREATIVE" ? item.variantId : null,
    anchor: model ? anchorForQuote(model, item.anchorQuote) : null,
  }));
}
