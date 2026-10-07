"use client";

/**
 * Video player for reviewing moments of a Reel / TikTok / Story / Short.
 *
 * Own controls over a native <video playsInline>: the client comments on a
 * moment ("al secondo 0:07…"), not on "the video". The frame keeps the
 * network's proportions (network UI can be drawn over it via `overlay`);
 * the review controls sit below the frame so they never hide the content.
 *
 * - Progress bar with numbered comment markers (ranges as bands); tapping
 *   a marker seeks there and pauses.
 * - −1 s / +1 s, 0,5× speed, arrow keys step one frame (Shift: one second).
 * - "Commenta a m:ss" pauses and reports the time; tapping the paused frame
 *   reports the point too (x/y relative to the frame, 0..1).
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { formatTimecode } from "@/lib/domain";
import {
  clampTime,
  clampUnit,
  isAtTime,
  isKnownDuration,
  layoutMarkers,
  markerPercent,
  relativePoint,
  roundTime,
  seekBy,
  stepFrame,
  withStartFragment,
  badgeText,
  type MarkerInput,
} from "./helpers";
import { PauseIcon, PlayIcon } from "./icons";

export type VideoPlayerMarker = MarkerInput;

export interface VideoPlayerPin {
  id: string;
  x: number;
  y: number;
  label: string;
  timeSec?: number | null;
  timeEndSec?: number | null;
}

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  markers?: VideoPlayerMarker[];
  onRequestComment?: (p: { timeSec: number; x?: number; y?: number }) => void;
  onTimeChange?: (sec: number) => void;
  registerTimeGetter?: (get: () => number) => void;
  seekTo?: { timeSec: number; nonce: number };
  /** Duration known from the upload, used for markers before metadata loads. */
  durationSec?: number;
  /** Frame width / height (default 9:16). */
  aspectRatio?: number;
  fit?: "cover" | "contain";
  /** Accessible name of the video ("Reel", alt text…). */
  label?: string;
  /** Network UI drawn over the frame; pointer-events are off except on controls inside it. */
  overlay?: ReactNode;
  /** Comment pins; shown while paused at their moment. */
  pins?: VideoPlayerPin[];
  onDimensions?: (width: number, height: number) => void;
  /** Extra classes for the frame (e.g. rounded corners). */
  frameClassName?: string;
  className?: string;
}

const MARKER_TONES = {
  client: "bg-accent text-white",
  assistant: "bg-foreground text-white",
  agency: "bg-muted text-white",
} as const;

const BAND_TONES = {
  client: "bg-accent/40",
  assistant: "bg-foreground/30",
  agency: "bg-muted/40",
} as const;

const controlButton =
  "inline-flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded px-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";

