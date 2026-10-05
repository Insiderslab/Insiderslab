/**
 * Pure rules for the review assistant: cost limits, which session to resume,
 * clean-up of the model's action items and the API view of a session.
 * Kept free of I/O so they are unit-tested directly.
 */

import type { ReviewMessage, ReviewSession } from "@/app/generated/prisma/client";
import type { HistoryMessage } from "./prompt";
import {
  MAX_CLIENT_MESSAGES_PER_DAY,
  MAX_CLIENT_MESSAGES_PER_SESSION,
  MAX_SESSIONS_PER_POST_PER_REVIEWER,
  isVerdict,
  parseActionItems,
  type ActionItem,
  type AssistantSessionView,
} from "./shared";

/** Action items kept from one summary; more than this is noise for the agency. */
export const MAX_ACTION_ITEMS = 15;
const MAX_ACTION_REQUEST_LENGTH = 500;

export type SessionWithMessages = ReviewSession & { messages: ReviewMessage[] };

export interface LimitCounts {
  /** Whether the reviewer already has an OPEN session for this version. */
  hasOpenSession: boolean;
  /** Sessions this reviewer has on this post (any version, any status). */
  sessionsOnPost: number;
  /** Client messages already in the open session (0 when there is none). */
  clientMessagesInSession: number;
  /** Client messages this reviewer sent in the last 24 hours, all posts. */
  clientMessagesLast24h: number;
}

/**
 * Returns the Italian reason a new client message is refused, or null when it
 * is allowed. Every message costs a model call, so these caps bound the spend
 * per reviewer.
 */
export function checkMessageLimits(counts: LimitCounts): string | null {
  if (!counts.hasOpenSession && counts.sessionsOnPost >= MAX_SESSIONS_PER_POST_PER_REVIEWER) {
    return "Hai già usato tutte le conversazioni con l'assistente per questo post. Puoi comunque approvarlo o chiedere modifiche direttamente.";
  }
  if (counts.hasOpenSession && counts.clientMessagesInSession >= MAX_CLIENT_MESSAGES_PER_SESSION) {
    return "La conversazione ha raggiunto la lunghezza massima: prepara il riepilogo per l'agenzia.";
  }
  if (counts.clientMessagesLast24h >= MAX_CLIENT_MESSAGES_PER_DAY) {
    return "Hai inviato molti messaggi all'assistente nelle ultime 24 ore. Riprova più tardi oppure scrivi direttamente all'agenzia.";
  }
  return null;
}

export function sessionsLeft(sessionsOnPost: number): number {
  return Math.max(0, MAX_SESSIONS_PER_POST_PER_REVIEWER - sessionsOnPost);
}

/**
 * Session the panel should show for this version: the open one (resume), else
 * the latest completed one (summary still waiting for the client's click).
 */
export function pickSessionForVersion<T extends Pick<ReviewSession, "status" | "versionNumber" | "startedAt">>(
  sessions: T[],
  versionNumber: number
): T | null {
  const forVersion = sessions
    .filter((s) => s.versionNumber === versionNumber)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return forVersion.find((s) => s.status === "OPEN") ?? forVersion.find((s) => s.status === "COMPLETED") ?? null;
}

/**
 * Cleans the model's action items: trims, drops empty and duplicate requests,
 * nulls out-of-range media indexes and caps the list.
 */
export function sanitizeActionItems(items: ActionItem[], mediaCount: number): ActionItem[] {
  const seen = new Set<string>();
  const result: ActionItem[] = [];
  for (const item of items) {
    const request = item.request.trim().replace(/\s+/g, " ").slice(0, MAX_ACTION_REQUEST_LENGTH);
    if (!request) continue;
    const key = request.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const mediaIndex =
      item.mediaIndex !== null && Number.isInteger(item.mediaIndex) && item.mediaIndex >= 0 && item.mediaIndex < mediaCount
        ? item.mediaIndex
        : null;
    result.push({ ...item, request, mediaIndex });
    if (result.length >= MAX_ACTION_ITEMS) break;
  }
  return result;
}

/** Stable chronological order (createdAt ties broken by id). */
export function sortMessages<T extends Pick<ReviewMessage, "createdAt" | "id">>(messages: T[]): T[] {
  return [...messages].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function toHistory(messages: Array<Pick<ReviewMessage, "role" | "content" | "inputMode">>): HistoryMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content, inputMode: m.inputMode }));
}

export function toSessionView(session: SessionWithMessages): AssistantSessionView {
  const messages = sortMessages(session.messages);
  const clientMessages = messages.filter((m) => m.role === "CLIENT").length;
  return {
    id: session.id,
    status: session.status,
    versionNumber: session.versionNumber,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      inputMode: m.inputMode,
      createdAt: m.createdAt.toISOString(),
    })),
    verdict: isVerdict(session.verdict) ? session.verdict : null,
    summary: session.summary,
    actionItems: parseActionItems(session.actionItems),
    clientMessagesLeft:
      session.status === "OPEN" ? Math.max(0, MAX_CLIENT_MESSAGES_PER_SESSION - clientMessages) : 0,
  };
}
