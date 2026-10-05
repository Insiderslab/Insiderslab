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
 * Pure helpers (diffing, versioning decisions) are exported for unit tests.
 */

import { z } from "zod";
import type {
  MediaAsset,
  Post,
  PostComment,
  PostStatus,
  ReviewSession,
  ReviewMessage,
} from "@/app/generated/prisma/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { actorColumns, type Actor } from "@/lib/actor";
import { prisma } from "@/lib/db/client";
import {
  CLIENT_VISIBLE_STATUSES,
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
import { recordEvent, type DbClient } from "@/lib/events";
import { validateForNetworks } from "@/lib/metricool/payload";
import { notifyApproved, notifyChangesRequested, notifyReviewRequested } from "@/lib/notifications";
import { MAX_VIDEO_DURATION_SEC, mediaItemForAsset, storageKeyFromMediaUrl } from "@/lib/storage";

// ─── Input ───────────────────────────────────────────────────────────────────

export type PostInput = {
  clientId: string;
  title: string;
  publishAt: Date;
  networks: Network[];
  networkOptions?: NetworkOptions;
  text: string;
  firstCommentText?: string | null;
  media: MediaItem[];
  /** Cover frame of the (first) video in ms; sent to Metricool as videoCoverMilliseconds. */
  videoCoverMs?: number | null;
};

export type PostUpdateInput = Partial<PostInput> & { changeNote?: string };

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
});

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
  networks: z
    .array(z.enum(NETWORKS, { error: "Rete non supportata" }))
    .min(1, "Scegli almeno una rete")
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

export const postInputSchema = z.object({
  ...postFields,
  networkOptions: postFields.networkOptions.optional(),
  firstCommentText: postFields.firstCommentText.optional(),
  videoCoverMs: postFields.videoCoverMs.optional(),
});

export const postUpdateSchema = z
  .object(postFields)
  .partial()
  .extend({ changeNote: z.string().trim().max(1000).optional() });

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
  return JSON.stringify([item.durationSec ?? null, item.posterUrl ?? null]);
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
}

