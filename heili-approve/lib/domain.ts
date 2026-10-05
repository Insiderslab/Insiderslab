/**
 * Shared domain contract for Approve by Heili.
 *
 * Every module (agency dashboard, client portal, Metricool integration,
 * worker) imports statuses, networks and transitions from here, so the
 * approval rules live in exactly one place. Keep this file pure: no I/O.
 */

import type { PostStatus } from "@/app/generated/prisma/client";

// ─── Networks ────────────────────────────────────────────────────────────────

/** Network ids exactly as Metricool's `providers[].network` expects them. */
export const NETWORKS = [
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "twitter",
  "threads",
  "pinterest",
  "youtube",
  "gmb",
  "bluesky",
] as const;

export type Network = (typeof NETWORKS)[number];

export const NETWORK_LABELS: Record<Network, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  twitter: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  youtube: "YouTube",
  gmb: "Google Business",
  bluesky: "Bluesky",
};

export function isNetwork(value: unknown): value is Network {
  return typeof value === "string" && (NETWORKS as readonly string[]).includes(value);
}

/** Post formats the editor offers per network (Metricool `<network>Data.type`). */
export const NETWORK_FORMATS: Partial<Record<Network, readonly string[]>> = {
  instagram: ["POST", "REEL", "STORY"],
  facebook: ["POST", "REEL", "STORY"],
  linkedin: ["post"],
  youtube: ["video", "short"],
  gmb: ["publication", "photo"],
};

/** Max caption length per network; the editor warns, the API rejects. */
export const NETWORK_TEXT_LIMITS: Partial<Record<Network, number>> = {
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  tiktok: 2200,
  twitter: 280,
  threads: 500,
  pinterest: 500,
  bluesky: 300,
  gmb: 1500,
};

// ─── Media ───────────────────────────────────────────────────────────────────

export type MediaType = "image" | "video";

/** Shape stored in PostVersion.media (JSON array). */
export interface MediaItem {
  /** Absolute public URL (Metricool downloads it from here). */
  url: string;
  type: MediaType;
  mimeType: string;
  /** MediaAsset.id when uploaded through the app; absent for external URLs. */
  assetId?: string;
  alt?: string;
}

export function parseMediaItems(value: unknown): MediaItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MediaItem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as MediaItem).url === "string" &&
      ((item as MediaItem).type === "image" || (item as MediaItem).type === "video")
  );
}

/**
 * Per-network options in Metricool's own shape, keyed by `<network>Data`,
 * e.g. { instagramData: { type: "REEL" } }. Stored in Post.networkOptions.
 */
export type NetworkOptions = Record<string, Record<string, unknown>>;

// ─── Status machine ──────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "Bozza",
  IN_REVIEW: "In revisione",
  CHANGES_REQUESTED: "Modifiche richieste",
  APPROVED: "Approvato",
  SCHEDULING: "In programmazione",
  SCHEDULED: "Programmato",
  FAILED: "Errore",
  CANCELLED: "Annullato",
};

/** Tone used by StatusBadge. */
export const STATUS_TONES: Record<PostStatus, "neutral" | "info" | "warning" | "success" | "error"> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  SCHEDULING: "info",
  SCHEDULED: "success",
  FAILED: "error",
  CANCELLED: "neutral",
};

export type PostAction =
  | "submit" //            agency → client
  | "approve" //           client
  | "request_changes" //   client
  | "edit" //              agency edits content (new version once it has been seen)
  | "schedule" //          system/agency → Metricool job
  | "schedule_succeeded"
  | "schedule_failed"
  | "retry" //             agency retries a FAILED schedule
  | "cancel";

/**
 * Allowed transitions. `edit` on IN_REVIEW / CHANGES_REQUESTED / APPROVED /
 * FAILED sends the post back to DRAFT: the client must re-approve whatever
 * content actually gets published. A SCHEDULED post is frozen (change it in
 * Metricool or cancel and recreate).
 */
const TRANSITIONS: Record<PostAction, Partial<Record<PostStatus, PostStatus>>> = {
  submit: { DRAFT: "IN_REVIEW", CHANGES_REQUESTED: "IN_REVIEW" },
  approve: { IN_REVIEW: "APPROVED" },
  request_changes: { IN_REVIEW: "CHANGES_REQUESTED" },
  edit: {
    DRAFT: "DRAFT",
    IN_REVIEW: "DRAFT",
    CHANGES_REQUESTED: "CHANGES_REQUESTED",
    APPROVED: "DRAFT",
    FAILED: "DRAFT",
  },
  schedule: { APPROVED: "SCHEDULING" },
  schedule_succeeded: { SCHEDULING: "SCHEDULED" },
  schedule_failed: { SCHEDULING: "FAILED" },
  retry: { FAILED: "SCHEDULING" },
  cancel: {
    DRAFT: "CANCELLED",
    IN_REVIEW: "CANCELLED",
    CHANGES_REQUESTED: "CANCELLED",
    APPROVED: "CANCELLED",
    FAILED: "CANCELLED",
  },
};

export function nextStatus(current: PostStatus, action: PostAction): PostStatus | null {
  return TRANSITIONS[action][current] ?? null;
}

export function canTransition(current: PostStatus, action: PostAction): boolean {
  return nextStatus(current, action) !== null;
}

export class InvalidTransitionError extends Error {
  constructor(public current: PostStatus, public action: PostAction) {
    super(`Azione "${action}" non consentita con stato ${current}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(current: PostStatus, action: PostAction): PostStatus {
  const next = nextStatus(current, action);
  if (!next) throw new InvalidTransitionError(current, action);
  return next;
}

/** Statuses the client portal shows (the client never sees drafts). */
export const CLIENT_VISIBLE_STATUSES: PostStatus[] = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SCHEDULING",
  "SCHEDULED",
  "FAILED",
];

/** Statuses where the client can still act. */
export const CLIENT_ACTIONABLE_STATUSES: PostStatus[] = ["IN_REVIEW"];
