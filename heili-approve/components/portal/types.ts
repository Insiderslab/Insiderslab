/**
 * Serializable view models passed from the portal's server pages to its
 * client components, plus the result shape of the portal server actions.
 * Dates are pre-formatted on the server in the client's time zone, so the
 * browser never re-formats them (no hydration drift).
 */

import type { PostStatus } from "@/app/generated/prisma/client";
import type { MediaItem, Network } from "@/lib/domain";
import type { DiffSegment } from "@/lib/posts";

/** Errors carry an Italian message safe to show; `stale` = reload needed. */
export type PortalActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; stale?: boolean };

export interface PortalComment {
  id: string;
  authorType: "AGENCY" | "CLIENT";
  authorName: string;
  isMine: boolean;
  body: string;
  mediaIndex: number | null;
  pinX: number | null;
  pinY: number | null;
  timeSec: number | null;
  timeEndSec: number | null;
  resolved: boolean;
  createdAt: Date;
  /** "7 ott, 18:30" in the client's time zone. */
  createdLabel: string;
}

export interface PortalVersionChanges {
  /** Version compared with the current one. */
  fromNumber: number;
  /** True when the reviewer actually opened `fromNumber`. */
  seenByReviewer: boolean;
  /** "Testo modificato", "1 media aggiunto"… */
  summary: string[];
  text: DiffSegment[];
  firstComment: DiffSegment[];
  addedMedia: MediaItem[];
  /** Agency notes of every version after `fromNumber`, newest first. */
  notes: Array<{ number: number; note: string; dateLabel: string }>;
}

export interface PortalOlderVersion {
  number: number;
  dateLabel: string;
  changeNote: string | null;
  comments: PortalComment[];
}

export interface PortalPost {
  id: string;
  title: string;
  status: PostStatus;
  canAct: boolean;
  networks: Network[];
  networkOptions: unknown;
  versionNumber: number;
  versionId: string;
  text: string;
  firstCommentText: string | null;
  media: MediaItem[];
  publishAt: Date;
  /** "mercoledì 7 ottobre alle 18:30" in the client's time zone. */
  publishLabel: string;
  reviewDueLabel: string | null;
  approvedLabel: string | null;
  timeZone: string;
  /** Comments on the version shown. */
  comments: PortalComment[];
}

export interface PortalClient {
  name: string;
  logoUrl: string | null;
  autoSchedule: boolean;
}

export interface PortalQueue {
  /** Next post awaiting review, if any (never the current one). */
  nextPostId: string | null;
  /** Posts awaiting review, the current one included when it is one. */
  toReviewCount: number;
  /** 1-based position of the current post among them, null if it is not one. */
  position: number | null;
}