/** What changed between two versions (media are matched by URL). */
export function diffVersions(before: VersionContent, after: VersionContent): VersionDiff {
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
      scheduleChanged,
    textChanged,
    firstCommentChanged,
    text: textChanged ? diffText(before.text, after.text) : [],
    firstComment: firstCommentChanged ? diffText(beforeComment, afterComment) : [],
    media: { added, removed, reordered, altChanged },
    coverChanged,
    schedule,
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
}): VersionContent {
  return {
    text: version.text,
    firstCommentText: version.firstCommentText,
    media: parseMediaItems(version.media),
    videoCoverMs: version.videoCoverMs,
  };
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
    if (asset) return mediaItemForAsset(asset, item.alt || undefined, video);
    return {
      url: item.url,
      type: item.type,
      mimeType: item.mimeType,
      ...(item.alt ? { alt: item.alt } : {}),
      ...(item.type === "video" && video.durationSec !== undefined ? { durationSec: video.durationSec } : {}),
      ...(item.type === "video" && video.posterUrl ? { posterUrl: video.posterUrl } : {}),
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

  return prisma.$transaction(async (tx) => {
    const client = await findClientForPost(tx, data.clientId, workspaceId);
    assertNetworksAllowed(data.networks, client.networks);
    const media = await normalizeMedia(tx, workspaceId, data.media);
    const videoCoverMs = resolveVideoCover(media, data.videoCoverMs);

    const post = await tx.post.create({
      data: {
        workspaceId,
        clientId: client.id,
        title: data.title,
        publishAt: data.publishAt,
        networks: data.networks,
        networkOptions: toJson(data.networkOptions ?? {}),
        currentVersionNumber: 1,
        createdById: userIdOf(actor),
        versions: {
          create: {
            number: 1,
            text: data.text,
            firstCommentText: normalizeFirstComment(data.firstCommentText),
            media: toJson(media),
            videoCoverMs,
            schedule: scheduleToJson({
              publishAt: data.publishAt,
              networks: data.networks,
              networkOptions: data.networkOptions ?? {},
            }),
            createdById: userIdOf(actor),
          },
        },
      },
    });

    await recordEvent(tx, { postId: post.id, type: "CREATED", actor, versionNumber: 1 });
    return post;
  });
}

export async function updatePost(
  postId: string,
  workspaceId: string,
  input: PostUpdateInput,
  actor: Actor
): Promise<Post> {
  const data = parseOrThrow(postUpdateSchema, input);

  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({ where: { id: postId, workspaceId }, include: { client: true } });
    if (!post) throw new NotFoundError("Post non trovato");

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
    }

    const networks = data.networks ?? (post.networks as Network[]);
    if (data.networks !== undefined || client.id !== post.clientId) {
      assertNetworksAllowed(networks, client.networks);
    }

    const media = data.media !== undefined ? await normalizeMedia(tx, workspaceId, data.media) : undefined;
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
        title: data.title,
        publishAt: data.publishAt,
        networks: data.networks,
        networkOptions: data.networkOptions,
      },
    });

    const clientChanged = client.id !== post.clientId;
    // Duration/poster filled in on the same files: stored in place, even on a
    // version already sent (it is not content the client approves).
    const metadataOnly = !plan.contentChanged && media !== undefined && mediaMetadataChanged(current.media, media);
    if (metadataOnly) {
      await tx.postVersion.update({ where: { id: version.id }, data: { media: toJson(media) } });
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
      const diff = diffVersions(current, nextContent);
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
  opts: { reviewDueAt?: Date } = {}
): Promise<{ submitted: string[]; clientsWithoutReviewers: string[] }> {
  const ids = [...new Set(postIds)];
  if (ids.length === 0) throw new ValidationError("Seleziona almeno un post");
  if (ids.length > 200) throw new ValidationError("Puoi inviare al massimo 200 post alla volta");
  if (opts.reviewDueAt && Number.isNaN(opts.reviewDueAt.getTime())) {
    throw new ValidationError("Scadenza di revisione non valida");
  }

  const clientsWithoutReviewers = await prisma.$transaction(async (tx) => {
    const posts = await tx.post.findMany({
      where: { id: { in: ids }, workspaceId },
      include: {
        client: {
          select: {
            name: true,
            archivedAt: true,
            timezone: true,
            _count: { select: { reviewers: { where: { active: true } } } },
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
      if (!version || (!version.text.trim() && parseMediaItems(version.media).length === 0)) {
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

    return [
      ...new Set(posts.filter((p) => p.client._count.reviewers === 0).map((p) => p.client.name)),
    ];
  });

  await notifyReviewRequested(ids);
  return { submitted: ids, clientsWithoutReviewers };
}

export async function cancelPost(postId: string, workspaceId: string, actor: Actor): Promise<Post> {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({ where: { id: postId, workspaceId } });
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

// ─── Client: approve / request changes ───────────────────────────────────────

async function loadPostForReviewerAction(db: DbClient, postId: string, reviewer: ReviewerRef) {
  const post = await db.post.findUnique({ where: { id: postId }, include: { client: true } });
  if (!post || post.clientId !== reviewer.clientId || !isClientVisible(post.status)) {
    throw new NotFoundError("Post non trovato");
  }
  return post;
}

const STALE_VERSION_MESSAGE =
  "Il post è stato aggiornato dall'agenzia nel frattempo: ricarica la pagina per vedere la versione più recente";

export async function approvePost(postId: string, reviewer: ReviewerRef, versionNumber: number): Promise<Post> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ValidationError("Versione non valida");
  const actor: Actor = { kind: "reviewer", reviewerId: reviewer.id };

  const result = await prisma.$transaction(async (tx) => {
    const post = await loadPostForReviewerAction(tx, postId, reviewer);
    if (post.currentVersionNumber !== versionNumber) throw new ConflictError(STALE_VERSION_MESSAGE);

    // Double click / second tab: approving what is already approved is a no-op.
    if (post.approvedAt && ["APPROVED", "SCHEDULING", "SCHEDULED"].includes(post.status)) {
      return { post, changed: false };
    }

    const next = assertTransition(post.status, "approve");
    const now = new Date();
    await guardedPostUpdate(
      tx,
      { id: postId, status: post.status, currentVersionNumber: versionNumber },
      { status: next, approvedAt: now, approvedByReviewerId: reviewer.id, lastError: null }
    );
    await recordEvent(tx, { postId, type: "APPROVED", actor, versionNumber });
    return { post: { ...post, status: next, approvedAt: now, approvedByReviewerId: reviewer.id }, changed: true };
  });

  if (!result.changed) return result.post;

  if (result.post.client.autoSchedule) {
    try {
      // Imported lazily: scheduling pulls in BullMQ/Redis and imports this module.
      const { requestScheduling } = await import("@/lib/scheduling");
      await requestScheduling(postId, actor);
    } catch (error) {
      // The approval is committed; the sweep cron re-queues APPROVED posts.
      console.error(`[posts] Scheduling request failed for approved post ${postId}:`, error);
    }
  }

  await notifyApproved(postId);
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
  opts: { reviewSessionId?: string; actionItems?: RequestChangesActionItem[] } = {}
): Promise<{ post: Post; comment: PostComment; actionComments: PostComment[] }> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ValidationError("Versione non valida");
  const body = parseOrThrow(changesMessageSchema, message);
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
      select: { id: true, media: true },
    });

    await guardedPostUpdate(
      tx,
      { id: postId, status: post.status, currentVersionNumber: versionNumber },
      { status: next }
    );
    const comment = await tx.postComment.create({
      data: {
        postId,
        versionId: version.id,
        authorType: "CLIENT",
        reviewerId: reviewer.id,
        body,
      },
    });

    const media = parseMediaItems(version.media);
    const actionComments: PostComment[] = [];
    for (const item of actionItems) {
      const planned = planActionItemComment(item, media);
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
  /** Agency callers: the active workspace; the post must belong to it. */
  workspaceId?: string;
}

/**
 * Adds a general, pinned or video-moment comment. Agency users must be
 * members of the post's workspace; reviewers must belong to the post's client
 * and can only comment on versions they have been sent. A moment can only be
 * set on a video media of that version (pinX/pinY then mark the paused frame).
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
  });
  const { actor } = input;
  if (actor.kind === "system") throw new ForbiddenError();

  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id: data.postId } });
    if (!post) throw new NotFoundError("Post non trovato");

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

    const media = parseMediaItems(version.media);
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
      },
    });
    await recordEvent(tx, {
      postId: post.id,
      type: "COMMENTED",
      actor,
      versionNumber: version.number,
      metadata: {
        commentId: comment.id,
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
    where: { id: commentId, post: { workspaceId } },
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
} satisfies Prisma.PostInclude;

export type WorkspacePost = Prisma.PostGetPayload<{ include: typeof workspacePostInclude }>;

/**
 * Full post for the agency editor: client, versions (newest first), comments,
 * events (chronological) and AI review sessions with their transcripts.
 */
export async function getPostForWorkspace(postId: string, workspaceId: string): Promise<WorkspacePost> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId },
    include: workspacePostInclude,
  });
  if (!post) throw new NotFoundError("Post non trovato");
  return post;
}

