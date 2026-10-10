/**
 * Pure helpers for the clients pages (no I/O, safe in client components):
 * time zone options, post counts per status, date labels.
 */

import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import { STATUS_LABELS, statusLabelFor } from "@/lib/domain";
import { isValidTimeZone } from "@/lib/metricool/payload";

// ─── Time zones ──────────────────────────────────────────────────────────────

/** The zones agencies actually pick; anything else goes in the free field. */
export const COMMON_TIME_ZONES: ReadonlyArray<{ value: string; city: string }> = [
  { value: "Europe/Rome", city: "Roma" },
  { value: "Europe/London", city: "Londra" },
  { value: "Europe/Lisbon", city: "Lisbona" },
  { value: "Europe/Madrid", city: "Madrid" },
  { value: "Atlantic/Canary", city: "Canarie" },
  { value: "Europe/Paris", city: "Parigi" },
  { value: "Europe/Berlin", city: "Berlino" },
  { value: "Europe/Zurich", city: "Zurigo" },
  { value: "Europe/Vienna", city: "Vienna" },
  { value: "Europe/Athens", city: "Atene" },
  { value: "Europe/Bucharest", city: "Bucarest" },
  { value: "Europe/Istanbul", city: "Istanbul" },
  { value: "Europe/Moscow", city: "Mosca" },
  { value: "America/New_York", city: "New York" },
  { value: "America/Chicago", city: "Chicago" },
  { value: "America/Denver", city: "Denver" },
  { value: "America/Los_Angeles", city: "Los Angeles" },
  { value: "America/Mexico_City", city: "Città del Messico" },
  { value: "America/Bogota", city: "Bogotá" },
  { value: "America/Lima", city: "Lima" },
  { value: "America/Caracas", city: "Caracas" },
  { value: "America/Santiago", city: "Santiago del Cile" },
  { value: "America/Argentina/Buenos_Aires", city: "Buenos Aires" },
  { value: "America/Sao_Paulo", city: "San Paolo" },
  { value: "Asia/Dubai", city: "Dubai" },
  { value: "Asia/Kolkata", city: "India" },
  { value: "Asia/Singapore", city: "Singapore" },
  { value: "Asia/Shanghai", city: "Shanghai" },
  { value: "Asia/Tokyo", city: "Tokyo" },
  { value: "Australia/Sydney", city: "Sydney" },
  { value: "UTC", city: "UTC" },
];

export interface TimeZoneOption {
  value: string;
  label: string;
}

/** Same check as the server (lib/clients.ts), usable in the browser. */
export function isValidTimeZoneName(value: string): boolean {
  return isValidTimeZone(value.trim());
}

/** "UTC+2", "UTC−5", "UTC" — offset of the zone at `at`. */
export function timeZoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    // ICU on Windows can spell a zero offset as GMT+0 rather than GMT.
    if (!part || /^GMT(?:[+−-]0(?::00)?)?$/.test(part)) return "UTC";
    return part.replace("GMT", "UTC").replace("-", "−");
  } catch {
    return "";
  }
}

/**
 * Options for the time zone select, with the current offset in the label.
 * Built on the server so the offsets cannot differ between SSR and hydration.
 */
export function buildTimeZoneOptions(at: Date = new Date()): TimeZoneOption[] {
  return COMMON_TIME_ZONES.map(({ value, city }) => {
    const offset = timeZoneOffsetLabel(value, at);
    return { value, label: offset ? `${city} (${offset})` : city };
  });
}

// ─── Post counts ─────────────────────────────────────────────────────────────

/** Order in which counts are shown: what needs someone first. */
export const STATUS_COUNT_ORDER: PostStatus[] = [
  "CHANGES_REQUESTED",
  "FAILED",
  "IN_REVIEW",
  "DRAFT",
  "APPROVED",
  "SCHEDULING",
  "SCHEDULED",
  "DELIVERED",
];

export type StatusCounts = Partial<Record<PostStatus, number>>;

