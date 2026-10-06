/**
 * Pure helpers for the agency post pages (no I/O, safe in client components):
 * status filters and actions, dates in the client's time zone, calendar
 * grids, caption counters, comment threads, Italian event descriptions.
 */

import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import type { BlogAnchor } from "@/lib/content/types";
import {
  KIND_CONFIG,
  NETWORK_LABELS,
  NETWORK_TEXT_LIMITS,
  STATUS_LABELS,
  STATUS_TONES,
  canTransition,
  formatTimeRange,
  isNetwork,
  statusLabelFor,
  type Network,
  type NetworkOptions,
} from "@/lib/domain";
import { getNetworkFormat, toZonedDateTimeString, zonedDateTimeToUtc } from "@/lib/metricool/payload";
import { kindParam } from "@/lib/variant";

export const DEFAULT_TIME_ZONE = "Europe/Rome";

// ─── Statuses ────────────────────────────────────────────────────────────────

export const POST_STATUSES: readonly PostStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SCHEDULING",
  "SCHEDULED",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
];

/** Statuses only social posts reach (Metricool scheduling). */
const SOCIAL_ONLY_STATUSES: readonly PostStatus[] = ["SCHEDULING", "SCHEDULED", "FAILED"];

/**
 * Statuses posts of these kinds can be in, in display order: the filters
 * and legends of a blog/ads-only instance do not offer Metricool statuses,
 * a social-only one does not offer "Consegnato".
 */
export function statusesForKinds(kinds: readonly ContentKind[]): PostStatus[] {
  const social = kinds.includes("SOCIAL_POST");
  const internal = kinds.some((kind) => KIND_CONFIG[kind].internal);
  return POST_STATUSES.filter((status) => {
    if (SOCIAL_ONLY_STATUSES.includes(status)) return social;
    if (status === "DELIVERED") return internal;
    return true;
  });
}

/**
 * Status label for a list that may mix kinds: the kind's own wording when
 * known ("Pubblicato" for an article), the generic one otherwise.
 */
export function kindStatusLabel(status: PostStatus, kind: ContentKind | null = null): string {
  return kind ? statusLabelFor(kind, status) : STATUS_LABELS[status];
}

/** `?status=attention`: what is waiting on the agency (same as the top bar counter). */
export const ATTENTION_STATUSES: readonly PostStatus[] = ["CHANGES_REQUESTED", "FAILED"];

export function isPostStatus(value: unknown): value is PostStatus {
  return typeof value === "string" && (POST_STATUSES as readonly string[]).includes(value);
}

export type StatusFilter =
  | { kind: "all" }
  | { kind: "attention" }
  | { kind: "status"; status: PostStatus };

export function parseStatusFilter(value: string | string[] | undefined): StatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "attention") return { kind: "attention" };
  if (isPostStatus(raw)) return { kind: "status", status: raw };
  return { kind: "all" };
}

/** Statuses a filter matches; "all" hides cancelled posts. */
export function statusesForFilter(filter: StatusFilter): PostStatus[] {
  switch (filter.kind) {
    case "attention":
      return [...ATTENTION_STATUSES];
    case "status":
      return [filter.status];
    case "all":
      return POST_STATUSES.filter((s) => s !== "CANCELLED");
  }
}

/** URL state of the posts list (/posts?kind=&status=&clientId=&periodo=&q=&pagina=). */
export interface PostFilterValues {
  /** "" (every enabled kind) or a kind slug ("social" | "blog" | "ads"). */
  kind?: string;
  status: string;
  clientId: string;
  /** "" | "prossimi" | "passati" */
  periodo: string;
  q: string;
}

export function buildPostsHref(values: Partial<PostFilterValues> & { pagina?: number }): string {
  const params = new URLSearchParams();
  if (values.kind) params.set("kind", values.kind);
  if (values.status) params.set("status", values.status);
  if (values.clientId) params.set("clientId", values.clientId);
  if (values.periodo) params.set("periodo", values.periodo);
  if (values.q?.trim()) params.set("q", values.q.trim());
  if (values.pagina && values.pagina > 1) params.set("pagina", String(values.pagina));
  const query = params.toString();
  return query ? `/posts?${query}` : "/posts";
}

