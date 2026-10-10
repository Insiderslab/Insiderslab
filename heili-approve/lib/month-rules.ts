/**
 * Vista del mese nel portale cliente — pure rules (no I/O, safe in client
 * components).
 *
 * The month of a client can be seen in three ways on a plan page (Panoramica,
 * Griglia, Sfoglia) and in two on the month route (Griglia, Sfoglia). Sfoglia
 * is the fast review: one card per post, "Approva" or "Commenta", then the
 * next one. These helpers hold what must stay testable: which view a URL
 * asks for, the state of a card, the progress, where the next card is after
 * an action, and which months deserve the "Rivedi tutto <mese> insieme" offer
 * on the portal home.
 *
 * Nothing here decides what is allowed: approvals still go through
 * lib/posts (version binding, transitions) and "Approva i rimanenti" through
 * selectApproveAll, exactly like the monthly plan's "Approva tutto".
 */

import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import {
  byPublishAsc,
  isApprovedLike,
  isInPlanMonth,
  isPlanMonth,
  planMonthOf,
  planProgress,
  progressLabel,
  type PlanProgress,
} from "@/lib/plan-rules";

// ─── Views (URL state) ───────────────────────────────────────────────────────

export const MONTH_VIEWS = ["panoramica", "griglia", "sfoglia"] as const;
export type MonthView = (typeof MONTH_VIEWS)[number];

export const MONTH_VIEW_LABELS: Record<MonthView, string> = {
  panoramica: "Panoramica",
  griglia: "Griglia",
  sfoglia: "Sfoglia",
};

/**
 * `?vista=` → a view among `allowed`; anything else (missing, unknown, a
 * view the page does not have) → `fallback`. Arrays (repeated params) use
 * the first value.
 */
export function parseMonthView(
  value: unknown,
  { allowed = MONTH_VIEWS, fallback = "panoramica" }: { allowed?: readonly MonthView[]; fallback?: MonthView } = {}
): MonthView {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return fallback;
  const view = raw.trim().toLowerCase() as MonthView;
  return allowed.includes(view) ? view : fallback;
}

/** `?i=` → 1-based position, or null when missing / not a positive integer. */
export function parsePosition(value: unknown, max = 500): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

/** "/review/<t>/piani/<id>" + view (+ position) → "…?vista=sfoglia&i=3". Panoramica is the bare path. */
export function viewPath(basePath: string, view: MonthView, position?: number | null): string {
  if (view === "panoramica") return basePath;
  const params = new URLSearchParams({ vista: view });
  if (view === "sfoglia" && position && position > 0) params.set("i", String(position));
  return `${basePath}?${params.toString()}`;
}

/** Where a post page was opened from, so it can offer the way back. */
export type PostOrigin = "griglia" | "sfoglia";

export interface PostReturn {
  da: PostOrigin;
  /** 1-based position in Sfoglia. */
  i: number | null;
  /** "YYYY-MM" when the list is the month route (not a plan). */
  mese: string | null;
}

/** Query string appended to a post link opened from Griglia / Sfoglia. */
export function postLinkQuery(origin: PostOrigin, opts: { position?: number | null; month?: string | null } = {}): string {
  const params = new URLSearchParams({ da: origin });
  if (origin === "sfoglia" && opts.position && opts.position > 0) params.set("i", String(opts.position));
  if (opts.month && isPlanMonth(opts.month)) params.set("mese", opts.month);
  return `?${params.toString()}`;
}

/** Reads `?da=&i=&mese=` of a post page; null when it was not opened from a month view. */
export function parsePostReturn(query: { da?: unknown; i?: unknown; mese?: unknown }): PostReturn | null {
  const rawDa = Array.isArray(query.da) ? query.da[0] : query.da;
  if (rawDa !== "griglia" && rawDa !== "sfoglia") return null;
  const rawMonth = Array.isArray(query.mese) ? query.mese[0] : query.mese;
  return {
    da: rawDa,
    i: parsePosition(query.i),
    mese: typeof rawMonth === "string" && isPlanMonth(rawMonth) ? rawMonth : null,
  };
}

// ─── Posts of a month ────────────────────────────────────────────────────────

/** The reviewer's social posts of `month` (client time zone), in calendar order. */
export function selectMonthPosts<T extends { id: string; kind: ContentKind; publishAt: Date }>(
  posts: readonly T[],
  month: string,
  timeZone: string | null | undefined
): T[] {
  if (!isPlanMonth(month)) return [];
  return byPublishAsc(posts.filter((p) => p.kind === "SOCIAL_POST" && isInPlanMonth(p.publishAt, month, timeZone)));
}

/**
 * The month route answers 404 (not an empty page) for a malformed month and
 * for a month without posts the client can see: a link to another client's
 * month, or to a month with only drafts, tells nothing.
 */
export function monthRouteAllowed(month: string, visiblePostCount: number): boolean {
  return isPlanMonth(month) && visiblePostCount > 0;
}

export interface MonthOffer {
  /** "YYYY-MM". */
  month: string;
  /** Social posts waiting for the client in that month, outside any plan. */
  count: number;
}

