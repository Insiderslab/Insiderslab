"use client";

/**
 * Client portal — "Sfoglia", the fast review of a month.
 *
 * One card per post, in calendar order: the real preview (the same
 * components as the post review), date, networks and two big buttons.
 * "Approva" approves THAT post at the version shown (approvePostAction, the
 * single-post rules: version binding, transitions, Metricool scheduling);
 * "Commenta" opens the post's own review page, where the Studio feedback
 * lives, with a way back to this card. After an approval the next post still
 * waiting comes up. A progress bar ("8 di 12 approvati") stays on screen and
 * the last step is a summary with "Approva i rimanenti" (the plan's
 * approve-all, or the month's own, with the same exclusions) and the way back.
 *
 * Swipe left / right, the arrows on the screen and ← → on a keyboard move
 * between cards; nothing is decided by moving. Motion is off for people who
 * asked for less (globals.css).
 */

import Link from "next/link";
import HeiliAssistantIcon from "@/components/heili-assistant-icon";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { approveMonthAction, approvePlanAction, approvePostAction } from "@/app/review/[token]/actions";
import { PlanProgressBar } from "@/components/plans/plan-bits";
import { NetworkPreviewTabs } from "@/components/post-preview";
import BottomSheet from "@/components/portal/bottom-sheet";
import { portalStatusLabel } from "@/components/portal/helpers";
import { DecisionBar, SheetButtons, SheetError } from "@/components/portal/review-pieces";
import {
  browseProgress,
  browseState,
  browseSummary,
  browseSummaryText,
  nextBrowseIndex,
  postLinkQuery,
  progressLabel,
  startBrowseIndex,
  stepBrowseIndex,
  withApproved,
  type BrowseItem,
  type BrowseState,
} from "@/lib/month-rules";
import { SKIP_REASON_LABELS, selectApproveAll, type ApproveAllSkipReason } from "@/lib/plan-rules";
import type { BrowsePost, BrowseScope } from "./types";

const CHIP: Record<BrowseState, { className: string; label: (post: BrowsePost) => string }> = {
  waiting: { className: "chip chip-brand", label: () => "Da approvare" },
  feedback: { className: "chip chip-stale", label: () => "Hai lasciato commenti" },
  changes: { className: "chip chip-stale", label: () => "Modifiche richieste" },
  approved: { className: "chip chip-fresh", label: (post) => portalStatusLabel("SOCIAL_POST", post.status) },
  locked: { className: "chip chip-offline", label: () => "In aggiornamento" },
};

/** Where a swipe must not move the card: things that scroll or slide on their own. */
const OWN_GESTURE = '[data-no-swipe], [aria-roledescription="carosello"], [role="tablist"], [role="slider"], video, input, textarea, select';
const SWIPE_MIN_PX = 60;

function postsWord(n: number): string {
  return n === 1 ? "1 post" : `${n} post`;
}

type Outcome = { approved: number; skipped: Array<{ id: string; title: string; reason: ApproveAllSkipReason }> };

