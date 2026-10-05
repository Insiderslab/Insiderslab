/**
 * Review assistant — pieces shared by the server and the client components.
 *
 * Pure and client-safe: no Prisma, no SDK, no env. The chat panel (client
 * component) and the agency transcript import from here; everything that
 * touches the database or the Claude API lives in the sibling modules.
 */

import { z } from "zod";
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

export const ACTION_AREAS = ["testo", "media", "tono", "cta", "hashtag", "orario", "altro"] as const;
export type ActionArea = (typeof ACTION_AREAS)[number];

export const ACTION_PRIORITIES = ["alta", "media", "bassa"] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const VERDICTS = ["approve", "changes", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * One change requested by the client. Plain numbers (no int/min constraints)
 * keep the JSON schema inside what both providers' structured outputs accept;
 * rules.sanitizeActionItems enforces ranges afterwards.
 */
export const actionItemSchema = z.object({
  area: z.enum(ACTION_AREAS),
  /** 0-based index into PostVersion.media, or null when not about one media. */
  mediaIndex: z.number().nullable(),
  /** Videos: second the change refers to ("verso il settimo secondo" → 7). */
  timeSec: z.number().nullable(),
  /** Videos: end of a range ("dal 12 al 15" → 15), else null. */
  timeEndSec: z.number().nullable(),
  request: z.string(),
  priority: z.enum(ACTION_PRIORITIES),
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
 * dropped, and fields added later (timeSec, timeEndSec) default to null.
 */
export function parseActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  const items: ActionItem[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const parsed = actionItemSchema.safeParse({ mediaIndex: null, timeSec: null, timeEndSec: null, ...entry });
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

/** One bullet line, e.g. "[Immagini/video · Media n°2 · 0:07 · Priorità alta] Tagliare la clip". */
export function formatActionItem(item: ActionItem): string {
  const tags = [ACTION_AREA_LABELS[item.area]];
  if (item.mediaIndex !== null) tags.push(mediaLabel(item.mediaIndex));
  const time = formatActionItemTime(item);
  if (time) tags.push(time);
  tags.push(ACTION_PRIORITY_LABELS[item.priority]);
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

// ─── Message to the agency ───────────────────────────────────────────────────

/**
 * Message posted to the agency as the client's change request: the summary
 * followed by a bulleted list of the actions. Kept under the comment limit.
 */
export function formatChangesMessage(summary: string, actionItems: ActionItem[], maxLength = 5000): string {
  const parts = [summary.trim()];
  if (actionItems.length > 0) {
    parts.push(["Modifiche richieste:", ...actionItems.map((item) => `• ${formatActionItem(item)}`)].join("\n"));
  }
  const message = parts.filter(Boolean).join("\n\n");
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}
