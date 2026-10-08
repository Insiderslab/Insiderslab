/**
 * Review assistant — pieces shared by the server and the client components.
 *
 * Pure and client-safe: no Prisma, no SDK, no env. The chat panel (client
 * component) and the agency transcript import from here; everything that
 * touches the database or the Claude API lives in the sibling modules.
 */

import { z } from "zod";
import type { ContentKind } from "@/app/generated/prisma/client";
import type { AdPlacement } from "@/lib/content/types";
import { formatTimeRange, formatTimecode, parseTimecode } from "@/lib/domain";

// ─── Limits ──────────────────────────────────────────────────────────────────

/** Client messages per conversation. Caps the cost of a single session. */
export const MAX_CLIENT_MESSAGES_PER_SESSION = 30;
/** Conversations one reviewer can start on one post (all versions). */
export const MAX_SESSIONS_PER_POST_PER_REVIEWER = 5;
/** Client messages one reviewer can send across all posts in 24 hours. */
export const MAX_CLIENT_MESSAGES_PER_DAY = 150;
/** Length of a single client message (typed or dictated). */
export const MAX_CLIENT_MESSAGE_LENGTH = 2000;
/** Questions the assistant should ask before wrapping up (soft, prompt-level). */
export const TARGET_MAX_QUESTIONS = 6;

// ─── Model output schemas ────────────────────────────────────────────────────

export const READINESS_VALUES = ["exploring", "ready_changes", "ready_approve"] as const;
export type Readiness = (typeof READINESS_VALUES)[number];

/** One chat turn: the reply shown to the client and where the conversation is. */
export const turnOutputSchema = z.object({
  reply: z.string(),
  readiness: z.enum(READINESS_VALUES),
});
export type TurnOutput = z.infer<typeof turnOutputSchema>;

export const ACTION_AREAS = ["testo", "media", "tono", "cta", "hashtag", "orario", "seo", "altro"] as const;
export type ActionArea = (typeof ACTION_AREAS)[number];