export default function Browse({
  token,
  scope,
  posts,
  backHref,
  backLabel,
  startPosition,
  autoSchedule,
  clientName,
  logoUrl,
  timeZone,
  assistantEnabled = false,
}: {
  token: string;
  scope: BrowseScope;
  /** In calendar order. */
  posts: BrowsePost[];
  /** The page Sfoglia came from ("Torna al piano" / "Torna ai post"). */
  backHref: string;
  backLabel: string;
  /** 1-based position from `?i=`; null = the first post still waiting. */
  startPosition: number | null;
  autoSchedule: boolean;
  clientName: string;
  logoUrl: string | null;
  timeZone: string;
  /** Heili is on: "Parla con Heili" opens the post with the assistant already open. */
  assistantEnabled?: boolean;
}) {
  const router = useRouter();
  const regionRef = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  const moved = useRef(false);

  const [approvedIds, setApprovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [index, setIndex] = useState(() => startBrowseIndex(posts.map(toItem), startPosition));
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const items = useMemo(() => withApproved(posts.map(toItem), approvedIds), [posts, approvedIds]);
  const total = posts.length;
  const current = Math.min(index, total);
  const atSummary = current >= total;
  const progress = browseProgress(items);
  const summary = browseSummary(items);
  const selection = selectApproveAll(
    items.map((item, i) => ({
      id: item.id,
      title: posts[i].title,
      status: item.status,
      versionNumber: posts[i].versionNumber,
      canAct: item.canAct,
      openClientComments: item.openComments,
    }))
  );
  const toApprove = selection.approve.length;
  const month = scope.kind === "month" ? scope.month : null;

  const goTo = useCallback((next: number, dir: "next" | "prev") => {
    setDirection(dir);
    setIndex(next);
    setError(null);
    setStale(false);
    moved.current = true;
  }, []);

  const step = useCallback(
    (delta: 1 | -1) => {
      if (busy) return;
      const next = stepBrowseIndex(current, delta, total);
      if (next !== current) goTo(next, delta === 1 ? "next" : "prev");
    },
    [busy, current, total, goTo]
  );

  // The URL follows the card (reload and "back from the post" land on it). Also
  // after the page data is refreshed (a server action refreshes the route,
  // which restores the URL it was loaded with).
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("vista", "sfoglia");
      url.searchParams.set("i", String(current + 1));
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The URL is a convenience only.
    }
  }, [current, posts]);

  // After a move: back to the top of the card and the heading announced.
  useEffect(() => {
    if (!moved.current) return;
    regionRef.current?.scrollIntoView({ block: "start" });
    regionRef.current?.querySelector<HTMLElement>("[data-focus-target]")?.focus({ preventScroll: true });
  }, [current]);

  // ← → on a keyboard (unless something on the card uses the arrows itself).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (sheetOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(`${OWN_GESTURE}, [contenteditable="true"], dialog`)) return;
      event.preventDefault();
      step(event.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, sheetOpen]);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    const point = event.touches[0];
    if (!point || event.touches.length > 1) {
      touch.current = null;
      return;
    }
    touch.current = { x: point.clientX, y: point.clientY, ignore: Boolean((event.target as HTMLElement).closest(OWN_GESTURE)) };
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touch.current;
    const point = event.changedTouches[0];
    touch.current = null;
    if (!start || start.ignore || !point) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }

  function commentHref(post: BrowsePost): string {
    return `${post.href}${postLinkQuery("sfoglia", { position: current + 1, month })}`;
  }

  async function approve() {
    if (busy || atSummary) return;
    const post = posts[current];
    if (browseState(items[current]) !== "waiting") return;
    setBusy(true);
    setError(null);
    try {
      const result = await approvePostAction(token, { postId: post.id, versionNumber: post.versionNumber });
      if (!result.ok) {
        setError(result.error);
        if (result.stale) setStale(true);
        return;
      }
      const nextApproved = new Set(approvedIds).add(post.id);
      setApprovedIds(nextApproved);
      setAnnounce(`Approvato: ${post.title}`);
      goTo(nextBrowseIndex(withApproved(posts.map(toItem), nextApproved), current), "next");
    } catch {
      setError("La connessione si è interrotta. Controlla lo stato del post e riprova.");
    } finally {
      setBusy(false);
    }
  }

  async function approveRemaining() {
    if (sheetBusy) return;
    setSheetBusy(true);
    setSheetError(null);
    const shown = posts.map((p) => ({ postId: p.id, versionNumber: p.versionNumber }));
    try {
      const result =
        scope.kind === "plan"
          ? await approvePlanAction(token, { planId: scope.planId, posts: shown })
          : await approveMonthAction(token, { posts: shown });
      if (!result.ok) {
        setSheetError(result.error);
        if (result.stale) setStale(true);
        return;
      }
      setApprovedIds((previous) => new Set([...previous, ...result.data.approved]));
      setOutcome({ approved: result.data.approved.length, skipped: result.data.skipped });
      setSheetOpen(false);
      setAnnounce(`${postsWord(result.data.approved.length)} approvati`);
    } catch {
      setSheetError("La connessione si è interrotta. Controlla lo stato dei post e riprova.");
    } finally {
      setSheetBusy(false);
    }
  }

  const post = atSummary ? null : posts[current];
  const state = post ? browseState(items[current]) : null;

  return (
    <section
      ref={regionRef}
      className="mx-auto w-full max-w-[480px] scroll-mt-2 space-y-4"
      aria-roledescription="revisione veloce"
      aria-label="Revisione veloce del mese"
      data-testid="browse"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="space-y-3">
        <PlanProgressBar progress={progress} size="sm" label={progressLabel(progress)} />
        <p className="hidden text-center text-xs text-muted lg:block">Scorri con le frecce ← → della tastiera.</p>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {stale && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-surface p-3 text-sm" role="alert">
          <span>L&apos;agenzia ha aggiornato qualcosa nel frattempo.</span>
          <button
            type="button"
            onClick={() => {
              setStale(false);
              router.refresh();
            }}
            className="btn min-h-11"
          >
            Mostra la versione aggiornata
          </button>
        </div>
      )}

      <div className="overflow-x-clip">
        {post && state ? (
          <article
            key={post.id}
            className="browse-card space-y-3"
            data-dir={direction ?? undefined}
            data-testid="browse-card"
            data-post-id={post.id}
            data-state={state}
            aria-labelledby={`browse-title-${post.id}`}
          >
            <header className="space-y-2">
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <StepButton dir="prev" disabled={current === 0 || busy} onClick={() => step(-1)} />
                <div className="min-w-0 text-center">
                  <p className="text-xs font-medium text-muted tabular" data-testid="browse-position">
                    Post {current + 1} di {total}
                  </p>
                  <p className="text-sm font-semibold text-foreground tabular" data-testid="browse-slot">
                    {post.slotLabel}
                  </p>
                </div>
                <StepButton
                  dir="next"
                  disabled={busy}
                  label={current === total - 1 ? "Vai al riepilogo" : "Post successivo"}
                  onClick={() => step(1)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={CHIP[state].className} data-testid="browse-state">
                  {CHIP[state].label(post)}
                </span>
                <span className="text-xs text-muted">Versione {post.versionNumber}</span>
              </div>
              <h2
                id={`browse-title-${post.id}`}
                data-focus-target
                tabIndex={-1}
                // Focused by script after a move (to announce the card): not a control, no ring.
                style={{ outline: "none" }}
                className="text-lg font-semibold leading-snug"
              >
                {post.title}
              </h2>
            </header>

            <StateNotice state={state} post={post} />

            <div className="w-full">
              <NetworkPreviewTabs
                networks={post.networks}
                networkOptions={post.networkOptions}
                text={post.text}
                firstCommentText={post.firstCommentText}
                media={post.media}
                accountName={clientName}
                accountAvatarUrl={logoUrl}
                publishAt={post.publishAt}
                timeZone={timeZone}
              />
            </div>
          </article>
        ) : (
          <SummaryCard
            key="summary"
            direction={direction}
            summaryText={browseSummaryText(summary)}
            waiting={summary.waiting}
            withComments={summary.withComments}
            outcome={outcome}
            toApprove={toApprove}
            skippedLinks={items.flatMap((item, i) =>
              ["feedback", "changes"].includes(browseState(item))
                ? [{ id: item.id, title: posts[i].title, state: browseState(item), href: `${posts[i].href}${postLinkQuery("sfoglia", { position: i + 1, month })}` }]
                : []
            )}
            backHref={backHref}
            backLabel={backLabel}
            onApproveRemaining={() => {
              setSheetError(null);
              setSheetOpen(true);
            }}
            onRestart={() => goTo(0, "prev")}
            onPrev={() => step(-1)}
          />
        )}
      </div>

      {post && state && (
        <DecisionBar>
          <div className="space-y-2">
            {error && (
              <div className="rounded-md border border-error/40 bg-surface p-3 text-sm text-error" role="alert" data-testid="browse-error">
                {error}
              </div>
            )}
            {state === "waiting" ? (
              <div className="flex gap-3">
                <Link
                  href={commentHref(post)}
                  className="btn min-h-12 flex-1 !text-base"
                  data-testid="browse-comment"
                >
                  Commenta
                </Link>
                <button
                  type="button"
                  onClick={approve}
                  disabled={busy}
                  className="btn btn-primary min-h-12 flex-1 !text-base"
                  data-testid="browse-approve"
                >
                  {busy ? "Approvo…" : "Approva"}
                </button>
              </div>
            ) : null}
            {state === "waiting" && assistantEnabled ? (
              <Link
                href={`${commentHref(post)}&heili=1`}
                className="btn btn-quiet min-h-11 w-full !text-base"
                data-testid="browse-heili"
              >
                <HeiliAssistantIcon className="h-6 w-6" />
                Parla con Heili
              </Link>
            ) : null}
            {state === "waiting" ? null : (
              <div className="flex gap-3">
                {state === "feedback" && (
                  <Link href={commentHref(post)} className="btn btn-primary min-h-12 flex-1 !text-base" data-testid="browse-open-post">
                    Decidi dal post
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => step(1)}
                  className={`btn min-h-12 flex-1 !text-base ${state === "feedback" ? "" : "btn-primary"}`}
                  data-testid="browse-skip"
                >
                  {current === total - 1 ? "Vai al riepilogo" : "Avanti"}
                </button>
              </div>
            )}
          </div>
        </DecisionBar>
      )}

      <BottomSheet
        open={sheetOpen}
        title={toApprove === 1 ? "Approvi 1 post rimasto?" : `Approvi ${toApprove} post rimasti?`}
        onClose={() => !sheetBusy && setSheetOpen(false)}
        busy={sheetBusy}
      >
        <p className="text-base">
          {autoSchedule
            ? `Approvi ${postsWord(toApprove)} così come li vedi: verranno programmati per le loro date.`
            : `Approvi ${postsWord(toApprove)} così come li vedi: l'agenzia li programmerà per le loro date.`}
        </p>
        <p className="text-sm text-muted">Ogni post viene approvato nella versione che vedi adesso.</p>
        {selection.skipped.length > 0 && <SkippedList skipped={selection.skipped} title="Non li approvo in blocco:" />}
        <SheetError error={sheetError} stale={stale} onReload={() => router.refresh()} />
        <SheetButtons
          busy={sheetBusy}
          onCancel={() => setSheetOpen(false)}
          onConfirm={approveRemaining}
          confirmLabel={sheetBusy ? "Approvazione…" : `Sì, approva ${postsWord(toApprove)}`}
          confirmClass="bg-success text-white hover:opacity-90"
        />
      </BottomSheet>
    </section>
  );
}

