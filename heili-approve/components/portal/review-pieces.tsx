"use client";

/**
 * Building blocks shared by the portal's review pages (social post, blog
 * article, ads set): the navigation line, the "updated in the meantime"
 * banner, the outcome panel, the assistant toggle, the sticky decision bar
 * and the bottom-sheet buttons. Plain props, no data fetching.
 */

import Link from "next/link";
import type { ReactNode, RefObject } from "react";
import type { PortalQueue } from "./types";
import type { PortalWording } from "./helpers";

/** Clearly labelled controls and progress for the review queue. */
export function ReviewNav({
  homeHref,
  nextHref,
  queue,
  wording,
  showProgress,
}: {
  homeHref: string;
  nextHref: string | null;
  queue: PortalQueue;
  wording: PortalWording;
  /** False once the client decided (the success panel takes over). */
  showProgress: boolean;
}) {
  const progressLabel =
    queue.position !== null ? wording.position(queue.position, queue.toReviewCount) : null;
  const backLabel = wording.backLabel.replace(/^←\s*/, "");
  const nextLabel = wording.nextLabel.replace(/\s*→$/, "");

  return (
    <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm" aria-label="Navigazione della revisione">
      <Link
        href={homeHref}
        aria-label={backLabel}
        className="inline-flex min-h-11 min-w-0 items-center justify-start justify-self-start rounded-md border border-border bg-surface px-3 font-medium text-foreground hover:border-border-hover"
      >
        <span className="sm:hidden">Elenco</span>
        <span className="hidden truncate sm:inline">{backLabel}</span>
      </Link>
      {progressLabel && showProgress && (
        <span className="text-center text-muted" aria-label={progressLabel}>
          <span className="tabular-nums sm:hidden" aria-hidden="true">
            {queue.position}/{queue.toReviewCount}
          </span>
          <span className="hidden sm:inline">{progressLabel}</span>
        </span>
      )}
      {nextHref && showProgress && (
        <Link
          href={nextHref}
          aria-label={nextLabel}
          className="inline-flex min-h-11 min-w-0 items-center justify-end justify-self-end rounded-md bg-accent px-3 text-right font-semibold text-white hover:bg-accent-hover"
        >
          <span className="sm:hidden">Successivo</span>
          <span className="hidden truncate sm:inline">{nextLabel}</span>
        </Link>
      )}
    </nav>
  );
}

/** The agency sent a newer version while the client was on the page. */
export function StaleBanner({ text, onReload }: { text: string; onReload: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-surface p-3 text-sm"
      role="alert"
    >
      <span>{text}</span>
      <button type="button" onClick={onReload} className="min-h-11 rounded-md bg-foreground px-4 font-medium text-background">
        Mostra la versione aggiornata
      </button>
    </div>
  );
}

/** After a decision: what happens next, then the next item to review. */
export function SuccessPanel({
  title,
  children,
  nextHref,
  homeHref,
  remaining,
  wording,
}: {
  title: string;
  children?: ReactNode;
  nextHref: string | null;
  homeHref: string;
  /** Items still waiting for the client, the current one excluded. */
  remaining: number;
  wording: PortalWording;
}) {
  return (
    <section className="space-y-4 rounded-lg border-2 border-success bg-surface p-5" role="status" aria-live="polite">
      <div className="space-y-1">
        <p className="text-lg font-semibold text-success">{title}</p>
        {children}
      </div>
      {nextHref ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">{wording.remaining(remaining)}</p>
          <Link
            href={nextHref}
            className="flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover"
          >
            {wording.nextLabel}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted">{wording.allDone}</p>
      )}
      <Link href={homeHref} className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-2">
        {wording.homeLabel}
      </Link>
    </section>
  );
}

/** The big "Non sei sicuro? Parlane con l'assistente" toggle and the panel under it. */
export function AssistantToggle({
  open,
  onToggle,
  containerRef,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  /** The panel, rendered while open. */
  children: ReactNode;
}) {
  return (
    <div ref={containerRef} className="scroll-mt-4 space-y-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg border-2 border-accent bg-background p-4 text-left hover:bg-surface"
      >
        <span className="space-y-0.5">
          <span className="block text-base font-semibold text-accent">
            {open ? "Chiudi l'assistente" : "Non sei sicuro? Parlane con l'assistente"}
          </span>
          <span className="block text-sm text-muted">
            Ti aiuta a capire cosa cambiare, anche a voce. La decisione resta sempre tua.
          </span>
        </span>
        <span aria-hidden="true" className="text-xl text-accent">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && children}
    </div>
  );
}

/** Sticky bar at the bottom of the screen with the page's decision buttons. */
export function DecisionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-40 -mx-4 border-t border-border bg-background px-4 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  );
}

export function SheetError({ error, stale, onReload }: { error: string | null; stale: boolean; onReload: () => void }) {
  if (!error) return null;
  return (
    <div className="space-y-2" role="alert">
      <p className="text-sm text-error">{error}</p>
      {stale && (
        <button type="button" onClick={onReload} className="text-sm font-medium underline underline-offset-2">
          Ricarica la pagina
        </button>
      )}
    </div>
  );
}

export function SheetButtons({
  busy,
  disabled = false,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmClass,
}: {
  busy: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmClass: string;
}) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || disabled}
        className={`min-h-12 w-full rounded-lg px-4 text-base font-semibold disabled:opacity-50 ${confirmClass}`}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="min-h-12 w-full rounded-lg border border-border px-4 text-base hover:border-border-hover disabled:opacity-50"
      >
        Annulla
      </button>
    </div>
  );
}
