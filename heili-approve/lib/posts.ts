/**
 * Post lifecycle: create, edit (with versioning), submit for review, client
 * approval / change requests, comments, cancellation.
 *
 * Rules enforced here, for every caller (dashboard actions, client portal,
 * AI assistant):
 * - every status change goes through assertTransition (lib/domain.ts) and is
 *   written with an optimistic check on the status it was read with, so two
 *   concurrent clicks can never both succeed;
 * - agency calls are scoped by workspaceId, client calls by reviewer.clientId,
 *   and the client never sees drafts or versions that were not sent to them;
 * - approval is bound to the version number the client was looking at;
 * - every change writes a PostEvent in the same transaction;
 * - video comments carry a moment (timeSec / timeEndSec) that must fall on a
 *   video of the version and within its duration when known.
 *
 * Content kinds (docs/VARIANTI.md): a Post is a social post (Metricool), a
 * blog article or an ads creative set. Blog and ads keep their content in
 * PostVersion.content (validated by lib/content/blog.ts / ads.ts) and have no
 * networks, text or media of their own; they are "internal": approval never
 * schedules anything, the agency exports and then marks them DELIVERED.
 * Only kinds enabled for this instance (lib/variant.ts) and active for the
 * client (Client.services, lib/clients.ts) can be created.
 *
 * Pure helpers (diffing, versioning decisions) are exported for unit tests.
 */

import { z } from "zod";
import type {
  ContentKind,
  MediaAsset,
  Post,
  PostComment,
  PostStatus,
  ReviewSession,
  ReviewMessage,
} from "@/app/generated/prisma/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { actorColumns, type Actor } from "@/lib/actor";
import { parseAdContent, validateAdsForReview } from "@/lib/content/ads";
import { blogAnchorSchema, parseBlogAnchor, parseBlogContent, validateBlogForReview } from "@/lib/content/blog";
import type { AdContent, BlogAnchor, BlogContent } from "@/lib/content/types";
import {
  approvalBlocker,
  buildRejectionMessage,
  evaluateCreativeDecisions,
  variantLabel,
} from "@/lib/creative-decisions";
import { prisma } from "@/lib/db/client";
import {
  CLIENT_VISIBLE_STATUSES,
  KIND_CONFIG,
  NETWORKS,
  NETWORK_LABELS,
  assertTransition,
  isNetwork,
  parseMediaItems,
  type MediaItem,
  type Network,
  type NetworkOptions,
} from "@/lib/domain";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  parseOrThrow,
} from "@/lib/errors";
import { clientHasService, serviceNotActiveMessage } from "@/lib/clients";
import { recordEvent, type DbClient } from "@/lib/events";
import { validateForNetworks } from "@/lib/metricool/payload";
import { notifyApproved, notifyChangesRequested, notifyReviewRequested } from "@/lib/notifications";
import { MAX_VIDEO_DURATION_SEC, mediaItemForAsset, storageKeyFromMediaUrl } from "@/lib/storage";
import { assertKindEnabled, enabledKinds, isKindEnabled } from "@/lib/variant";

// ─── Input ───────────────────────────────────────────────────────────────────

export type PostInput = {
  clientId: string;
  title: string;
  publishAt: Date;
  /** Default SOCIAL_POST. Must be enabled for this instance (lib/variant.ts); fixed after creation. */
  kind?: ContentKind;
  /** Social only (required there, at least one); ignored for blog/ads. */
  networks?: Network[];
  networkOptions?: NetworkOptions;
  /** Social only (required there); ignored for blog/ads. */
  text?: string;
  firstCommentText?: string | null;
  /** Social only (required there); ignored for blog/ads. */
  media?: MediaItem[];
  /** Cover frame of the (first) video in ms; sent to Metricool as videoCoverMilliseconds. */
  videoCoverMs?: number | null;
  /**
   * Blog/ads only (required there): BlogContent / AdContent, validated with
   * parseBlogContent / parseAdContent. Ignored for social posts.
   */
  content?: unknown;
};

export type PostUpdateInput = Partial<Omit<PostInput, "kind">> & { changeNote?: string };

/** True for kinds without an external integration (blog, ads). */
export function isInternalKind(kind: ContentKind): boolean {
  return KIND_CONFIG[kind].internal;
}

/** Who the client portal acts as: the reviewer resolved from the link token. */
export type ReviewerRef = { id: string; clientId: string };

export const MAX_MEDIA_PER_POST = 20;
export const MAX_COMMENT_LENGTH = 5000;
/** Assistant action items turned into comments by one change request. */
export const MAX_ACTION_ITEMS = 50;
/** Slack on video times: clients say "al secondo 15" of a 14.9 s clip. */
export const VIDEO_TIME_SLACK_SEC = 1;

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "URL del media non valido");

export const mediaItemSchema = z.object({
  url: httpUrl,
  type: z.enum(["image", "video"]),
  mimeType: z.string().trim().min(1).max(100),
  assetId: z.string().min(1).max(64).optional(),
  alt: z.string().trim().max(1000).optional(),
  durationSec: z.number().positive().max(MAX_VIDEO_DURATION_SEC).optional(),
  posterUrl: httpUrl.optional(),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
});

const CONTENT_KIND_VALUES = ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"] as const satisfies readonly ContentKind[];

export const networkOptionsSchema = z.record(
  z.string().regex(/^[a-z]+Data$/, "Opzioni di rete non valide"),
  z.record(z.string(), z.unknown())
);

// No defaults on purpose: in zod 4 defaults also fire inside .partial(),
// which would turn "field absent" into "reset field" on updates.
const postFields = {
  clientId: z.string().min(1).max(64),
  title: z.string().trim().min(1, "Inserisci un titolo").max(200, "Titolo troppo lungo"),
  publishAt: z.coerce.date({ error: "Data di pubblicazione non valida" }),
  // "At least one" is a social-only rule, checked per kind below / in updatePost.
  networks: z
    .array(z.enum(NETWORKS, { error: "Rete non supportata" }))
    .transform((list) => [...new Set(list)]),
  networkOptions: networkOptionsSchema,
  text: z.string().max(70_000, "Testo troppo lungo"),
  firstCommentText: z.string().max(10_000, "Primo commento troppo lungo").nullable(),
  media: z.array(mediaItemSchema).max(MAX_MEDIA_PER_POST, `Massimo ${MAX_MEDIA_PER_POST} media per post`),
  videoCoverMs: z
    .number({ error: "Copertina del video non valida" })
    .int("Copertina del video non valida")
    .min(0, "Copertina del video non valida")
    .max(MAX_VIDEO_DURATION_SEC * 1000, "Copertina del video non valida")
    .nullable(),
};

export const postInputSchema = z
  .object({
    ...postFields,
    kind: z.enum(CONTENT_KIND_VALUES, { error: "Tipo di contenuto non valido" }).optional(),
    networks: postFields.networks.optional(),
    networkOptions: postFields.networkOptions.optional(),
    text: postFields.text.optional(),
    firstCommentText: postFields.firstCommentText.optional(),
    media: postFields.media.optional(),
    videoCoverMs: postFields.videoCoverMs.optional(),
    // Shape checked by the kind's own parser (lib/content/*).
    content: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.kind ?? "SOCIAL_POST") !== "SOCIAL_POST") {
      if (data.content === undefined || data.content === null) {
        ctx.addIssue({ code: "custom", path: ["content"], message: "Contenuto mancante" });
      }
      return;
    }
    if (!data.networks || data.networks.length === 0) {
      ctx.addIssue({ code: "custom", path: ["networks"], message: "Scegli almeno una rete" });
    }
    if (data.text === undefined) ctx.addIssue({ code: "custom", path: ["text"], message: "Testo mancante" });
    if (data.media === undefined) ctx.addIssue({ code: "custom", path: ["media"], message: "Media mancanti" });
  });

export const postUpdateSchema = z
  .object(postFields)
  .partial()
  .extend({ changeNote: z.string().trim().max(1000).optional(), content: z.unknown().optional() });

/** Blog comment anchor: one schema for services and UIs (lib/content/blog). */
export { blogAnchorSchema };

const videoTime = z
  .number({ error: "Momento del video non valido" })
  .min(0, "Il momento del video non può essere negativo")
  .max(MAX_VIDEO_DURATION_SEC, "Momento del video non valido");

const commentSchema = z
  .object({
    postId: z.string().min(1),
    body: z
      .string()
      .trim()
      .min(1, "Il commento è vuoto")
      .max(MAX_COMMENT_LENGTH, "Commento troppo lungo"),
    versionId: z.string().min(1).optional(),
    mediaIndex: z.number().int().min(0).optional(),
    pinX: z.number().min(0).max(1).optional(),
    pinY: z.number().min(0).max(1).optional(),
    timeSec: videoTime.optional(),
    timeEndSec: videoTime.optional(),
    anchor: blogAnchorSchema.optional(),
    variantId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((c) => (c.pinX === undefined) === (c.pinY === undefined), "Posizione del commento incompleta")
  .refine((c) => c.pinX === undefined || c.mediaIndex !== undefined, "Il commento puntato richiede un media")
  .refine((c) => c.timeSec === undefined || c.mediaIndex !== undefined, "Il commento sul video richiede un media")
  .refine((c) => c.timeEndSec === undefined || c.timeSec !== undefined, "Indica anche l'inizio dell'intervallo")
  .refine(
    (c) => c.timeEndSec === undefined || c.timeSec === undefined || c.timeEndSec > c.timeSec,
    "La fine dell'intervallo deve venire dopo l'inizio"
  );

/** Structured change from the AI assistant (lib/review-assistant ActionItem). */
export interface RequestChangesActionItem {
  area: string;
  mediaIndex: number | null;
  timeSec: number | null;
  timeEndSec: number | null;
  request: string;
  priority: string;
  /** Ads: the variant the item is about (mediaIndex/time then refer to its media). */
  variantId?: string | null;
  /** Blog: the passage the item is about. */
  anchor?: BlogAnchor | null;
}

const actionItemsSchema = z
  .array(
    z.object({
      area: z.string().max(50),
      mediaIndex: z.number().nullable(),
      timeSec: z.number().nullable(),
      timeEndSec: z.number().nullable(),
      request: z.string().max(MAX_COMMENT_LENGTH),
      priority: z.string().max(20),
      // Best effort like the rest of the item: an invalid value is dropped.
      variantId: z.string().max(64).nullish().catch(null),
      anchor: blogAnchorSchema.nullish().catch(null),
    })
  )
  .max(MAX_ACTION_ITEMS, "Troppe modifiche in una sola richiesta");

const changesMessageSchema = z
  .string()
  .trim()
  .min(1, "Scrivi cosa vorresti cambiare")
  .max(MAX_COMMENT_LENGTH, "Messaggio troppo lungo");

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Client-visible content of a version: what a new version is about. */
export interface VersionContent {
  text: string;
  firstCommentText: string | null;
  media: MediaItem[];
  /** Absent = unknown/unchanged (treated as null when compared). */
  videoCoverMs?: number | null;
  /** Date and networks the version was sent with; absent/null = not compared. */
  schedule?: VersionSchedule | null;
  /** Blog/ads content (PostVersion.content); absent = not compared. */
  content?: unknown;
}

/**
 * Date, networks and per-network options of a version. The client approves
 * them together with the content, so they are kept per version
 * (PostVersion.schedule) and the portal shows those of the version it was sent.
 */
export interface VersionSchedule {
  publishAt: Date;
  networks: string[];
  networkOptions: unknown;
}

export function parseVersionSchedule(value: unknown): VersionSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.publishAt !== "string") return null;
  const publishAt = new Date(record.publishAt);
  if (Number.isNaN(publishAt.getTime())) return null;
  const networks = Array.isArray(record.networks)
    ? record.networks.filter((n): n is string => typeof n === "string")
    : [];
  return { publishAt, networks, networkOptions: record.networkOptions ?? {} };
}

