/**
 * Pure helpers for the post previews and the video player.
 *
 * No React and no DOM here, so the rules that decide what the client sees
 * (which mockup, where a pin or a marker lands, how a caption is cut) are
 * unit-tested in __tests__/post-preview.test.ts.
 */

import {
  NETWORK_FORMATS,
  type MediaItem,
  type Network,
} from "@/lib/domain";

// ─── Layouts ─────────────────────────────────────────────────────────────────

/** Which mockup renders a (network, format) pair. */
export type PreviewLayout =
  | "instagram-feed"
  | "instagram-reel"
  | "instagram-story"
  | "facebook-post"
  | "facebook-reel"
  | "facebook-story"
  | "linkedin"
  | "tiktok"
  | "twitter"
  | "threads"
  | "bluesky"
  | "pinterest"
  | "youtube-video"
  | "youtube-short"
  | "gmb";

/**
 * Format as stored in `<network>Data.type`, falling back to the network's
 * first format (same default the Metricool payload uses).
 */
export function resolveFormat(network: Network, format?: string | null): string | undefined {
  const formats = NETWORK_FORMATS[network];
  if (!formats) return undefined;
  const wanted = format?.trim().toLowerCase();
  return formats.find((f) => f.toLowerCase() === wanted) ?? formats[0];
}

/** Reads `networkOptions["<network>Data"].type` without trusting its shape. */
export function formatFromOptions(network: Network, networkOptions: unknown): string | undefined {
  if (typeof networkOptions !== "object" || networkOptions === null) return resolveFormat(network);
  const data = (networkOptions as Record<string, unknown>)[`${network}Data`];
  const type =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>).type : undefined;
  return resolveFormat(network, typeof type === "string" ? type : undefined);
}

export function layoutFor(network: Network, format?: string | null): PreviewLayout {
  const f = resolveFormat(network, format);
  switch (network) {
    case "instagram":
      return f === "REEL" ? "instagram-reel" : f === "STORY" ? "instagram-story" : "instagram-feed";
    case "facebook":
      return f === "REEL" ? "facebook-reel" : f === "STORY" ? "facebook-story" : "facebook-post";
    case "youtube":
      return f === "short" ? "youtube-short" : "youtube-video";
    case "linkedin":
    case "tiktok":
    case "twitter":
    case "threads":
    case "bluesky":
    case "pinterest":
    case "gmb":
      return network;
  }
}

/** Short Italian label for the format, shown in tabs ("Reel", "Storia"…). */
export function formatLabel(network: Network, format?: string | null): string | null {
  const f = resolveFormat(network, format);
  if (!f) return null;
  const labels: Record<string, string> = {
    POST: "Post",
    REEL: "Reel",
    STORY: "Storia",
    post: "Post",
    video: "Video",
    short: "Short",
    publication: "Aggiornamento",
    photo: "Foto",
  };
  return labels[f] ?? f;
}

/** Vertical full-screen layouts (9:16, network UI drawn over the media). */
export function isVerticalLayout(layout: PreviewLayout): boolean {
  return (
    layout === "instagram-reel" ||
    layout === "instagram-story" ||
    layout === "facebook-reel" ||
    layout === "facebook-story" ||
    layout === "tiktok" ||
    layout === "youtube-short"
  );
}

// ─── Captions ────────────────────────────────────────────────────────────────

export type CaptionToken =
  | { kind: "text"; value: string }
  | { kind: "hashtag"; value: string }
  | { kind: "mention"; value: string }
  | { kind: "url"; value: string };

// Built from a string so the `u` flag does not depend on the TS target.
// Group 1: what precedes a hashtag/mention (start or a non-word char), so
// "mail@brand.it" or "a#b" are not highlighted.
const TOKEN_SOURCE =
  "(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)|(^|[^\\p{L}\\p{N}_&/])([#@][\\p{L}\\p{N}_]+(?:\\.[\\p{L}\\p{N}_]+)*)";

