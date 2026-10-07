"use client";

/**
 * Client portal — a monthly plan ("Piano social di ottobre").
 *
 * The agency's message for the month, how far along the client is ("3 di 12
 * approvati"), the Instagram profile-grid preview (server-rendered slot),
 * then every post of the month in calendar order as compact cards that open
 * the usual review page. "Approva tutto il piano" approves, in one step,
 * every post still waiting for the client at the version shown here; posts
 * with the client's own open comments or with changes requested are left
 * out and listed in the confirmation. A general "Commento sul piano" goes to
 * the agency; per-post feedback stays on each post.
 */

/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { addPlanCommentAction, approvePlanAction } from "@/app/review/[token]/actions";
import { PlanProgressBar } from "@/components/plans/plan-bits";
import { NETWORK_LABELS } from "@/lib/domain";
import { SKIP_REASON_LABELS, planProgress, selectApproveAll, type ApproveAllSkipReason } from "@/lib/plan-rules";
import BottomSheet from "./bottom-sheet";
import { portalStatusLabel, portalTone } from "./helpers";
import { DecisionBar, SheetButtons, SheetError } from "./review-pieces";
import type { PortalPlan, PortalPlanPost } from "./types";

const toneChip = {
  action: "chip chip-brand",
  waiting: "chip chip-stale",
  done: "chip chip-fresh",
} as const;

function postsWord(n: number): string {
  return n === 1 ? "1 post" : `${n} post`;
}

