"use client";

/**
 * Inline form for a new comment, under the preview so the pin ("+") or the
 * marker stays visible while the client types.
 *
 * - pin: a point tapped on an image;
 * - moment: "Commenta a 0:07" on a video (timecode editable, optional
 *   "fino a…" for a range, plus the point if the paused frame was tapped);
 * - passage: a passage selected in an article (blog), quoted above the field;
 * - general: no location.
 */

import { useEffect, useId, useRef, useState } from "react";
import DictationButton from "@/components/voice/dictation-button";
import type { BlogAnchor } from "@/lib/content/types";
import { formatTimecode } from "@/lib/domain";
import { checkMomentInput } from "./helpers";

export type CommentDraft =
  | { kind: "general" }
  | { kind: "pin"; mediaIndex: number; x: number; y: number }
  | { kind: "moment"; mediaIndex: number; timeSec: number; x?: number; y?: number }
  | { kind: "passage"; anchor: BlogAnchor };

export interface CommentSubmission {
  body: string;
  mediaIndex?: number;
  pinX?: number;
  pinY?: number;
  timeSec?: number;
  timeEndSec?: number;
  anchor?: BlogAnchor;
}

const MAX_BODY = 5000;

export default function CommentComposer({
  draft,
  mediaLabel,
  durationSec,
  onSubmit,
  onCancel,
  framed = true,
}: {
  draft: CommentDraft;
  /** "Immagine 2", "Video"… for the located drafts ("Variante B · Video" for ads). */
  mediaLabel: string | null;
  durationSec?: number;
  /** Resolves with an error message, or null when the comment was saved. */
  onSubmit: (input: CommentSubmission) => Promise<string | null>;
  onCancel: () => void;
  /** False inside a sheet that already frames it (no border, no heading). */
  framed?: boolean;
}) {
  const fieldId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [start, setStart] = useState(draft.kind === "moment" ? formatTimecode(draft.timeSec) : "");
  const [withEnd, setWithEnd] = useState(false);
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dictating, setDictating] = useState(false);

  // Bring the form into view and focus it when it opens on a new spot.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [draft]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || dictating) return;
    const text = body.trim();
    if (!text) {
      setError("Scrivi il commento prima di inviarlo.");
      return;
    }

    const input: CommentSubmission = { body: text };
    if (draft.kind === "pin") {
      input.mediaIndex = draft.mediaIndex;
      input.pinX = draft.x;
      input.pinY = draft.y;
    } else if (draft.kind === "moment") {
      const moment = checkMomentInput(start, withEnd ? end : null, durationSec);
      if ("error" in moment) {
        setError(moment.error);
        return;
      }
      input.mediaIndex = draft.mediaIndex;
      input.timeSec = moment.timeSec;
      input.timeEndSec = moment.timeEndSec;
      if (draft.x !== undefined && draft.y !== undefined) {
        input.pinX = draft.x;
        input.pinY = draft.y;
      }
    } else if (draft.kind === "passage") {
      input.anchor = draft.anchor;
    }

    setBusy(true);
    setError(null);
    const failure = await onSubmit(input);
    setBusy(false);
    if (failure) setError(failure);
  }

  const heading =
    draft.kind === "general"
      ? `Nuovo commento${mediaLabel ? ` · ${mediaLabel}` : ""}`
      : draft.kind === "pin"
        ? `Commento sul punto segnato con +${mediaLabel ? ` · ${mediaLabel}` : ""}`
        : draft.kind === "passage"
          ? "Commento sul passaggio selezionato"
          : `Commento su un momento del video${mediaLabel ? ` · ${mediaLabel}` : ""}`;

  return (
    <form
      onSubmit={submit}
      className={framed ? "space-y-3 rounded-lg border border-accent bg-surface p-4" : "space-y-3"}
      aria-label={heading}
    >
      {framed && <p className="text-sm font-semibold">{heading}</p>}

      {draft.kind === "passage" && (
        <blockquote className="max-h-32 overflow-y-auto border-l-2 border-warning pl-3 text-sm italic text-muted">
          «{draft.anchor.quote}»
        </blockquote>
      )}

      {draft.kind === "moment" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-muted">{withEnd ? "Dal momento" : "Al momento"}</span>
              <input
                value={start}
                onChange={(e) => setStart(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-describedby={`${fieldId}-hint`}
                className="h-11 w-24 rounded-md border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-accent"
              />
            </label>
            {withEnd ? (
              <label className="space-y-1">
                <span className="block text-xs text-muted">Fino a</span>
                <input
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0:12"
                  className="h-11 w-24 rounded-md border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-accent"
                />
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setWithEnd(true)}
                className="min-h-11 rounded-md border border-border bg-background px-3 text-sm hover:border-border-hover"
              >
                Fino a…
              </button>
            )}
            {withEnd && (
              <button
                type="button"
                onClick={() => {
                  setWithEnd(false);
                  setEnd("");
                }}
                className="min-h-11 px-2 text-sm text-muted underline underline-offset-2"
              >
                Solo un momento
              </button>
            )}
          </div>
          <p id={`${fieldId}-hint`} className="text-xs text-muted">
            Minuti:secondi, per esempio 0:07. Puoi correggerlo se serve.
          </p>
        </div>
      )}

      <label htmlFor={`${fieldId}-body`} className="sr-only">
        Il tuo commento
      </label>
      <textarea
        id={`${fieldId}-body`}
        ref={textRef}
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
        rows={3}
        placeholder={
          draft.kind === "pin"
            ? "Cosa vorresti cambiare in questo punto?"
            : draft.kind === "moment"
              ? "Cosa non ti convince in questo momento del video?"
              : draft.kind === "passage"
                ? "Cosa vorresti cambiare in questo passaggio?"
                : "Scrivi il tuo commento per l'agenzia"
        }
        className="w-full resize-y rounded-md border border-border bg-background p-3 text-base outline-none focus:border-accent"
      />

      <DictationButton
        value={body}
        onChange={setBody}
        maxLength={MAX_BODY}
        disabled={busy}
        onListeningChange={setDictating}
      />

      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-11 rounded-md border border-border bg-background px-4 text-sm hover:border-border-hover disabled:opacity-50"
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={busy || dictating || body.trim() === ""}
          className="min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "Invio…" : "Invia commento"}
        </button>
      </div>
    </form>
  );
}
