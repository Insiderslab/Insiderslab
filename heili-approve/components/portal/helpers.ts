/**
 * Pure helpers for the client portal (/review/<token>): grouping, Italian
 * dates in the client's time zone, comment ordering and the "next post" queue.
 *
 * No I/O and no React: safe in server and client components, unit-tested in
 * __tests__/portal.test.ts.
 */

import type { PostStatus } from "@/app/generated/prisma/client";
import { formatTimeRange, formatTimecode, parseTimecode } from "@/lib/domain";

const FALLBACK_TIME_ZONE = "Europe/Rome";

// ─── Statuses ────────────────────────────────────────────────────────────────

/**
 * What the client reads. Scheduling problems are the agency's business, so a
 * FAILED post still reads "Approvato" (the agency is notified and retries).
 */
export const PORTAL_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "In preparazione",
  IN_REVIEW: "Da approvare",
  CHANGES_REQUESTED: "Modifiche richieste",
  APPROVED: "Approvato",
  SCHEDULING: "Approvato",
  SCHEDULED: "Programmato",
  FAILED: "Approvato",
  CANCELLED: "Annullato",
};

export type PortalTone = "action" | "waiting" | "done";

export function portalTone(status: PostStatus, canAct: boolean): PortalTone {
  if (canAct) return "action";
  if (status === "IN_REVIEW" || status === "CHANGES_REQUESTED") return "waiting";
  return "done";
}

export interface GroupablePost {
  id: string;
  status: PostStatus;
  canAct: boolean;
  publishAt: Date;
}

export interface PortalGroups<T> {
  /** The client can approve / request changes now (by publish date). */
  toReview: T[];
  /** Changes requested: the agency is working on a new version. */
  inProgress: T[];
  /** Approved or scheduled, publish date still ahead (soonest first). */
  approvedUpcoming: T[];
  /** Approved or scheduled, publish date passed (most recent first). */
  approvedPast: T[];
}

/** Splits the reviewer's posts into the sections of the portal home. */
export function groupPortalPosts<T extends GroupablePost>(posts: readonly T[], now: Date = new Date()): PortalGroups<T> {
  const byDate = [...posts].sort((a, b) => a.publishAt.getTime() - b.publishAt.getTime());
  const groups: PortalGroups<T> = { toReview: [], inProgress: [], approvedUpcoming: [], approvedPast: [] };
  for (const post of byDate) {
    const tone = portalTone(post.status, post.canAct);
    if (tone === "action") groups.toReview.push(post);
    else if (tone === "waiting") groups.inProgress.push(post);
    else if (post.publishAt.getTime() >= now.getTime()) groups.approvedUpcoming.push(post);
    else groups.approvedPast.push(post);
  }
  groups.approvedPast.reverse();
  return groups;
}

/**
 * Post to open after the current one: the next post awaiting review in
 * publish order, wrapping around; never the current post itself.
 */
export function nextPostToReview(queue: readonly string[], currentId: string): string | null {
  const others = queue.filter((id) => id !== currentId);
  if (others.length === 0) return null;
  const index = queue.indexOf(currentId);
  if (index === -1) return others[0];
  return queue.slice(index + 1).find((id) => id !== currentId) ?? others[0];
}

// ─── Dates ───────────────────────────────────────────────────────────────────