export function scheduleToJson(schedule: VersionSchedule): Prisma.InputJsonValue {
  return {
    publishAt: schedule.publishAt.toISOString(),
    networks: [...schedule.networks],
    networkOptions: (schedule.networkOptions ?? {}) as Prisma.InputJsonValue,
  };
}

export function normalizeFirstComment(value: string | null | undefined): string | null {
  return value && value.trim() ? value : null;
}

// Duration and poster are technical metadata, not content: filling them in
// later must not create a version the client has to re-approve.
function mediaKey(item: MediaItem): string {
  return JSON.stringify([item.url, item.type, item.mimeType, item.assetId ?? null, item.alt ?? null]);
}

function mediaMetaKey(item: MediaItem): string {
  return JSON.stringify([item.durationSec ?? null, item.posterUrl ?? null, item.width ?? null, item.height ?? null]);
}

/** MediaItem fields that are technical metadata (see mediaKey). */
const MEDIA_METADATA_KEYS = new Set(["durationSec", "posterUrl", "width", "height"]);

function looksLikeMediaItem(value: Record<string, unknown>): boolean {
  return typeof value.url === "string" && (value.type === "image" || value.type === "video");
}

function stripMediaMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMediaMetadata);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const media = looksLikeMediaItem(record);
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !(media && MEDIA_METADATA_KEYS.has(key)))
        .map(([key, v]) => [key, stripMediaMetadata(v)])
    );
  }
  return value;
}

/**
 * What the client approves in a blog/ads content: everything except media
 * metadata (duration, poster, pixel size), which may be filled in later
 * without a new version — same rule as the social media list.
 */
export function contentFingerprint(content: unknown): string {
  return stableStringify(stripMediaMetadata(content ?? {}));
}

export function sameMedia(a: MediaItem[], b: MediaItem[]): boolean {
  return a.length === b.length && a.every((item, index) => mediaKey(item) === mediaKey(b[index]));
}

/** Same media whose duration/poster differ (an in-place metadata update). */
export function mediaMetadataChanged(current: MediaItem[], next: MediaItem[]): boolean {
  return sameMedia(current, next) && current.some((item, index) => mediaMetaKey(item) !== mediaMetaKey(next[index]));
}

/** True when applying `patch` would change what the client sees in the post. */
export function contentChanged(current: VersionContent, patch: Partial<VersionContent>): boolean {
  if (patch.text !== undefined && patch.text !== current.text) return true;
  if (
    patch.firstCommentText !== undefined &&
    normalizeFirstComment(patch.firstCommentText) !== normalizeFirstComment(current.firstCommentText)
  ) {
    return true;
  }
  if (patch.media !== undefined && !sameMedia(patch.media, current.media)) return true;
  if (patch.videoCoverMs !== undefined && (patch.videoCoverMs ?? null) !== (current.videoCoverMs ?? null)) return true;
  if (patch.content !== undefined && contentFingerprint(patch.content) !== contentFingerprint(current.content)) {
    return true;
  }
  return false;
}

// ─── Video helpers (pure) ────────────────────────────────────────────────────

function knownDuration(item: MediaItem | undefined): number | null {
  const d = item?.durationSec;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
}

/** Seconds rounded to hundredths (what the player can seek to). */
function roundTime(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/**
 * Checks a comment's moment against the media it points at. Returns the
 * times to store (clamped to the duration within VIDEO_TIME_SLACK_SEC) or
 * an Italian error message.
 */
export function checkCommentTime(
  media: MediaItem | undefined,
  timeSec: number | undefined,
  timeEndSec: number | undefined
): { timeSec: number | null; timeEndSec: number | null } | { error: string } {
  if (timeSec === undefined) {
    return timeEndSec === undefined ? { timeSec: null, timeEndSec: null } : { error: "Indica anche l'inizio dell'intervallo" };
  }
  if (!media || media.type !== "video") return { error: "Il momento si può indicare solo su un video" };
  if (!Number.isFinite(timeSec) || timeSec < 0) return { error: "Il momento del video non può essere negativo" };
  if (timeEndSec !== undefined && !(timeEndSec > timeSec)) {
    return { error: "La fine dell'intervallo deve venire dopo l'inizio" };
  }
  const duration = knownDuration(media);
  if (duration !== null) {
    if (timeSec > duration + VIDEO_TIME_SLACK_SEC || (timeEndSec ?? 0) > duration + VIDEO_TIME_SLACK_SEC) {
      return { error: "Il momento indicato è oltre la durata del video" };
    }
  }
  const start = roundTime(duration !== null ? Math.min(timeSec, duration) : timeSec);
  let end = timeEndSec === undefined ? null : roundTime(duration !== null ? Math.min(timeEndSec, duration) : timeEndSec);
  // Clamping can collapse a range at the very end into a single moment.
  if (end !== null && end <= start) end = null;
  return { timeSec: start, timeEndSec: end };
}

/**
 * Where an assistant action item lands as a comment, or null when it is not
 * about a specific media (it then lives only in the summary comment). The
 * assistant's output is best effort, so invalid parts are dropped rather than
 * failing the whole change request: a bad index → no comment, a bad time →
 * a comment on the media without a moment. A timed item with no media goes
 * to the version's only video.
 */
export function planActionItemComment(
  item: RequestChangesActionItem,
  media: MediaItem[]
): { body: string; mediaIndex: number; timeSec: number | null; timeEndSec: number | null } | null {
  const body = item.request.trim();
  if (!body) return null;

  const validTime = (value: number | null) => (value !== null && Number.isFinite(value) && value >= 0 ? value : null);
  const timeSec = validTime(item.timeSec);
  let mediaIndex =
    item.mediaIndex !== null && Number.isInteger(item.mediaIndex) && item.mediaIndex >= 0 && item.mediaIndex < media.length
      ? item.mediaIndex
      : null;
  if (mediaIndex === null && timeSec !== null) {
    const videos = media.flatMap((m, index) => (m.type === "video" ? [index] : []));
    if (videos.length === 1) mediaIndex = videos[0];
  }
  if (mediaIndex === null) return null;

  if (timeSec === null) return { body, mediaIndex, timeSec: null, timeEndSec: null };
  const timeEndSec = validTime(item.timeEndSec);
  const checked =
    checkCommentTime(media[mediaIndex], timeSec, timeEndSec !== null && timeEndSec > timeSec ? timeEndSec : undefined);
  if ("error" in checked) return { body, mediaIndex, timeSec: null, timeEndSec: null };
  return { body, mediaIndex, ...checked };
}

/** What an assistant action item can point at, per content kind. */
export type ActionItemTarget =
  | { kind: "SOCIAL_POST"; media: MediaItem[] }
  | { kind: "BLOG_ARTICLE" }
  | { kind: "AD_CREATIVE"; variants: ReadonlyArray<{ id: string; media: MediaItem[] }> };

export interface PlannedActionComment {
  body: string;
  mediaIndex: number | null;
  timeSec: number | null;
  timeEndSec: number | null;
  variantId: string | null;
  anchor: BlogAnchor | null;
}

/**
 * planActionItemComment for every kind: social items land on a media/moment;
 * blog items on their passage (anchor); ads items on their variant, and on a
 * media/moment of that variant when they name one. Items that point nowhere
 * valid stay in the summary comment only (null).
 */
export function planActionItemCommentFor(
  item: RequestChangesActionItem,
  target: ActionItemTarget
): PlannedActionComment | null {
  const body = item.request.trim();
  if (!body) return null;
  const none = { mediaIndex: null, timeSec: null, timeEndSec: null, variantId: null, anchor: null };
  switch (target.kind) {
    case "SOCIAL_POST": {
      const planned = planActionItemComment(item, target.media);
      return planned ? { ...none, ...planned } : null;
    }
    case "BLOG_ARTICLE":
      return item.anchor ? { ...none, body, anchor: item.anchor } : null;
    case "AD_CREATIVE": {
      const variant = target.variants.find((v) => v.id === item.variantId);
      if (!variant) return null;
      const planned = planActionItemComment(item, variant.media);
      return planned ? { ...none, ...planned, variantId: variant.id } : { ...none, body, variantId: variant.id };
    }
  }
}

/**
 * Cover to store for a version: dropped when the media have no video (the
 * agency removed it), rejected when past the first video's known duration.
 */
export function resolveVideoCover(media: MediaItem[], videoCoverMs: number | null | undefined): number | null {
  if (videoCoverMs === null || videoCoverMs === undefined) return null;
  const video = media.find((m) => m.type === "video");
  if (!video) return null;
  const duration = knownDuration(video);
  if (duration !== null && videoCoverMs > Math.ceil(duration * 1000)) {
    throw new ValidationError("La copertina scelta è oltre la durata del video");
  }
  return videoCoverMs;
}

/** JSON comparison independent of key order (networkOptions come from forms). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Highest version number the client has been sent. Falls back to the current
 * version when the post was submitted but no SUBMITTED_FOR_REVIEW event exists
 * (e.g. seeded data).
 */
export function effectiveLastSubmittedVersion(
  lastSubmittedFromEvents: number | null | undefined,
  submittedAt: Date | null,
  currentVersionNumber: number
): number | null {
  if (lastSubmittedFromEvents != null) return lastSubmittedFromEvents;
  return submittedAt ? currentVersionNumber : null;
}

/**
 * A content change creates a new version only when the current version has
 * already been sent to the client: the client must be able to see what
 * changed and approve exactly that. Edits to a version the client has not
 * seen yet (a draft, or a revision being prepared after a change request)
 * update it in place, so repeated saves do not pile up versions.
 */
export function needsNewVersion(params: {
  contentChanged: boolean;
  currentVersionNumber: number;
  lastSubmittedVersionNumber: number | null;
}): boolean {
  return (
    params.contentChanged &&
    params.lastSubmittedVersionNumber !== null &&
    params.currentVersionNumber <= params.lastSubmittedVersionNumber
  );
}

/**
 * The version the client portal shows. Only differs from the current one
 * while the agency is preparing a revision after CHANGES_REQUESTED (that
 * status stays visible to the client, the unsent revision must not).
 */
export function visibleVersionNumber(currentVersionNumber: number, lastSubmittedVersionNumber: number | null): number {
  if (lastSubmittedVersionNumber === null) return currentVersionNumber;
  return Math.min(currentVersionNumber, lastSubmittedVersionNumber);
}

export interface PostUpdatePlan {
  /** Nothing would change: skip the write entirely. */
  noop: boolean;
  contentChanged: boolean;
  /** Fields the client reviews besides content (date, networks, options). */
  scheduleChanged: boolean;
  createVersion: boolean;
  nextStatus: PostStatus;
}

/**
 * Decides what an agency edit does. Any change must be allowed by the `edit`
 * transition (a SCHEDULED post is frozen); changes the client reviews move
 * the post per the state machine (e.g. APPROVED → DRAFT), while a change to
 * the title alone keeps the status (it is shown to the client but never
 * published).
 */
export function planPostUpdate(params: {
  status: PostStatus;
  currentVersionNumber: number;
  lastSubmittedVersionNumber: number | null;
  current: VersionContent & {
    title: string;
    publishAt: Date;
    networks: string[];
    networkOptions: unknown;
  };
  patch: Partial<VersionContent> & {
    title?: string;
    publishAt?: Date;
    networks?: string[];
    networkOptions?: unknown;
  };
}): PostUpdatePlan {
  const { current, patch } = params;
  const changedContent = contentChanged(current, patch);
  const scheduleChanged =
    (patch.publishAt !== undefined && patch.publishAt.getTime() !== current.publishAt.getTime()) ||
    (patch.networks !== undefined &&
      stableStringify([...patch.networks].sort()) !== stableStringify([...current.networks].sort())) ||
    (patch.networkOptions !== undefined &&
      stableStringify(patch.networkOptions) !== stableStringify(current.networkOptions ?? {}));
  const titleChanged = patch.title !== undefined && patch.title !== current.title;

  if (!changedContent && !scheduleChanged && !titleChanged) {
    return {
      noop: true,
      contentChanged: false,
      scheduleChanged: false,
      createVersion: false,
      nextStatus: params.status,
    };
  }

  const editedStatus = assertTransition(params.status, "edit");
  return {
    noop: false,
    contentChanged: changedContent,
    scheduleChanged,
    // Date and networks are approved together with the content: changing them
    // on a version the client was already sent needs a new version too, so a
    // stale approval (bound to the old version number) is refused.
    createVersion: needsNewVersion({
      contentChanged: changedContent || scheduleChanged,
      currentVersionNumber: params.currentVersionNumber,
      lastSubmittedVersionNumber: params.lastSubmittedVersionNumber,
    }),
    nextStatus: changedContent || scheduleChanged ? editedStatus : params.status,
  };
}

/** Networks not enabled for the client. An unconfigured client allows all. */
export function findDisallowedNetworks(networks: readonly string[], clientNetworks: readonly string[]): string[] {
  if (clientNetworks.length === 0) return [];
  return networks.filter((network) => !clientNetworks.includes(network));
}

export type DiffSegment = { type: "same" | "added" | "removed"; value: string };

/** Above this many token pairs the diff degrades to "all replaced". */
const MAX_DIFF_CELLS = 1_000_000;

/**
 * Word-level diff (LCS over words and whitespace runs) for the "what changed"
 * view. Adjacent segments of the same type are merged.
 */
export function diffText(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ type: "same", value: before }] : [];
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);

  if (a.length * b.length > MAX_DIFF_CELLS) {
    return mergeSegments([
      { type: "removed", value: before },
      { type: "added", value: after },
    ]);
  }

  // Weighted LCS: matching words dominates matching whitespace, so the diff
  // aligns on words instead of on the spaces between them.
  // score[i][j] = best score for a[i:] vs b[j:], flattened.
  const weight = (token: string) => (/^\s/.test(token) ? 1 : 1000);
  const width = b.length + 1;
  const score = new Float64Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const skip = Math.max(score[(i + 1) * width + j], score[i * width + j + 1]);
      score[i * width + j] =
        a[i] === b[j] ? Math.max(skip, weight(a[i]) + score[(i + 1) * width + j + 1]) : skip;
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j] && score[i * width + j] === weight(a[i]) + score[(i + 1) * width + j + 1]) {
      segments.push({ type: "same", value: a[i] });
      i++;
      j++;
    } else if (score[(i + 1) * width + j] >= score[i * width + j + 1]) {
      segments.push({ type: "removed", value: a[i++] });
    } else {
      segments.push({ type: "added", value: b[j++] });
    }
  }
  while (i < a.length) segments.push({ type: "removed", value: a[i++] });
  while (j < b.length) segments.push({ type: "added", value: b[j++] });
  return mergeSegments(segments);
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    if (!segment.value) continue;
    const last = merged[merged.length - 1];
    if (last && last.type === segment.type) last.value += segment.value;
    else merged.push({ ...segment });
  }
  return merged;
}

