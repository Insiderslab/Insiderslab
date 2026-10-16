"use client";

/**
 * «Approvato · Annulla»: the few seconds after an approval in which the client
 * can take it back (undoApprovalAction, lib/approval-undo). A status region
 * with the seconds left in plain text and a thin bar that follows the clock
 * (no CSS animation, so reduced motion changes nothing). It disappears by
 * itself; if the server refuses (too late), it says so and stays a little
 * longer. The parent shows one toast per approval (key it by the approval).
 */

import { useEffect, useRef, useState } from "react";
import { UNDO_TOAST_MS, undoToastDurationMs } from "@/lib/undo-rules";

const ERROR_VISIBLE_MS = 8_000;
const TICK_MS = 250;

export default function UndoToast({
  label = "Approvato",
  durationMs: fixedDurationMs = UNDO_TOAST_MS,
  sentAt,
  onUndo,
  onClose,
}: {
  label?: string;
  durationMs?: number;
  /**
   * When the approval request left the browser (Date.now()). The toast then
   * lasts only as long as the server still accepts «Annulla» (undoToastDurationMs):
   * a slow answer shortens it, a very slow one shows no toast.
   */
  sentAt?: number;
  /** Resolves with an Italian error message, or null when the approval was taken back. */
  onUndo: () => Promise<string | null>;
  /** The toast is over: expired, dismissed or undone. */
  onClose: () => void;
}) {
  const [durationMs] = useState(() => (sentAt === undefined ? fixedDurationMs : undoToastDurationMs(Date.now() - sentAt)));
  const [deadline] = useState(() => Date.now() + durationMs);
  const [left, setLeft] = useState(durationMs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  // No time left to undo (a very slow answer): no toast at all.
  useEffect(() => {
    if (durationMs <= 0) closeRef.current();
  }, [durationMs]);

  // The clock: based on the deadline, so a throttled background tab catches up.
  useEffect(() => {
    if (error) return;
    const timer = window.setInterval(() => {
      const remaining = deadline - Date.now();
      setLeft(Math.max(0, remaining));
      if (remaining <= 0 && !busyRef.current) closeRef.current();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [deadline, error]);

  // A refusal stays readable for a while, then goes away.
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => closeRef.current(), ERROR_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function undo() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let message: string | null;
    try {
      message = await onUndo();
    } catch {
      message = "La connessione si è interrotta. Controlla lo stato e riprova.";
    }
    busyRef.current = false;
    setBusy(false);
    if (message) setError(message);
    else closeRef.current();
  }

  const seconds = Math.ceil(left / 1000);
  const percent = durationMs > 0 ? Math.max(0, Math.min(100, Math.round((left / durationMs) * 100))) : 0;

  if (durationMs <= 0) return null;

  return (
    <div
      className="fixed inset-x-4 z-50 mx-auto w-auto max-w-[480px]"
      style={{ bottom: "calc(var(--decision-bar-h, 0px) + max(0.75rem, env(safe-area-inset-bottom)) + 4rem)" }}
      role="status"
      aria-live={error ? "assertive" : "polite"}
      aria-atomic="true"
      data-testid="undo-toast"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-overlay)]">
        {error ? (
          <div className="flex items-center justify-between gap-3 p-3">
            <p className="min-w-0 text-sm text-error" data-testid="undo-error">
              {error}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border px-4 text-base font-semibold hover:border-border-hover"
            >
              Chiudi
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-3 py-1 pl-4 pr-1">
              <p className="min-w-0 text-base font-semibold text-success" data-testid="undo-label">
                {label}
                <span className="mx-1.5 font-normal text-muted" aria-hidden="true">
                  ·
                </span>
                <span className="text-sm font-normal text-muted tabular-nums" aria-hidden="true" data-testid="undo-seconds">
                  {seconds} s
                </span>
              </p>
              <button
                type="button"
                onClick={undo}
                disabled={busy}
                className="ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-4 text-base font-semibold text-accent hover:bg-accent-soft disabled:opacity-50"
                data-testid="undo-button"
              >
                {busy ? "Annullo…" : "Annulla l'approvazione"}
              </button>
            </div>
            <div className="h-0.5 bg-surface-sunken" aria-hidden="true">
              <div className="h-full bg-success" style={{ width: `${percent}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