export interface ReviewerPostVersion {
  id: string;
  number: number;
  text: string;
  firstCommentText: string | null;
  media: MediaItem[];
  /** Chosen video cover frame (ms), if any. */
  videoCoverMs: number | null;
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
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface ReviewerPost {
  id: string;
  title: string;
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
  client: { id: string; name: string; logoUrl: string | null; timezone: string };
  /** Newest first. */
  versions: ReviewerPostVersion[];
  /** Oldest first. */
  comments: ReviewerPostComment[];
  /** This reviewer's conversations with the AI assistant. */
  reviewSessions: Array<ReviewSession & { messages: ReviewMessage[] }>;
}

/**
 * Post as the client portal may show it. Throws NotFoundError when the post
 * belongs to another client or is not visible to clients (drafts, cancelled).
 */
export async function getPostForReviewer(postId: string, reviewer: ReviewerRef): Promise<ReviewerPost> {
  const post = await prisma.post.findFirst({
    where: { id: postId, clientId: reviewer.clientId, status: { in: CLIENT_VISIBLE_STATUSES } },
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

  return {
    id: post.id,
    title: post.title,
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
    client: post.client,
    versions: versions.map((v) => ({
      id: v.id,
      number: v.number,
      text: v.text,
      firstCommentText: v.firstCommentText,
      media: parseMediaItems(v.media),
      videoCoverMs: v.videoCoverMs,
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
        resolvedAt: c.resolvedAt,
        createdAt: c.createdAt,
      })),
    reviewSessions: post.reviewSessions,
  };
}

export interface ReviewerPostSummary {
  id: string;
  title: string;
  status: PostStatus;
  publishAt: Date;
  networks: Network[];
  currentVersionNumber: number;
  reviewDueAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  canAct: boolean;
  /** First media of the visible version, for thumbnails. */
  cover: MediaItem | null;
  mediaCount: number;
  /** First ~160 characters of the caption. */
  excerpt: string;
}

/** Posts of the reviewer's client that the portal lists, by publish date. */
export async function listPostsForReviewer(reviewer: ReviewerRef): Promise<ReviewerPostSummary[]> {
  const posts = await prisma.post.findMany({
    where: { clientId: reviewer.clientId, status: { in: CLIENT_VISIBLE_STATUSES } },
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
    select: { postId: true, text: true, media: true, schedule: true },
  });
  const versionByPost = new Map(versions.map((v) => [v.postId, v]));

  return posts.map((p) => {
    const version = versionByPost.get(p.id);
    const media = version ? parseMediaItems(version.media) : [];
    const text = version?.text ?? "";
    const visible = visibleByPost.get(p.id)!;
    // An unsent revision's date and networks stay hidden like its content.
    const sent = visible < p.currentVersionNumber && version ? parseVersionSchedule(version.schedule) : null;
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      publishAt: sent?.publishAt ?? p.publishAt,
      networks: (sent?.networks ?? p.networks) as Network[],
      currentVersionNumber: visible,
      reviewDueAt: p.reviewDueAt,
      submittedAt: p.submittedAt,
      approvedAt: p.approvedAt,
      canAct: p.status === "IN_REVIEW" && visible === p.currentVersionNumber,
      cover: media[0] ?? null,
      mediaCount: media.length,
      excerpt: text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text,
    };
  });
}
