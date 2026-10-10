/**
 * Piano del mese — pure rules (no I/O, safe in client components).
 *
 * A plan ("Piano social ottobre 2026") groups the social posts of one client
 * for one month, so the agency presents them together and the client reviews
 * them on one page. The posts stay ordinary posts: every approval is still
 * per post and bound to the version the client saw.
 *
 * Month: stored as "YYYY-MM" and read in the CLIENT's time zone, so a post
 * at 23:30 on 31 October in Europe/Rome belongs to October even though it is
 * 22:30 UTC (and a post at 00:30 on 1 November belongs to November).
 *
 * Status: derived from the posts (derivePlanStatus); ContentPlan.status is a
 * copy kept in sync by lib/plans.ts.
 */

import type { ContentKind, PlanStatus, PostStatus } from "@/app/generated/prisma/client";
import { toZonedDateTimeString, zonedDateTimeToUtc } from "@/lib/metricool/payload";

const FALLBACK_TIME_ZONE = "Europe/Rome";

// ─── Months ──────────────────────────────────────────────────────────────────

const MONTH_RE = /^(\d{4})-(\d{2})$/;

const MONTH_NAMES = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
] as const;

/** "2026-10" → valid month key (years 2000–2100); null otherwise. */
export function parsePlanMonth(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const match = MONTH_RE.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return `${match[1]}-${match[2]}`;
}

export function isPlanMonth(value: unknown): value is string {
  return typeof value === "string" && parsePlanMonth(value) === value;
}