function StepButton({
  dir,
  disabled,
  onClick,
  label,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="btn min-h-11 min-w-11 !px-0 text-xl"
      aria-label={label ?? (dir === "prev" ? "Post precedente" : "Post successivo")}
      data-testid={dir === "prev" ? "browse-prev" : "browse-next"}
    >
      <span aria-hidden="true">{dir === "prev" ? "‹" : "›"}</span>
    </button>
  );
}

function toItem(post: BrowsePost): BrowseItem {
  return { id: post.id, status: post.status, canAct: post.canAct, openComments: post.openComments };
}

function StateNotice({ state, post }: { state: BrowseState; post: BrowsePost }) {
  if (state === "waiting") return null;
  const tone = state === "approved" ? "border-success" : state === "locked" ? "border-border" : "border-warning";
  let text: string;
  if (state === "approved") {
    text =
      post.status === "SCHEDULED"
        ? `Programmato: uscirà ${post.publishLabel}.`
        : post.status === "DELIVERED"
          ? "Pubblicato."
          : `Hai approvato questo post. Uscirà ${post.publishLabel}.`;
  } else if (state === "changes") {
    text = "Hai chiesto modifiche: l'agenzia sta preparando una nuova versione e ti scriverà quando sarà pronta.";
  } else if (state === "feedback") {
    text = "Hai già lasciato dei commenti su questo post. Aprilo per inviare le modifiche all'agenzia o per approvarlo così com'è.";
  } else {
    text = "Questo post è in aggiornamento: ricarica la pagina tra poco.";
  }
  return (
    <p className={`rounded-lg border bg-surface p-3 text-sm leading-relaxed ${tone}`} data-testid="browse-notice">
      {text}
    </p>
  );
}

