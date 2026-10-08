"use client";

import { useEffect } from "react";
import { useSpeechInput } from "./use-speech-input";

export default function DictationButton({
  value,
  onChange,
  maxLength,
  disabled = false,
  onListeningChange,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled?: boolean;
  onListeningChange?: (listening: boolean) => void;
}) {
  const speech = useSpeechInput({ value, onChange, maxLength });

  useEffect(() => {
    onListeningChange?.(speech.listening);
  }, [onListeningChange, speech.listening]);

  if (!speech.supported) {
    return <span className="text-xs text-muted">La dettatura non è supportata da questo browser: puoi scrivere normalmente.</span>;
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => (speech.listening ? speech.stop() : speech.start({ continuous: true }))}
        disabled={disabled && !speech.listening}
        aria-pressed={speech.listening}
        className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium disabled:opacity-50 ${
          speech.listening ? "border-accent text-accent" : "border-border bg-background hover:border-border-hover"
        }`}
      >
        <span aria-hidden="true">🎙</span>
        {speech.listening ? "Ferma dettatura" : "Detta il commento"}
      </button>
      {speech.listening && <p className="text-xs text-accent">Ti ascolto. Il testo resta modificabile prima dell’invio.</p>}
      {speech.error && (
        <p className="text-xs text-error" role="alert">
          {speech.error}
        </p>
      )}
    </div>
  );
}
