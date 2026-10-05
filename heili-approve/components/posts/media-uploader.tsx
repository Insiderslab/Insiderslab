"use client";

/**
 * Media Uploader
 *
 * Drag & drop (or pick) images and videos, upload them with a progress bar,
 * reorder (drag, or the arrow buttons on touch screens), remove, and edit the
 * alternative text. Files upload one at a time in drop order, so the media
 * end up in the order the agency chose them.
 */

import { useRef, useState, type DragEvent } from "react";
import { formatTimecode, type MediaItem } from "@/lib/domain";
import { formatBytes, moveItem } from "./helpers";
import { ACCEPTED_MEDIA, MAX_UPLOAD_MB, readVideoDuration, uploadMedia } from "./upload";

/** Same cap as lib/posts (MAX_MEDIA_PER_POST). */
const MAX_MEDIA = 20;

interface PendingUpload {
  id: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  controller: AbortController | null;
}

interface MediaUploaderProps {
  media: MediaItem[];
  onChange: (update: (current: MediaItem[]) => MediaItem[]) => void;
  /** True while at least one file is uploading (the editor blocks saving). */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

const smallButton =
  "inline-flex h-8 min-w-8 items-center justify-center rounded border border-border bg-background px-2 text-xs text-muted hover:text-foreground disabled:opacity-40";

export default function MediaUploader({ media, onChange, onBusyChange, disabled = false }: MediaUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const uploading = pending.some((p) => p.error === null);

  function patchPending(id: string, patch: Partial<PendingUpload>) {
    setPending((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || disabled) return;
    setNotice(null);

    const room = MAX_MEDIA - media.length - pending.filter((p) => p.error === null).length;
    const accepted = files.slice(0, Math.max(0, room));
    if (accepted.length < files.length) {
      setNotice(`Puoi caricare al massimo ${MAX_MEDIA} media per post.`);
    }
    if (accepted.length === 0) return;

    const entries: Array<{ file: File; item: PendingUpload }> = accepted.map((file, i) => ({
      file,
      item: {
        id: `${Date.now()}-${i}-${file.name}`,
        name: file.name,
        size: file.size,
        progress: 0,
        error: null,
        controller: new AbortController(),
      },
    }));
    setPending((list) => [...list, ...entries.map((e) => e.item)]);
    onBusyChange?.(true);

    for (const { file, item } of entries) {
      if (item.controller?.signal.aborted) continue;
      try {
        const durationSec = await readVideoDuration(file);
        const uploaded = await uploadMedia(file, {
          durationSec,
          signal: item.controller?.signal,
          onProgress: (fraction) => patchPending(item.id, { progress: fraction }),
        });
        onChange((current) => [...current, uploaded]);
        setPending((list) => list.filter((p) => p.id !== item.id));
      } catch (error) {
        if (item.controller?.signal.aborted) {
          setPending((list) => list.filter((p) => p.id !== item.id));
        } else {
          patchPending(item.id, {
            error: error instanceof Error ? error.message : "Caricamento non riuscito.",
            controller: null,
          });
        }
      }
    }
    onBusyChange?.(false);
  }

  function cancelUpload(upload: PendingUpload) {
    if (upload.controller) upload.controller.abort();
    else setPending((list) => list.filter((p) => p.id !== upload.id));
  }

  function remove(index: number) {
    onChange((current) => current.filter((_, i) => i !== index));
  }

  function move(from: number, to: number) {
    onChange((current) => moveItem(current, from, to));
  }

  function setAlt(index: number, alt: string) {
    onChange((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item };
        if (alt.trim()) next.alt = alt;
        else delete next.alt;
        return next;
      })
    );
  }

  function isFileDrag(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  // ── Drop zone (files from the computer) ──
  function onZoneDragOver(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event) || disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }

  function onZoneDrop(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setDropActive(false);
    void addFiles(event.dataTransfer.files);
  }