export interface VersionDiff {
  changed: boolean;
  textChanged: boolean;
  firstCommentChanged: boolean;
  text: DiffSegment[];
  firstComment: DiffSegment[];
  media: {
    added: MediaItem[];
    removed: MediaItem[];
    /** Same files, different order. */
    reordered: boolean;
    /** Alternative text changed on a kept file. */
    altChanged: boolean;
  };
  /** The video cover frame (videoCoverMs) changed. */
  coverChanged: boolean;
  /** Date / networks / per-network options (only when both sides know them). */
  schedule: {
    publishAtChanged: boolean;
    networksAdded: string[];
    networksRemoved: string[];
    optionsChanged: boolean;
  };
  /** Blog/ads content changes, as Italian bullet points (empty = unchanged or not compared). */
  content: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sameField(a: Record<string, unknown>, b: Record<string, unknown>, key: string): boolean {
  return contentFingerprint(a[key] ?? null) === contentFingerprint(b[key] ?? null);
}

const BLOG_SEO_FIELDS: Array<[key: string, label: string]> = [
  ["metaTitle", "titolo SEO"],
  ["metaDescription", "meta description"],
  ["focusKeyword", "parola chiave"],
  ["slug", "slug"],
];

const AD_VARIANT_FIELDS: Array<[keys: string[], label: string]> = [
  [["name"], "nome"],
  [["media"], "media"],
  [["primaryText", "headline", "description"], "testi"],
  [["cta"], "CTA"],
  [["destinationUrl"], "URL"],
  [["placements"], "posizionamenti"],
];

function blogContentChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (!sameField(before, after, "headline")) lines.push("Titolo dell'articolo modificato");
  if (!sameField(before, after, "bodyMarkdown")) lines.push("Testo dell'articolo modificato");
  if (!sameField(before, after, "excerpt")) lines.push("Estratto modificato");
  const seo = BLOG_SEO_FIELDS.filter(([key]) => !sameField(before, after, key)).map(([, label]) => label);
  if (seo.length > 0) lines.push(`SEO modificata: ${seo.join(", ")}`);
  if (!sameField(before, after, "featuredImage")) lines.push("Immagine in evidenza cambiata");
  if (!sameField(before, after, "categories") || !sameField(before, after, "tags")) {
    lines.push("Categorie o tag modificati");
  }
  if (!sameField(before, after, "author")) lines.push("Autore modificato");
  return lines;
}

function adContentChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (!sameField(before, after, "campaign")) lines.push("Dati della campagna modificati");

  const variantsOf = (content: Record<string, unknown>) =>
    asList(content.variants)
      .map(asRecord)
      .filter((v): v is Record<string, unknown> & { id: string } => typeof v.id === "string");
  const beforeVariants = variantsOf(before);
  const afterVariants = variantsOf(after);
  const label = (v: Record<string, unknown> & { id: string }) =>
    variantLabel({ id: v.id, name: typeof v.name === "string" ? v.name : null }, v.id);
  const beforeIds = beforeVariants.map((v) => v.id);
  const afterIds = afterVariants.map((v) => v.id);

  const added = afterVariants.filter((v) => !beforeIds.includes(v.id));
  const removed = beforeVariants.filter((v) => !afterIds.includes(v.id));
  if (added.length === 1) lines.push(`Variante aggiunta: ${label(added[0])}`);
  if (added.length > 1) lines.push(`Varianti aggiunte: ${added.map(label).join(", ")}`);
  if (removed.length === 1) lines.push(`Variante rimossa: ${label(removed[0])}`);
  if (removed.length > 1) lines.push(`Varianti rimosse: ${removed.map(label).join(", ")}`);

  const keptBefore = beforeIds.filter((id) => afterIds.includes(id));
  const keptAfter = afterIds.filter((id) => beforeIds.includes(id));
  if (keptBefore.some((id, index) => keptAfter[index] !== id)) lines.push("Ordine delle varianti cambiato");

  for (const variant of afterVariants) {
    const previous = beforeVariants.find((v) => v.id === variant.id);
    if (!previous) continue;
    const fields = AD_VARIANT_FIELDS.filter(([keys]) => keys.some((key) => !sameField(previous, variant, key))).map(
      ([, fieldLabel]) => fieldLabel
    );
    if (fields.length > 0) lines.push(`${label(variant)} modificata: ${fields.join(", ")}`);
  }
  return lines;
}

/**
 * Italian bullet points for what changed in a blog/ads content. Falls back
 * to "Contenuto modificato" for a change no specific line describes.
 */
export function summarizeContentChanges(kind: ContentKind, before: unknown, after: unknown): string[] {
  if (kind === "SOCIAL_POST" || contentFingerprint(before) === contentFingerprint(after)) return [];
  const lines =
    kind === "BLOG_ARTICLE"
      ? blogContentChanges(asRecord(before), asRecord(after))
      : adContentChanges(asRecord(before), asRecord(after));
  return lines.length > 0 ? lines : ["Contenuto modificato"];
}

/**
 * What changed between two versions (media are matched by URL). `kind`
 * selects how the blog/ads content is described (compared only when both
 * versions carry it).
 */
export function diffVersions(
  before: VersionContent,
  after: VersionContent,
  kind: ContentKind = "SOCIAL_POST"
): VersionDiff {
  const content =
    before.content !== undefined && after.content !== undefined
      ? summarizeContentChanges(kind, before.content, after.content)
      : [];
  const textChanged = before.text !== after.text;
  const beforeComment = normalizeFirstComment(before.firstCommentText) ?? "";
  const afterComment = normalizeFirstComment(after.firstCommentText) ?? "";
  const firstCommentChanged = beforeComment !== afterComment;

  const beforeUrls = before.media.map((m) => m.url);
  const afterUrls = after.media.map((m) => m.url);
  const added = after.media.filter((m) => !beforeUrls.includes(m.url));
  const removed = before.media.filter((m) => !afterUrls.includes(m.url));
  const keptBefore = beforeUrls.filter((url) => afterUrls.includes(url));
  const keptAfter = afterUrls.filter((url) => beforeUrls.includes(url));
  const reordered = keptBefore.some((url, index) => keptAfter[index] !== url);
  const altChanged = after.media.some((m) => {
    const previous = before.media.find((p) => p.url === m.url);
    return previous !== undefined && (previous.alt ?? "") !== (m.alt ?? "");
  });

  const coverChanged = (before.videoCoverMs ?? null) !== (after.videoCoverMs ?? null);

  const schedule = { publishAtChanged: false, networksAdded: [] as string[], networksRemoved: [] as string[], optionsChanged: false };
  if (before.schedule && after.schedule) {
    const b = before.schedule;
    const a = after.schedule;
    schedule.publishAtChanged = b.publishAt.getTime() !== a.publishAt.getTime();
    schedule.networksAdded = a.networks.filter((n) => !b.networks.includes(n));
    schedule.networksRemoved = b.networks.filter((n) => !a.networks.includes(n));
    schedule.optionsChanged = stableStringify(b.networkOptions ?? {}) !== stableStringify(a.networkOptions ?? {});
  }
  const scheduleChanged =
    schedule.publishAtChanged ||
    schedule.networksAdded.length > 0 ||
    schedule.networksRemoved.length > 0 ||
    schedule.optionsChanged;

  return {
    changed:
      textChanged ||
      firstCommentChanged ||
      added.length > 0 ||
      removed.length > 0 ||
      reordered ||
      altChanged ||
      coverChanged ||
      scheduleChanged ||
      content.length > 0,
    textChanged,
    firstCommentChanged,
    text: textChanged ? diffText(before.text, after.text) : [],
    firstComment: firstCommentChanged ? diffText(beforeComment, afterComment) : [],
    media: { added, removed, reordered, altChanged },
    coverChanged,
    schedule,
    content,
  };
}