function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("it-IT", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

function dateParts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("it-IT", { ...options, timeZone }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/**
 * "mercoledì 7 ottobre alle 18:30" in the client's time zone (year added when
 * it is not the current one). Built from parts, so server and browser agree.
 */
export function formatPortalDate(
  date: Date,
  timeZone: string | null | undefined,
  { withTime = true, now = new Date() }: { withTime?: boolean; now?: Date } = {}
): string {
  const zone = safeTimeZone(timeZone);
  const p = dateParts(date, zone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const currentYear = dateParts(now, zone, { year: "numeric" }).year;
  const year = p.year !== currentYear ? ` ${p.year}` : "";
  const day = `${p.weekday} ${p.day} ${p.month}${year}`;
  return withTime ? `${day} alle ${p.hour}:${p.minute}` : day;
}

/** "7 ott, 18:30": compact form for comment timestamps. */
export function formatShortDateTime(date: Date, timeZone: string | null | undefined): string {
  const p = dateParts(date, safeTimeZone(timeZone), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

// ─── Versions ────────────────────────────────────────────────────────────────

/**
 * Version to compare the current one with in "Cosa è cambiato": the newest
 * version this reviewer opened before the current one or, if they never
 * opened an earlier one, the previous version. Null for a first version.
 */
export function diffBaseline(
  viewedVersions: readonly number[],
  currentVersion: number,
  availableVersions: readonly number[]
): { number: number; seenByReviewer: boolean } | null {
  const seen = viewedVersions.filter((n) => n < currentVersion && availableVersions.includes(n));
  if (seen.length > 0) return { number: Math.max(...seen), seenByReviewer: true };
  const older = availableVersions.filter((n) => n < currentVersion);
  if (older.length === 0) return null;
  return { number: Math.max(...older), seenByReviewer: false };
}

// ─── Comments ────────────────────────────────────────────────────────────────

export interface OrderableComment {
  id: string;
  mediaIndex: number | null;
  pinX: number | null;
  pinY: number | null;
  timeSec: number | null;
  timeEndSec: number | null;
  createdAt: Date;
}

/** A comment placed on a media (pin) or on a video moment (timecode). */
export function isLocated(comment: OrderableComment): boolean {
  return comment.mediaIndex !== null && (comment.pinX !== null || comment.timeSec !== null);
}

/**
 * Located comments first (by media, then video moment, then date) numbered
 * 1..n — the same numbers the pins and timeline markers show — then the
 * general ones in chronological order.
 */
export function orderComments<T extends OrderableComment>(
  comments: readonly T[]
): { located: Array<T & { number: number }>; general: T[] } {
  const located = comments
    .filter(isLocated)
    .sort(
      (a, b) =>
        (a.mediaIndex ?? 0) - (b.mediaIndex ?? 0) ||
        (a.timeSec ?? -1) - (b.timeSec ?? -1) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    )
    .map((comment, index) => ({ ...comment, number: index + 1 }));
  const general = comments
    .filter((c) => !isLocated(c))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { located, general };
}

/** "0:07" or "0:12–0:15". */
export const formatMoment = formatTimeRange;

/**
 * Reads what the client typed in a timecode field ("0:07", "7", "1:05").
 * Returns seconds, or null when empty/invalid.
 */
export function parseMomentInput(value: string): number | null {
  const trimmed = value.trim().replace(/[.,]/g, ":");
  if (!trimmed) return null;
  return parseTimecode(trimmed);
}

/** Video moment of a new comment as typed by the client, validated. */
export function checkMomentInput(
  startText: string,
  endText: string | null,
  durationSec?: number
): { timeSec: number; timeEndSec?: number } | { error: string } {
  const timeSec = parseMomentInput(startText);
  if (timeSec === null) return { error: "Scrivi il momento come minuti:secondi, per esempio 0:07." };
  const limit = durationSec && durationSec > 0 ? Math.ceil(durationSec) : null;
  if (limit !== null && timeSec > limit) {
    return { error: `Il video dura ${formatTimecode(limit)}: scegli un momento entro la fine.` };
  }
  if (endText === null || endText.trim() === "") return { timeSec };
  const timeEndSec = parseMomentInput(endText);
  if (timeEndSec === null) return { error: "Scrivi la fine come minuti:secondi, per esempio 0:12." };
  if (timeEndSec <= timeSec) return { error: "La fine deve venire dopo l'inizio." };
  if (limit !== null && timeEndSec > limit) {
    return { error: `Il video dura ${formatTimecode(limit)}: scegli una fine entro la durata.` };
  }
  return { timeSec, timeEndSec };
}

/** "Immagine 2" / "Video 1" for a media index (1-based for people). */
export function mediaName(type: "image" | "video" | undefined, index: number, total: number): string {
  const noun = type === "video" ? "Video" : "Immagine";
  return total > 1 ? `${noun} ${index + 1}` : noun;
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** Path of a portal page; the token is URL-safe but encoded anyway. */
export function portalPath(token: string, postId?: string): string {
  const base = `/review/${encodeURIComponent(token)}`;
  return postId ? `${base}/posts/${encodeURIComponent(postId)}` : base;
}