/** Minimum number of waiting posts for "Rivedi tutto <mese> insieme". */
export const MONTH_OFFER_MIN = 2;

/**
 * Months for which the portal home offers "Rivedi tutto <mese> insieme":
 * at least two social posts waiting for the client in the same month (client
 * time zone) that are not part of a plan the client sees. Earliest month
 * first, at most `limit`.
 */
export function monthOffers(
  posts: ReadonlyArray<{ kind: ContentKind; canAct: boolean; publishAt: Date }>,
  timeZone: string | null | undefined,
  limit = 3
): MonthOffer[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    if (post.kind !== "SOCIAL_POST" || !post.canAct) continue;
    const month = planMonthOf(post.publishAt, timeZone);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MONTH_OFFER_MIN)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(0, limit);
}

// ─── Sfoglia: card state, progress, next card ────────────────────────────────

export interface BrowseItem {
  id: string;
  status: PostStatus;
  /** The client can approve it now (IN_REVIEW at the version it was sent with). */
  canAct: boolean;
  /** Open client feedback on the version shown (comments, conversations). */
  openComments: number;
}

/**
 * - waiting: Approva / Commenta are available;
 * - feedback: waiting, but the client already left comments: it is decided
 *   from the post page (approve all excludes it too);
 * - changes: the client asked for changes, the agency is working on it;
 * - approved: approved, scheduled or published;
 * - locked: not decidable now (the agency is updating it).
 */
export type BrowseState = "waiting" | "feedback" | "changes" | "approved" | "locked";

export function browseState(item: BrowseItem): BrowseState {
  if (isApprovedLike(item.status)) return "approved";
  if (item.status === "CHANGES_REQUESTED") return "changes";
  if (!item.canAct) return "locked";
  return item.openComments > 0 ? "feedback" : "waiting";
}

/** Items with the posts approved in this session overlaid (the server confirms later). */
export function withApproved<T extends BrowseItem>(items: readonly T[], approvedIds: ReadonlySet<string>): T[] {
  return items.map((item) =>
    approvedIds.has(item.id) && browseState(item) === "waiting"
      ? { ...item, status: "APPROVED" as PostStatus, canAct: false }
      : item
  );
}

/** "8 di 12 approvati" numbers, from the items as they are now. */
export function browseProgress(items: readonly BrowseItem[]): PlanProgress {
  return planProgress(items.map((i) => i.status));
}

export { progressLabel };

export interface BrowseSummary {
  total: number;
  approved: number;
  /** Changes requested plus waiting posts with comments left. */
  withComments: number;
  /** Still to decide with Approva / Commenta. */
  waiting: number;
  /** Not decidable now. */
  locked: number;
}

export function browseSummary(items: readonly BrowseItem[]): BrowseSummary {
  const summary: BrowseSummary = { total: items.length, approved: 0, withComments: 0, waiting: 0, locked: 0 };
  for (const item of items) {
    const state = browseState(item);
    if (state === "approved") summary.approved += 1;
    else if (state === "changes" || state === "feedback") summary.withComments += 1;
    else if (state === "waiting") summary.waiting += 1;
    else summary.locked += 1;
  }
  return summary;
}

/** "10 approvati, 2 con commenti" (zero parts left out). */
export function browseSummaryText(summary: Pick<BrowseSummary, "approved" | "withComments" | "waiting">): string {
  const parts: string[] = [];
  if (summary.approved > 0) parts.push(`${summary.approved} ${summary.approved === 1 ? "approvato" : "approvati"}`);
  if (summary.withComments > 0) {
    parts.push(`${summary.withComments} con ${summary.withComments === 1 ? "commento" : "commenti"}`);
  }
  if (summary.waiting > 0) parts.push(`${summary.waiting} da decidere`);
  return parts.length > 0 ? parts.join(", ") : "nessun post deciso";
}

/**
 * Index of the card to show after the one at `current` was dealt with: the
 * next post still waiting after it, else the first waiting one before it (a
 * skipped post comes back), else the summary (index === items.length).
 * Approved posts, changes requested and posts with comments are skipped.
 */
export function nextBrowseIndex(items: readonly BrowseItem[], current: number): number {
  const waiting = (item: BrowseItem) => browseState(item) === "waiting";
  for (let i = current + 1; i < items.length; i++) if (waiting(items[i])) return i;
  for (let i = 0; i < Math.min(current, items.length); i++) if (waiting(items[i])) return i;
  return items.length;
}

/**
 * Card Sfoglia opens on: the requested 1-based position when it is valid
 * (items.length + 1 is the summary), else the first waiting post, else the
 * summary. Returns a 0-based index (items.length = summary).
 */
export function startBrowseIndex(items: readonly BrowseItem[], requested: number | null): number {
  if (requested !== null && requested >= 1) return Math.min(requested - 1, items.length);
  const first = items.findIndex((item) => browseState(item) === "waiting");
  return first === -1 ? items.length : first;
}

/** Manual step (arrows, swipe, keys): stays inside 0..items.length (the summary is the last step). */
export function stepBrowseIndex(current: number, delta: 1 | -1, total: number): number {
  return Math.max(0, Math.min(total, current + delta));
}
