"use client";

/**
 * The outcome of «Verifica installazione» in plain words: what happened
 * (title, with a word and a sign besides the colour), what to do next, and
 * «Verifica di nuovo» when something may change.
 */

import { describeVerification, type VerifyGroup } from "@/lib/website/verify-outcomes";

const GROUP_LABEL: Record<VerifyGroup, string> = {
  found: "Trovato",
  wrong: "Da correggere",
  missing: "Non trovato",
  blocked: "Sito protetto",
  unreachable: "Sito non raggiungibile",
  address: "Indirizzo da correggere",
};

const TONE_CLASS = { success: "text-success", warning: "text-warning", error: "text-error" } as const;
const TONE_SIGN = { success: "✓", warning: "!", error: "✕" } as const;

export default function VerifyResult({
  message,
  pending,
  onRetry,
}: {
  message: string | null;
  pending: boolean;
  onRetry: () => void;
}) {
  const outcome = describeVerification(message);
  if (!outcome) return null;
  const shown = outcome;
  const found = shown.group === "found";
  return (
    <div
      className="space-y-2 rounded border border-border bg-surface p-3"
      role="status"
      aria-live="polite"
      data-testid="site-verify-result"
      data-group={shown.group}
    >
      <p className={`flex items-start gap-2 text-sm font-semibold ${TONE_CLASS[shown.tone]}`}>
        <span aria-hidden="true" className="w-4 shrink-0 text-center">
          {TONE_SIGN[shown.tone]}
        </span>
        <span>
          <span className="sr-only">{GROUP_LABEL[shown.group]}: </span>
          <span data-testid="site-verify-message">{shown.title}</span>
        </span>
      </p>
      {shown.hints.length === 1 ? (
        <p className="text-sm text-muted" data-testid="site-verify-hints">
          {shown.hints[0]}
        </p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted" data-testid="site-verify-hints">
          {shown.hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}
      {!found && shown.retry && (
        <button type="button" className="btn btn-sm" disabled={pending} onClick={onRetry} data-testid="site-verify-retry">
          {pending ? "Verifico…" : "Verifica di nuovo"}
        </button>
      )}
    </div>
  );
}
