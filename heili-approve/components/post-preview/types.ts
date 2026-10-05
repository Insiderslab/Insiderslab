/**
 * Props shared by PostPreview, NetworkPreviewTabs and the per-network mockups.
 */

import type { MediaItem, Network } from "@/lib/domain";
import type { MarkerInput } from "./helpers";

/** A comment pin over a media; x/y are relative to the shown frame (0..1). */
export interface PreviewPin {
  id: string;
  mediaIndex: number;
  x: number;
  y: number;
  /** Short text in the circle ("1", "2"…); longer labels show the number. */
  label: string;
  /** Video pins: shown only while paused at (or within) this moment. */
  timeSec?: number | null;
  timeEndSec?: number | null;
}

/** Timeline marker on a video's progress bar. */
export type VideoMarker = MarkerInput;

/** Marker as passed to PostPreview: `mediaIndex` defaults to the first video. */
export interface PreviewVideoMarker extends VideoMarker {
  mediaIndex?: number;
}

export interface MediaClickPoint {
  mediaIndex: number;
  x: number;
  y: number;
}

export interface VideoCommentRequest {
  mediaIndex: number;
  timeSec: number;
  x?: number;
  y?: number;
}

export interface PreviewSeek {
  timeSec: number;
  /** Change it to seek again to the same time. */
  nonce: number;
  /** Defaults to the first video. */
  mediaIndex?: number;
}

/** Video review pass-through (see "Video e Reel" in docs/CONTRATTO.md). */
export interface VideoReviewProps {
  markers?: PreviewVideoMarker[];
  /** "Commenta a m:ss" and taps on the paused frame. */
  onRequestComment?: (p: VideoCommentRequest) => void;
  onTimeChange?: (sec: number, mediaIndex: number) => void;
  /** Receives a getter for the current time of the video on screen. */
  registerTimeGetter?: (get: () => number) => void;
  seekTo?: PreviewSeek;
}

export interface PostPreviewProps extends VideoReviewProps {
  network: Network;
  /** `<network>Data.type` ("POST" | "REEL" | "STORY", "short"…). */
  format?: string;
  text: string;
  firstCommentText?: string | null;
  media: MediaItem[];
  accountName: string;
  accountAvatarUrl?: string | null;
  publishAt?: Date | string;
  pins?: PreviewPin[];
  /** Images: click on the media → relative point. Videos use onRequestComment. */
  onMediaClick?: (p: MediaClickPoint) => void;
  /** Time zone for the dates shown in the mockups (default Europe/Rome). */
  timeZone?: string;
  className?: string;
}

/** What every per-network mockup receives (format already resolved). */
export type MockupProps = Omit<PostPreviewProps, "network" | "format" | "className">;