function SkippedList({
  skipped,
  title,
}: {
  skipped: Array<{ id: string; title: string; reason: ApproveAllSkipReason }>;
  title: string;
}) {
  return (
    <div className="space-y-1.5" data-testid="browse-skipped">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="space-y-1 text-sm">
        {skipped.map((item) => (
          <li key={item.id} className="inset p-2.5">
            <span className="font-medium">{item.title}</span>
            <span className="text-muted"> — {SKIP_REASON_LABELS[item.reason]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryCard({
  direction,
  summaryText,
  waiting,
  withComments,
  outcome,
  toApprove,
  skippedLinks,
  backHref,
  backLabel,
  onApproveRemaining,
  onRestart,
  onPrev,
}: {
  direction: "next" | "prev" | null;
  summaryText: string;
  waiting: number;
  withComments: number;
  outcome: Outcome | null;
  toApprove: number;
  skippedLinks: Array<{ id: string; title: string; state: BrowseState; href: string }>;
  backHref: string;
  backLabel: string;
  onApproveRemaining: () => void;
  onRestart: () => void;
  onPrev: () => void;
}) {
  return (
    <section
      className="browse-card panel space-y-4 p-5"
      data-dir={direction ?? undefined}
      data-testid="browse-summary"
      aria-labelledby="browse-summary-title"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <StepButton dir="prev" disabled={false} onClick={onPrev} />
          <p className="label-caps" data-testid="browse-position">
            Riepilogo
          </p>
        </div>
        <h2 id="browse-summary-title" data-focus-target tabIndex={-1} style={{ outline: "none" }} className="text-[22px] font-semibold leading-tight" data-testid="browse-summary-text">
          {summaryText.charAt(0).toUpperCase() + summaryText.slice(1)}
        </h2>
      </div>

      {outcome && (
        <p className="rounded-lg border-2 border-success bg-surface p-3 text-sm font-medium text-success" role="status" data-testid="browse-outcome">
          {outcome.approved === 1 ? "Fatto! 1 post approvato." : `Fatto! ${outcome.approved} post approvati.`}
        </p>
      )}

      {waiting === 0 && withComments === 0 && !outcome && (
        <p className="text-sm text-muted">Hai rivisto tutti i post. Grazie!</p>
      )}
      {waiting === 0 && withComments > 0 && (
        <p className="text-sm text-muted">L&apos;agenzia riceve i tuoi commenti e ti scrive quando le nuove versioni sono pronte.</p>
      )}

      {skippedLinks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Con commenti o modifiche:</p>
          <ul className="space-y-1">
            {skippedLinks.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="inset flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-sunken">
                  <span className="min-w-0 truncate font-medium">{item.title}</span>
                  <span className="shrink-0 text-muted">{item.state === "changes" ? "Modifiche richieste" : "Da decidere"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        {toApprove > 0 && (
          <button type="button" onClick={onApproveRemaining} className="btn btn-primary min-h-12 w-full !text-base" data-testid="browse-approve-rest">
            Approva i rimanenti ({toApprove})
          </button>
        )}
        <Link href={backHref} className={`btn min-h-12 w-full !text-base ${toApprove > 0 ? "" : "btn-primary"}`} data-testid="browse-back">
          {backLabel}
        </Link>
        <button type="button" onClick={onRestart} className="btn btn-quiet min-h-11 w-full">
          Ricomincia dal primo post
        </button>
      </div>
    </section>
  );
}