function networkNames(networks: string[]): string {
  return networks.map((n) => (isNetwork(n) ? NETWORK_LABELS[n] : n)).join(", ");
}

/** Short Italian bullet points for timelines and emails. */
export function summarizeVersionDiff(diff: VersionDiff): string[] {
  const lines: string[] = [];
  if (diff.textChanged) lines.push("Testo modificato");
  if (diff.firstCommentChanged) lines.push("Primo commento modificato");
  const { added, removed, reordered, altChanged } = diff.media;
  if (added.length === 1) lines.push("1 media aggiunto");
  if (added.length > 1) lines.push(`${added.length} media aggiunti`);
  if (removed.length === 1) lines.push("1 media rimosso");
  if (removed.length > 1) lines.push(`${removed.length} media rimossi`);
  if (reordered) lines.push("Ordine dei media cambiato");
  if (altChanged) lines.push("Testo alternativo dei media modificato");
  if (diff.coverChanged) lines.push("Copertina del video modificata");
  if (diff.schedule.publishAtChanged) lines.push("Data di pubblicazione cambiata");
  if (diff.schedule.networksAdded.length > 0) lines.push(`Reti aggiunte: ${networkNames(diff.schedule.networksAdded)}`);
  if (diff.schedule.networksRemoved.length > 0) lines.push(`Reti rimosse: ${networkNames(diff.schedule.networksRemoved)}`);
  if (diff.schedule.optionsChanged) lines.push("Formato o opzioni per rete cambiati");
  lines.push(...diff.content);
  return lines;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function versionContent(version: {
  text: string;
  firstCommentText: string | null;
  media: unknown;
  videoCoverMs: number | null;
  content: unknown;
}): VersionContent {
  return {
    text: version.text,
    firstCommentText: version.firstCommentText,
    media: parseMediaItems(version.media),
    videoCoverMs: version.videoCoverMs,
    content: version.content ?? {},
  };
}

/** Content of a blog/ads version, as stored in PostVersion.content. */
export type KindContent = BlogContent | AdContent;

/**
 * Runs a lib/content parser and turns any validation failure (zod error or
 * ValidationError) into a ValidationError with an Italian message.
 */
function parseWith<T>(parse: (json: unknown) => T, json: unknown, label: string): T {
  try {
    return parse(json);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof z.ZodError) {
      throw new ValidationError(error.issues[0]?.message || `${label} non valido`);
    }
    throw error;
  }
}

/** Validates the content of a blog/ads post (throws ValidationError). */
export function parseKindContent(kind: "BLOG_ARTICLE", json: unknown): BlogContent;
export function parseKindContent(kind: "AD_CREATIVE", json: unknown): AdContent;
export function parseKindContent(kind: ContentKind, json: unknown): KindContent | null;
export function parseKindContent(kind: ContentKind, json: unknown): KindContent | null {
  if (kind === "BLOG_ARTICLE") return parseWith(parseBlogContent, json, "Articolo");
  if (kind === "AD_CREATIVE") return parseWith(parseAdContent, json, "Set di creatività");
  return null;
}

/**
 * Stored content for reads: never throws (an old or hand-edited row must not
 * break the portal); null for social posts or unreadable content.
 */
