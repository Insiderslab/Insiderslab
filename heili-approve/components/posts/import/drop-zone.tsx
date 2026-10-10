"use client";

/**
 * Drop zone of "Importa post": the sheet and the pictures/videos can be
 * dropped (or picked) together or one after the other. Files only, no folders.
 */

import { useId, useRef, useState, type DragEvent } from "react";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  title: string;
  hint: string;
  accept: string;
  disabled?: boolean;
  /** Smaller, for the "add pictures" strip once the rows are on screen. */
  compact?: boolean;
  testId?: string;
}

export default function DropZone({ onFiles, title, hint, accept, disabled = false, compact = false, testId }: DropZoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);

  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event) || disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setActive(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setActive(false);
    if (!disabled) onFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
      data-testid={testId}
      className={`rounded-2xl border border-dashed text-center transition-colors ${compact ? "p-4" : "p-6 sm:p-8"} ${
        active ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-hover"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <p className={`font-semibold ${compact ? "text-sm" : "text-base"}`}>{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted">{hint}</p>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        className="sr-only"
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          // The same file can be picked again after a change.
          event.target.value = "";
        }}
      />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="btn mt-3">
        Scegli dal computer
      </button>
    </div>
  );
}
