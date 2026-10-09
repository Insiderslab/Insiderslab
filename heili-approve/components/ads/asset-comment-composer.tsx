"use client";

/**
 * Comment on one Google Ads asset (a headline, a description, a keyword…).
 * The asset is quoted above the field and in the saved comment
 * (formatAssetComment: "[Titolo 3] «…»" on the first line), so the agency
 * reads exactly which text the client means wherever the comment shows up.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import DictationButton from "@/components/voice/dictation-button";
import { feedbackDraftKey, feedbackStorage, readFeedbackDraft, removeFeedbackDraft, writeFeedbackDraft } from "@/components/portal/feedback-draft";
import { GOOGLE_ASSET_LABELS, formatAssetComment, googleAssetName, type GoogleAssetRef } from "@/lib/content/google-ads";

const MAX_BODY = 4500;

export default function AssetCommentComposer({
  asset,
  onSubmit,
  onCancel,
  draftStorageScope,
  onDirtyChange,
  onListeningChange,
  assistantAction,
}: {
  asset: GoogleAssetRef;
  /** Receives the full comment body; resolves with an error message, or null when saved. */
  onSubmit: (body: string) => Promise<string | null>;
  onCancel: () => void;
  draftStorageScope?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onListeningChange?: (listening: boolean) => void;
  assistantAction?: ReactNode;
}) {
  const fieldId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const restoredRef = useRef(false);
  const dirtyCallbackRef = useRef(onDirtyChange);
  const storageKey = draftStorageScope ? feedbackDraftKey(draftStorageScope, { kind: "general" }) : null;

  useEffect(() => {
    dirtyCallbackRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    if (!storageKey) return;
    const timer = window.setTimeout(() => {
      restoredRef.current = true;
      const storage = feedbackStorage(window);
      const stored = storage ? readFeedbackDraft(storage, storageKey) : null;
      if (!stored) return;
      setBody(stored.body);
      dirtyCallbackRef.current?.(stored.body.trim() !== "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !restoredRef.current) return;
    if (!body) {
      const storage = feedbackStorage(window);
      if (storage) removeFeedbackDraft(storage, storageKey);
      return;
    }
    const storage = feedbackStorage(window);
    if (storage) writeFeedbackDraft(storage, storageKey, { body, start: "", end: "", withEnd: false });
  }, [body, storageKey]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [asset]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || dictating) return;
    const text = body.trim();
    if (!text) {
      setError("Scrivi il commento prima di inviarlo.");
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSubmit(formatAssetComment(asset, text));
    setBusy(false);
    if (failure) setError(failure);
    else {
      dirtyCallbackRef.current?.(false);
      const storage = feedbackStorage(window);
      if (storageKey && storage) removeFeedbackDraft(storage, storageKey);
    }
  }

  function cancel() {
    dirtyCallbackRef.current?.(false);
    const storage = feedbackStorage(window);
    if (storageKey && storage) removeFeedbackDraft(storage, storageKey);
    onCancel();
  }

  const title = GOOGLE_ASSET_LABELS[asset.kind].verb;
  return (
    <form
      onSubmit={submit}
      data-feedback-composer="active"
      className="space-y-3 rounded-lg border border-accent bg-surface p-3"
      aria-label={title}
    >
      <p className="text-sm font-semibold">{title}</p>
      <blockquote className="border-l-2 border-accent pl-3 text-sm">
        <span className="block text-xs text-muted">{googleAssetName(asset)}</span>
        <span className="break-words">«{asset.text}»</span>
      </blockquote>
      <label htmlFor={fieldId} className="sr-only">
        Il tuo commento
      </label>
      <div className="rounded-xl border border-border bg-background focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10">
        <textarea
          id={fieldId}
          ref={textRef}
          value={body}
          onChange={(e) => {
            const value = e.target.value.slice(0, MAX_BODY);
            setBody(value);
            dirtyCallbackRef.current?.(value.trim() !== "");
          }}
          rows={3}
          placeholder="Cosa cambieresti? Per esempio: troppo generico, direi «Prima settimana gratis»."
          className="min-h-24 w-full resize-y border-0 bg-transparent p-3 text-base outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            {assistantAction}
            <span className="text-xs text-muted">
              {dictating ? "Ti ascolto…" : body.trim() ? "Bozza sul dispositivo · non inviata" : "Scrivi o detta"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <DictationButton
              value={body}
              onChange={(value) => {
                setBody(value);
                dirtyCallbackRef.current?.(value.trim() !== "");
              }}
              maxLength={MAX_BODY}
              disabled={busy}
              onListeningChange={(listening) => {
                setDictating(listening);
                onListeningChange?.(listening);
                dirtyCallbackRef.current?.(listening || body.trim() !== "");
              }}
              compact
            />
            <button
              type="submit"
              disabled={busy || dictating || !body.trim()}
              aria-label={busy ? "Invio del commento" : "Invia commento"}
              title="Invia commento"
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-xl font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn" disabled={busy} onClick={cancel}>
          Annulla
        </button>
      </div>
    </form>
  );
}
