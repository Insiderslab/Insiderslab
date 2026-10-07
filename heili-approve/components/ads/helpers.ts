/**
 * Pure helpers for the ads components: comment numbering, pins and video
 * markers for a variant, the domain shown in the mockups, and edits of a set
 * (reorder, platform switch). No React, no DOM: unit-tested in
 * __tests__/ads-content.test.ts.
 */

import {
  AD_PLACEMENTS,
  PLACEMENT_SPECS,
  defaultPlacementsForPlatform,
  emptyGoogleAssets,
  type AdContent,
  type AdPlacement,
  type AdPlatform,
  type AdVariant,
} from "@/lib/content/ads";
import { formatTimeRange } from "@/lib/domain";
import type { PreviewPin, PreviewVideoMarker } from "@/components/post-preview/types";

/** A comment on a variant, as the review components need it (PortalComment fits). */
export interface AdReviewComment {
  id: string;
  authorType: "AGENCY" | "CLIENT";
  authorName: string;
  /** The current reviewer wrote it ("Tu"). */
  isMine?: boolean;
  body: string;
  mediaIndex: number | null;
  pinX: number | null;
  pinY: number | null;
  timeSec: number | null;
  timeEndSec: number | null;
  resolved?: boolean;
  /** Used for ordering when present; otherwise the given order is kept. */
  createdAt?: Date | string;
  /** "7 ott, 18:30", pre-formatted by the server. */
  createdLabel: string;
}

export type NumberedComment<T extends AdReviewComment = AdReviewComment> = T & { number: number };

function isLocated(c: AdReviewComment): boolean {
  return c.mediaIndex !== null && (c.timeSec !== null || (c.pinX !== null && c.pinY !== null));
}

function time(value: Date | string | undefined): number {
  if (!value) return 0;
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Located comments (pins, moments) numbered 1..n by media, then time, then
 * creation; general comments by creation. The numbers are the ones drawn in
 * the pins and video markers.
 */
export function numberAdComments<T extends AdReviewComment>(
  comments: readonly T[]
): { located: Array<NumberedComment<T>>; general: T[] } {
  const indexed = comments.map((comment, order) => ({ comment, order }));
  const byCreation = (a: { comment: T; order: number }, b: { comment: T; order: number }) =>
    time(a.comment.createdAt) - time(b.comment.createdAt) || a.order - b.order;
  const located = indexed
    .filter(({ comment }) => isLocated(comment))
    .sort(
      (a, b) =>
        (a.comment.mediaIndex ?? 0) - (b.comment.mediaIndex ?? 0) ||
        (a.comment.timeSec ?? -1) - (b.comment.timeSec ?? -1) ||
        byCreation(a, b)
    )
    .map(({ comment }, index) => ({ ...comment, number: index + 1 }));
  const general = indexed
    .filter(({ comment }) => !isLocated(comment))
    .sort(byCreation)
    .map(({ comment }) => comment);
  return { located, general };
}

/** Pins over the media for numbered comments (video pins only show at their moment). */
export function pinsForComments(located: ReadonlyArray<NumberedComment>): PreviewPin[] {
  return located.flatMap((c) =>
    c.mediaIndex !== null && c.pinX !== null && c.pinY !== null
      ? [
          {
            id: c.id,
            mediaIndex: c.mediaIndex,
            x: c.pinX,
            y: c.pinY,
            label: String(c.number),
            timeSec: c.timeSec,
            timeEndSec: c.timeEndSec,
          },
        ]
      : []
  );
}

/** Progress-bar markers for numbered comments on videos. */
export function markersForComments(located: ReadonlyArray<NumberedComment>): PreviewVideoMarker[] {
  return located.flatMap((c) =>
    c.mediaIndex !== null && c.timeSec !== null
      ? [
          {
            id: c.id,
            mediaIndex: c.mediaIndex,
            timeSec: c.timeSec,
            timeEndSec: c.timeEndSec,
            label: String(c.number),
            tone: c.authorType === "AGENCY" ? ("agency" as const) : ("client" as const),
          },
        ]
      : []
  );
}

/** "0:07" or "0:12–0:15". */
export function commentMoment(c: Pick<AdReviewComment, "timeSec" | "timeEndSec">): string | null {
  return c.timeSec === null ? null : formatTimeRange(c.timeSec, c.timeEndSec);
}

/** "esempio.it" from the destination URL (no "www."), or null when it is not a URL. */
export function displayDomain(url: string): string | null {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host ? host.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** Moves an item; out-of-range moves return the list unchanged. */
export function moveVariant<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Campaign platform switch: every variant keeps only the placements of the
 * new platform, or gets all of them when none is left.
 */
export function switchPlatform(content: AdContent, platform: AdPlatform): AdContent {
  if (content.campaign.platform === platform) return content;
  const defaults = defaultPlacementsForPlatform(platform);
  return {
    campaign: { ...content.campaign, platform },
    variants: content.variants.map((variant) => {
      const kept = variant.placements.filter((p) => PLACEMENT_SPECS[p].platform === platform);
      const next = { ...variant, placements: kept.length > 0 ? kept : defaults };
      // Google Ads variants get (empty) assets to fill in; other platforms keep any they had.
      return platform === "google" && !variant.google ? { ...next, google: emptyGoogleAssets() } : next;
    }),
  };
}

/** Placements of the given variants in canonical order (for the compare view switch). */
export function unionPlacements(variants: ReadonlyArray<Pick<AdVariant, "placements">>): AdPlacement[] {
  const used = new Set(variants.flatMap((v) => v.placements));
  return AD_PLACEMENTS.filter((p) => used.has(p));
}

/** Patch of one variant by id (unknown ids leave the content unchanged). */
export function patchVariant(content: AdContent, id: string, patch: Partial<Omit<AdVariant, "id">>): AdContent {
  return {
    ...content,
    variants: content.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
  };
}

/** Records the pixel size of every media at `url` that does not have one yet. */
export function withMediaDimensions(content: AdContent, url: string, width: number, height: number): AdContent {
  if (!(width > 0) || !(height > 0)) return content;
  let changed = false;
  const missing = (m: { url: string; width?: number; height?: number }) => m.url === url && (!m.width || !m.height);
  const sized = <T extends { url: string; width?: number; height?: number }>(m: T): T =>
    missing(m) ? { ...m, width: Math.round(width), height: Math.round(height) } : m;
  const variants = content.variants.map((variant) => {
    const inMedia = variant.media.some(missing);
    const inLogos = variant.google?.logos.some(missing) ?? false;
    if (!inMedia && !inLogos) return variant;
    changed = true;
    return {
      ...variant,
      media: inMedia ? variant.media.map(sized) : variant.media,
      ...(variant.google && inLogos ? { google: { ...variant.google, logos: variant.google.logos.map(sized) } } : {}),
    };
  });
  return changed ? { ...content, variants } : content;
}