  // ── Reorder (drag between thumbnails) ──
  function onItemDragStart(event: DragEvent<HTMLElement>, index: number) {
    dragIndexRef.current = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function onItemDragOver(event: DragEvent<HTMLLIElement>, index: number) {
    if (dragIndexRef.current === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setOverIndex(index);
  }

  function onItemDrop(event: DragEvent<HTMLLIElement>, index: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setOverIndex(null);
    if (from === null) return;
    event.preventDefault();
    event.stopPropagation();
    move(from, index);
  }

  function onItemDragEnd() {
    dragIndexRef.current = null;
    setOverIndex(null);
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={onZoneDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={onZoneDrop}
        className={`rounded border border-dashed p-4 text-center text-sm transition-colors ${
          dropActive ? "border-accent bg-accent/5" : "border-border bg-background"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <p className="text-muted">
          Trascina qui immagini o video, oppure{" "}
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="font-medium text-accent hover:underline disabled:no-underline"
          >
            scegli dal computer
          </button>
        </p>
        <p className="mt-1 text-xs text-muted">
          JPG, PNG, WebP, GIF, MP4, MOV, WebM · fino a {MAX_UPLOAD_MB} MB per file · massimo {MAX_MEDIA} media
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MEDIA}
          multiple
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            event.target.value = "";
            void addFiles(files);
          }}
        />
      </div>

      {notice && <p className="text-xs text-warning">{notice}</p>}

      {pending.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {pending.map((upload) => (
            <li key={upload.id} className="rounded border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-foreground">{upload.name}</span>
                <span className="shrink-0 text-muted">{formatBytes(upload.size)}</span>
              </div>
              {upload.error ? (
                <p className="mt-1 text-xs text-error">{upload.error}</p>
              ) : (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded bg-surface-hover"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(upload.progress * 100)}
                  aria-label={`Caricamento di ${upload.name}`}
                >
                  <div className="h-full bg-accent" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <button type="button" onClick={() => cancelUpload(upload)} className="text-xs text-muted hover:text-foreground">
                  {upload.error ? "Chiudi" : "Annulla"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {media.length > 0 && (
        <ol className="space-y-2">
          {media.map((item, index) => (
            <li
              key={item.url}
              onDragOver={(event) => onItemDragOver(event, index)}
              onDrop={(event) => onItemDrop(event, index)}
              onDragEnd={onItemDragEnd}
              className={`flex gap-3 rounded border bg-background p-2 ${
                overIndex === index ? "border-accent" : "border-border"
              }`}
            >
              {/* The thumbnail is the drag handle, so selecting the alt text never starts a drag. */}
              <div
                draggable={!disabled}
                onDragStart={(event) => onItemDragStart(event, index)}
                onDragEnd={onItemDragEnd}
                title="Trascina per riordinare"
                className="relative h-20 w-20 shrink-0 cursor-grab overflow-hidden rounded bg-surface-hover"
              >
                {item.type === "video" ? (
                  <video
                    src={`${item.url}#t=0.5`}
                    poster={item.posterUrl}
                    preload="metadata"
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- uploaded media, arbitrary sizes
                  <img src={item.url} alt={item.alt ?? ""} className="h-full w-full object-cover" />
                )}
                <span className="absolute left-1 top-1 rounded bg-foreground/80 px-1.5 text-[11px] font-medium text-white">
                  {index + 1}
                </span>
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-muted">
                  {item.type === "video" ? "Video" : "Immagine"}
                  {item.type === "video" && item.durationSec ? ` · ${formatTimecode(item.durationSec)}` : ""}
                </p>
                <input
                  type="text"
                  value={item.alt ?? ""}
                  onChange={(event) => setAlt(index, event.target.value)}
                  disabled={disabled}
                  maxLength={1000}
                  placeholder="Testo alternativo (facoltativo)"
                  aria-label={`Testo alternativo del media ${index + 1}`}
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-accent/40"
                />
              </div>

              <div className="flex shrink-0 flex-col items-end justify-between gap-1">
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={smallButton}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, index - 1)}
                    aria-label={`Sposta il media ${index + 1} prima`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={disabled || index === media.length - 1}
                    onClick={() => move(index, index + 1)}
                    aria-label={`Sposta il media ${index + 1} dopo`}
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(index)}
                  className="text-xs text-error hover:underline disabled:opacity-40"
                >
                  Rimuovi
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {uploading && <p className="text-xs text-muted">Caricamento in corso: attendi prima di salvare.</p>}
    </div>
  );
}
