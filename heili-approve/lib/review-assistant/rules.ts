/**
 * Pure rules for the review assistant: cost limits, which session to resume,
 * clean-up of the model's action items and the API view of a session.
 * Kept free of I/O so they are unit-tested directly.
 */

import type { ReviewMessage, ReviewSession } from "@/app/generated/prisma/client";
import { resolveArticleQuote, type AssistantItemTarget, type AssistantMediaRef } from "./content";
import type { HistoryMessage } from "./prompt";
import {
  MAX_CLIENT_MESSAGES_PER_DAY,
  MAX_CLIENT_MESSAGES_PER_SESSION,
  MAX_SESSIONS_PER_POST_PER_REVIEWER,
  formatChangesMessage,
  isVerdict,
  parseActionItems,
  type ActionItem,
  type ActionItemLabels,
  type AssistantSessionView,
} from "./shared";

/** Action items kept from one summary; more than this is noise for the agency. */
export const MAX_ACTION_ITEMS = 15;
const MAX_ACTION_REQUEST_LENGTH = 500;

export type SessionWithMessages = ReviewSession & { messages: ReviewMessage[] };

export interface LimitCounts {
  /**
   * Whether the reviewer already has a session for this version (open, or
   * completed and reopened by the new message) — no new session is created.
   */
  hasCurrentSession: boolean;
  /** Sessions this reviewer has on this post (any version, any status). */
  sessionsOnPost: number;
  /** Client messages already in that session (0 when there is none). */
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
  if (!counts.hasCurrentSession && counts.sessionsOnPost >= MAX_SESSIONS_PER_POST_PER_REVIEWER) {
    return "Hai già usato tutte le conversazioni con l'assistente per questo post. Puoi comunque approvarlo o chiedere modifiche direttamente.";
  }
  if (counts.hasCurrentSession && counts.clientMessagesInSession >= MAX_CLIENT_MESSAGES_PER_SESSION) {
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
 * Session the panel shows and continues for this version: the open one
 * (resume), else the latest completed one (its summary is waiting for the
 * client's click; a new message reopens it). Abandoned sessions are skipped.
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

/** Seconds rounded to tenths; null for anything that is not a usable time. */
function cleanTime(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10) / 10;
}

function cleanRequest(request: string): string {
  return request.trim().replace(/\s+/g, " ").slice(0, MAX_ACTION_REQUEST_LENGTH);
}

type MediaRef = AssistantMediaRef;

/**
 * Media index and video times of one item against a media list: out-of-range
 * indexes become null, times are kept only on a video (within its duration
 * when known, end after start), and a timed item with no media goes to the
 * list's only video.
 */
function placeOnMedia(
  item: Pick<ActionItem, "mediaIndex" | "timeSec" | "timeEndSec" | "pinX" | "pinY">,
  media: MediaRef[]
): Pick<ActionItem, "mediaIndex" | "timeSec" | "timeEndSec" | "pinX" | "pinY"> {
  const videoIndexes = media.flatMap((m, index) => (m.type === "video" ? [index] : []));
  let mediaIndex =
    item.mediaIndex !== null && Number.isInteger(item.mediaIndex) && item.mediaIndex >= 0 && item.mediaIndex < media.length
      ? item.mediaIndex
      : null;
  let timeSec = cleanTime(item.timeSec);
  let timeEndSec = timeSec === null ? null : cleanTime(item.timeEndSec);

  if (timeSec !== null && mediaIndex === null && videoIndexes.length === 1) mediaIndex = videoIndexes[0];
  const target = mediaIndex !== null ? media[mediaIndex] : null;
  if (timeSec !== null && (!target || target.type !== "video")) {
    // A moment only means something on a video.
    timeSec = null;
    timeEndSec = null;
  }
  const duration = target?.durationSec;
  if (timeSec !== null && typeof duration === "number" && duration > 0) {
    // One second of slack for rounding in what the client said.
    if (timeSec > duration + 1) {
      timeSec = null;
      timeEndSec = null;
    } else if (timeEndSec !== null && timeEndSec > duration) {
      timeEndSec = Math.round(duration * 10) / 10;
    }
  }
  if (timeSec !== null && timeEndSec !== null && timeEndSec <= timeSec) timeEndSec = null;
  const validPin =
    mediaIndex !== null &&
    item.pinX !== null &&
    item.pinY !== null &&
    Number.isFinite(item.pinX) &&
    Number.isFinite(item.pinY) &&
    item.pinX >= 0 &&
    item.pinX <= 1 &&
    item.pinY >= 0 &&
    item.pinY <= 1;
  return {
    mediaIndex,
    timeSec,
    timeEndSec,
    pinX: validPin ? Math.round(item.pinX! * 10_000) / 10_000 : null,
    pinY: validPin ? Math.round(item.pinY! * 10_000) / 10_000 : null,
  };
}

/**
 * Cleans the model's action items for a social post: trims, drops empty and
 * duplicate requests, nulls out-of-range media indexes, keeps video times
 * only when they make sense (on a video, within its duration when known, end
 * after start) and caps the list. A timed item with no media goes to the
 * post's only video. Variant and passage do not apply to social posts.
 */
export function sanitizeActionItems(items: ActionItem[], media: MediaRef[]): ActionItem[] {
  return sanitizeActionItemsFor(items, { kind: "SOCIAL_POST", media });
}

const NO_PLACE = { mediaIndex: null, timeSec: null, timeEndSec: null, pinX: null, pinY: null } as const;

/** Variant an item names: by id (any case), else by name; the only one when there is one. */
function matchVariant<T extends { id: string; name: string }>(variants: T[], variantId: string | null): T | null {
  const wanted = variantId?.trim();
  if (wanted) {
    const lower = wanted.toLowerCase();
    const found =
      variants.find((v) => v.id === wanted) ??
      variants.find((v) => v.id.toLowerCase() === lower) ??
      variants.find((v) => v.name.trim().toLowerCase() === lower) ??
      variants.find((v) => `variante ${v.id}`.toLowerCase() === lower);
    if (found) return found;
  }
  return variants.length === 1 ? variants[0] : null;
}

/**
 * sanitizeActionItems for every kind:
 * - social: media and moments of the post (variant and passage dropped);
 * - blog: only the passage, kept when the article really contains it (as it
 *   appears there), so it can be anchored; no media or moments;
 * - ads: the variant (matched by id or name; the only one when the set has
 *   one), then media and moments of that variant; without a variant, no media.
 * Duplicates are the same request on the same variant/passage.
 */
export function sanitizeActionItemsFor(items: ActionItem[], target: AssistantItemTarget): ActionItem[] {
  const seen = new Set<string>();
  const result: ActionItem[] = [];
  for (const item of items) {
    const request = cleanRequest(item.request);
    if (!request) continue;

    let cleaned: ActionItem;
    if (target.kind === "BLOG_ARTICLE") {
      const anchorQuote = resolveArticleQuote({ text: target.articleText }, item.anchorQuote);
      cleaned = { ...item, request, ...NO_PLACE, variantId: null, anchorQuote };
    } else if (target.kind === "AD_CREATIVE") {
      const variant = matchVariant(target.variants, item.variantId);
      cleaned = {
        ...item,
        request,
        ...(variant ? placeOnMedia(item, variant.media) : NO_PLACE),
        variantId: variant?.id ?? null,
        anchorQuote: null,
      };
    } else {
      cleaned = { ...item, request, ...placeOnMedia(item, target.media), variantId: null, anchorQuote: null };
    }

    const key = [
      cleaned.variantId ?? "",
      cleaned.anchorQuote?.toLowerCase() ?? "",
      cleaned.mediaIndex ?? "",
      cleaned.timeSec ?? "",
      cleaned.pinX ?? "",
      cleaned.pinY ?? "",
      request.toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
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

/** API view of a session; `labels` names the ads variants in the ready-made message. */
export function toSessionView(session: SessionWithMessages, labels?: ActionItemLabels): AssistantSessionView {
  const messages = sortMessages(session.messages);
  const clientMessages = messages.filter((m) => m.role === "CLIENT").length;
  const actionItems = parseActionItems(session.actionItems);
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
    actionItems,
    // A completed session can be reopened by a new message (same version).
    clientMessagesLeft: Math.max(0, MAX_CLIENT_MESSAGES_PER_SESSION - clientMessages),
    changesMessage:
      session.status === "COMPLETED" && session.summary
        ? formatChangesMessage(session.summary, actionItems, undefined, labels)
        : null,
  };
}
