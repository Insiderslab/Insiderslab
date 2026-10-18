/**
 * Pure helpers for the Attività pages (no I/O, safe in client components):
 * icons and tones per activity type, relative time labels, links and member
 * labels.
 */

import type { ActivityType } from "@/app/generated/prisma/client";

/** Tailwind text tone for the type icon (tasks are stale, info is fresh). */
export const ACTIVITY_TYPE_TONE_CLASS: Record<ActivityType, string> = {
  CHANGES_REQUESTED: "text-warning",
  CLIENT_COMMENT: "text-warning",
  PLAN_COMMENT: "text-warning",
  WEBSITE_NOTES: "text-warning",
  SCHEDULE_FAILED: "text-error",
  APPROVED: "text-success",
  PLAN_APPROVED: "text-success",
};

/** Line icons (24 grid, 1.75 stroke) for the activity types. */
export const ACTIVITY_TYPE_ICONS: Record<ActivityType, string[]> = {
  // A pencil: the client asked for changes.
  CHANGES_REQUESTED: ["M4 20l4-1 11-11-3-3-11 11-1 4z", "M12.5 7.5l3 3"],
  // A chat bubble: a comment.
  CLIENT_COMMENT: ["M4 5h16v10H9l-5 4z"],
  // A page with a line: a comment on the plan.
  PLAN_COMMENT: ["M6 3h9l3 3v15H6z", "M9 9h6", "M9 13h4"],
  // A browser window: notes on the website.
  WEBSITE_NOTES: ["M3 5h18v14H3z", "M3 9h18", "M6 7h.01"],
  // An alert triangle: scheduling failed.
  SCHEDULE_FAILED: ["M12 3l9 16H3z", "M12 10v4", "M12 17v.01"],
  // A check circle: approved.
  APPROVED: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M8.5 12.5l2.5 2.5 4.5-5"],
  // A calendar with a check: the plan was approved.
  PLAN_APPROVED: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4", "M9 15l2 2 4-4"],
};

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MONTH = 30 * DAY;

/** "adesso", "2 minuti fa", "1 ora fa", "3 giorni fa", then "5 ott". */
export function relativeTimeLabel(value: Date | string, now: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "adesso";
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return minutes === 1 ? "1 minuto fa" : `${minutes} minuti fa`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return hours === 1 ? "1 ora fa" : `${hours} ore fa`;
  }
  if (diff < MONTH) {
    const days = Math.floor(diff / DAY);
    return days === 1 ? "1 giorno fa" : `${days} giorni fa`;
  }
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" }).format(date);
}

/** The post (in the "Revisione" tab) or plan an activity points at, or null. */
export function activityHref(item: { postId: string | null; planId: string | null }): string | null {
  if (item.planId) return `/plans/${item.planId}`;
  if (item.postId) return `/posts/${item.postId}?tab=revisione`;
  return null;
}

/** A member's display name: name, else email, else a neutral placeholder. */
export function memberLabel(member: { name: string | null; email?: string | null }): string {
  return member.name ?? member.email ?? "Persona senza nome";
}