function VideoPlayerInstance({
  src,
  poster,
  markers = [],
  onRequestComment,
  onTimeChange,
  registerTimeGetter,
  seekTo,
  durationSec,
  aspectRatio = 9 / 16,
  fit = "cover",
  label = "Video",
  overlay,
  pins = [],
  onDimensions,
  frameClassName = "",
  className = "",
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lastTimeRef = useRef(0);
  const scrubbingRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);

  const duration = isKnownDuration(mediaDuration)
    ? mediaDuration
    : isKnownDuration(durationSec)
      ? durationSec
      : null;
  const positioned = layoutMarkers(markers, duration);
  const progressPct = markerPercent(time, duration) ?? 0;

  // Let the parent (assistant panel, comment form) read the current time
  // on demand. Invalid browser values fall back to this clip's last time.
  useEffect(() => {
    registerTimeGetter?.(() => {
      const current = videoRef.current?.currentTime;
      return typeof current === "number" && Number.isFinite(current) ? current : lastTimeRef.current;
    });
  }, [registerTimeGetter]);

  // Jump requested from outside (a timecode chip in the comment list).
  const seekNonce = seekTo?.nonce;
  const seekTime = seekTo?.timeSec;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || seekNonce === undefined || seekTime === undefined) return;
    video.pause();
    video.currentTime = clampTime(seekTime, isKnownDuration(video.duration) ? video.duration : null);
    frameRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [seekNonce, seekTime]);

  function syncTime() {
    const video = videoRef.current;
    if (!video) return;
    lastTimeRef.current = video.currentTime;
    setTime(video.currentTime);
    onTimeChange?.(video.currentTime);
  }

  function seek(timeSec: number) {
    const video = videoRef.current;
    if (!video) return;
    const next = clampTime(timeSec, duration);
    video.currentTime = next;
    lastTimeRef.current = next;
    setTime(next);
  }

  function play() {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) video.currentTime = 0;
    video.playbackRate = slow ? 0.5 : 1;
    // play() rejects when interrupted by a pause; nothing to report.
    video.play().catch(() => {});
  }

  function pause() {
    videoRef.current?.pause();
  }

  function togglePlay() {
    if (playing) pause();
    else play();
  }

  function stepFrames(direction: 1 | -1) {
    const video = videoRef.current;
    if (!video) return;
    pause();
    seek(stepFrame(video.currentTime, direction, duration));
  }

  function toggleSpeed() {
    const next = !slow;
    setSlow(next);
    if (videoRef.current) videoRef.current.playbackRate = next ? 0.5 : 1;
  }

  function requestComment(point?: { x: number; y: number }) {
    if (!onRequestComment) return;
    pause();
    const current = videoRef.current?.currentTime ?? lastTimeRef.current;
    onRequestComment({ timeSec: roundTime(current), ...point });
  }

  function onFrameClick(event: MouseEvent<HTMLDivElement>) {
    if (failed) return;
    if (playing) {
      pause();
      return;
    }
    if (onRequestComment && frameRef.current) {
      // Keyboard "clicks" have no position: comment on the moment only.
      const point =
        event.detail === 0
          ? null
          : relativePoint(event.clientX, event.clientY, frameRef.current.getBoundingClientRect());
      requestComment(point ?? undefined);
      return;
    }
    play();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const onButton = target.tagName === "BUTTON";
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        const direction = event.key === "ArrowRight" ? 1 : -1;
        if (event.shiftKey) {
          pause();
          seek(seekBy(videoRef.current?.currentTime ?? time, direction, duration));
        } else {
          stepFrames(direction);
        }
        // Do not let a surrounding carousel change slide.
        event.preventDefault();
        event.stopPropagation();
        break;
      }
      case "Home":
      case "End":
        if (onButton) return;
        pause();
        seek(event.key === "Home" ? 0 : (duration ?? 0));
        event.preventDefault();
        break;
      case " ":
      case "k":
        // Space on a button activates that button instead.
        if (onButton) return;
        togglePlay();
        event.preventDefault();
        break;
      case "Enter":
        if (target !== frameRef.current) return;
        togglePlay();
        event.preventDefault();
        break;
    }
  }

  function seekFromPointer(clientX: number) {
    const track = trackRef.current;
    if (!track || duration === null) return;
    const rect = track.getBoundingClientRect();
    if (rect.width > 0) seek(clampUnit((clientX - rect.left) / rect.width) * duration);
  }

  function onTrackPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (duration === null) return;
    scrubbingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    pause();
    seekFromPointer(event.clientX);
  }

  function onTrackPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (scrubbingRef.current) seekFromPointer(event.clientX);
  }

  function onTrackPointerUp(event: PointerEvent<HTMLDivElement>) {
    scrubbingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const visiblePins = playing
    ? []
    : pins.filter((pin) => pin.timeSec == null || isAtTime(time, pin.timeSec, pin.timeEndSec));
  const timeText = formatTimecode(time);
  const durationText = duration !== null ? formatTimecode(duration) : "–:––";
  const frameLabel = failed
    ? `${label}: impossibile caricare il video`
    : playing
      ? `${label}: in riproduzione, tocca per mettere in pausa`
      : onRequestComment
        ? `${label}: in pausa a ${timeText}. Tocca un punto del fotogramma per commentarlo`
        : `${label}: riproduci`;
  const mobileWidth = `${Math.min(100, Math.max(0, aspectRatio * 62))}svh`;
  const playerStyle = { "--mobile-video-width": mobileWidth } as CSSProperties & {
    "--mobile-video-width": string;
  };

  return (
    <div
      className={`w-full max-[480px]:mx-auto max-[480px]:w-[clamp(16rem,var(--mobile-video-width),100%)] max-[480px]:max-w-full ${className}`}
      style={playerStyle}
      onKeyDown={onKeyDown}
    >
      <div
        className={`relative w-full overflow-hidden bg-black ${frameClassName}`}
        style={{ aspectRatio: String(aspectRatio) }}
      >
        <video
          ref={videoRef}
          src={poster ? src : withStartFragment(src)}
          poster={poster}
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          className={`absolute inset-0 h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            setMediaDuration(video.duration);
            video.playbackRate = slow ? 0.5 : 1;
            if (video.videoWidth && video.videoHeight) onDimensions?.(video.videoWidth, video.videoHeight);
          }}
          onDurationChange={(event) => setMediaDuration(event.currentTarget.duration)}
          onTimeUpdate={syncTime}
          onSeeked={syncTime}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
        />

        {/* Tap surface: pause while playing, pin on the paused frame. */}
        <div
          ref={frameRef}
          role="button"
          tabIndex={0}
          aria-label={frameLabel}
          onClick={onFrameClick}
          className={`absolute inset-0 ${!playing && onRequestComment && !failed ? "cursor-crosshair" : "cursor-pointer"}`}
        />

        {overlay ? <div className="pointer-events-none absolute inset-0">{overlay}</div> : null}

        {failed ? (
          <p className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm text-white">
            Impossibile caricare il video
          </p>
        ) : !playing ? (
          <button
            type="button"
            onClick={play}
            aria-label={`Riproduci ${label}`}
            className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white"
          >
            <PlayIcon className="ml-1 h-7 w-7" />
          </button>
        ) : null}

        {/* Pins last: visible over the play button, never catching taps. */}
        {visiblePins.map((pin, index) => (
          <span
            key={pin.id}
            title={pin.label}
            className="pointer-events-none absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-accent text-xs font-semibold text-white"
            style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
          >
            <span aria-hidden="true">{badgeText(pin.label, index)}</span>
            <span className="sr-only">Commento {pin.label}</span>
          </span>
        ))}

      </div>

      {/* Review controls (below the frame: never cover the content). */}
      <div data-no-swipe className="bg-background">
        <div className="px-6 pt-1">
          {/* Marker lane: 44px targets above the track. */}
          {positioned.length > 0 ? (
            <div className="relative h-11">
              {positioned.map((marker) => {
                const tone = marker.tone ?? "client";
                const range =
                  marker.widthPct !== null && typeof marker.timeEndSec === "number"
                    ? ` fino a ${formatTimecode(marker.timeEndSec)}`
                    : "";
                return (
                  <button
                    key={marker.id}
                    type="button"
                    onClick={() => {
                      pause();
                      seek(marker.timeSec);
                    }}
                    title={marker.label}
                    aria-label={`Commento ${marker.label}: vai a ${formatTimecode(marker.timeSec)}${range}`}
                    className="absolute top-0 flex h-11 w-11 -translate-x-1/2 cursor-pointer items-end justify-center pb-1"
                    style={{ left: `${marker.leftPct}%` }}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${MARKER_TONES[tone]}`}
                    >
                      {marker.text}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Progress track (slider). */}
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Avanzamento del video"
            aria-valuemin={0}
            aria-valuemax={duration !== null ? Math.round(duration) : 0}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${timeText} di ${durationText}`}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            onPointerCancel={onTrackPointerUp}
            className="relative flex h-8 cursor-pointer touch-none items-center"
          >
            <div className="relative h-1.5 w-full rounded-full bg-border">
              {positioned.map((marker) =>
                marker.widthPct !== null ? (
                  <span
                    key={marker.id}
                    aria-hidden="true"
                    className={`absolute inset-y-0 rounded-full ${BAND_TONES[marker.tone ?? "client"]}`}
                    style={{ left: `${marker.leftPct}%`, width: `${marker.widthPct}%` }}
                  />
                ) : null
              )}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-full bg-foreground"
                style={{ width: `${progressPct}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
                style={{ left: `${progressPct}%` }}
              />
              {positioned.map((marker) => (
                <span
                  key={marker.id}
                  aria-hidden="true"
                  className={`absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 ${MARKER_TONES[marker.tone ?? "client"]}`}
                  style={{ left: `${marker.leftPct}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 px-2 pb-1">
          <button
            type="button"
            onClick={togglePlay}
            disabled={failed}
            aria-label={playing ? "Metti in pausa" : "Riproduci"}
            className={controlButton}
          >
            {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              pause();
              seek(seekBy(videoRef.current?.currentTime ?? time, -1, duration));
            }}
            disabled={failed}
            aria-label="Indietro di 1 secondo"
            className={controlButton}
          >
            −1s
          </button>
          <span className="min-w-0 flex-1 text-center font-mono text-sm tabular-nums text-foreground">
            {timeText}
            <span className="text-muted"> / {durationText}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              pause();
              seek(seekBy(videoRef.current?.currentTime ?? time, 1, duration));
            }}
            disabled={failed}
            aria-label="Avanti di 1 secondo"
            className={controlButton}
          >
            +1s
          </button>
          <button
            type="button"
            onClick={toggleSpeed}
            disabled={failed}
            aria-pressed={slow}
            aria-label="Velocità 0,5×"
            className={`${controlButton} ${slow ? "bg-foreground text-white hover:bg-foreground" : ""}`}
          >
            0,5×
          </button>
        </div>

        {onRequestComment ? (
          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={() => requestComment()}
              disabled={failed}
              className="h-12 w-full cursor-pointer rounded bg-accent px-4 text-base font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              Commenta a {timeText}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A source change is a different review clip, so none of its playback state is reusable. */
function VideoPlayer(props: VideoPlayerProps) {
  return <VideoPlayerInstance key={props.src} {...props} />;
}

export default VideoPlayer;
export { VideoPlayer };
