/**
 * Serializable view models passed from the portal's server pages to its
 * client components, plus the result shape of the portal server actions.
 * Dates are pre-formatted on the server in the client's time zone, so the
 * browser never re-formats them (no hydration drift).
 */

import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import type { AdContent, BlogAnchor, BlogContent } from "@/lib/content/types";
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
  /** Blog: the commented passage. */
  anchor: BlogAnchor | null;
  /** Ads: the commented variant (mediaIndex refers to its media). */
  variantId: string | null;
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

/** What every kind's review page shows about the item, besides its content. */
export interface PortalItemBase {
  id: string;
  kind: ContentKind;
  title: string;
  status: PostStatus;
  canAct: boolean;
  versionNumber: number;
  versionId: string;
  /** "Pubblicazione prevista", "Inizio campagna"… (KIND_CONFIG.dateLabel). */
  dateLabel: string;
  /** The planned date, pre-formatted in the client's time zone. */
  publishLabel: string;
  reviewDueLabel: string | null;
  approvedLabel: string | null;
  timeZone: string;
  /** Comments on the version shown. */
  comments: PortalComment[];
}

/** Blog: a comment numbered like its highlight in the article. */
export interface PortalPassageComment extends PortalComment {
  /** Number on the highlight, null for comments without a passage. */
  number: number | null;
  /** "moved": the passage was edited, "missing": it is no longer in the text. */
  placement: "exact" | "moved" | "missing" | null;
  /** Open note on an earlier version, re-anchored on this one (its number). */
  fromVersion: number | null;
}

export interface PortalBlogPost extends Omit<PortalItemBase, "comments"> {
  kind: "BLOG_ARTICLE";
  content: BlogContent;
  /** renderMarkdownSafe(content.bodyMarkdown), rendered on the server. */
  html: string;
  /** "mercoledì 7 ottobre", the planned date in the article's byline. */
  articleDateLabel: string;
  comments: PortalPassageComment[];
}

/** Ads: the decision on one variant of the version shown. */
export interface PortalVariantDecision {
  verdict: "APPROVED" | "REJECTED";
  note: string | null;
  /** Taken by this reviewer (another reviewer of the client may have decided). */
  isMine: boolean;
  reviewerName: string | null;
}

export interface PortalAdsPost extends PortalItemBase {
  kind: "AD_CREATIVE";
  content: AdContent;
  /** By variant id; missing = not decided yet. */
  decisions: Record<string, PortalVariantDecision>;
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