export const ACTION_PRIORITIES = ["alta", "media", "bassa"] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const VERDICTS = ["approve", "changes", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * One change requested by the client. Plain numbers (no int/min constraints)
 * keep the JSON schema inside what both providers' structured outputs accept;
 * rules.sanitizeActionItems / sanitizeActionItemsFor enforce ranges afterwards.
 */
export const actionItemSchema = z.object({
  area: z.enum(ACTION_AREAS),
  /** 0-based index into PostVersion.media (ads: into the variant's media), or null. */
  mediaIndex: z.number().nullable(),
  /** Videos: second the change refers to ("verso il settimo secondo" → 7). */
  timeSec: z.number().nullable(),
  /** Videos: end of a range ("dal 12 al 15" → 15), else null. */
  timeEndSec: z.number().nullable(),
  /** Point selected on an image or paused video frame, as relative 0..1 coordinates. */
  pinX: z.number().nullable(),
  pinY: z.number().nullable(),
  request: z.string(),
  priority: z.enum(ACTION_PRIORITIES),
  /** Ads: id of the variant the change is about, else null. */
  variantId: z.string().nullable(),
  /** Blog: the passage of the article the change is about, copied verbatim, else null. */
  anchorQuote: z.string().nullable(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

/** Final summary written for the agency when the conversation ends. */
export const finalOutputSchema = z.object({
  verdict: z.enum(VERDICTS),
  summary: z.string(),
  actionItems: z.array(actionItemSchema),
});
export type FinalOutput = z.infer<typeof finalOutputSchema>;

// ─── Views (API responses) ───────────────────────────────────────────────────

export type ReviewSessionStatusValue = "OPEN" | "COMPLETED" | "ABANDONED";
export type ReviewMessageRoleValue = "CLIENT" | "ASSISTANT";
export type ReviewInputModeValue = "TEXT" | "VOICE";

export interface AssistantMessageView {
  id: string;
  role: ReviewMessageRoleValue;
  content: string;
  inputMode: ReviewInputModeValue;
  /** ISO timestamp. */
  createdAt: string;
}

export interface AssistantSessionView {
  id: string;
  status: ReviewSessionStatusValue;
  versionNumber: number;
  messages: AssistantMessageView[];
  verdict: Verdict | null;
  summary: string | null;
  actionItems: ActionItem[];
  /** Client messages still allowed in this conversation. */
  clientMessagesLeft: number;
  /** Ready-made text for requestChanges once the session is summarised. */
  changesMessage: string | null;
}

/** GET /api/review/[token]/assistant?postId=&versionNumber= */
export interface AssistantStateResponse {
  session: AssistantSessionView | null;
  /** New conversations the reviewer can still start on this post. */
  sessionsLeft: number;
  /** False when the post can no longer be approved or changed (read-only). */
  canChat: boolean;
}

/** POST /api/review/[token]/assistant */
export interface AssistantTurnResponse {
  session: AssistantSessionView;
  readiness: Readiness;
  sessionsLeft: number;
}

/** POST /api/review/[token]/assistant/finalize */
export interface AssistantFinalizeResponse {
  session: AssistantSessionView;
  /** Ready-made text for requestChanges (summary + bullet list). */
  changesMessage: string;
}

// ─── Labels and formatting ───────────────────────────────────────────────────

export const ACTION_AREA_LABELS: Record<ActionArea, string> = {
  testo: "Testo",
  media: "Immagini/video",
  tono: "Tono",
  cta: "Invito all'azione",
  hashtag: "Hashtag",
  orario: "Data e orario",
  seo: "SEO",
  altro: "Altro",
};

export const ACTION_PRIORITY_LABELS: Record<ActionPriority, string> = {
  alta: "Priorità alta",
  media: "Priorità media",
  bassa: "Priorità bassa",
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  approve: "Pronto per l'approvazione",
  changes: "Modifiche richieste",
  unclear: "Esito non chiaro",
};

export const SESSION_STATUS_LABELS: Record<ReviewSessionStatusValue, string> = {
  OPEN: "In corso",
  COMPLETED: "Conclusa",
  ABANDONED: "Interrotta",
};

/** "Media n°2" — humans count from 1, the data model from 0. */
export function mediaLabel(mediaIndex: number): string {
  return `Media n°${mediaIndex + 1}`;
}

/**
 * Reads ReviewSession.actionItems (JSON) defensively: invalid entries are
 * dropped, and fields added later (timeSec, timeEndSec, variantId,
 * anchorQuote, pinX, pinY) default to null.
 */
export function parseActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  const items: ActionItem[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const parsed = actionItemSchema.safeParse({
      mediaIndex: null,
      timeSec: null,
      timeEndSec: null,
      pinX: null,
      pinY: null,
      variantId: null,
      anchorQuote: null,
      ...entry,
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/** "0:07" or "0:12–0:15"; null when the item has no time. */
export function formatActionItemTime(item: Pick<ActionItem, "timeSec" | "timeEndSec">): string | null {
  if (item.timeSec === null) return null;
  return formatTimeRange(item.timeSec, item.timeEndSec);
}

/** Names that make action items readable: ads variants by id. */
export interface ActionItemLabels {
  variantNames?: Record<string, string>;
}

/** "Variante A — Prima/dopo" (its name), or "Variante A" from the id. */
export function variantNameFor(variantId: string, labels?: ActionItemLabels): string {
  const name = labels?.variantNames?.[variantId]?.trim();
  return name || `Variante ${variantId}`;
}

/** «Le nostre colombe sono…» — a passage shortened for tags and chips. */
export function shortQuote(quote: string, max = 80): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return `«${chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : flat}»`;
}

/** Where an item points, as tags: variant, passage, media, moment. */
export function actionItemPlaceTags(item: ActionItem, labels?: ActionItemLabels): string[] {
  const tags: string[] = [];
  if (item.variantId) tags.push(variantNameFor(item.variantId, labels));
  if (item.anchorQuote) tags.push(`Passaggio ${shortQuote(item.anchorQuote)}`);
  if (item.mediaIndex !== null) tags.push(mediaLabel(item.mediaIndex));
  const time = formatActionItemTime(item);
  if (time) tags.push(time);
  if (item.pinX !== null && item.pinY !== null) {
    tags.push(`Punto ${Math.round(item.pinX * 100)}%, ${Math.round(item.pinY * 100)}%`);
  }
  return tags;
}

/** One bullet line, e.g. "[Immagini/video · Media n°2 · 0:07 · Priorità alta] Tagliare la clip". */
export function formatActionItem(item: ActionItem, labels?: ActionItemLabels): string {
  const tags = [ACTION_AREA_LABELS[item.area], ...actionItemPlaceTags(item, labels), ACTION_PRIORITY_LABELS[item.priority]];
  return `[${tags.join(" · ")}] ${item.request}`;
}

// ─── Video moments ───────────────────────────────────────────────────────────

/**
 * Text the panel inserts when the client taps "Usa il momento attuale". The
 * prompt tells the model what it means; the transcript turns it into a chip.
 */
export function videoMomentMarker(timeSec: number): string {
  return `[al momento ${formatTimecode(timeSec)} del video]`;
}

export type MessageSegment = { type: "text"; value: string } | { type: "moment"; label: string; timeSec: number };

/** Splits a message into text and video-moment markers (rendered as chips). */
export function splitVideoMoments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const re = /\[al momento ((?:\d+:)?\d{1,2}:\d{2}) del video\]/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const timeSec = parseTimecode(match[1]);
    if (timeSec === null) continue;
    if (match.index > last) segments.push({ type: "text", value: text.slice(last, match.index) });
    segments.push({ type: "moment", label: match[1], timeSec });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

// ─── Blog passages and ads variants ──────────────────────────────────────────

/** Longest passage the panel inserts into a message. */
export const MAX_MARKER_QUOTE = 400;

/** Marker text can hold no brackets or guillemets (they delimit it). */
function markerSafe(value: string): string {
  return value
    .replace(/[«»]/g, '"')
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/·/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Text the panel inserts when the client taps "Usa il passaggio selezionato"
 * on an article: the selected text, quoted. The prompt tells the model to
 * copy it as the item's anchorQuote.
 */
export function passageMarker(quote: string): string {
  const clean = markerSafe(quote);
  const chars = Array.from(clean);
  const shown = chars.length > MAX_MARKER_QUOTE ? `${chars.slice(0, MAX_MARKER_QUOTE - 1).join("").trimEnd()}…` : clean;
  return `[passaggio «${shown}»]`;
}

export interface VariantMarkerInput {
  variantId: string;
  variantName?: string | null;
  /** "Storie e Reels", already a label. */
  placementLabel?: string | null;
  timeSec?: number | null;
}

export interface PointMarkerInput {
  mediaIndex: number;
  x: number;
  y: number;
  variantId?: string | null;
  timeSec?: number | null;
}

/**
 * Machine-readable marker for one selected point. Every part of the target is
 * kept in the same marker so a later summary cannot combine the point with a
 * different media, ads variant or video moment.
 */
export function pointMarker(input: PointMarkerInput): string {
  const mediaIndex = Math.max(0, Math.trunc(input.mediaIndex));
  const x = Math.min(1, Math.max(0, input.x));
  const y = Math.min(1, Math.max(0, input.y));
  const variant = input.variantId?.trim() ? encodeURIComponent(input.variantId.trim()) : "-";
  const time =
    typeof input.timeSec === "number" && Number.isFinite(input.timeSec) && input.timeSec >= 0
      ? String(Math.round(input.timeSec * 10) / 10)
      : "-";
  return `[punto media=${mediaIndex} x=${x.toFixed(4)} y=${y.toFixed(4)} variante=${variant} tempo=${time}]`;
}

/**
 * Text the panel inserts when the client taps "Usa la variante e il momento
 * attuali" on an ads set: which variant, in which placement, at which moment.
 */
export function variantMarker(input: VariantMarkerInput): string {
  const parts = [`variante ${markerSafe(input.variantId)}${input.variantName?.trim() ? ` «${markerSafe(input.variantName)}»` : ""}`];
  if (input.placementLabel?.trim()) parts.push(markerSafe(input.placementLabel));
  if (typeof input.timeSec === "number" && Number.isFinite(input.timeSec) && input.timeSec >= 0) {
    parts.push(`al momento ${formatTimecode(input.timeSec)}`);
  }
  return `[${parts.join(" · ")}]`;
}

export type MarkerSegment =
  | MessageSegment
  | { type: "passage"; quote: string }
  | {
      type: "variant";
      variantId: string;
      variantName: string | null;
      placementLabel: string | null;
      timeSec: number | null;
      label: string;
    }
  | {
      type: "point";
      mediaIndex: number;
      x: number;
      y: number;
      variantId: string | null;
      timeSec: number | null;
      label: string;
    };

const MARKER_RE = new RegExp(
  [
    String.raw`\[al momento ((?:\d+:)?\d{1,2}:\d{2}) del video\]`,
    String.raw`\[passaggio «([^«»\[\]]{1,500})»\]`,
    String.raw`\[variante ([A-Za-z0-9_-]{1,32})(?: «([^«»\[\]]{1,200})»)?((?: · [^·\[\]]{1,80})*)\]`,
    String.raw`\[punto media=(\d{1,4}) x=(0(?:\.\d+)?|1(?:\.0+)?) y=(0(?:\.\d+)?|1(?:\.0+)?) variante=([A-Za-z0-9_.~%:-]{1,200}|-) tempo=(\d+(?:\.\d+)?|-)\]`,
  ].join("|"),
  "g"
);

/**
 * Splits a message into text and the markers the panel inserts (video
 * moments, article passages, ads variants), rendered as chips.
 */
export function splitMessageMarkers(text: string): MarkerSegment[] {
  const segments: MarkerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    let segment: MarkerSegment | null = null;
    if (match[1] !== undefined) {
      const timeSec = parseTimecode(match[1]);
      if (timeSec !== null) segment = { type: "moment", label: match[1], timeSec };
    } else if (match[2] !== undefined) {
      segment = { type: "passage", quote: match[2] };
    } else if (match[3] !== undefined) {
      const extras = (match[5] ?? "").split(" · ").map((p) => p.trim()).filter(Boolean);
      let timeSec: number | null = null;
      let placementLabel: string | null = null;
      for (const extra of extras) {
        const moment = /^al momento ((?:\d+:)?\d{1,2}:\d{2})$/.exec(extra);
        if (moment) timeSec = parseTimecode(moment[1]);
        else placementLabel ??= extra;
      }
      const variantName = match[4]?.trim() || null;
      const label = [
        variantName ?? `Variante ${match[3]}`,
        placementLabel,
        timeSec !== null ? formatTimecode(timeSec) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      segment = { type: "variant", variantId: match[3], variantName, placementLabel, timeSec, label };
    } else if (match[6] !== undefined) {
      const mediaIndex = Number(match[6]);
      const x = Number(match[7]);
      const y = Number(match[8]);
      let variantId: string | null = null;
      if (match[9] !== "-") {
        try {
          variantId = decodeURIComponent(match[9]);
        } catch {
          variantId = null;
        }
      }
      const timeSec = match[10] === "-" ? null : Number(match[10]);
      if (
        Number.isInteger(mediaIndex) &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x >= 0 &&
        x <= 1 &&
        y >= 0 &&
        y <= 1 &&
        (timeSec === null || (Number.isFinite(timeSec) && timeSec >= 0))
      ) {
        const label = [
          `Punto sul media ${mediaIndex + 1}`,
          `${Math.round(x * 100)}%, ${Math.round(y * 100)}%`,
          variantId ? `Variante ${variantId}` : null,
          timeSec !== null ? formatTimecode(timeSec) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        segment = { type: "point", mediaIndex, x, y, variantId, timeSec, label };
      }
    }
    if (!segment) continue;
    if (match.index > last) segments.push({ type: "text", value: text.slice(last, match.index) });
    segments.push(segment);
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

// ─── Copy per content kind ───────────────────────────────────────────────────

/** Content kinds as plain strings (the Prisma enum is server-side). */
export type AssistantContentKind = ContentKind;

export interface AssistantKindCopy {
  /** First bubble of the chat. */
  intro: string;
  placeholder: string;
  /** Shown when the client approved through the panel. */
  approvedText: string;
  /** Label of the panel's approve button. */
  approveLabel: string;
}

export const ASSISTANT_KIND_COPY: Record<AssistantContentKind, AssistantKindCopy> = {
  SOCIAL_POST: {
    intro:
      "Ciao! Dimmi pure cosa ne pensi di questo post: cosa ti piace e cosa cambieresti. Puoi scrivere o dettare a voce.",
    placeholder: "Es. «Il testo mi convince, la seconda foto meno»",
    approvedText: "Post approvato. Grazie!",
    approveLabel: "Approva",
  },
  BLOG_ARTICLE: {
    intro:
      "Ciao! Dimmi pure cosa ne pensi di questo articolo: cosa ti convince e cosa cambieresti. Se si tratta di un punto preciso, selezionalo nel testo e tocca «Usa il passaggio selezionato». Puoi scrivere o dettare a voce.",
    placeholder: "Es. «Il secondo paragrafo è troppo tecnico»",
    approvedText: "Articolo approvato. Grazie!",
    approveLabel: "Approva",
  },
  AD_CREATIVE: {
    intro:
      "Ciao! Dimmi pure cosa ne pensi di queste creatività: quale variante ti convince e cosa cambieresti. Se parli di una variante o di un momento del video, tocca «Usa la variante e il momento attuali». Puoi scrivere o dettare a voce.",
    placeholder: "Es. «Nella variante B la scritta finale passa troppo veloce»",
    approvedText: "Decisioni inviate all'agenzia. Grazie!",
    approveLabel: "Invia le mie decisioni",
  },
};

/**
 * Ads: what the client is looking at, for the chip "Usa la variante e il
 * momento attuali" (the review page knows the variant, the placement tab and
 * the video player's time).
 */
export interface AssistantAdsContext {
  variantId: string;
  placement: AdPlacement | null;
  /** Current time of the variant's video player, null without a video. */
  timeSec: number | null;
  /** "Variante B — Prima/dopo", when the page knows it. */
  variantName?: string | null;
  /** "Storie e Reels", when the page knows it. */
  placementLabel?: string | null;
}

// ─── Message to the agency ───────────────────────────────────────────────────

/**
 * Message posted to the agency as the client's change request: the summary
 * followed by a bulleted list of the actions. Kept under the comment limit.
 */
export function formatChangesMessage(
  summary: string,
  actionItems: ActionItem[],
  maxLength = 5000,
  labels?: ActionItemLabels
): string {
  const parts = [summary.trim()];
  if (actionItems.length > 0) {
    parts.push(["Modifiche richieste:", ...actionItems.map((item) => `• ${formatActionItem(item, labels)}`)].join("\n"));
  }
  const message = parts.filter(Boolean).join("\n\n");
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}