export type Tone = (typeof STATUS_TONES)[PostStatus];

/** Full class names (Tailwind only sees literal strings). */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  info: "text-accent",
  warning: "text-warning",
  success: "text-success",
  error: "text-error",
};

export const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-l-border-hover",
  info: "border-l-accent",
  warning: "border-l-warning",
  success: "border-l-success",
  error: "border-l-error",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted",
  info: "bg-accent",
  warning: "bg-warning",
  success: "bg-success",
  error: "bg-error",
};

export function statusTone(status: PostStatus): Tone {
  return STATUS_TONES[status];
}

export type PostCommand = "submit" | "schedule" | "retry" | "deliver" | "cancel";

/**
 * Buttons the detail page offers for a status, in display order. Social
 * posts go to Metricool (schedule / retry); blog and ads are marked
 * published / delivered by hand (deliver).
 */
export function availableCommands(status: PostStatus, kind: ContentKind = "SOCIAL_POST"): PostCommand[] {
  const internal = KIND_CONFIG[kind].internal;
  const commands: PostCommand[] = [];
  if (canTransition(status, "submit")) commands.push("submit");
  if (!internal && canTransition(status, "schedule")) commands.push("schedule");
  if (!internal && canTransition(status, "retry")) commands.push("retry");
  if (internal && canTransition(status, "deliver")) commands.push("deliver");
  if (canTransition(status, "cancel")) commands.push("cancel");
  return commands;
}

/** SCHEDULING / SCHEDULED / CANCELLED posts are frozen. */
export function isEditable(status: PostStatus): boolean {
  return canTransition(status, "edit");
}

/** Italian nouns per kind, for sentences ("l'articolo è in revisione"). */
export const KIND_NOUNS: Record<
  ContentKind,
  { the: string; a: string; It: string; plural: string }
> = {
  SOCIAL_POST: { the: "il post", a: "un post", It: "Il post", plural: "post" },
  BLOG_ARTICLE: {
    the: "l'articolo",
    a: "un articolo",
    It: "L'articolo",
    plural: "articoli",
  },
  AD_CREATIVE: {
    the: "il set di creatività",
    a: "un set di creatività",
    It: "Il set di creatività",
    plural: "set di creatività",
  },
};

/**
 * How a page names the items of an instance: the kind's words when it has
 * one kind ("i post", "gli articoli", "le creatività"), "i contenuti" when
 * it mixes several.
 */
export function contentWords(kinds: readonly ContentKind[]): {
  plural: string;
  the: string;
  Plural: string;
  /** "Tutti i post", "Tutte le creatività"… */
  all: string;
} {
  if (kinds.length !== 1) return { plural: "contenuti", the: "i contenuti", Plural: "Contenuti", all: "Tutti i contenuti" };
  switch (kinds[0]) {
    case "BLOG_ARTICLE":
      return { plural: "articoli", the: "gli articoli", Plural: "Articoli", all: "Tutti gli articoli" };
    case "AD_CREATIVE":
      return { plural: "creatività", the: "le creatività", Plural: "Creatività", all: "Tutte le creatività" };
    default:
      return { plural: "post", the: "i post", Plural: "Post", all: "Tutti i post" };
  }
}

/** What saving does to the status, said before the agency saves. */
export function editWarning(status: PostStatus, kind: ContentKind = "SOCIAL_POST"): string | null {
  if (kind !== "SOCIAL_POST") {
    const { It, the } = KIND_NOUNS[kind];
    switch (status) {
      case "IN_REVIEW":
        return `${It} è in revisione: se modifichi contenuto o data torna in bozza e va inviato di nuovo al cliente.`;
      case "APPROVED":
        return `${It} è già approvato: se modifichi contenuto o data torna in bozza e il cliente dovrà approvarlo di nuovo.`;
      case "CHANGES_REQUESTED":
        return `Le modifiche creano una nuova versione: quando hai finito, invia di nuovo ${the} in revisione.`;
      default:
        return null;
    }
  }
  switch (status) {
    case "IN_REVIEW":
      return "Il post è in revisione: se modifichi contenuto, data o reti torna in bozza e va inviato di nuovo al cliente.";
    case "APPROVED":
      return "Il post è già approvato: se modifichi contenuto, data o reti torna in bozza e il cliente dovrà approvarlo di nuovo.";
    case "FAILED":
      return "Se modifichi contenuto, data o reti il post torna in bozza e il cliente dovrà approvarlo di nuovo.";
    case "CHANGES_REQUESTED":
      return "Le modifiche creano una nuova versione: quando hai finito, inviala di nuovo in revisione.";
    default:
      return null;
  }
}

