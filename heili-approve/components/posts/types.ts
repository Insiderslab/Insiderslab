/**
 * Shapes shared by the post server actions (app/(dashboard)/posts/actions.ts)
 * and the client components that call them. Dates cross the boundary as ISO
 * strings; the actions validate everything again.
 */

import type { BlogAnchor } from "@/lib/content/types";
import type { MediaItem, NetworkOptions } from "@/lib/domain";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

/** What the editor sends to createPostAction / updatePostAction. */
export interface PostFormInput {
  clientId: string;
  title: string;
  /** ISO instant, already converted from the client's time zone. */
  publishAt: string;
  networks: string[];
  networkOptions: NetworkOptions;
  text: string;
  firstCommentText: string | null;
  media: MediaItem[];
  videoCoverMs: number | null;
  /** Edits only: note for the client about what changed. */
  changeNote?: string;
}

/**
 * What the blog / ads editor sends to createContentAction /
 * updateContentAction: no networks, caption or media of their own, the
 * whole article or ad set is in `content` (BlogContent / AdContent).
 */
export interface ContentFormInput {
  /** Create only: "BLOG_ARTICLE" | "AD_CREATIVE" (fixed afterwards). */
  kind?: "BLOG_ARTICLE" | "AD_CREATIVE";
  clientId: string;
  title: string;
  /** ISO instant: planned publication (blog) or campaign start (ads). */
  publishAt: string;
  content: unknown;
  /** Edits only: note for the client about what changed. */
  changeNote?: string;
}

/** Client as the editor needs it (networks limit the choice, zone drives the date). */
export interface EditorClient {
  id: string;
  name: string;
  timezone: string;
  networks: string[];
  logoUrl: string | null;
  hasMetricoolBrand: boolean;
  activeReviewers: number;
}

export interface CommentInput {
  postId: string;
  body: string;
  versionId?: string;
  mediaIndex?: number;
  pinX?: number;
  pinY?: number;
  timeSec?: number;
  timeEndSec?: number;
  /** Blog: the commented passage. */
  anchor?: BlogAnchor;
  /** Ads: the variant (mediaIndex then refers to its media). */
  variantId?: string;
}