/** groupBy rows → { clientId: { STATUS: n } }. Cancelled posts are dropped. */
export function groupStatusCounts(
  rows: ReadonlyArray<{ clientId: string; status: PostStatus; count: number }>
): Record<string, StatusCounts> {
  const result: Record<string, StatusCounts> = {};
  for (const row of rows) {
    if (row.status === "CANCELLED" || row.count <= 0) continue;
    const counts = (result[row.clientId] ??= {});
    counts[row.status] = (counts[row.status] ?? 0) + row.count;
  }
  return result;
}

/**
 * Non-zero counts in display order, with their Italian label (worded for
 * `kind` when the instance has a single one: "Pubblicato" for articles).
 */
export function statusCountEntries(
  counts: StatusCounts | undefined,
  kind: ContentKind | null = null
): Array<{ status: PostStatus; count: number; label: string }> {
  if (!counts) return [];
  return STATUS_COUNT_ORDER.filter((status) => (counts[status] ?? 0) > 0).map((status) => ({
    status,
    count: counts[status]!,
    label: kind ? statusLabelFor(kind, status) : STATUS_LABELS[status],
  }));
}

export function totalPosts(counts: StatusCounts | undefined): number {
  if (!counts) return 0;
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/** "5 ott 2026, 14:20" in the given zone (agency pages default to Rome). */
export function formatDateTime(value: Date | string, timeZone = "Europe/Rome"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/** "5 ottobre 2026". */
export function formatLongDate(value: Date | string, timeZone = "Europe/Rome"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}

/** Initials for the logo placeholder: "Pasticceria Rossi" → "PR". */
export function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

// ─── Services overview ───────────────────────────────────────────────────────

export interface ServiceOverviewEntry {
  key: "toReview" | "changes" | "approved" | "done";
  label: string;
  count: number;
  /** Status the "see them" link filters the list on. */
  status: PostStatus;
  tone: "info" | "warning" | "success" | "neutral";
}

/**
 * The four numbers of a service on the client page: waiting for the client,
 * changes requested, approved (not yet out), scheduled (social) / published
 * (blog) / delivered (ads). Drafts and scheduling errors are reported apart
 * (pure).
 */
export function serviceOverview(
  kind: ContentKind,
  counts: StatusCounts | undefined
): { entries: ServiceOverviewEntry[]; drafts: number; failed: number; total: number } {
  const n = (status: PostStatus) => counts?.[status] ?? 0;
  const social = kind === "SOCIAL_POST";
  const doneLabel = social ? "Programmati" : kind === "BLOG_ARTICLE" ? "Pubblicati" : "Consegnati";
  return {
    entries: [
      { key: "toReview", label: "Da approvare", count: n("IN_REVIEW"), status: "IN_REVIEW", tone: "info" },
      { key: "changes", label: "Modifiche richieste", count: n("CHANGES_REQUESTED"), status: "CHANGES_REQUESTED", tone: "warning" },
      { key: "approved", label: "Approvati", count: n("APPROVED") + n("SCHEDULING"), status: "APPROVED", tone: "success" },
      { key: "done", label: doneLabel, count: social ? n("SCHEDULED") : n("DELIVERED"), status: social ? "SCHEDULED" : "DELIVERED", tone: "neutral" },
    ],
    drafts: n("DRAFT"),
    failed: social ? n("FAILED") : 0,
    total: totalPosts(counts),
  };
}

/** groupBy rows by kind and status → { KIND: { STATUS: n } } (cancelled dropped). */
export function groupKindStatusCounts(
  rows: ReadonlyArray<{ kind: ContentKind; status: PostStatus; count: number }>
): Partial<Record<ContentKind, StatusCounts>> {
  const result: Partial<Record<ContentKind, StatusCounts>> = {};
  for (const row of rows) {
    if (row.status === "CANCELLED" || row.count <= 0) continue;
    const counts = (result[row.kind] ??= {});
    counts[row.status] = (counts[row.status] ?? 0) + row.count;
  }
  return result;
}