/** /posts/new for a kind, keeping the client and day chosen elsewhere. */
export function newContentHref(
  kind: ContentKind | null,
  options: { clientId?: string | null; day?: string | null } = {}
): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kindParam(kind));
  if (options.clientId) params.set("clientId", options.clientId);
  if (options.day) params.set("data", options.day);
  const query = params.toString();
  return query ? `/posts/new?${query}` : "/posts/new";
}

// ─── Dates and time zones ────────────────────────────────────────────────────

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("it-IT", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * "3.894": an integer with "." thousands groups. Not toLocaleString: Node's
 * ICU leaves four-digit numbers ungrouped for it-IT while browsers group
 * them, so a server-rendered counter would not match on hydration.
 */
export function formatCount(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.trunc(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** "lun 6 ott 2026, 09:30" in the given zone. */
export function formatDateTime(
  value: Date | string,
  timeZone?: string | null,
  options: { year?: boolean; weekday?: boolean } = {}
): string {
  const { year = true, weekday = true } = options;
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: safeZone(timeZone),
    ...(weekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(toDate(value));
}

/** "09:30" in the given zone. */
export function formatTime(value: Date | string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: safeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
  }).format(toDate(value));
}

/** "CEST", "GMT-5"… — short name of the zone at `at`. */
export function timeZoneAbbr(timeZone: string, at: Date | string = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("it-IT", { timeZone, timeZoneName: "short" })
      .formatToParts(toDate(at))
      .find((p) => p.type === "timeZoneName")?.value;
    return part ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** Date and time inputs' values ("YYYY-MM-DD", "HH:mm") for an instant in a zone. */
export function toLocalParts(value: Date | string, timeZone: string): { date: string; time: string } {
  const local = toZonedDateTimeString(toDate(value), safeZone(timeZone));
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Inverse of toLocalParts; null when the inputs are incomplete or invalid. */
export function localPartsToUtc(date: string, time: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return zonedDateTimeToUtc(`${date}T${time}`, safeZone(timeZone));
}

/** Calendar day ("YYYY-MM-DD") of an instant in a zone. */
export function dayKeyIn(value: Date | string, timeZone: string): string {
  return toLocalParts(value, timeZone).date;
}

/** UTC instant of local midnight at the start of `dayKey` in `timeZone`. */
export function startOfDayUtc(dayKey: string, timeZone: string): Date {
  return zonedDateTimeToUtc(`${dayKey}T00:00`, safeZone(timeZone)) ?? new Date(`${dayKey}T00:00:00Z`);
}

// ─── Calendar math (on day keys, independent of time zones) ──────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function keyToUtc(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return utcToKey(keyToUtc(value)) === value;
}

export function addDays(dayKey: string, days: number): string {
  return utcToKey(keyToUtc(dayKey) + days * DAY_MS);
}

/** Monday of the week containing `dayKey`. */
export function startOfWeek(dayKey: string): string {
  const weekday = new Date(keyToUtc(dayKey)).getUTCDay(); // 0 = Sunday
  return addDays(dayKey, -((weekday + 6) % 7));
}

export function weekDays(mondayKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i));
}

export interface MonthRef {
  year: number;
  /** 1–12 */
  month: number;
}

export function parseMonthParam(value: string | string[] | undefined): MonthRef | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw ? /^(\d{4})-(\d{2})$/.exec(raw) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { year, month };
}

export function monthKey({ year, month }: MonthRef): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthOfDay(dayKey: string): MonthRef {
  return { year: Number(dayKey.slice(0, 4)), month: Number(dayKey.slice(5, 7)) };
}

