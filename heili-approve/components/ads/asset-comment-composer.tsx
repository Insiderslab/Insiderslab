"use client";

/**
 * Comment on one Google Ads asset (a headline, a description, a keyword…).
 * The asset is quoted above the field and in the saved comment
 * (formatAssetComment: "[Titolo 3] «…»" on the first line), so the agency
 * reads exactly which text the client means wherever the comment shows up.
 */

import { useEffect, useId, useRef, useState } from "react";
import DictationButton from "@/components/voice/dictation-button";
import { GOOGLE_ASSET_LABELS, formatAssetComment, googleAssetName, type GoogleAssetRef } from "@/lib/content/google-ads";

const MAX_BODY = 4500;

export default function AssetCommentComposer({
  asset,
  onSubmit,
  onCancel,
}: {
  asset: GoogleAssetRef;
  /** Receives the full comment body; resolves with an error message, or null when saved. */
  onSubmit: (body: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);

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
  }

  const title = GOOGLE_ASSET_LABELS[asset.kind].verb;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-accent bg-surface p-3" aria-label={title}>
      <p className="text-sm font-semibold">{title}</p>
      <blockquote className="border-l-2 border-accent pl-3 text-sm">
        <span className="block text-xs text-muted">{googleAssetName(asset)}</span>
        <span className="break-words">«{asset.text}»</span>
      </blockquote>
      <label htmlFor={fieldId} className="sr-only">
        Il tuo commento
      </label>
      <textarea
        id={fieldId}
        ref={textRef}
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
        rows={3}
        placeholder="Cosa cambieresti? Per esempio: troppo generico, direi «Prima settimana gratis»."
        className="field resize-y text-base"
      />
      <DictationButton
        value={body}
        onChange={setBody}
        maxLength={MAX_BODY}
        disabled={busy}
        onListeningChange={setDictating}
      />
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || dictating || !body.trim()}>
          {busy ? "Invio…" : "Invia commento"}
        </button>
      </div>
    </form>
  );
}
