"use client";

/**
 * Video Cover Picker
 *
 * Choose the Reel / TikTok / YouTube cover as a frame of the video: move the
 * player to the frame, then "Usa questo fotogramma". The choice is stored as
 * milliseconds (PostVersion.videoCoverMs) and sent to Metricool as
 * videoCoverMilliseconds.
 */

import { useRef, useState } from "react";
import { VideoPlayer } from "@/components/post-preview";
import { formatTimecode, type MediaItem } from "@/lib/domain";

interface VideoCoverPickerProps {
  video: MediaItem;
  coverMs: number | null;
  onChange: (coverMs: number | null) => void;
  disabled?: boolean;
}

export default function VideoCoverPicker({ video, coverMs, onChange, disabled = false }: VideoCoverPickerProps) {
  const getTimeRef = useRef<() => number>(() => 0);
  const [seek, setSeek] = useState<{ timeSec: number; nonce: number } | undefined>(undefined);

  const coverSec = coverMs !== null ? coverMs / 1000 : null;
  const markers =
    coverSec !== null ? [{ id: "cover", timeSec: coverSec, label: "C", tone: "agency" as const }] : [];

  function applyCurrentFrame() {
    const sec = getTimeRef.current();
    onChange(Math.max(0, Math.round(sec * 1000)));
  }

  return (
    <div className="space-y-3">
      <div className="mx-auto max-w-[240px]">
        <VideoPlayer
          src={video.url}
          poster={video.posterUrl}
          durationSec={video.durationSec}
          markers={markers}
          seekTo={seek}
          registerTimeGetter={(get) => {
            getTimeRef.current = get;
          }}
          label="Scelta della copertina"
          fit="contain"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={applyCurrentFrame}
          className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-border-hover disabled:opacity-50"
        >
          Usa questo fotogramma
        </button>
        {coverSec !== null && (
          <>
            <button
              type="button"
              onClick={() => setSeek((previous) => ({ timeSec: coverSec, nonce: (previous?.nonce ?? 0) + 1 }))}
              className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-accent hover:border-border-hover"
            >
              Copertina a {formatTimecode(coverSec)}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(null)}
              className="text-xs text-muted hover:text-foreground disabled:opacity-50"
            >
              Rimuovi copertina
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-muted">
        {coverSec === null
          ? "Nessuna copertina scelta: la rete userà il primo fotogramma."
          : "La copertina è parte del contenuto approvato: se la cambi, il cliente vede una nuova versione."}
      </p>
    </div>
  );
}
