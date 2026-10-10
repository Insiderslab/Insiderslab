"use client";

import { useEffect } from "react";
import { useSpeechInput } from "./use-speech-input";

export default function DictationButton({
  value,
  onChange,
  maxLength,
  disabled = false,
  onListeningChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled?: boolean;
  onListeningChange?: (listening: boolean) => void;
  /** Icon-sized control for placement immediately beside a submit button. */
  compact?: boolean;
}) {
  const speech = useSpeechInput({ value, onChange, maxLength });

  useEffect(() => {
    onListeningChange?.(speech.listening);
  }, [onListeningChange, speech.listening]);

  if (!speech.supported) {
    return compact ? (
      <button
        type="button"
        disabled
        aria-label="Dettatura non disponibile in questo browser"
        title="Dettatura non disponibile in questo browser"
        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-background text-muted opacity-60"
      >
        <MicrophoneIcon />
      </button>
    ) : <span className="text-xs text-muted">La dettatura non è supportata da questo browser: puoi scrivere normalmente.</span>;
  }

  return (
    <div className={compact ? "relative" : "space-y-1"}>
      <button
        type="button"
        onClick={() => (speech.listening ? speech.stop() : speech.start({ continuous: true }))}
        disabled={disabled && !speech.listening}
        aria-pressed={speech.listening}
        aria-label={speech.listening ? "Ferma dettatura" : "Detta il commento"}
        title={speech.listening ? "Ferma dettatura" : "Detta il commento"}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium disabled:opacity-50 ${compact ? "w-11 p-0" : "px-3"} ${
          speech.listening ? "border-accent text-accent" : "border-border bg-background hover:border-border-hover"
        }`}
      >
        <span aria-hidden="true">{speech.listening ? <StopIcon /> : <MicrophoneIcon />}</span>
        {!compact && (speech.listening ? "Ferma dettatura" : "Detta il commento")}
      </button>
      {!compact && speech.listening && <p className="text-xs text-accent">Ti ascolto. Il testo resta modificabile prima dell’invio.</p>}
      {speech.error && (
        <p className={`${compact ? "absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-error/30 bg-surface p-2 shadow-sm" : ""} text-xs text-error`} role="alert">
          {speech.error}
        </p>
      )}
    </div>
  );
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
