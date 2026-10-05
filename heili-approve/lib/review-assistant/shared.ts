/**
 * Review assistant — pieces shared by the server and the client components.
 *
 * Pure and client-safe: no Prisma, no SDK, no env. The chat panel (client
 * component) and the agency transcript import from here; everything that
 * touches the database or the Claude API lives in the sibling modules.
 */

import { z } from "zod";

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

export const actionItemSchema = z.object({
  area: z.enum(ACTION_AREAS),
  /** 0-based index into PostVersion.media, or null when not about one media. */
  mediaIndex: z.number().int().nullable(),
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
}

/** GET /api/review/[token]/assistant */
export interface AssistantStateResponse {
  session: AssistantSessionView | null;
  /** New conversations the reviewer can still start on this post. */
  sessionsLeft: number;
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

/** Reads ReviewSession.actionItems (JSON) defensively: invalid entries are dropped. */
export function parseActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  const items: ActionItem[] = [];
  for (const entry of value) {
    const parsed = actionItemSchema.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/** One bullet line, e.g. "[Immagini/video · Media n°2 · Priorità alta] Schiarire lo sfondo". */
export function formatActionItem(item: ActionItem): string {
  const tags = [ACTION_AREA_LABELS[item.area]];
  if (item.mediaIndex !== null) tags.push(mediaLabel(item.mediaIndex));
  tags.push(ACTION_PRIORITY_LABELS[item.priority]);
  return `[${tags.join(" · ")}] ${item.request}`;
}

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
