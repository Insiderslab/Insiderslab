"use client";

/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * The media area of a mockup: a single media, a carousel (arrows, dots,
 * counter or story bars, swipe, ← → keys) or a 2–4 image grid.
 *
 * Owns everything interactive about media so the per-network mockups stay
 * plain markup: comment pins, clicks reported as relative coordinates, and
 * routing of the video-review props to the right video. Only the current
 * carousel slide is mounted, so switching slide stops a playing video.
 */

import { useState, type KeyboardEvent, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import type { MediaItem } from "@/lib/domain";
import { clampRatio, mediaAlt, relativePoint } from "./helpers";
import CommentPin from "./comment-pin";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import type { MediaClickPoint, PreviewPin, VideoReviewProps } from "./types";
import VideoPlayer from "./video-player";

/** A fixed width/height ratio, or one measured from the first media and clamped. */
export type RatioSpec = number | { min: number; max: number; fallback: number };

export interface MediaStageProps extends VideoReviewProps {
  media: MediaItem[];
  ratio: RatioSpec;
  /** Ratio for video slides when it differs (e.g. Instagram feed videos at 4:5). */
  videoRatio?: number;
  fit?: "cover" | "contain";
  pins?: PreviewPin[];
  onMediaClick?: (p: MediaClickPoint) => void;
  /** Network UI drawn over every slide (Reel/Story/TikTok chrome). */
  overlay?: ReactNode;
  /** dots: under the frame · counter: "1/3" top-right · story: bars on top. */
  indicators?: "dots" | "counter" | "dots-counter" | "story" | "none";
  /** 2–4 images side by side like Facebook/LinkedIn/X, instead of a carousel. */
  layout?: "carousel" | "grid";
  /** Name used in accessible labels ("Reel", "Post Instagram"…). */
  label: string;
  frameClassName?: string;
  dotsClassName?: string;
  className?: string;
  /** Shown when there is no media (e.g. Instagram post without image). */
  emptyLabel?: string;
}

const SWIPE_MIN_PX = 40;

export default function MediaStage({
  media,
  ratio,
  videoRatio,
  fit = "cover",
  pins = [],
  onMediaClick,
  overlay,
  indicators = "dots",
  layout = "carousel",
  label,
  frameClassName = "",
  dotsClassName = "",
  className = "",
  emptyLabel = "Nessun contenuto multimediale",
  markers,
  onRequestComment,
  onTimeChange,
  registerTimeGetter,
  seekTo,
}: MediaStageProps) {
  const total = media.length;
  const firstVideo = media.findIndex((item) => item.type === "video");

  const [index, setIndex] = useState(0);
  const [measured, setMeasured] = useState<{ url: string; ratio: number } | null>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  // A seek aimed at another slide (timecode chip in the comment list)
  // brings that slide on screen first; adjusting state during render is
  // React's recommended alternative to an effect here.
  const [seenSeek, setSeenSeek] = useState(seekTo?.nonce);
  if (seekTo && seekTo.nonce !== seenSeek) {
    setSeenSeek(seekTo.nonce);
    const target = seekTo.mediaIndex ?? firstVideo;
    if (target >= 0 && target < total) setIndex(target);
  }

  const current = Math.min(index, Math.max(0, total - 1));

  const frameRatio =
    typeof ratio === "number"
      ? ratio
      : measured && measured.url === media[0]?.url
        ? clampRatio(measured.ratio, ratio.min, ratio.max)
        : ratio.fallback;

  function measure(item: MediaItem, i: number, width: number, height: number) {
    if (i === 0 && width > 0 && height > 0) setMeasured({ url: item.url, ratio: width / height });
  }

  function go(next: number) {
    if (total === 0) return;
    setIndex(Math.min(total - 1, Math.max(0, next)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The video player stops arrow keys it uses for frame stepping.
    if (total < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      go(current + (event.key === "ArrowRight" ? 1 : -1));
      event.preventDefault();
    }
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    const target = event.target as HTMLElement;
    if (total < 2 || !touch || target.closest("[data-no-swipe]")) {
      setTouchStart(null);
      return;
    }
    setTouchStart({ x: touch.clientX, y: touch.clientY });
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const touch = event.changedTouches[0];
    if (!touchStart || !touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    setTouchStart(null);
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      // A swipe is navigation, not a tap on the media: no click, no pin.
      event.preventDefault();
      go(current + (dx < 0 ? 1 : -1));
    }
  }

  function videoProps(i: number) {
    const isDefaultVideo = i === firstVideo;
    const seekTarget = seekTo ? (seekTo.mediaIndex ?? firstVideo) : -1;
    return {
      markers: (markers ?? []).filter((m) =>
        m.mediaIndex === undefined ? isDefaultVideo : m.mediaIndex === i
      ),
      onRequestComment: onRequestComment
        ? (p: { timeSec: number; x?: number; y?: number }) => onRequestComment({ mediaIndex: i, ...p })
        : undefined,
      onTimeChange: onTimeChange ? (sec: number) => onTimeChange(sec, i) : undefined,
      registerTimeGetter,
      seekTo: seekTo && seekTarget === i ? { timeSec: seekTo.timeSec, nonce: seekTo.nonce } : undefined,
    };
  }

  function renderSlide(item: MediaItem, i: number, slideRatio: number, slideOverlay: ReactNode, frameClass: string) {
    const slidePins = pins.filter((pin) => pin.mediaIndex === i);
    const alt = mediaAlt(item, i, total);
    if (item.type === "video") {
      return (
        <VideoPlayer
          key={item.url}
          src={item.url}
          poster={item.posterUrl}
          durationSec={item.durationSec}
          aspectRatio={videoRatio ?? slideRatio}
          fit={fit}
          label={alt}
          overlay={slideOverlay}
          pins={slidePins}
          onDimensions={(w, h) => measure(item, i, w, h)}
          frameClassName={frameClass}
          {...videoProps(i)}
        />
      );
    }
    return (
      <div
        key={item.url}
        className={`relative w-full overflow-hidden bg-black/5 ${frameClass}`}
        style={{ aspectRatio: String(slideRatio) }}
      >
        <ImageSurface
          key={item.url}
          item={item}
          index={i}
          alt={alt}
          fit={fit}
          pins={slidePins}
          onMediaClick={onMediaClick}
          onLoadSize={(w, h) => measure(item, i, w, h)}
        />
        {slideOverlay ? <div className="pointer-events-none absolute inset-0 z-20">{slideOverlay}</div> : null}
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className={className}>
        <div
          className={`relative flex w-full items-center justify-center overflow-hidden bg-surface ${frameClassName}`}
          style={{ aspectRatio: String(typeof ratio === "number" ? ratio : ratio.fallback) }}
        >
          <p className="px-6 text-center text-sm text-muted">{emptyLabel}</p>
          {overlay ? <div className="pointer-events-none absolute inset-0">{overlay}</div> : null}
        </div>
      </div>
    );
  }

  // Grid: every image visible (and pinnable) at once.
  if (layout === "grid" && total >= 2 && total <= 4 && media.every((m) => m.type === "image")) {
    return (
      <div className={className}>
        <div className={`grid grid-cols-2 gap-0.5 overflow-hidden ${frameClassName}`}>
          {media.map((item, i) => {
            const wide = total === 3 && i === 0;
            return (
              <div key={`${item.url}-${i}`} className={wide ? "col-span-2" : ""}>
                {renderSlide(item, i, wide ? 2 : total === 2 ? 4 / 5 : 1, null, "")}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const item = media[current];
  const nav =
    total > 1 ? (
      <>
        {indicators === "story" ? (
          <div className="absolute inset-x-2 top-2 flex gap-1" aria-hidden="true">
            {media.map((m, i) => (
              <span key={`${m.url}-${i}`} className={`h-0.5 flex-1 rounded-full ${i <= current ? "bg-white" : "bg-white/40"}`} />
            ))}
          </div>
        ) : null}
        {indicators === "counter" || indicators === "dots-counter" ? (
          <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white" aria-hidden="true">
            {current + 1} di {total}
          </span>
        ) : null}
        {current > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(current - 1);
            }}
            aria-label="Contenuto precedente"
            className="pointer-events-auto absolute left-2 top-1/2 flex h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-black/70 px-2 text-xs font-semibold text-white shadow-sm backdrop-blur-sm sm:px-3">
              <ChevronLeftIcon className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Precedente</span>
            </span>
          </button>
        ) : null}
        {current < total - 1 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(current + 1);
            }}
            aria-label="Contenuto successivo"
            className="pointer-events-auto absolute right-2 top-1/2 flex h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-black/70 px-2 text-xs font-semibold text-white shadow-sm backdrop-blur-sm sm:px-3">
              <ChevronRightIcon className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Successivo</span>
            </span>
          </button>
        ) : null}
      </>
    ) : null;

  const slideOverlay =
    overlay || nav ? (
      <>
        {overlay}
        {nav}
      </>
    ) : null;

  return (
    <div
      className={className}
      role={total > 1 ? "region" : undefined}
      aria-roledescription={total > 1 ? "carosello" : undefined}
      aria-label={total > 1 ? `${label}: ${total} contenuti` : undefined}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div aria-roledescription={total > 1 ? "contenuto" : undefined} aria-label={total > 1 ? `${current + 1} di ${total}` : undefined} role={total > 1 ? "group" : undefined}>
        {renderSlide(item, current, frameRatio, slideOverlay, frameClassName)}
      </div>
      {total > 1 && (indicators === "dots" || indicators === "dots-counter") ? (
        <div className={`flex items-center justify-start overflow-x-auto px-2 sm:justify-center ${dotsClassName}`}>
          {media.map((m, i) => (
            <button
              key={`${m.url}-${i}`}
              type="button"
              onClick={() => go(i)}
              aria-label={`Vai al contenuto ${i + 1} di ${total}`}
              aria-current={i === current ? "true" : undefined}
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className={`h-2 rounded-full transition-[width] ${i === current ? "w-5 bg-[#0095f6]" : "w-2 bg-[#a8a8a8]"}`} />
            </button>
          ))}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {total > 1 ? `Contenuto ${current + 1} di ${total}` : ""}
      </p>
    </div>
  );
}

// ─── Image with pins ─────────────────────────────────────────────────────────

function ImageSurface({
  item,
  index,
  alt,
  fit,
  pins,
  onMediaClick,
  onLoadSize,
}: {
  item: MediaItem;
  index: number;
  alt: string;
  fit: "cover" | "contain";
  pins: PreviewPin[];
  onMediaClick?: (p: MediaClickPoint) => void;
  onLoadSize: (width: number, height: number) => void;
}) {
  const [failed, setFailed] = useState(false);

  function report(event: MouseEvent<HTMLDivElement>) {
    if (!onMediaClick) return;
    // Keyboard activation has no position: pin the center.
    const point =
      event.detail === 0
        ? { x: 0.5, y: 0.5 }
        : relativePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    if (point) onMediaClick({ mediaIndex: index, ...point });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onMediaClick || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onMediaClick({ mediaIndex: index, x: 0.5, y: 0.5 });
  }

  return (
    <>
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <p className="px-6 text-center text-sm text-muted">Immagine non disponibile</p>
        </div>
      ) : (
        <img
          src={item.url}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(event) => onLoadSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full select-none ${fit === "contain" ? "object-contain" : "object-cover"}`}
        />
      )}
      {onMediaClick ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={`${alt}: tocca un punto per aggiungere un commento`}
          onClick={report}
          onKeyDown={onKeyDown}
          className="absolute inset-0 cursor-crosshair"
        />
      ) : null}
      {pins.map((pin, i) => (
          <CommentPin
            key={pin.id}
            x={pin.x}
            y={pin.y}
            label={pin.label}
            index={i}
          />
      ))}
    </>
  );
}

export { MediaStage };
