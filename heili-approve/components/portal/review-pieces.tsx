"use client";

/**
 * Building blocks shared by the portal's review pages (social post, blog
 * article, ads set): the navigation line, the "updated in the meantime"
 * banner, the outcome panel, the assistant toggle, the sticky decision bar
 * and the bottom-sheet buttons. Plain props, no data fetching.
 */

import Link from "next/link";
import type { ReactNode, RefObject } from "react";
import HeiliAssistantIcon from "@/components/heili-assistant-icon";
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

/** Compact assistant action, kept beside the other feedback tools. */
export function AssistantToggle({
  open,
  mounted = open,
  showButton = true,
  onToggle,
  containerRef,
  children,
}: {
  open: boolean;
  /** Keep local feedback while the panel is collapsed, after its first opening. */
  mounted?: boolean;
  /** The compact trigger can live inside the manual composer action row. */
  showButton?: boolean;
  onToggle: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  /** The panel, rendered while open. */
  children: ReactNode;
}) {
  return (
    <div ref={containerRef} className="scroll-mt-4 space-y-3">
      {showButton && <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Chiudi Heili" : "Parla con Heili"}
        className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${open ? "border-accent bg-accent/5" : "border-border bg-background hover:border-accent"}`}
      >
        <HeiliAssistantIcon className="h-7 w-7" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{open ? "Torna al commento manuale" : "Parla con Heili"}</span>
          <span className="block truncate text-xs text-muted">Conversazione guidata, anche a voce</span>
        </span>
        <span className="ml-auto text-lg text-muted" aria-hidden="true">{open ? "←" : "→"}</span>
      </button>}
      {mounted && <div hidden={!open}>{children}</div>}
    </div>
  );
}

/** Compact conversational action shown inside the manual feedback composer. */
export function AssistantActionButton({ onToggle }: { onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Parla con Heili"
      className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-accent/5"
    >
      <HeiliAssistantIcon className="h-6 w-6" />
      <span className="truncate">Parla con Heili</span>
    </button>
  );
}

/**
 * Subtitle of "Cosa ne pensi?". Heili works only while the version waits for a
 * decision: after "Chiedi modifiche" the client can still write or dictate, and
 * Heili comes back with the agency's new version.
 */
export function feedbackHint(canAct: boolean, assistantEnabled: boolean): string {
  if (!assistantEnabled) return "Scrivilo oppure dettalo.";
  if (canAct) return "Scrivilo, dettalo oppure parlane con Heili.";
  return "Scrivilo oppure dettalo. Heili torna disponibile quando l'agenzia invia la nuova versione.";
}

/** Sticky bar at the bottom of the screen with the page's decision buttons. */
export function DecisionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-40 -mx-4 border-t border-border bg-background/95 px-4 pt-3 backdrop-blur"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  );
}

/** Why the saved-feedback decision cannot run yet. */
export function savedFeedbackBlocker(hasUnsavedDraft: boolean, savedCommentCount: number): string | null {
  if (hasUnsavedDraft) {
    return "Hai un commento ancora da inviare. Premi «Invia commento» oppure annullalo prima di chiedere le modifiche.";
  }
  if (savedCommentCount < 1) {
    return "Non hai ancora indicato modifiche. Aggiungi e invia almeno un commento prima di continuare.";
  }
  return null;
}

export const UNSAVED_COMMENT_MESSAGE = "Hai un commento ancora da inviare. Invia il commento oppure annullalo prima di concludere la revisione.";

/** Every reviewer's current feedback matters before an explicit override. */
export function OpenFeedbackNotice({ comments, ads = false }: {
  comments: Array<{ authorType: string; authorName: string; resolved: boolean; fromVersion?: number | null }>;
  ads?: boolean;
}) {
  const open = comments.filter((comment) => comment.authorType === "CLIENT" && !comment.resolved && comment.fromVersion == null);
  if (!open.length) return null;
  const authors = [...new Set(open.map((comment) => comment.authorName))].join(", ");
  return <p className="text-sm text-warning">
    {open.length === 1 ? "C’è 1 commento aperto" : `Ci sono ${open.length} commenti aperti`} di {authors} su questa versione.
    {ads ? " Confermando invii le decisioni sulle varianti." : " Se approvi, il contenuto viene approvato così com’è."}
    {" Per richiedere interventi sui commenti, scegli «Chiedi modifiche»."}
  </p>;
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