/** Splits a caption into plain text, #hashtags, @mentions and links. */
export function tokenizeCaption(text: string): CaptionToken[] {
  const tokens: CaptionToken[] = [];
  const push = (token: CaptionToken) => {
    const last = tokens[tokens.length - 1];
    if (token.kind === "text" && last?.kind === "text") last.value += token.value;
    else if (token.value) tokens.push(token);
  };
  const re = new RegExp(TOKEN_SOURCE, "gu");
  let cursor = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    push({ kind: "text", value: text.slice(cursor, start) });
    if (match[1]) {
      // Trailing punctuation belongs to the sentence, not to the link.
      const url = match[1].replace(/[.,;:!?)\]}'"»]+$/, "");
      push({ kind: "url", value: url });
      push({ kind: "text", value: match[1].slice(url.length) });
    } else {
      push({ kind: "text", value: match[2] ?? "" });
      const tag = match[3] ?? "";
      push({ kind: tag.startsWith("#") ? "hashtag" : "mention", value: tag });
    }
    cursor = start + match[0].length;
  }
  push({ kind: "text", value: text.slice(cursor) });
  return tokens;
}

/** Where the real apps cut the caption before "altro". */
export const CAPTION_LIMITS = {
  instagramFeed: { maxChars: 125, maxLines: 2 },
  instagramReel: { maxChars: 60, maxLines: 1 },
  facebook: { maxChars: 280, maxLines: 5 },
  linkedin: { maxChars: 210, maxLines: 3 },
  tiktok: { maxChars: 80, maxLines: 2 },
  twitter: { maxChars: 280, maxLines: 30 },
  threads: { maxChars: 500, maxLines: 30 },
  bluesky: { maxChars: 300, maxLines: 30 },
  pinterest: { maxChars: 100, maxLines: 2 },
  youtube: { maxChars: 100, maxLines: 2 },
  gmb: { maxChars: 180, maxLines: 4 },
} as const;

export interface CaptionLimit {
  maxChars: number;
  maxLines: number;
}

/**
 * Cuts a caption the way the feeds do: after `maxLines` lines or
 * `maxChars` characters, on a word boundary, trailing spaces removed.
 */
export function truncateCaption(
  text: string,
  { maxChars, maxLines }: CaptionLimit
): { text: string; truncated: boolean } {
  let cut = text.length;
  // Line limit: stop at the newline that ends line `maxLines`.
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      if (lines === maxLines) {
        cut = i;
        break;
      }
      lines++;
    }
  }
  if (cut > maxChars) {
    const space = text.lastIndexOf(" ", maxChars);
    cut = space > maxChars * 0.6 ? space : maxChars;
  }
  if (cut >= text.length) return { text, truncated: false };
  return { text: text.slice(0, cut).trimEnd(), truncated: true };
}

// ─── Accounts and dates ──────────────────────────────────────────────────────

/** "Pasticceria Rossi" → "@pasticceriarossi" (X/Threads/Bluesky handles). */
export function toHandle(accountName: string): string {
  const slug = accountName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "");
  return `@${slug || "account"}`;
}

/** Two-letter initials for the avatar placeholder. */
export function initials(accountName: string): string {
  const words = accountName.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Publication date in the network's style. A fixed time zone keeps the
 * server render and the hydration identical.
 */
export function formatPublishDate(
  value: Date | string | null | undefined,
  style: "short" | "dayMonth" | "long" | "time",
  timeZone = "Europe/Rome"
): string | null {
  const date = toDate(value);
  if (!date) return null;
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short", timeZone }
      : style === "dayMonth"
        ? { day: "numeric", month: "long", timeZone }
        : style === "long"
        ? { day: "numeric", month: "long", year: "numeric", timeZone }
        : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone };
  return new Intl.DateTimeFormat("it-IT", options).format(date);
}

// ─── Media geometry ──────────────────────────────────────────────────────────

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Pointer position → coordinates relative to the media box (0..1, four
 * decimals). Null when the box has no size (not laid out yet).
 */
export function relativePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const round = (v: number) => Math.round(clampUnit(v) * 10000) / 10000;
  return { x: round((clientX - rect.left) / rect.width), y: round((clientY - rect.top) / rect.height) };
}

/** Width/height ratio clamped to what a feed accepts (e.g. IG 4:5 … 1.91:1). */
export function clampRatio(ratio: number, min: number, max: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return min;
  return Math.min(max, Math.max(min, ratio));
}