export function readKindContent(kind: ContentKind, json: unknown): KindContent | null {
  if (kind === "SOCIAL_POST") return null;
  try {
    return parseKindContent(kind, json);
  } catch (error) {
    console.error(`[posts] Unreadable ${kind} content:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Messages of a list of review issues (plain strings or { message } objects). */
function issueMessages(issues: ReadonlyArray<string | { message: string }>): string[] {
  return issues.map((issue) => (typeof issue === "string" ? issue : issue.message));
}

/** Review checks of a blog/ads content (Italian messages, empty = ready). */
function reviewIssuesFor(kind: ContentKind, json: unknown): string[] {
  if (kind === "BLOG_ARTICLE") return issueMessages(validateBlogForReview(parseKindContent(kind, json)));
  if (kind === "AD_CREATIVE") return issueMessages(validateAdsForReview(parseKindContent(kind, json)));
  return [];
}

/**
 * Validates and canonicalises a blog/ads content: media inside it (featured
 * image, variant media) go through normalizeMedia like a social post's, so
 * an asset of another workspace can never be referenced.
 */
async function prepareKindContent(
  db: DbClient,
  workspaceId: string,
  kind: ContentKind,
  json: unknown
): Promise<KindContent> {
  if (kind === "BLOG_ARTICLE") {
    const content = parseKindContent(kind, json);
    const featuredImage = content.featuredImage
      ? (await normalizeMedia(db, workspaceId, [content.featuredImage]))[0]
      : null;
    return { ...content, featuredImage };
  }
  if (kind === "AD_CREATIVE") {
    const content = parseKindContent(kind, json);
    // Variant media and Google Ads logos go through the same ownership and size checks.
    const all = await normalizeMedia(
      db,
      workspaceId,
      content.variants.flatMap((v) => [...v.media, ...(v.google?.logos ?? [])])
    );
    let offset = 0;
    const variants = content.variants.map((variant) => {
      const media = all.slice(offset, offset + variant.media.length);
      offset += variant.media.length;
      if (!variant.google) return { ...variant, media };
      const logos = all.slice(offset, offset + variant.google.logos.length);
      offset += variant.google.logos.length;
      return { ...variant, media, google: { ...variant.google, logos } };
    });
    return { ...content, variants };
  }
  throw new ValidationError("Questo tipo di contenuto non ha un contenuto strutturato");
}

/** Variants (id + media) of an ads content, for comments and action items. */
function adVariantsOf(content: KindContent | null): Array<{ id: string; media: MediaItem[] }> {
  return content && "variants" in content ? content.variants.map((v) => ({ id: v.id, media: v.media })) : [];
}

function isClientVisible(status: PostStatus): boolean {
  return CLIENT_VISIBLE_STATUSES.includes(status);
}

async function lastSubmittedVersions(db: DbClient, postIds: string[]): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await db.postEvent.groupBy({
    by: ["postId"],
    where: { postId: { in: postIds }, type: "SUBMITTED_FOR_REVIEW" },
    _max: { versionNumber: true },
  });
  const result = new Map<string, number>();
  for (const row of rows) {
    if (row._max.versionNumber != null) result.set(row.postId, row._max.versionNumber);
  }
  return result;
}

async function lastSubmittedVersion(
  db: DbClient,
  post: Pick<Post, "id" | "submittedAt" | "currentVersionNumber">
): Promise<number | null> {
  const fromEvents = (await lastSubmittedVersions(db, [post.id])).get(post.id);
  return effectiveLastSubmittedVersion(fromEvents, post.submittedAt, post.currentVersionNumber);
}

/**
 * Canonicalises media: uploaded assets must belong to the workspace (their
 * URL/type are rebuilt from the asset row), links to this app's /media are
 * resolved to their asset, other http(s) URLs are kept as external media.
 */
async function normalizeMedia(db: DbClient, workspaceId: string, media: MediaItem[]): Promise<MediaItem[]> {
  if (media.length === 0) return [];
  const assetIds = [...new Set(media.flatMap((m) => (m.assetId ? [m.assetId] : [])))];
  const storageKeys = [
    ...new Set(media.flatMap((m) => (m.assetId ? [] : [storageKeyFromMediaUrl(m.url)].filter((k): k is string => !!k)))),
  ];

  const assets: MediaAsset[] =
    assetIds.length || storageKeys.length
      ? await db.mediaAsset.findMany({
          where: {
            workspaceId,
            OR: [{ id: { in: assetIds } }, { storageKey: { in: storageKeys } }],
          },
        })
      : [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  const byKey = new Map(assets.map((a) => [a.storageKey, a]));

  return media.map((item) => {
    const key = item.assetId ? null : storageKeyFromMediaUrl(item.url);
    const asset = item.assetId ? byId.get(item.assetId) : key ? byKey.get(key) : undefined;
    if ((item.assetId || key) && !asset) {
      throw new ValidationError("Uno dei media non è stato trovato: ricaricalo");
    }
    const video = { durationSec: item.durationSec, posterUrl: item.posterUrl };
    // Pixel size (ads spec checks): the asset's when recorded, else the client's.
    const width = asset?.width ?? item.width;
    const height = asset?.height ?? item.height;
    const size = width && height ? { width, height } : {};
    if (asset) return { ...mediaItemForAsset(asset, item.alt || undefined, video), ...size };
    return {
      url: item.url,
      type: item.type,
      mimeType: item.mimeType,
      ...(item.alt ? { alt: item.alt } : {}),
      ...(item.type === "video" && video.durationSec !== undefined ? { durationSec: video.durationSec } : {}),
      ...(item.type === "video" && video.posterUrl ? { posterUrl: video.posterUrl } : {}),
      ...size,
    };
  });
}

async function findClientForPost(db: DbClient, clientId: string, workspaceId: string) {
  const client = await db.client.findFirst({ where: { id: clientId, workspaceId } });
  if (!client) throw new NotFoundError("Cliente non trovato");
  if (client.archivedAt) throw new ValidationError("Il cliente è archiviato");
  return client;
}

function assertNetworksAllowed(networks: readonly string[], clientNetworks: readonly string[]) {
  const disallowed = findDisallowedNetworks(networks, clientNetworks);
  if (disallowed.length > 0) {
    throw new ValidationError(`Reti non abilitate per questo cliente: ${disallowed.join(", ")}`);
  }
}

/** Status write guarded by the status (and version) it was read with. */
async function guardedPostUpdate(
  db: DbClient,
  where: { id: string; status: PostStatus; currentVersionNumber?: number },
  data: Prisma.PostUncheckedUpdateManyInput
) {
  const { count } = await db.post.updateMany({ where, data });
  if (count !== 1) throw new ConflictError();
}

function userIdOf(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}

// ─── Agency: create / edit / submit / cancel ─────────────────────────────────

export async function createPost(workspaceId: string, input: PostInput, actor: Actor): Promise<Post> {
  const data = parseOrThrow(postInputSchema, input);
  const kind: ContentKind = data.kind ?? "SOCIAL_POST";
  assertKindEnabled(kind);
  const internal = isInternalKind(kind);

  return prisma.$transaction(async (tx) => {
    const client = await findClientForPost(tx, data.clientId, workspaceId);
    // Only the client's active services; existing content of a service
    // removed later stays editable (updatePost does not check this).
    if (!clientHasService(client, kind)) throw new ValidationError(serviceNotActiveMessage(kind));
    // Blog/ads have no networks, caption or media of their own: everything
    // the client approves is in `content`.
    const networks = internal ? [] : (data.networks ?? []);
    const networkOptions = internal ? {} : (data.networkOptions ?? {});
    if (!internal) assertNetworksAllowed(networks, client.networks);
    const media = internal ? [] : await normalizeMedia(tx, workspaceId, data.media ?? []);
    const videoCoverMs = internal ? null : resolveVideoCover(media, data.videoCoverMs);
    const content = internal ? await prepareKindContent(tx, workspaceId, kind, data.content) : {};

    const post = await tx.post.create({
      data: {
        workspaceId,
        clientId: client.id,
        title: data.title,
        kind,
        publishAt: data.publishAt,
        networks,
        networkOptions: toJson(networkOptions),
        currentVersionNumber: 1,
        createdById: userIdOf(actor),
        versions: {
          create: {
            number: 1,
            text: internal ? "" : (data.text ?? ""),
            firstCommentText: internal ? null : normalizeFirstComment(data.firstCommentText),
            media: toJson(media),
            videoCoverMs,
            content: toJson(content),
            schedule: scheduleToJson({ publishAt: data.publishAt, networks, networkOptions }),
            createdById: userIdOf(actor),
          },
        },
      },
    });

    await recordEvent(tx, { postId: post.id, type: "CREATED", actor, versionNumber: 1, metadata: { kind } });
    return post;
  });
}

export async function updatePost(
  postId: string,
  workspaceId: string,
  input: PostUpdateInput,
  actor: Actor
): Promise<Post> {
  const parsed = parseOrThrow(postUpdateSchema, input);

  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: postId, workspaceId, kind: { in: enabledKinds() } },
      include: { client: true },
    });
    if (!post) throw new NotFoundError("Post non trovato");

    // The kind is fixed: blog/ads ignore the social fields, social posts
    // ignore `content`.
    const internal = isInternalKind(post.kind);
    const data = internal
      ? {
          ...parsed,
          networks: undefined,
          networkOptions: undefined,
          text: undefined,
          firstCommentText: undefined,
          media: undefined,
          videoCoverMs: undefined,
        }
      : { ...parsed, content: undefined };
    if (!internal && data.networks !== undefined && data.networks.length === 0) {
      throw new ValidationError("Scegli almeno una rete");
    }

    const version = await tx.postVersion.findUnique({
      where: { postId_number: { postId, number: post.currentVersionNumber } },
    });
    if (!version) throw new NotFoundError("Versione del post non trovata");

    let client = post.client;
    if (data.clientId !== undefined && data.clientId !== post.clientId) {
      if (post.submittedAt) {
        throw new ValidationError("Non puoi cambiare il cliente di un post già inviato in revisione");
      }
      client = await findClientForPost(tx, data.clientId, workspaceId);
      // Moving a draft to another client: that client must have the service.
      if (!clientHasService(client, post.kind)) throw new ValidationError(serviceNotActiveMessage(post.kind));
    }

    const networks = data.networks ?? (post.networks as Network[]);
    if (!internal && (data.networks !== undefined || client.id !== post.clientId)) {
      assertNetworksAllowed(networks, client.networks);
    }

    const media = data.media !== undefined ? await normalizeMedia(tx, workspaceId, data.media) : undefined;
    const kindContent =
      data.content !== undefined ? await prepareKindContent(tx, workspaceId, post.kind, data.content) : undefined;
    // The Post row holds the current version's date and networks.
    const current: VersionContent = {
      ...versionContent(version),
      schedule: { publishAt: post.publishAt, networks: post.networks, networkOptions: post.networkOptions ?? {} },
    };
    const lastSubmitted = await lastSubmittedVersion(tx, post);

    // The cover follows the media: it is dropped with the last video and must
    // fit a video whose duration is known.
    const coverInput = data.videoCoverMs !== undefined ? data.videoCoverMs : current.videoCoverMs;
    const nextCover = resolveVideoCover(media ?? current.media, coverInput);
    const coverPatch = data.videoCoverMs !== undefined || nextCover !== (current.videoCoverMs ?? null) ? nextCover : undefined;

    const plan = planPostUpdate({
      status: post.status,
      currentVersionNumber: post.currentVersionNumber,
      lastSubmittedVersionNumber: lastSubmitted,
      current: {
        ...current,
        title: post.title,
        publishAt: post.publishAt,
        networks: post.networks,
        networkOptions: post.networkOptions,
      },
      patch: {
        text: data.text,
        firstCommentText: data.firstCommentText,
        media,
        videoCoverMs: coverPatch,
        content: kindContent,
        title: data.title,
        publishAt: data.publishAt,
        networks: data.networks,
        networkOptions: data.networkOptions,
      },
    });

    const clientChanged = client.id !== post.clientId;
    // Duration/poster/size filled in on the same files: stored in place, even
    // on a version already sent (it is not content the client approves).
    const mediaMetadataOnly = !plan.contentChanged && media !== undefined && mediaMetadataChanged(current.media, media);
    const contentMetadataOnly =
      !plan.contentChanged &&
      kindContent !== undefined &&
      stableStringify(kindContent) !== stableStringify(current.content ?? {});
    const metadataOnly = mediaMetadataOnly || contentMetadataOnly;
    if (metadataOnly) {
      await tx.postVersion.update({
        where: { id: version.id },
        data: {
          ...(mediaMetadataOnly ? { media: toJson(media) } : {}),
          ...(contentMetadataOnly ? { content: toJson(kindContent) } : {}),
        },
      });
    }
    if (plan.noop && !clientChanged && data.changeNote === undefined) {
      return metadataOnly ? tx.post.findUniqueOrThrow({ where: { id: postId } }) : post;
    }

    const nextContent: VersionContent = {
      text: data.text ?? current.text,
      firstCommentText:
        data.firstCommentText !== undefined ? normalizeFirstComment(data.firstCommentText) : current.firstCommentText,
      media: media ?? current.media,
      videoCoverMs: coverPatch !== undefined ? coverPatch : (current.videoCoverMs ?? null),
      content: kindContent ?? current.content ?? {},
      schedule: {
        publishAt: data.publishAt ?? post.publishAt,
        networks: data.networks ?? post.networks,
        networkOptions: data.networkOptions !== undefined ? data.networkOptions : (post.networkOptions ?? {}),
      },
    };
    const nextSchedule = nextContent.schedule!;

    let versionNumber = post.currentVersionNumber;
    if (plan.createVersion) {
      versionNumber = post.currentVersionNumber + 1;
      await tx.postVersion.create({
        data: {
          postId,
          number: versionNumber,
          text: nextContent.text,
          firstCommentText: nextContent.firstCommentText,
          media: toJson(nextContent.media),
          videoCoverMs: nextContent.videoCoverMs ?? null,
          content: toJson(nextContent.content),
          schedule: scheduleToJson(nextSchedule),
          changeNote: data.changeNote || null,
          createdById: userIdOf(actor),
        },
      });
    } else if (plan.contentChanged || plan.scheduleChanged || data.changeNote !== undefined) {
      // A version already sent to the client is immutable: only unsent ones
      // are edited in place (the plan guarantees that for content and
      // schedule changes).
      const versionWasSent = lastSubmitted !== null && post.currentVersionNumber <= lastSubmitted;
      if (plan.contentChanged || plan.scheduleChanged || !versionWasSent) {
        await tx.postVersion.update({
          where: { id: version.id },
          data: {
            text: nextContent.text,
            firstCommentText: nextContent.firstCommentText,
            media: toJson(nextContent.media),
            videoCoverMs: nextContent.videoCoverMs ?? null,
            content: toJson(nextContent.content),
            schedule: scheduleToJson(nextSchedule),
            ...(data.changeNote !== undefined ? { changeNote: data.changeNote || null } : {}),
          },
        });
      }
    }

    const backToDraft = plan.nextStatus === "DRAFT" && post.status !== "DRAFT";
    await guardedPostUpdate(
      tx,
      { id: postId, status: post.status, currentVersionNumber: post.currentVersionNumber },
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.publishAt !== undefined ? { publishAt: data.publishAt } : {}),
        ...(data.networks !== undefined ? { networks: data.networks } : {}),
        ...(data.networkOptions !== undefined ? { networkOptions: toJson(data.networkOptions) } : {}),
        ...(clientChanged ? { clientId: client.id } : {}),
        currentVersionNumber: versionNumber,
        status: plan.nextStatus,
        // The approval was for content/schedule that no longer exists.
        ...(backToDraft ? { approvedAt: null, approvedByReviewerId: null, lastError: null } : {}),
      }
    );

    if (plan.createVersion) {
      const diff = diffVersions(current, nextContent, post.kind);
      await recordEvent(tx, {
        postId,
        type: "VERSION_CREATED",
        actor,
        versionNumber,
        metadata: {
          previousVersionNumber: post.currentVersionNumber,
          changeNote: data.changeNote || null,
          changes: summarizeVersionDiff(diff),
          ...(post.status !== plan.nextStatus ? { fromStatus: post.status, toStatus: plan.nextStatus } : {}),
        },
      });
    }

    return tx.post.findUniqueOrThrow({ where: { id: postId } });
  });
}

export async function submitForReview(
  postIds: string[],
  workspaceId: string,
  actor: Actor,
  opts: {
    reviewDueAt?: Date;
    /**
     * false: no review-request email here (the caller sends its own, e.g. the
     * monthly plan's single email per reviewer, lib/plans.ts).
     */
    notify?: boolean;
  } = {}
): Promise<{
  submitted: string[];
  /** Clients with no active reviewer: nobody can see the items yet. */
  clientsWithoutReviewers: string[];
  /** Clients whose active reviewers have no email: nobody is notified, the agency shares the link. */
  clientsWithoutEmail: string[];
}> {
  const ids = [...new Set(postIds)];
  if (ids.length === 0) throw new ValidationError("Seleziona almeno un post");
  if (ids.length > 200) throw new ValidationError("Puoi inviare al massimo 200 post alla volta");
  if (opts.reviewDueAt && Number.isNaN(opts.reviewDueAt.getTime())) {
    throw new ValidationError("Scadenza di revisione non valida");
  }

  const { clientsWithoutReviewers, clientsWithoutEmail } = await prisma.$transaction(async (tx) => {
    const posts = await tx.post.findMany({
      where: { id: { in: ids }, workspaceId, kind: { in: enabledKinds() } },
      include: {
        client: {
          select: {
            name: true,
            archivedAt: true,
            timezone: true,
            reviewers: { where: { active: true }, select: { email: true } },
          },
        },
        versions: { orderBy: { number: "desc" }, take: 1 },
      },
    });
    if (posts.length !== ids.length) throw new NotFoundError("Uno o più post non sono stati trovati");

    for (const post of posts) {
      if (post.client.archivedAt) throw new ValidationError(`Il cliente ${post.client.name} è archiviato`);
      assertTransition(post.status, "submit");
      const version = post.versions[0];
      if (!version) throw new NotFoundError("Versione del post non trovata");
      if (isInternalKind(post.kind)) {
        // Blog/ads: the kind's own review checks instead of Metricool's.
        const problems = reviewIssuesFor(post.kind, version.content);
        if (problems.length > 0) {
          throw new ValidationError(`"${post.title}" non è pronto per la revisione: ${problems.join(" ")}`);
        }
        continue;
      }
      if (!version.text.trim() && parseMediaItems(version.media).length === 0) {
        throw new ValidationError(`"${post.title}" non ha né testo né media`);
      }
      // The client must never approve something Metricool would reject. The
      // date is left out: a past date is caught at scheduling time, and the
      // agency may still move it after the approval.
      const issues = validateForNetworks({
        networks: post.networks,
        networkOptions: post.networkOptions,
        text: version.text,
        firstCommentText: version.firstCommentText,
        media: version.media,
        timezone: post.client.timezone,
      });
      if (issues.length > 0) {
        throw new ValidationError(
          `"${post.title}" non è pubblicabile così com'è: ${issues.map((issue) => issue.message).join(" ")}`
        );
      }
    }

    const now = new Date();
    for (const post of posts) {
      const next = assertTransition(post.status, "submit");
      await guardedPostUpdate(
        tx,
        { id: post.id, status: post.status, currentVersionNumber: post.currentVersionNumber },
        { status: next, submittedAt: now, reviewDueAt: opts.reviewDueAt ?? null }
      );
      if (post.kind === "AD_CREATIVE") {
        // Every submission opens a new review round: a set resent without a
        // new version must not come back with the previous round's verdicts
        // (they stay in the history as VARIANT_DECIDED events).
        await tx.creativeDecision.deleteMany({
          where: { postId: post.id, versionNumber: post.currentVersionNumber },
        });
      }
      await recordEvent(tx, {
        postId: post.id,
        type: "SUBMITTED_FOR_REVIEW",
        actor,
        versionNumber: post.currentVersionNumber,
        metadata: {
          fromStatus: post.status,
          ...(opts.reviewDueAt ? { reviewDueAt: opts.reviewDueAt.toISOString() } : {}),
        },
      });
    }

    const clientNames = (keep: (reviewers: Array<{ email: string | null }>) => boolean) => [
      ...new Set(posts.filter((p) => keep(p.client.reviewers)).map((p) => p.client.name)),
    ];
    return {
      clientsWithoutReviewers: clientNames((reviewers) => reviewers.length === 0),
      clientsWithoutEmail: clientNames((reviewers) => reviewers.length > 0 && reviewers.every((r) => !r.email)),
    };
  });

  if (opts.notify !== false) await notifyReviewRequested(ids);
  return { submitted: ids, clientsWithoutReviewers, clientsWithoutEmail };
}