/** "2026-10" + 1 → "2026-11"; works across years. */
export function addPlanMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + delta;
  const nextYear = Math.floor(index / 12);
  return `${nextYear}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("it-IT", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** Month ("YYYY-MM") an instant falls in, in the given time zone. */
export function planMonthOf(instant: Date, timeZone: string | null | undefined): string {
  return toZonedDateTimeString(instant, safeZone(timeZone)).slice(0, 7);
}

/**
 * UTC bounds of a month in a time zone: [start, end), from local midnight of
 * the 1st to local midnight of the 1st of the next month.
 */
export function planMonthRange(month: string, timeZone: string | null | undefined): { start: Date; end: Date } {
  const key = parsePlanMonth(month);
  if (!key) throw new Error(`Mese non valido: ${month}`);
  const zone = safeZone(timeZone);
  const at = (m: string) => zonedDateTimeToUtc(`${m}-01T00:00`, zone) ?? new Date(`${m}-01T00:00:00Z`);
  return { start: at(key), end: at(addPlanMonths(key, 1)) };
}

/** True when `instant` belongs to `month` in `timeZone`. */
export function isInPlanMonth(instant: Date, month: string, timeZone: string | null | undefined): boolean {
  const { start, end } = planMonthRange(month, timeZone);
  return instant.getTime() >= start.getTime() && instant.getTime() < end.getTime();
}

/** "ottobre". */
export function planMonthName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_NAMES[m - 1] ?? month;
}

/** "ottobre 2026". */
export function planMonthLabel(month: string): string {
  return `${planMonthName(month)} ${month.slice(0, 4)}`;
}

/** "Ottobre 2026". */
export function planMonthTitle(month: string): string {
  const label = planMonthLabel(month);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "di ottobre" / "d'aprile"-free Italian: "di ottobre", "di agosto" (as people write it in plans). */
function ofMonth(month: string): string {
  return `di ${planMonthName(month)}`;
}

const KIND_WORD: Record<ContentKind, string> = {
  SOCIAL_POST: "social",
  BLOG_ARTICLE: "articoli",
  AD_CREATIVE: "creatività",
};

/** Default title: "Piano social ottobre 2026". */
export function defaultPlanTitle(month: string, kind: ContentKind = "SOCIAL_POST"): string {
  return `Piano ${KIND_WORD[kind]} ${planMonthLabel(month)}`;
}

/**
 * Heading the client reads: "Piano social di ottobre" (with the year when it
 * is not the current one in the client's zone: "Piano social di gennaio 2027").
 */
export function planHeading(
  month: string,
  { kind = "SOCIAL_POST", now = new Date(), timeZone }: { kind?: ContentKind; now?: Date; timeZone?: string | null } = {}
): string {
  const year = month.slice(0, 4);
  const currentYear = planMonthOf(now, timeZone).slice(0, 4);
  return `Piano ${KIND_WORD[kind]} ${ofMonth(month)}${year !== currentYear ? ` ${year}` : ""}`;
}

/** "Piano di ottobre" — short form for the agency's emails and chips. */
export function planShortName(month: string): string {
  return `Piano ${ofMonth(month)}`;
}

// ─── Status ──────────────────────────────────────────────────────────────────

/** Post statuses that count as "approvato" for a plan (the client said yes). */
export const APPROVED_LIKE: readonly PostStatus[] = ["APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "DELIVERED"];

export function isApprovedLike(status: PostStatus): boolean {
  return APPROVED_LIKE.includes(status);
}

/**
 * Plan status from its posts (cancelled ones ignored):
 * - no posts → DRAFT;
 * - any post waiting for the client → IN_REVIEW;
 * - else any change request → CHANGES_REQUESTED;
 * - else anything still in draft (never sent, or pulled back by an edit) → DRAFT;
 * - else (every post approved) → APPROVED.
 */
export function derivePlanStatus(statuses: readonly PostStatus[]): PlanStatus {
  const live = statuses.filter((s) => s !== "CANCELLED");
  if (live.length === 0) return "DRAFT";
  if (live.includes("IN_REVIEW")) return "IN_REVIEW";
  if (live.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (live.some((s) => !isApprovedLike(s))) return "DRAFT";
  return "APPROVED";
}

export interface PlanProgress {
  total: number;
  approved: number;
  inReview: number;
  changes: number;
  draft: number;
}

export function planProgress(statuses: readonly PostStatus[]): PlanProgress {
  const live = statuses.filter((s) => s !== "CANCELLED");
  return {
    total: live.length,
    approved: live.filter(isApprovedLike).length,
    inReview: live.filter((s) => s === "IN_REVIEW").length,
    changes: live.filter((s) => s === "CHANGES_REQUESTED").length,
    draft: live.filter((s) => s === "DRAFT").length,
  };
}

/** "8 di 12 approvati" ("1 di 1 approvato"). */
export function progressLabel(progress: Pick<PlanProgress, "approved" | "total">): string {
  return `${progress.approved} di ${progress.total} ${progress.total === 1 ? "approvato" : "approvati"}`;
}

/** 0–100, for the progress bar. */
export function progressPercent(progress: Pick<PlanProgress, "approved" | "total">): number {
  return progress.total === 0 ? 0 : Math.round((progress.approved / progress.total) * 100);
}

/**
 * The client has answered on every post sent to them: nothing waits for
 * them and at least one post got a decision.
 */
export function isPlanDecided(statuses: readonly PostStatus[]): boolean {
  const live = statuses.filter((s) => s !== "CANCELLED");
  if (live.includes("IN_REVIEW")) return false;
  return live.some((s) => isApprovedLike(s) || s === "CHANGES_REQUESTED");
}

/** "10 approvati, 2 con modifiche" (zero parts left out; "nessun post deciso" when empty). */
export function planOutcomeSummary(statuses: readonly PostStatus[]): string {
  const p = planProgress(statuses);
  const parts: string[] = [];
  if (p.approved > 0) parts.push(`${p.approved} ${p.approved === 1 ? "approvato" : "approvati"}`);
  if (p.changes > 0) parts.push(`${p.changes} con modifiche`);
  if (p.inReview > 0) parts.push(`${p.inReview} da rivedere`);
  return parts.length > 0 ? parts.join(", ") : "nessun post deciso";
}

/** Agency labels; DRAFT reads "Da inviare" once the plan went out (something to resend). */
export function planStatusLabel(status: PlanStatus, sent: boolean): string {
  switch (status) {
    case "IN_REVIEW":
      return "In revisione";
    case "CHANGES_REQUESTED":
      return "Modifiche richieste";
    case "APPROVED":
      return "Approvato";
    default:
      return sent ? "Da inviare" : "Bozza";
  }
}

export type PlanTone = "neutral" | "info" | "warning" | "success";

export function planStatusTone(status: PlanStatus): PlanTone {
  switch (status) {
    case "IN_REVIEW":
      return "info";
    case "CHANGES_REQUESTED":
      return "warning";
    case "APPROVED":
      return "success";
    default:
      return "neutral";
  }
}

// ─── Order and navigation ────────────────────────────────────────────────────

/** Calendar order: earliest publication first (ties by id, stable). */
export function byPublishAsc<T extends { id: string; publishAt: Date }>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => a.publishAt.getTime() - b.publishAt.getTime() || a.id.localeCompare(b.id));
}

/** Instagram profile order: newest publication first, as the grid shows it. */
export function instagramGridOrder<T extends { id: string; publishAt: Date }>(posts: readonly T[]): T[] {
  return byPublishAsc(posts).reverse();
}

/** Previous / next post of the plan in calendar order around `currentId`. */
export function planNeighbors(
  orderedIds: readonly string[],
  currentId: string
): { prevId: string | null; nextId: string | null; position: number | null; total: number } {
  const index = orderedIds.indexOf(currentId);
  if (index === -1) return { prevId: null, nextId: null, position: null, total: orderedIds.length };
  return {
    prevId: index > 0 ? orderedIds[index - 1] : null,
    nextId: index < orderedIds.length - 1 ? orderedIds[index + 1] : null,
    position: index + 1,
    total: orderedIds.length,
  };
}

// ─── "Approva tutto il piano" ────────────────────────────────────────────────

export interface ApproveAllCandidate {
  id: string;
  title: string;
  status: PostStatus;
  /** Version the client can act on now (the current one while IN_REVIEW). */
  versionNumber: number;
  /** True when the client can approve it now (IN_REVIEW at the version it was sent with). */
  canAct: boolean;
  /** Open (unresolved) client comments on that version. */
  openClientComments: number;
}

export type ApproveAllSkipReason = "comments" | "changes" | "stale";

export interface ApproveAllPlan {
  approve: Array<{ id: string; versionNumber: number }>;
  skipped: Array<{ id: string; title: string; reason: ApproveAllSkipReason }>;
}

/**
 * Which posts "Approva tutto il piano" approves, given the versions the
 * client saw on the plan page (`seen`: post id → version number):
 * - only posts waiting for the client (IN_REVIEW, canAct);
 * - never a post with open client comments (the client asked something:
 *   they decide it on its own page);
 * - never a post at another version than the one shown (the agency updated
 *   it meanwhile) or one the page did not show;
 * - posts with changes requested are listed as excluded;
 * - already approved posts and drafts are simply not part of it.
 */
export function selectApproveAll(
  posts: readonly ApproveAllCandidate[],
  seen: ReadonlyMap<string, number> | null = null
): ApproveAllPlan {
  const result: ApproveAllPlan = { approve: [], skipped: [] };
  for (const post of posts) {
    if (post.status === "CHANGES_REQUESTED") {
      result.skipped.push({ id: post.id, title: post.title, reason: "changes" });
      continue;
    }
    if (post.status !== "IN_REVIEW") continue;
    if (!post.canAct) {
      result.skipped.push({ id: post.id, title: post.title, reason: "stale" });
      continue;
    }
    if (seen && seen.get(post.id) !== post.versionNumber) {
      result.skipped.push({ id: post.id, title: post.title, reason: "stale" });
      continue;
    }
    if (post.openClientComments > 0) {
      result.skipped.push({ id: post.id, title: post.title, reason: "comments" });
      continue;
    }
    result.approve.push({ id: post.id, versionNumber: post.versionNumber });
  }
  return result;
}

/** Why a post was left out, as the client reads it. */
export const SKIP_REASON_LABELS: Record<ApproveAllSkipReason, string> = {
  comments: "ha commenti o una conversazione da verificare: decidilo dalla sua pagina",
  changes: "hai chiesto modifiche",
  stale: "l'agenzia l'ha aggiornato: riaprilo per vedere la nuova versione",
};