export function addMonths({ year, month }: MonthRef, delta: number): MonthRef {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** "ottobre 2026" */
export function monthLabel({ year, month }: MonthRef): string {
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

/** "lun 6", or "lunedì 6 ottobre" with `long`. */
export function dayLabel(dayKey: string, long = false): string {
  return new Intl.DateTimeFormat(
    "it-IT",
    long
      ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }
      : { weekday: "short", day: "numeric", timeZone: "UTC" }
  ).format(new Date(keyToUtc(dayKey)));
}

export const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"] as const;

/**
 * Weeks (Monday first) covering the month, as day keys. Days outside the
 * month are included to fill the first and last week.
 */
export function buildMonthGrid(ref: MonthRef): string[][] {
  const first = `${monthKey(ref)}-01`;
  const next = `${monthKey(addMonths(ref, 1))}-01`;
  const weeks: string[][] = [];
  for (let monday = startOfWeek(first); monday < next; monday = addDays(monday, 7)) {
    weeks.push(weekDays(monday));
  }
  return weeks;
}

/** Group items by the day (in `timeZone`) of their date. */
export function groupByDay<T>(
  items: readonly T[],
  dateOf: (item: T) => Date | string,
  timeZone: string
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKeyIn(dateOf(item), timeZone);
    const list = byDay.get(key);
    if (list) list.push(item);
    else byDay.set(key, [item]);
  }
  return byDay;
}

// ─── Networks and caption ────────────────────────────────────────────────────

/** Characters as users count them (an emoji is one). */
export function charCount(text: string): number {
  return Array.from(text).length;
}

export interface CaptionCounter {
  network: Network;
  label: string;
  count: number;
  limit: number | null;
  over: boolean;
  /** Stories carry no caption: the limit does not apply. */
  noCaption: boolean;
}

export function captionCounters(text: string, networks: readonly Network[], networkOptions: unknown): CaptionCounter[] {
  const count = charCount(text);
  return networks.map((network) => {
    const format = getNetworkFormat(network, networkOptions);
    const noCaption = (network === "instagram" || network === "facebook") && format === "STORY";
    const limit = NETWORK_TEXT_LIMITS[network] ?? null;
    return {
      network,
      label: NETWORK_LABELS[network],
      count,
      limit,
      over: !noCaption && limit !== null && count > limit,
      noCaption,
    };
  });
}

export function toNetworks(values: readonly string[]): Network[] {
  return values.filter(isNetwork);
}

/** Immutable update of one option inside `<network>Data`; empty values remove the key. */
export function setNetworkOption(
  options: NetworkOptions,
  network: Network,
  key: string,
  value: string | undefined
): NetworkOptions {
  const dataKey = `${network}Data`;
  const current = { ...(options[dataKey] ?? {}) };
  if (value === undefined || value === "") delete current[key];
  else current[key] = value;
  const next = { ...options };
  if (Object.keys(current).length === 0) delete next[dataKey];
  else next[dataKey] = current;
  return next;
}

/** Only the `<network>Data` entries of the selected networks are kept. */
export function pruneNetworkOptions(options: NetworkOptions, networks: readonly Network[]): NetworkOptions {
  const keep = new Set(networks.map((n) => `${n}Data`));
  return Object.fromEntries(Object.entries(options).filter(([key]) => keep.has(key)));
}

/** Labels for the format select (NETWORK_FORMATS values). */
export const FORMAT_LABELS: Record<string, string> = {
  POST: "Post",
  REEL: "Reel",
  STORY: "Storia",
  post: "Post",
  video: "Video",
  short: "Short",
  publication: "Aggiornamento",
  photo: "Foto",
};

// ─── Media ───────────────────────────────────────────────────────────────────

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
}

/** "0:07" or "0:12–0:15". */
export const formatMoment = formatTimeRange;

// ─── Comments ────────────────────────────────────────────────────────────────

export interface CommentLike {
  id: string;
  versionId: string | null;
  authorType: "AGENCY" | "CLIENT";
  body: string;
  mediaIndex: number | null;
  pinX: number | null;
  pinY: number | null;
  timeSec: number | null;
  timeEndSec: number | null;
  resolvedAt: Date | string | null;
  createdAt: Date | string;
  /** Blog: the commented passage. */
  anchor?: BlogAnchor | null;
  /** Ads: the variant the comment is about (mediaIndex then refers to its media). */
  variantId?: string | null;
}