export async function cancelPost(postId: string, workspaceId: string, actor: Actor): Promise<Post> {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({ where: { id: postId, workspaceId, kind: { in: enabledKinds() } } });
    if (!post) throw new NotFoundError("Post non trovato");
    const next = assertTransition(post.status, "cancel");
    await guardedPostUpdate(tx, { id: postId, status: post.status }, { status: next });
    await recordEvent(tx, {
      postId,
      type: "CANCELLED",
      actor,
      versionNumber: post.currentVersionNumber,
      metadata: { fromStatus: post.status },
    });
    return tx.post.findUniqueOrThrow({ where: { id: postId } });
  });
}

/**
 * Blog/ads only: the agency marks an approved item as published / delivered
 * (action `deliver`, APPROVED → DELIVERED) once it has exported it.
 */
export async function deliverPost(postId: string, workspaceId: string, actor: Actor): Promise<Post> {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({ where: { id: postId, workspaceId, kind: { in: enabledKinds() } } });
    if (!post) throw new NotFoundError("Post non trovato");
    if (!isInternalKind(post.kind)) {
      throw new ValidationError("I post social si programmano su Metricool: non si segnano come consegnati");
    }
    const next = assertTransition(post.status, "deliver");
    await guardedPostUpdate(
      tx,
      { id: postId, status: post.status, currentVersionNumber: post.currentVersionNumber },
      { status: next }
    );
    await recordEvent(tx, {
      postId,
      type: "DELIVERED",
      actor,
      versionNumber: post.currentVersionNumber,
      metadata: { fromStatus: post.status, kind: post.kind },
    });
    return tx.post.findUniqueOrThrow({ where: { id: postId } });
  });
}

// ─── Client: approve / request changes ───────────────────────────────────────

async function loadPostForReviewerAction(db: DbClient, postId: string, reviewer: ReviewerRef) {
  const post = await db.post.findUnique({ where: { id: postId }, include: { client: true } });
  if (!post || post.clientId !== reviewer.clientId || !isClientVisible(post.status) || !isKindEnabled(post.kind)) {
    throw new NotFoundError("Post non trovato");
  }
  return post;
}

const STALE_VERSION_MESSAGE =
  "Il post è stato aggiornato dall'agenzia nel frattempo: ricarica la pagina per vedere la versione più recente";

/**
 * After a client decision on a post of a monthly plan: keeps the plan's
 * status in sync and tells the agency once when the whole plan is decided.
 * Imported lazily (lib/plans imports this module). Never throws.
 */
async function afterPlanDecision(planId: string | null): Promise<void> {
  if (!planId) return;
  try {
    const { afterPlanPostDecided } = await import("@/lib/plans");
    await afterPlanPostDecided(planId);
  } catch (error) {
    console.error(`[posts] Plan follow-up failed for plan ${planId}:`, error);
  }
}

export async function approvePost(
  postId: string,
  reviewer: ReviewerRef,
  versionNumber: number,
  opts: {
    /**
     * false: no "Approvato" email and no plan follow-up (approving a whole
     * monthly plan sends one summary instead, lib/plans.ts). Scheduling is
     * never skipped.
     */
    notify?: boolean;
  } = {}
): Promise<Post> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ValidationError("Versione non valida");
  const actor: Actor = { kind: "reviewer", reviewerId: reviewer.id };

  const result = await prisma.$transaction(async (tx) => {
    const post = await loadPostForReviewerAction(tx, postId, reviewer);
    if (post.currentVersionNumber !== versionNumber) throw new ConflictError(STALE_VERSION_MESSAGE);

    // Double click / second tab: approving what is already approved is a no-op.
    if (post.approvedAt && ["APPROVED", "SCHEDULING", "SCHEDULED", "DELIVERED"].includes(post.status)) {
      return { post, changed: false };
    }

    const next = assertTransition(post.status, "approve");
    const now = new Date();
    // The guarded write also locks the row, so the ads decisions read below
    // cannot change before this transaction commits (decideVariant locks it too).
    await guardedPostUpdate(
      tx,
      { id: postId, status: post.status, currentVersionNumber: versionNumber },
      { status: next, approvedAt: now, approvedByReviewerId: reviewer.id, lastError: null }
    );

    let metadata: Prisma.InputJsonObject | undefined;
    if (post.kind === "AD_CREATIVE") {
      // Rule 5: every variant decided, at least one approved.
      const version = await tx.postVersion.findUniqueOrThrow({
        where: { postId_number: { postId, number: versionNumber } },
        select: { content: true },
      });
      const content = parseKindContent("AD_CREATIVE", version.content);
      const decisions = await tx.creativeDecision.findMany({ where: { postId, versionNumber } });
      const evaluation = evaluateCreativeDecisions(
        content.variants.map((v) => v.id),
        decisions
      );
      const blocker = approvalBlocker(evaluation, content);
      if (blocker) throw new ValidationError(blocker);
      metadata = {
        approvedVariants: evaluation.approved,
        rejectedVariants: evaluation.rejected.map((r) => r.variantId),
      };
    }

    await recordEvent(tx, { postId, type: "APPROVED", actor, versionNumber, ...(metadata ? { metadata } : {}) });
    return { post: { ...post, status: next, approvedAt: now, approvedByReviewerId: reviewer.id }, changed: true };
  });

  if (!result.changed) return result.post;

  // Blog/ads have no external integration: nothing to schedule, ever.
  if (!isInternalKind(result.post.kind) && result.post.client.autoSchedule) {
    try {
      // Imported lazily: scheduling pulls in BullMQ/Redis and imports this module.
      const { requestScheduling } = await import("@/lib/scheduling");
      await requestScheduling(postId, actor);
    } catch (error) {
      // The approval is committed; the sweep cron re-queues APPROVED posts.
      console.error(`[posts] Scheduling request failed for approved post ${postId}:`, error);
    }
  }

  if (opts.notify !== false) {
    await notifyApproved(postId);
    await afterPlanDecision(result.post.planId);
  }
  return prisma.post.findUniqueOrThrow({ where: { id: postId } });
}

/**
 * Client asks for changes. `message` becomes the general CLIENT comment (for
 * the assistant: summary + bullet list). `opts.actionItems` are the
 * assistant's structured items: each one about a specific media / video
 * moment also becomes its own CLIENT comment, so it shows up as a pin or a
 * marker on the video timeline (see planActionItemComment).
 */