/** Text inside a pin/marker circle: short labels as-is, otherwise the number. */
export function badgeText(label: string, index: number): string {
  const trimmed = label.trim();
  return trimmed && trimmed.length <= 3 ? trimmed : String(index + 1);
}

export function mediaAlt(item: MediaItem, index: number, total: number): string {
  if (item.alt?.trim()) return item.alt.trim();
  const kind = item.type === "video" ? "Video" : "Immagine";
  return total > 1 ? `${kind} ${index + 1} di ${total}` : kind;
}

// ─── Video ───────────────────────────────────────────────────────────────────

/** One frame at 30 fps: what the arrow keys step by. */
export const FRAME_SEC = 1 / 30;

export function isKnownDuration(duration: number | null | undefined): duration is number {
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0;
}

/** Keeps a time inside [0, duration] (only ≥ 0 while the duration is unknown). */
export function clampTime(timeSec: number, duration?: number | null): number {
  const t = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
  return isKnownDuration(duration) ? Math.min(t, duration) : t;
}

/**
 * Next time when stepping one frame. Stops one frame before the end so the
 * video does not flip to "ended" while the client is inspecting frames.
 */
export function stepFrame(current: number, direction: 1 | -1, duration?: number | null): number {
  const next = clampTime(current + direction * FRAME_SEC, duration);
  if (direction > 0 && isKnownDuration(duration)) {
    return Math.max(0, Math.min(next, duration - FRAME_SEC));
  }
  return next;
}

/** ±N seconds, clamped. */
export function seekBy(current: number, deltaSec: number, duration?: number | null): number {
  return clampTime(current + deltaSec, duration);
}

/** Time reported to comments: hundredths are plenty for "0:07". */
export function roundTime(timeSec: number): number {
  return Math.round(Math.max(0, timeSec) * 100) / 100;
}

/** Position on the progress bar in percent (0..100), null if unknown. */
export function markerPercent(timeSec: number, duration?: number | null): number | null {
  if (!isKnownDuration(duration) || !Number.isFinite(timeSec)) return null;
  return Math.round(clampUnit(timeSec / duration) * 10000) / 100;
}

export interface MarkerInput {
  id: string;
  timeSec: number;
  timeEndSec?: number | null;
  label: string;
  tone?: "client" | "assistant" | "agency";
}

export interface PositionedMarker extends MarkerInput {
  /** 1-based number shown in the circle when the label is long. */
  number: number;
  text: string;
  leftPct: number;
  /** Width of the band for ranges ("dal 0:12 al 0:15"), null for points. */
  widthPct: number | null;
}

/**
 * Markers sorted by time with their bar position. Ranges whose end is not
 * after the start are drawn as points; everything is clamped to the bar.
 */
export function layoutMarkers(markers: readonly MarkerInput[], duration?: number | null): PositionedMarker[] {
  if (!isKnownDuration(duration)) return [];
  return [...markers]
    .filter((m) => Number.isFinite(m.timeSec))
    .sort((a, b) => a.timeSec - b.timeSec)
    .map((marker, index) => {
      const leftPct = markerPercent(marker.timeSec, duration) ?? 0;
      const end = marker.timeEndSec;
      const endPct =
        typeof end === "number" && end > marker.timeSec ? markerPercent(end, duration) : null;
      return {
        ...marker,
        number: index + 1,
        text: badgeText(marker.label, index),
        leftPct,
        widthPct: endPct !== null && endPct > leftPct ? Math.round((endPct - leftPct) * 100) / 100 : null,
      };
    });
}

/** Whether a paused frame at `currentSec` is "at" a comment made at `timeSec`. */
export function isAtTime(currentSec: number, timeSec: number, timeEndSec?: number | null): boolean {
  if (typeof timeEndSec === "number" && timeEndSec > timeSec) {
    return currentSec >= timeSec - 0.25 && currentSec <= timeEndSec + 0.25;
  }
  return Math.abs(currentSec - timeSec) <= 0.5;
}

/**
 * Without a poster, iOS shows a black box until playback: asking for the
 * first instant via a media fragment makes it paint the first frame.
 */
export function withStartFragment(src: string): string {
  return src.includes("#") ? src : `${src}#t=0.001`;
}