/**
 * Comments on the same spot (version + media + moment + pin, the passage of
 * an article, or the variant's media spot) form a thread: an agency reply
 * copies the anchor of the comment it answers. General comments (also the
 * general ones on a variant) have no anchor and stand alone.
 */
export function commentAnchorKey(comment: CommentLike): string | null {
  if (comment.anchor) {
    const { quote, prefix, suffix } = comment.anchor;
    return [comment.versionId ?? "", "passage", quote, prefix, suffix].join("|");
  }
  if (comment.mediaIndex === null && comment.timeSec === null) return null;
  return [
    comment.versionId ?? "",
    ...(comment.variantId ? [`variant:${comment.variantId}`] : []),
    comment.mediaIndex ?? "",
    comment.timeSec ?? "",
    comment.timeEndSec ?? "",
    comment.pinX ?? "",
    comment.pinY ?? "",
  ].join("|");
}

export interface CommentThread<C extends CommentLike> {
  id: string;
  root: C;
  replies: C[];
  /** Every comment of the thread is resolved. */
  resolved: boolean;
}

function time(value: Date | string): number {
  return toDate(value).getTime();
}

/** Threads in order of their first comment. */
export function buildCommentThreads<C extends CommentLike>(comments: readonly C[]): CommentThread<C>[] {
  const sorted = [...comments].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const threads: CommentThread<C>[] = [];
  const byAnchor = new Map<string, CommentThread<C>>();
  for (const comment of sorted) {
    const key = commentAnchorKey(comment);
    const existing = key ? byAnchor.get(key) : undefined;
    if (existing) {
      existing.replies.push(comment);
      continue;
    }
    const thread: CommentThread<C> = { id: comment.id, root: comment, replies: [], resolved: false };
    threads.push(thread);
    if (key) byAnchor.set(key, thread);
  }
  for (const thread of threads) {
    thread.resolved = [thread.root, ...thread.replies].every((c) => c.resolvedAt !== null);
  }
  return threads;
}