export async function requestChanges(
  postId: string,
  reviewer: ReviewerRef,
  versionNumber: number,
  message: string,
  opts: {
    reviewSessionId?: string;
    actionItems?: RequestChangesActionItem[];
    /**
     * Ads "Invia le mie decisioni" with every variant discarded: re-checked
     * under the row lock (a variant approved in the meantime is a conflict)
     * and the message rebuilt from the decisions as committed.
     */
    allVariantsRejected?: boolean;
  } = {}
): Promise<{ post: Post; comment: PostComment; actionComments: PostComment[] }> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ValidationError("Versione non valida");
  let body = parseOrThrow(changesMessageSchema, message);
  const actionItems = opts.actionItems ? parseOrThrow(actionItemsSchema, opts.actionItems) : [];
  const actor: Actor = { kind: "reviewer", reviewerId: reviewer.id };

  const result = await prisma.$transaction(async (tx) => {
    const post = await loadPostForReviewerAction(tx, postId, reviewer);
    if (post.currentVersionNumber !== versionNumber) throw new ConflictError(STALE_VERSION_MESSAGE);
    const next = assertTransition(post.status, "request_changes");

    if (opts.reviewSessionId) {
      const session = await tx.reviewSession.findFirst({
        where: { id: opts.reviewSessionId, postId, reviewerId: reviewer.id },
        select: { id: true },
      });
      if (!session) throw new NotFoundError("Conversazione con l'assistente non trovata");
    }

    const version = await tx.postVersion.findUniqueOrThrow({
      where: { postId_number: { postId, number: versionNumber } },
      select: { id: true, media: true, content: true },
    });

    await guardedPostUpdate(
      tx,
      { id: postId, status: post.status, currentVersionNumber: versionNumber },
      { status: next }
    );
    if (opts.allVariantsRejected) {
      // The guarded write locks the row (decideVariant locks it too), so the
      // decisions read here are the ones this request is based on.
      if (post.kind !== "AD_CREATIVE") throw new ValidationError("Questo contenuto non ha varianti");
      const content = parseKindContent("AD_CREATIVE", version.content);
      const decisions = await tx.creativeDecision.findMany({ where: { postId, versionNumber } });
      const evaluation = evaluateCreativeDecisions(
        content.variants.map((v) => v.id),
        decisions
      );
      if (evaluation.outcome !== "changes") {
        throw new ConflictError("Le decisioni sulle varianti sono cambiate nel frattempo: ricarica la pagina e riprova");
      }
      body = parseOrThrow(changesMessageSchema, buildRejectionMessage(evaluation, content));
    }
    const comment = await tx.postComment.create({
      data: {
        postId,
        versionId: version.id,
        authorType: "CLIENT",
        reviewerId: reviewer.id,
        body,
      },
    });

    const target: ActionItemTarget =
      post.kind === "BLOG_ARTICLE"
        ? { kind: "BLOG_ARTICLE" }
        : post.kind === "AD_CREATIVE"
          ? { kind: "AD_CREATIVE", variants: actionItems.length ? adVariantsOf(readKindContent(post.kind, version.content)) : [] }
          : { kind: "SOCIAL_POST", media: parseMediaItems(version.media) };
    const actionComments: PostComment[] = [];
    for (const item of actionItems) {
      const planned = planActionItemCommentFor(item, target);
      if (!planned) continue;
      actionComments.push(
        await tx.postComment.create({
          data: {
            postId,
            versionId: version.id,
            authorType: "CLIENT",
            reviewerId: reviewer.id,
            body: planned.body,
            mediaIndex: planned.mediaIndex,
            timeSec: planned.timeSec,
            timeEndSec: planned.timeEndSec,
            variantId: planned.variantId,
            ...(planned.anchor ? { anchor: toJson(planned.anchor) } : {}),
          },
        })
      );
    }

    await recordEvent(tx, {
      postId,
      type: "CHANGES_REQUESTED",
      actor,
      versionNumber,
      metadata: {
        commentId: comment.id,
        ...(opts.actionItems ? { actionCommentIds: actionComments.map((c) => c.id) } : {}),
        ...(opts.reviewSessionId ? { reviewSessionId: opts.reviewSessionId } : {}),
      },
    });
    return { comment, actionComments };
  });

  await notifyChangesRequested(postId);
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  await afterPlanDecision(post.planId);
  return { post, comment: result.comment, actionComments: result.actionComments };
}

/**
 * Logs that the reviewer opened the post (CLIENT_VIEWED), once per reviewer
 * and version. Best effort: never throws.
 */
export async function recordClientView(postId: string, reviewer: ReviewerRef): Promise<void> {
  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { clientId: true, status: true, currentVersionNumber: true, submittedAt: true, id: true },
    });
    if (!post || post.clientId !== reviewer.clientId || !isClientVisible(post.status)) return;
    const versionNumber = visibleVersionNumber(
      post.currentVersionNumber,
      await lastSubmittedVersion(prisma, post)
    );
    const seen = await prisma.postEvent.findFirst({
      where: { postId, type: "CLIENT_VIEWED", reviewerId: reviewer.id, versionNumber },
      select: { id: true },
    });
    if (seen) return;
    await recordEvent(prisma, {
      postId,
      type: "CLIENT_VIEWED",
      actor: { kind: "reviewer", reviewerId: reviewer.id },
      versionNumber,
    });
  } catch (error) {
    console.error(`[posts] Failed to record client view for ${postId}:`, error);
  }
}

// ─── Comments ────────────────────────────────────────────────────────────────

export interface AddCommentInput {
  postId: string;
  actor: Actor;
  body: string;
  versionId?: string;
  mediaIndex?: number;
  pinX?: number;
  pinY?: number;
  /** Videos: moment in seconds (≥ 0, within the duration when known). Requires mediaIndex. */
  timeSec?: number;
  /** Videos: end of a range, after timeSec. */
  timeEndSec?: number;
  /** Blog only: the selected passage. */
  anchor?: BlogAnchor | null;
  /** Ads only: the variant (must exist in the version); mediaIndex then refers to its media. */
  variantId?: string | null;
  /** Agency callers: the active workspace; the post must belong to it. */
  workspaceId?: string;
}

/**
 * Adds a general, pinned or video-moment comment. Agency users must be
 * members of the post's workspace; reviewers must belong to the post's client
 * and can only comment on versions they have been sent. A moment can only be
 * set on a video media of that version (pinX/pinY then mark the paused frame).
 * Blog comments may carry the selected passage (anchor); ads comments a
 * variant, whose media mediaIndex / moments then refer to.
 */
export async function addComment(input: AddCommentInput): Promise<PostComment> {
  const data = parseOrThrow(commentSchema, {
    postId: input.postId,
    body: input.body,
    versionId: input.versionId,
    mediaIndex: input.mediaIndex,
    pinX: input.pinX,
    pinY: input.pinY,
    timeSec: input.timeSec,
    timeEndSec: input.timeEndSec,
    anchor: input.anchor ?? undefined,
    variantId: input.variantId ?? undefined,
  });
  const { actor } = input;
  if (actor.kind === "system") throw new ForbiddenError();

  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id: data.postId } });
    // A kind this instance does not handle does not exist for it.
    if (!post || !isKindEnabled(post.kind)) throw new NotFoundError("Post non trovato");

    let maxVersion = post.currentVersionNumber;
    if (actor.kind === "user") {
      if (input.workspaceId !== undefined && input.workspaceId !== post.workspaceId) {
        throw new NotFoundError("Post non trovato");
      }
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: post.workspaceId, userId: actor.userId } },
        select: { id: true },
      });
      if (!member) throw new NotFoundError("Post non trovato");
    } else {
      const reviewer = await tx.clientReviewer.findUnique({
        where: { id: actor.reviewerId },
        select: { clientId: true, active: true },
      });
      if (!reviewer?.active || reviewer.clientId !== post.clientId || !isClientVisible(post.status)) {
        throw new NotFoundError("Post non trovato");
      }
      maxVersion = visibleVersionNumber(post.currentVersionNumber, await lastSubmittedVersion(tx, post));
    }

    const version = data.versionId
      ? await tx.postVersion.findFirst({ where: { id: data.versionId, postId: post.id } })
      : await tx.postVersion.findUnique({ where: { postId_number: { postId: post.id, number: maxVersion } } });
    if (!version || version.number > maxVersion) throw new NotFoundError("Versione non trovata");

    // Where a comment can point depends on the kind: social → the post's
    // media; blog → a passage (anchor); ads → a variant and its media.
    if (data.anchor && post.kind !== "BLOG_ARTICLE") {
      throw new ValidationError("Il passaggio del testo si può indicare solo sugli articoli");
    }
    if (data.variantId && post.kind !== "AD_CREATIVE") {
      throw new ValidationError("La variante si può indicare solo sulle creatività ads");
    }
    let media: MediaItem[] = [];
    if (post.kind === "AD_CREATIVE") {
      if (data.variantId) {
        const variant = adVariantsOf(readKindContent(post.kind, version.content)).find((v) => v.id === data.variantId);
        if (!variant) throw new NotFoundError("Variante non trovata in questa versione");
        media = variant.media;
      } else if (data.mediaIndex !== undefined) {
        throw new ValidationError("Indica la variante a cui si riferisce il commento");
      }
    } else if (post.kind === "BLOG_ARTICLE") {
      if (data.mediaIndex !== undefined) {
        throw new ValidationError("Sugli articoli seleziona il passaggio del testo da commentare");
      }
    } else {
      media = parseMediaItems(version.media);
    }
    if (data.mediaIndex !== undefined && data.mediaIndex >= media.length) {
      throw new ValidationError("Il media indicato non esiste in questa versione");
    }
    const time = checkCommentTime(
      data.mediaIndex !== undefined ? media[data.mediaIndex] : undefined,
      data.timeSec,
      data.timeEndSec
    );
    if ("error" in time) throw new ValidationError(time.error);

    const columns = actorColumns(actor);
    const comment = await tx.postComment.create({
      data: {
        postId: post.id,
        versionId: version.id,
        authorType: actor.kind === "user" ? "AGENCY" : "CLIENT",
        userId: columns.userId,
        reviewerId: columns.reviewerId,
        body: data.body,
        mediaIndex: data.mediaIndex ?? null,
        pinX: data.pinX ?? null,
        pinY: data.pinY ?? null,
        timeSec: time.timeSec,
        timeEndSec: time.timeEndSec,
        variantId: data.variantId ?? null,
        ...(data.anchor ? { anchor: toJson(data.anchor) } : {}),
      },
    });
    await recordEvent(tx, {
      postId: post.id,
      type: "COMMENTED",
      actor,
      versionNumber: version.number,
      metadata: {
        commentId: comment.id,
        ...(data.variantId ? { variantId: data.variantId } : {}),
        ...(data.anchor ? { quote: data.anchor.quote.slice(0, 200) } : {}),
        ...(data.mediaIndex !== undefined ? { mediaIndex: data.mediaIndex } : {}),
        ...(time.timeSec !== null ? { timeSec: time.timeSec } : {}),
        ...(time.timeEndSec !== null ? { timeEndSec: time.timeEndSec } : {}),
      },
    });
    return comment;
  });
}

/** Marks a comment resolved (or reopens it with `resolved = false`). Agency only. */
export async function resolveComment(commentId: string, workspaceId: string, resolved = true): Promise<PostComment> {
  const { count } = await prisma.postComment.updateMany({
    where: { id: commentId, post: { workspaceId, kind: { in: enabledKinds() } } },
    data: { resolvedAt: resolved ? new Date() : null },
  });
  if (count !== 1) throw new NotFoundError("Commento non trovato");
  return prisma.postComment.findUniqueOrThrow({ where: { id: commentId } });
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const personSelect = { id: true, name: true, email: true } as const;

const workspacePostInclude = {
  client: true,
  createdBy: { select: personSelect },
  versions: { orderBy: { number: "desc" }, include: { createdBy: { select: personSelect } } },
  comments: {
    orderBy: { createdAt: "asc" },
    include: { user: { select: personSelect }, reviewer: { select: personSelect } },
  },
  events: {
    orderBy: { createdAt: "asc" },
    include: { user: { select: personSelect }, reviewer: { select: personSelect } },
  },
  reviewSessions: {
    orderBy: { startedAt: "desc" },
    include: { reviewer: { select: personSelect }, messages: { orderBy: { createdAt: "asc" } } },
  },
  // Ads: the client's per-variant decisions, every version (newest first).
  creativeDecisions: {
    orderBy: [{ versionNumber: "desc" }, { createdAt: "asc" }],
    include: { reviewer: { select: personSelect } },
  },
} satisfies Prisma.PostInclude;

export type WorkspacePost = Prisma.PostGetPayload<{ include: typeof workspacePostInclude }>;

/**
 * Full post for the agency editor: client, versions (newest first), comments,
 * events (chronological), AI review sessions with their transcripts and, for
 * ads, the client's decisions per variant. Kinds not enabled for this
 * instance are not found.
 */
export async function getPostForWorkspace(postId: string, workspaceId: string): Promise<WorkspacePost> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId, kind: { in: enabledKinds() } },
    include: workspacePostInclude,
  });
  if (!post) throw new NotFoundError("Post non trovato");
  return post;
}