export default function PlanReview({
  token,
  plan,
  homeHref,
  gridSlot,
}: {
  token: string;
  plan: PortalPlan;
  homeHref: string;
  /** Server-rendered Instagram grid. */
  gridSlot: ReactNode;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    approved: number;
    skipped: Array<{ id: string; title: string; reason: ApproveAllSkipReason }>;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentNotice, setCommentNotice] = useState<string | null>(null);
  const [commentPending, startComment] = useTransition();

  const progress = planProgress(plan.posts.map((p) => p.status));
  const selection = selectApproveAll(
    plan.posts.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      versionNumber: p.versionNumber,
      canAct: p.canAct,
      openClientComments: p.openComments,
    }))
  );
  const toApprove = selection.approve.length;
  const firstToReview = plan.posts.find((p) => p.canAct);
  const waiting = plan.posts.filter((p) => p.canAct).length;

  function openSheet() {
    setSheetError(null);
    setSheetOpen(true);
  }

  async function approveAll() {
    if (busy) return;
    setBusy(true);
    setSheetError(null);
    try {
      const result = await approvePlanAction(token, {
        planId: plan.id,
        posts: plan.posts.map((p) => ({ postId: p.id, versionNumber: p.versionNumber })),
      });
      if (!result.ok) {
        setSheetError(result.error);
        return;
      }
      setSheetOpen(false);
      setOutcome({ approved: result.data.approved.length, skipped: result.data.skipped });
      window.scrollTo({ top: 0, behavior: "smooth" });
      router.refresh();
    } catch {
      setSheetError("La connessione si è interrotta. Controlla lo stato del piano e riprova.");
    } finally {
      setBusy(false);
    }
  }

  function sendComment() {
    const body = comment.trim();
    if (!body) return;
    setCommentError(null);
    setCommentNotice(null);
    startComment(async () => {
      const result = await addPlanCommentAction(token, { planId: plan.id, body });
      if (!result.ok) {
        setCommentError(result.error);
        return;
      }
      setComment("");
      setCommentNotice("Commento inviato: lo leggerà l'agenzia.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-7">
      <nav className="text-sm">
        <Link href={homeHref} className="inline-flex min-h-11 items-center text-muted hover:text-foreground">
          ← Tutti i post
        </Link>
      </nav>

      {outcome && (
        <section className="space-y-2 rounded-lg border-2 border-success bg-surface p-5" role="status" aria-live="polite" data-testid="plan-outcome">
          <p className="text-lg font-semibold text-success">
            {outcome.approved === 1 ? "Fatto! 1 post approvato." : `Fatto! ${outcome.approved} post approvati.`}
          </p>
          <p className="text-sm">
            {plan.autoSchedule
              ? "L'agenzia li riceve subito e verranno programmati per le loro date."
              : "L'agenzia li riceve subito e li programmerà per le loro date."}
          </p>
          {outcome.skipped.length > 0 && <SkippedList skipped={outcome.skipped} title="Da decidere uno per uno:" />}
        </section>
      )}

      <header className="panel space-y-4 p-5 sm:p-6">
        <div className="space-y-1">
          <p className="label-caps">{plan.clientName}</p>
          <h1 className="text-[26px] font-semibold leading-tight" data-testid="plan-heading">
            {plan.heading}
          </h1>
        </div>
        {plan.intro && (
          <div className="inset space-y-1 p-4">
            <p className="label-caps">Il messaggio dell&apos;agenzia</p>
            <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{plan.intro}</p>
          </div>
        )}
        <PlanProgressBar progress={progress} />
        {waiting > 0 && plan.dueLabel && (
          <p className="text-sm font-medium text-warning">Ti chiediamo di rispondere entro {plan.dueLabel}.</p>
        )}
        {waiting === 0 ? (
          <p className="text-sm text-muted">
            {progress.changes > 0
              ? "Hai rivisto tutti i post: l'agenzia sta preparando le modifiche che hai chiesto."
              : "Hai rivisto tutti i post del piano. Grazie!"}
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {toApprove > 0 && (
              <button
                type="button"
                onClick={openSheet}
                className="min-h-12 rounded-lg bg-success px-5 text-base font-semibold text-white hover:opacity-90"
                data-testid="plan-approve-all"
              >
                Approva tutto il piano ({toApprove})
              </button>
            )}
            {firstToReview && (
              <Link
                href={firstToReview.href}
                className="inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-foreground px-5 text-base font-semibold hover:bg-surface-hover"
              >
                Rivedi uno per uno
              </Link>
            )}
          </div>
        )}
      </header>

      <section className="space-y-3" aria-labelledby="plan-grid">
        <div className="space-y-1">
          <h2 id="plan-grid" className="text-lg font-semibold">
            Il tuo profilo a {plan.monthName}
          </h2>
          <p className="text-sm text-muted">Così apparirà la griglia di Instagram, dal post più recente. Tocca un post per aprirlo.</p>
        </div>
        {gridSlot}
      </section>

      <section className="space-y-3" aria-labelledby="plan-posts">
        <h2 id="plan-posts" className="flex items-center gap-2 text-lg font-semibold">
          I post del mese
          <span className="chip chip-offline">{plan.posts.length}</span>
        </h2>
        <ol className="space-y-2" data-testid="plan-post-list">
          {plan.posts.map((post) => (
            <li key={post.id}>
              <PlanPostCard post={post} />
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3" aria-labelledby="plan-comment">
        <div className="space-y-1">
          <h2 id="plan-comment" className="text-lg font-semibold">
            Commento sul piano
          </h2>
          <p className="text-sm text-muted">
            Un&apos;impressione su tutto il mese (tono, ritmo, temi). Per un post in particolare, commentalo dalla sua pagina.
          </p>
        </div>
        {plan.comments.length > 0 && (
          <ul className="space-y-2">
            {plan.comments.map((c) => (
              <li key={c.id} className="panel space-y-1 p-3 text-sm">
                <p className="text-xs text-muted">
                  {c.isMine ? "Tu" : c.authorName} · {c.createdLabel}
                </p>
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <label className="block space-y-2">
          <span className="sr-only">Commento sul piano</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 5000))}
            rows={3}
            placeholder="Per esempio: mi piace il ritmo, ma vorrei più foto del locale."
            className="w-full resize-y rounded-md border border-border bg-background p-3 text-base outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={sendComment}
          disabled={commentPending || comment.trim() === ""}
          className="min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:border-border-hover disabled:opacity-50"
        >
          {commentPending ? "Invio…" : "Invia il commento"}
        </button>
        {commentError && (
          <p className="text-sm text-error" role="alert">
            {commentError}
          </p>
        )}
        {commentNotice && (
          <p className="text-sm text-success" role="status">
            {commentNotice}
          </p>
        )}
      </section>

      {toApprove > 0 && (
        <DecisionBar>
          <button
            type="button"
            onClick={openSheet}
            className="min-h-12 w-full rounded-lg bg-success px-3 text-base font-semibold text-white hover:opacity-90"
          >
            Approva tutto il piano ({toApprove})
          </button>
        </DecisionBar>
      )}

      <BottomSheet
        open={sheetOpen}
        title={toApprove === 1 ? "Approvi 1 post del piano?" : `Approvi ${toApprove} post del piano?`}
        onClose={() => !busy && setSheetOpen(false)}
        busy={busy}
      >
        <p className="text-base">
          {plan.autoSchedule
            ? `Approvi ${postsWord(toApprove)} così come li vedi: verranno programmati per le loro date.`
            : `Approvi ${postsWord(toApprove)} così come li vedi: l'agenzia li programmerà per le loro date.`}
        </p>
        <p className="text-sm text-muted">Ogni post viene approvato nella versione che vedi adesso.</p>
        {selection.skipped.length > 0 && (
          <SkippedList skipped={selection.skipped} title="Non li approvo in blocco:" />
        )}
        <SheetError error={sheetError} stale={false} onReload={() => router.refresh()} />
        <SheetButtons
          busy={busy}
          onCancel={() => setSheetOpen(false)}
          onConfirm={approveAll}
          confirmLabel={busy ? "Approvazione…" : `Sì, approva ${postsWord(toApprove)}`}
          confirmClass="bg-success text-white hover:opacity-90"
        />
      </BottomSheet>
    </div>
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
    <div className="space-y-1.5" data-testid="plan-skipped">
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

function PlanPostCard({ post }: { post: PortalPlanPost }) {
  const tone = portalTone(post.status, post.canAct);
  const networks = post.networks.map((n) => NETWORK_LABELS[n] ?? n).join(" · ");
  const cover = post.cover;
  return (
    <Link href={post.href} className="panel flex gap-3 p-3 transition-colors hover:border-line-strong" data-testid="plan-post-card">
      <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
        {cover?.type === "image" && (
          <img src={cover.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        )}
        {cover?.type === "video" &&
          (cover.posterUrl ? (
            <img src={cover.posterUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <video
              src={`${cover.url}#t=0.5`}
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
              className="pointer-events-none h-full w-full object-cover"
            />
          ))}
        {!cover && (
          <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted">
            Solo testo
          </span>
        )}
        {post.mediaCount > 1 && (
          <span className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
            1/{post.mediaCount}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-xs font-medium text-muted tabular">{post.dateLabel}</span>
        <span className="line-clamp-2 text-base font-semibold leading-snug">{post.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={toneChip[tone]}>{portalStatusLabel("SOCIAL_POST", post.status)}</span>
          {networks && <span className="truncate text-xs text-muted">{networks}</span>}
        </span>
        {post.excerpt && <span className="line-clamp-1 text-xs text-muted">{post.excerpt}</span>}
        {post.canAct && post.openComments > 0 && (
          <span className="block text-xs font-medium text-warning">
            {post.openComments === 1 ? "1 commento aperto" : `${post.openComments} commenti aperti`}
          </span>
        )}
      </span>
    </Link>
  );
}