/** Video notes first, in timeline order; then the rest by date. */
export function sortThreadsByMoment<C extends CommentLike>(threads: readonly CommentThread<C>[]): CommentThread<C>[] {
  return [...threads].sort((a, b) => {
    const ta = a.root.timeSec;
    const tb = b.root.timeSec;
    if (ta !== null && tb !== null) {
      const ma = a.root.mediaIndex ?? 0;
      const mb = b.root.mediaIndex ?? 0;
      return ma !== mb ? ma - mb : ta - tb;
    }
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    return time(a.root.createdAt) - time(b.root.createdAt);
  });
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface PersonLike {
  name: string | null;
  email?: string | null;
}

export function personName(person: PersonLike | null | undefined, fallback = "Qualcuno"): string {
  return person?.name?.trim() || person?.email?.trim() || fallback;
}

export interface EventLike {
  type: string;
  versionNumber: number | null;
  metadata: unknown;
  user?: PersonLike | null;
  reviewer?: PersonLike | null;
}

export interface EventDescription {
  title: string;
  details: string[];
  tone: Tone;
}

function meta(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function statusLabel(value: unknown): string | null {
  return isPostStatus(value) ? STATUS_LABELS[value].toLowerCase() : null;
}

/** One line of the activity timeline, in Italian. */
export function describeEvent(
  event: EventLike,
  timeZone?: string | null,
  kind: ContentKind = "SOCIAL_POST"
): EventDescription {
  const noun = KIND_NOUNS[kind].the;
  const m = meta(event.metadata);
  const v = event.versionNumber ? ` (versione ${event.versionNumber})` : "";
  const agency = personName(event.user, "L'agenzia");
  const client = personName(event.reviewer, "Il cliente");
  const details: string[] = [];

  switch (event.type) {
    case "CREATED":
      return { title: `${agency} ha creato ${noun}`, details, tone: "neutral" };
    case "VERSION_CREATED": {
      if (Array.isArray(m.changes)) details.push(...m.changes.filter((c): c is string => typeof c === "string"));
      if (typeof m.changeNote === "string" && m.changeNote) details.push(`Nota: ${m.changeNote}`);
      const to = statusLabel(m.toStatus);
      if (to) details.push(`Stato: ${to}`);
      return { title: `${agency} ha creato la versione ${event.versionNumber ?? ""}`.trim(), details, tone: "neutral" };
    }
    case "SUBMITTED_FOR_REVIEW":
      if (typeof m.reviewDueAt === "string") details.push(`Risposta attesa entro ${formatDateTime(m.reviewDueAt, timeZone)}`);
      return { title: `${agency} ha inviato ${noun} in revisione${v}`, details, tone: "info" };
    case "REMINDER_SENT":
      return {
        title: `Sollecito inviato al cliente${typeof m.reminderNumber === "number" ? ` (n. ${m.reminderNumber})` : ""}`,
        details,
        tone: "neutral",
      };
    case "CLIENT_VIEWED":
      return { title: `${client} ha aperto ${noun}${v}`, details, tone: "neutral" };
    case "CHANGES_REQUESTED":
      if (Array.isArray(m.actionCommentIds) && m.actionCommentIds.length > 0) {
        details.push(
          m.actionCommentIds.length === 1
            ? "1 nota puntuale dall'assistente"
            : `${m.actionCommentIds.length} note puntuali dall'assistente`
        );
      }
      if (typeof m.reviewSessionId === "string") details.push("Con la conversazione dell'assistente AI");
      return { title: `${client} ha chiesto modifiche${v}`, details, tone: "warning" };
    case "APPROVED":
      return { title: `${client} ha approvato ${noun}${v}`, details, tone: "success" };
    case "SCHEDULE_REQUESTED":
      return {
        title: m.retry === true ? `${personName(event.user, "Il sistema")} ha riprovato la programmazione` : `Programmazione su Metricool richiesta${event.user ? ` da ${agency}` : ""}`,
        details,
        tone: "info",
      };
    case "SCHEDULED":
      if (typeof m.metricoolPostId === "string") details.push(`ID Metricool: ${m.metricoolPostId}`);
      return { title: "Programmato su Metricool", details, tone: "success" };
    case "SCHEDULE_FAILED":
      if (typeof m.error === "string") details.push(m.error);
      return { title: "Programmazione su Metricool non riuscita", details, tone: "error" };
    case "CANCELLED": {
      const from = statusLabel(m.fromStatus);
      if (from) details.push(`Era: ${from}`);
      return { title: `${agency} ha annullato ${noun}`, details, tone: "neutral" };
    }
    case "DELIVERED":
      return {
        title:
          kind === "BLOG_ARTICLE"
            ? `${agency} ha segnato l'articolo come pubblicato${v}`
            : `${agency} ha segnato ${noun} come consegnato${v}`,
        details,
        tone: "success",
      };
    case "VARIANT_DECIDED": {
      const name = typeof m.variantName === "string" ? m.variantName : typeof m.variantId === "string" ? `Variante ${m.variantId}` : "una variante";
      if (typeof m.note === "string" && m.note) details.push(`Nota: ${m.note}`);
      return m.verdict === "REJECTED"
        ? { title: `${client} ha scartato ${name}${v}`, details, tone: "warning" }
        : { title: `${client} ha approvato ${name}${v}`, details, tone: "success" };
    }
    case "COMMENTED": {
      if (typeof m.quote === "string" && m.quote) details.push(`Sul passaggio «${m.quote}»`);
      if (typeof m.variantId === "string") details.push(`Sulla variante ${m.variantId}`);
      if (typeof m.timeSec === "number") {
        details.push(`Al momento ${formatMoment(m.timeSec, typeof m.timeEndSec === "number" ? m.timeEndSec : null)}`);
      } else if (typeof m.mediaIndex === "number") {
        details.push(`Sul media ${m.mediaIndex + 1}`);
      }
      const who = event.reviewer ? client : agency;
      return { title: `${who} ha scritto un commento${v}`, details, tone: "neutral" };
    }
    case "ASSISTANT_SESSION_COMPLETED":
      return { title: `${client} ha concluso una conversazione con l'assistente AI${v}`, details, tone: "neutral" };
    default:
      return { title: event.type, details, tone: "neutral" };
  }
}