/** Comment anchor as stored (PostComment.anchor), or null when absent/malformed. */
export function readBlogAnchor(value: unknown): BlogAnchor | null {
  return parseBlogAnchor(value);
}

export interface ReviewerPostVersion {
  id: string;
  number: number;
  text: string;
  firstCommentText: string | null;
  media: MediaItem[];
  /** Chosen video cover frame (ms), if any. */
  videoCoverMs: number | null;
  /** Blog: BlogContent, ads: AdContent; null for social posts (or unreadable rows). */
  content: KindContent | null;
  /** Date and networks this version was sent with (null for old rows). */
  schedule: VersionSchedule | null;
  changeNote: string | null;
  createdAt: Date;
}

export interface ReviewerPostComment {
  id: string;
  versionId: string | null;
  authorType: "AGENCY" | "CLIENT";
  authorName: string;
  /** True for comments written by this reviewer. */
  isMine: boolean;
  body: string;
  mediaIndex: number | null;
  pinX: number | null;
  pinY: number | null;
  /** Video comments: moment (and optional end of range) in seconds. */
  timeSec: number | null;
  timeEndSec: number | null;
  /** Blog: the commented passage. */
  anchor: BlogAnchor | null;
  /** Ads: the commented variant (mediaIndex refers to its media). */
  variantId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** Ads: the client's decision on one variant of the visible version. */
export interface ReviewerVariantDecision {
  variantId: string;
  verdict: "APPROVED" | "REJECTED";
  note: string | null;
  reviewerName: string | null;
  /** Taken by this reviewer (another reviewer of the client may have decided). */
  isMine: boolean;
  updatedAt: Date;
}

export interface ReviewerPost {
  id: string;
  title: string;
  kind: ContentKind;
  status: PostStatus;
  publishAt: Date;
  networks: Network[];
  networkOptions: NetworkOptions;
  /** Version the client sees and approves (never an unsent revision). */
  currentVersionNumber: number;
  reviewDueAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  scheduledAt: Date | null;
  /** The client can approve / request changes right now. */
  canAct: boolean;
  /** Monthly plan the post belongs to (lib/plans.ts), if any. */
  planId?: string | null;
  client: { id: string; name: string; logoUrl: string | null; timezone: string };
  /** Newest first. */
  versions: ReviewerPostVersion[];
  /** Oldest first. */
  comments: ReviewerPostComment[];
  /** Ads: decisions on the visible version (empty for other kinds). */
  decisions: ReviewerVariantDecision[];
  /** This reviewer's conversations with the AI assistant. */
  reviewSessions: Array<ReviewSession & { messages: ReviewMessage[] }>;
}

/**
 * Post as the client portal may show it. Throws NotFoundError when the post
 * belongs to another client, is not visible to clients (drafts, cancelled) or
 * is of a kind this instance does not handle.
 */
export async function getPostForReviewer(postId: string, reviewer: ReviewerRef): Promise<ReviewerPost> {
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      clientId: reviewer.clientId,
      status: { in: CLIENT_VISIBLE_STATUSES },
      kind: { in: enabledKinds() },
    },
    include: {
      client: { select: { id: true, name: true, logoUrl: true, timezone: true } },
      versions: { orderBy: { number: "desc" } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } }, reviewer: { select: { name: true } } },
      },
      reviewSessions: {
        where: { reviewerId: reviewer.id },
        orderBy: { startedAt: "desc" },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!post) throw new NotFoundError("Post non trovato");

  const visible = visibleVersionNumber(post.currentVersionNumber, await lastSubmittedVersion(prisma, post));
  const versions = post.versions.filter((v) => v.number <= visible);
  const visibleVersionIds = new Set(versions.map((v) => v.id));
  const live: VersionSchedule = {
    publishAt: post.publishAt,
    networks: post.networks,
    networkOptions: post.networkOptions ?? {},
  };
  // The Post row carries the current version's date and networks; while an
  // unsent revision exists the client still sees those it was sent with.
  const scheduleOf = (v: { number: number; schedule: unknown }) =>
    v.number === post.currentVersionNumber ? live : parseVersionSchedule(v.schedule);
  const shownSchedule = scheduleOf(versions.find((v) => v.number === visible) ?? { number: -1, schedule: null }) ?? live;

  const decisions =
    post.kind === "AD_CREATIVE"
      ? await prisma.creativeDecision.findMany({
          where: { postId: post.id, versionNumber: visible },
          orderBy: { createdAt: "asc" },
          include: { reviewer: { select: { name: true } } },
        })
      : [];

  return {
    id: post.id,
    title: post.title,
    kind: post.kind,
    status: post.status,
    publishAt: shownSchedule.publishAt,
    networks: shownSchedule.networks as Network[],
    networkOptions: (shownSchedule.networkOptions ?? {}) as NetworkOptions,
    currentVersionNumber: visible,
    reviewDueAt: post.reviewDueAt,
    submittedAt: post.submittedAt,
    approvedAt: post.approvedAt,
    scheduledAt: post.scheduledAt,
    canAct: post.status === "IN_REVIEW" && visible === post.currentVersionNumber,
    planId: post.planId,
    client: post.client,
    versions: versions.map((v) => ({
      id: v.id,
      number: v.number,
      text: v.text,
      firstCommentText: v.firstCommentText,
      media: parseMediaItems(v.media),
      videoCoverMs: v.videoCoverMs,
      content: readKindContent(post.kind, v.content),
      schedule: scheduleOf(v),
      changeNote: v.changeNote,
      createdAt: v.createdAt,
    })),
    comments: post.comments
      .filter((c) => c.versionId === null || visibleVersionIds.has(c.versionId))
      .map((c) => ({
        id: c.id,
        versionId: c.versionId,
        authorType: c.authorType,
        authorName:
          c.authorType === "CLIENT" ? (c.reviewer?.name ?? post.client.name) : (c.user?.name ?? "Agenzia"),
        isMine: c.reviewerId === reviewer.id,
        body: c.body,
        mediaIndex: c.mediaIndex,
        pinX: c.pinX,
        pinY: c.pinY,
        timeSec: c.timeSec,
        timeEndSec: c.timeEndSec,
        anchor: readBlogAnchor(c.anchor),
        variantId: c.variantId,
        resolvedAt: c.resolvedAt,
        createdAt: c.createdAt,
      })),
    decisions: decisions.map((d) => ({
      variantId: d.variantId,
      verdict: d.verdict,
      note: d.note,
      reviewerName: d.reviewer?.name ?? null,
      isMine: d.reviewerId === reviewer.id,
      updatedAt: d.updatedAt,
    })),
    reviewSessions: post.reviewSessions,
  };
}

export interface ReviewerPostSummary {
  id: string;
  title: string;
  kind: ContentKind;
  status: PostStatus;
  publishAt: Date;
  networks: Network[];
  currentVersionNumber: number;
  reviewDueAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  canAct: boolean;
  /** Thumbnail: first media (social), featured image (blog), first variant's first media (ads). */
  cover: MediaItem | null;
  mediaCount: number;
  /** Ads: number of variants in the set; null for other kinds. */
  variantCount: number | null;
  /** First ~160 characters of the caption / article excerpt / first variant's text. */
  excerpt: string;
  /** Monthly plan the post belongs to (lib/plans.ts), if any. */
  planId?: string | null;
}

/** Markdown → one line of plain text, good enough (and cheap) for a list excerpt. */
function markdownExcerpt(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}…` : text;
}

/** Thumbnail, media count and excerpt of a version, per kind (pure). */
export function summarizeVersionForList(
  kind: ContentKind,
  version: { text: string; media: unknown; content: unknown } | undefined
): { cover: MediaItem | null; mediaCount: number; variantCount: number | null; excerpt: string } {
  if (!version) return { cover: null, mediaCount: 0, variantCount: kind === "AD_CREATIVE" ? 0 : null, excerpt: "" };
  if (kind === "SOCIAL_POST") {
    const media = parseMediaItems(version.media);
    return { cover: media[0] ?? null, mediaCount: media.length, variantCount: null, excerpt: truncate(version.text) };
  }
  const content = readKindContent(kind, version.content);
  if (content && "variants" in content) {
    const media = content.variants.flatMap((v) => v.media);
    const first = content.variants[0];
    return {
      cover: media[0] ?? null,
      mediaCount: media.length,
      variantCount: content.variants.length,
      excerpt: truncate(first?.primaryText || first?.headline || ""),
    };
  }
  if (content && "bodyMarkdown" in content) {
    return {
      cover: content.featuredImage,
      mediaCount: content.featuredImage ? 1 : 0,
      variantCount: null,
      excerpt: truncate(content.excerpt.trim() || markdownExcerpt(content.bodyMarkdown)),
    };
  }
  return { cover: null, mediaCount: 0, variantCount: kind === "AD_CREATIVE" ? 0 : null, excerpt: "" };
}

/** Posts of the reviewer's client that the portal lists, by publish date. */
export async function listPostsForReviewer(reviewer: ReviewerRef): Promise<ReviewerPostSummary[]> {
  const posts = await prisma.post.findMany({
    where: { clientId: reviewer.clientId, status: { in: CLIENT_VISIBLE_STATUSES }, kind: { in: enabledKinds() } },
    orderBy: { publishAt: "asc" },
    take: 500,
  });
  if (posts.length === 0) return [];

  const submitted = await lastSubmittedVersions(prisma, posts.map((p) => p.id));
  const visibleByPost = new Map(
    posts.map((p) => [
      p.id,
      visibleVersionNumber(
        p.currentVersionNumber,
        effectiveLastSubmittedVersion(submitted.get(p.id), p.submittedAt, p.currentVersionNumber)
      ),
    ])
  );
  const versions = await prisma.postVersion.findMany({
    where: { OR: posts.map((p) => ({ postId: p.id, number: visibleByPost.get(p.id)! })) },
    select: { postId: true, text: true, media: true, content: true, schedule: true },
  });
  const versionByPost = new Map(versions.map((v) => [v.postId, v]));

  return posts.map((p) => {
    const version = versionByPost.get(p.id);
    const visible = visibleByPost.get(p.id)!;
    // An unsent revision's date and networks stay hidden like its content.
    const sent = visible < p.currentVersionNumber && version ? parseVersionSchedule(version.schedule) : null;
    return {
      id: p.id,
      title: p.title,
      kind: p.kind,
      status: p.status,
      publishAt: sent?.publishAt ?? p.publishAt,
      networks: (sent?.networks ?? p.networks) as Network[],
      currentVersionNumber: visible,
      reviewDueAt: p.reviewDueAt,
      submittedAt: p.submittedAt,
      approvedAt: p.approvedAt,
      canAct: p.status === "IN_REVIEW" && visible === p.currentVersionNumber,
      planId: p.planId,
      ...summarizeVersionForList(p.kind, version),
    };
  });
}
