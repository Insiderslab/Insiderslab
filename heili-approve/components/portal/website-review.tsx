"use client";

/**
 * Client portal — a website under review «Sul sito» (docs/SITO-WEB.md).
 *
 * The client opens the real test site («Apri il sito»), points at elements
 * and comments them there with Heili; back here they see «Le tue note» and
 * decide: «Chiedi modifiche» sends the saved notes, «Approva» approves the
 * round as they see the site today. Deciding happens only here, never inside
 * the site (decided on 16/10). A general comment can always be written here,
 * also when the site cannot be opened with Heili (company browser, blocks).
 */

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { ContentKind } from "@/app/generated/prisma/client";
import {
  addAssistantFeedbackAction,
  addCommentAction,
  approvePostAction,
  requestChangesAction,
  undoApprovalAction,
} from "@/app/review/[token]/actions";
import { useHeili, useHeiliPage } from "@/components/portal/heili/context";
import type { HeiliDestination } from "@/components/portal/heili/types";
import { anchorChip, DEVICE_LABELS, pagePath } from "@/lib/content/website";
import type { AssistantMode } from "@/lib/review-assistant/shared";
import BottomSheet from "./bottom-sheet";
import CommentComposer, { type CommentDraft, type CommentSubmission } from "./comment-composer";
import { DECISION_ROW_CLASS, decisionButtonClass, hasDecisionFeedback, primaryDecision } from "./decision";
import { PORTAL_STATUS_LABELS, portalPath, portalWording } from "./helpers";
import KindLabel from "./kind-label";
import PortalIntro from "./portal-intro";
import {
  AssistantActionButton,
  DecisionBar,
  OpenFeedbackNotice,
  ReviewNav,
  SheetButtons,
  SheetError,
  StaleBanner,
  SuccessPanel,
  UNSAVED_COMMENT_MESSAGE,
  feedbackHint,
  newVersionNotice,
  savedFeedbackBlocker,
} from "./review-pieces";
import type { PortalComment, PortalQueue, PortalWebsitePost } from "./types";
import UndoToast from "./undo-toast";
import WebsiteLaunch from "./website-launch";

type Outcome = "approved" | "changes";

const APPROVE_CANCELLED = "Approvazione annullata: puoi continuare a parlare con l'assistente.";

export interface WebsiteReviewProps {
  token: string;
  post: PortalWebsitePost;
  queue: PortalQueue;
  listKinds: ContentKind[];
  assistantEnabled: boolean;
  reviewerHasEmail: boolean;
  /** Server-rendered "Cosa è cambiato", if there is an earlier version. */
  changesSlot?: ReactNode;
  /** Server-rendered history of earlier versions and their comments. */
  historySlot?: ReactNode;
}

export default function WebsiteReview({
  token,
  post,
  queue,
  listKinds,
  assistantEnabled,
  reviewerHasEmail,
  changesSlot,
  historySlot,
}: WebsiteReviewProps) {
  const router = useRouter();
  const heili = useHeili();
  const assistantApproval = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [undoKey, setUndoKey] = useState<number | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [commentDirty, setCommentDirty] = useState(false);
  const [commentListening, setCommentListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [assistantKey, setAssistantKey] = useState(0);
  const [sheet, setSheet] = useState<null | "approve">(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const ref = { id: post.id, versionNumber: post.versionNumber };
  const content = post.content;
  const pages = content.pages.filter((p) => p.url);
  const canAct = post.canAct && outcome === null;
  const feedbackOpen = post.status === "CHANGES_REQUESTED" || outcome === "changes";
  const canComment = (post.canAct || feedbackOpen) && outcome !== "approved";
  const assistantAvailable = assistantEnabled && canComment;
  const assistantMode: AssistantMode = canAct ? "decision" : "feedback";
  const nextHref = queue.nextPostId ? portalPath(token, queue.nextPostId) : null;
  const homeHref = portalPath(token);
  const wording = portalWording(listKinds);
  const myOpenComments = post.comments.filter((c) => c.isMine && !c.resolved).length;
  const primary = primaryDecision({
    hasFeedback: hasDecisionFeedback({
      savedComments: myOpenComments,
      hasDraft: commentDirty,
      heiliPending: heili.pendingFeedback,
    }),
  });
  const draft: CommentDraft | null = canComment ? { kind: "general" } : null;

  // ─── Comments ──────────────────────────────────────────────────────────────

  async function submitComment(input: CommentSubmission): Promise<string | null> {
    const result = await addCommentAction(token, { postId: ref.id, versionNumber: ref.versionNumber, ...input });
    if (!result.ok) {
      if (result.stale) setStale(true);
      return result.error;
    }
    setCommentDirty(false);
    setCommentListening(false);
    setDraftKey((key) => key + 1);
    setDecisionError(null);
    setNotice(
      feedbackOpen
        ? "Commento aggiunto alla richiesta di modifiche già inviata."
        : "Commento salvato e visibile all’agenzia. Quando hai finito, premi «Chiedi modifiche» per inviare la richiesta."
    );
    return null;
  }

  // ─── Decisions ─────────────────────────────────────────────────────────────

  function blockUnsavedComment(): boolean {
    if (!commentDirty) return false;
    setDecisionError(UNSAVED_COMMENT_MESSAGE);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-feedback-composer="active"] textarea')?.focus());
    return true;
  }

  function finish(result: Outcome) {
    setOutcome(result);
    setCommentDirty(false);
    setDraftKey((key) => key + 1);
    setDecisionError(null);
    setSheet(null);
    heili.closeDock();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function requestSavedChanges() {
    if (sheetBusy) return;
    setDecisionError(null);
    const blocker = savedFeedbackBlocker(commentDirty, myOpenComments);
    if (blocker) {
      setDecisionError(blocker);
      return;
    }
    setSheetBusy(true);
    const result = await requestChangesAction(token, {
      postId: ref.id,
      versionNumber: ref.versionNumber,
      feedback: "saved-comments",
    });
    setSheetBusy(false);
    if (!result.ok) {
      if (result.stale) setStale(true);
      setDecisionError(result.error);
      return;
    }
    finish("changes");
  }

  async function requestChangesFromBar() {
    if (blockUnsavedComment() || sheetBusy) return;
    if (heili.control.current?.isLoadingFeedback()) {
      setDecisionError("Sto recuperando il feedback precedente. Riprova tra un momento.");
      return;
    }
    setDecisionError(null);
    if (heili.open || heili.control.current?.hasPendingFeedback()) {
      heili.openDock("feedback");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await heili.control.current?.requestChanges();
    } else {
      await requestSavedChanges();
    }
  }

  async function approveFromBar() {
    if (blockUnsavedComment() || sheetBusy) return;
    if (heili.control.current?.isLoadingFeedback()) {
      setDecisionError("Sto recuperando il feedback precedente. Riprova tra un momento.");
      return;
    }
    setDecisionError(null);
    if (heili.open || heili.control.current?.hasPendingFeedback()) {
      heili.openDock("feedback");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await heili.control.current?.approve();
    } else {
      setSheetError(null);
      setSheet("approve");
    }
  }

  function closeSheet() {
    if (sheetBusy) return;
    assistantApproval.current?.reject(new Error(APPROVE_CANCELLED));
    assistantApproval.current = null;
    setSheet(null);
    setSheetError(null);
  }

  async function confirmApprove() {
    if (sheetBusy || blockUnsavedComment()) return;
    setSheetBusy(true);
    setSheetError(null);
    const result = await approvePostAction(token, { postId: ref.id, versionNumber: ref.versionNumber });
    setSheetBusy(false);
    const fromAssistant = assistantApproval.current;
    assistantApproval.current = null;
    if (!result.ok) {
      if (result.stale) setStale(true);
      if (fromAssistant) {
        setSheet(null);
        fromAssistant.reject(new Error(result.error));
      } else {
        setSheetError(result.error);
      }
      return;
    }
    fromAssistant?.resolve();
    finish("approved");
    setUndoKey((key) => (key ?? 0) + 1);
  }

  async function undoApprove(): Promise<string | null> {
    const result = await undoApprovalAction(token, { postId: ref.id, versionNumber: ref.versionNumber });
    if (!result.ok) return result.error;
    setOutcome(null);
    setDraftKey((key) => key + 1);
    setNotice(null);
    setDecisionError(null);
    setStale(false);
    return null;
  }

  const approveFromAssistant = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (commentDirty) {
          reject(new Error(UNSAVED_COMMENT_MESSAGE));
          return;
        }
        assistantApproval.current = { resolve, reject };
        setSheetError(null);
        setSheet("approve");
      }),
    [commentDirty]
  );

  async function submitFromAssistant(input: { message: string; reviewSessionId: string }) {
    if (blockUnsavedComment()) throw new Error(UNSAVED_COMMENT_MESSAGE);
    const result = await requestChangesAction(token, {
      postId: ref.id,
      versionNumber: ref.versionNumber,
      feedback: "assistant",
      message: input.message,
      reviewSessionId: input.reviewSessionId,
    });
    if (!result.ok) {
      if (result.stale) setStale(true);
      throw new Error(result.error);
    }
    finish("changes");
  }

  async function addFromAssistant(input: { message: string; reviewSessionId: string }) {
    if (blockUnsavedComment()) throw new Error(UNSAVED_COMMENT_MESSAGE);
    const result = await addAssistantFeedbackAction(token, {
      postId: ref.id,
      versionNumber: ref.versionNumber,
      message: input.message,
      reviewSessionId: input.reviewSessionId,
    });
    if (!result.ok) {
      if (result.stale) setStale(true);
      throw new Error(result.error);
    }
    heili.closeDock();
    setAssistantKey((key) => key + 1);
    setDecisionError(null);
    setNotice("Il riepilogo di Heili è stato aggiunto al tuo feedback: l’agenzia lo vedrà insieme alla richiesta già inviata.");
  }

  function openAssistant() {
    if (commentListening) {
      setDecisionError("Ferma la dettatura del commento prima di aprire Heili.");
      return;
    }
    heili.openDock("feedback");
  }

  // ─── Heili ─────────────────────────────────────────────────────────────────

  const heiliDestinations: HeiliDestination[] = [];
  if (nextHref) heiliDestinations.push({ id: "next", label: "Rivedi il prossimo contenuto", href: nextHref, kind: "next" });
  heiliDestinations.push({ id: "home", label: "Torna all'inizio", href: homeHref, kind: "home" });

  useHeiliPage({
    page: "website",
    title: `il sito «${post.title}»`,
    summary: canAct ? "Da approvare" : feedbackOpen ? "Modifiche già chieste, puoi aggiungere altro" : undefined,
    destinations: heiliDestinations,
    services: listKinds,
    review: assistantAvailable
      ? {
          postId: post.id,
          versionNumber: post.versionNumber,
          mode: assistantMode,
          kind: "WEBSITE",
          heading: post.title,
          sessionKey: assistantKey,
          onSubmitChanges: canAct ? submitFromAssistant : addFromAssistant,
          onApprove: canAct ? approveFromAssistant : undefined,
          onRequestSavedChanges: requestSavedChanges,
        }
      : undefined,
  });

  function reload() {
    setStale(false);
    setDecisionError(null);
    setSheet(null);
    setCommentDirty(false);
    setCommentListening(false);
    router.refresh();
  }

  const siteNotes = post.comments.filter((c) => c.siteAnchor);
  const generalNotes = post.comments.filter((c) => !c.siteAnchor);

  return (
    <div className="space-y-6">
      <ReviewNav homeHref={homeHref} nextHref={nextHref} queue={queue} wording={wording} showProgress={outcome === null} />

      {stale && <StaleBanner text="L'agenzia ha aggiornato questo sito nel frattempo." onReload={reload} />}

      {outcome && (
        <SuccessPanel
          title={outcome === "approved" ? "Fatto! Sito approvato." : "Modifiche inviate all'agenzia."}
          nextHref={nextHref}
          homeHref={homeHref}
          remaining={Math.max(0, queue.toReviewCount - (queue.position !== null ? 1 : 0))}
          wording={wording}
        >
          <p className="text-sm">
            {outcome === "approved"
              ? `L'agenzia metterà online il sito così come l'hai approvato. Messa online prevista: ${post.publishLabel}.`
              : newVersionNotice(reviewerHasEmail)}
          </p>
        </SuccessPanel>
      )}

      <header className="space-y-2">
        <KindLabel kind="WEBSITE" />
        <p className="text-lg font-semibold leading-snug">{post.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span
            className={`font-medium ${post.canAct ? "text-accent" : post.status === "CHANGES_REQUESTED" ? "text-warning" : "text-success"}`}
          >
            {outcome === "approved"
              ? "Approvato"
              : outcome === "changes"
                ? "Modifiche richieste"
                : post.status === "DELIVERED"
                  ? "Pubblicato"
                  : PORTAL_STATUS_LABELS[post.status]}
          </span>
          <span className="text-muted">Giro {content.round}</span>
        </div>
        <p className="text-base">
          <span className="text-muted">{post.dateLabel}: </span>
          <span className="font-medium">{post.publishLabel}</span>
        </p>
        {post.canAct && post.reviewDueLabel && outcome === null && (
          <p className="text-sm font-medium text-warning">Ti chiediamo di rispondere entro {post.reviewDueLabel}.</p>
        )}
      </header>

      {outcome === null && !post.canAct && <WebsiteStatusNotice post={post} hasEmail={reviewerHasEmail} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)] lg:items-start">
        <div className="space-y-4">
          {/* First visit: one compact row (K-10). */}
          <PortalIntro token={token} />
          {changesSlot}
          <section className="space-y-4 rounded-[20px] border border-border bg-background p-4 sm:p-5" aria-labelledby="site-title">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Giro {content.round}</p>
              <h2 id="site-title" className="mt-1 text-xl font-semibold">
                Il sito da rivedere
              </h2>
              {content.roundNote && (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm" data-testid="website-round-note">
                  <span className="text-muted">Nota dell&apos;agenzia: </span>
                  {content.roundNote}
                </p>
              )}
            </div>
            <WebsiteLaunch token={token} post={post} canComment={canComment} />
            {pages.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Pagine da guardare</h3>
                <ol className="space-y-2">
                  {pages.map((page, index) => (
                    <li key={page.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {index + 1}. {page.title || pagePath(page.url)}
                        </span>
                        <WebsiteLaunch token={token} post={post} canComment={canComment} pageUrl={page.url} compact />
                      </div>
                      {page.note && <p className="mt-1 text-xs text-muted">{page.note}</p>}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted">
                  Da controllare su: {content.devices.map((d) => DEVICE_LABELS[d].toLowerCase()).join(" e ")}.
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="space-y-4 rounded-[20px] border border-border bg-surface p-4 sm:p-5" aria-labelledby="notes-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Il tuo feedback</p>
              <h2 id="notes-title" className="mt-1 text-xl font-semibold" data-testid="website-notes-title">
                Le tue note ({post.comments.length})
              </h2>
              <p className="mt-1 text-sm text-muted">{feedbackHint(canComment, assistantEnabled, feedbackOpen)}</p>
            </div>
          </div>
          {draft && (
            <CommentComposer
              key={draftKey}
              draft={draft}
              mediaLabel={null}
              draftStorageScope={`${token}:${post.id}:${post.versionNumber}:general`}
              onSubmit={submitComment}
              onDirtyChange={setCommentDirty}
              onListeningChange={setCommentListening}
              assistantAction={assistantAvailable ? <AssistantActionButton onToggle={openAssistant} /> : undefined}
              onCancel={() => {
                setCommentDirty(false);
                setCommentListening(false);
                setDraftKey((key) => key + 1);
                setDecisionError(null);
              }}
              framed={false}
            />
          )}
          {notice && (
            <p className="text-sm text-success" role="status">
              {notice}
            </p>
          )}
          <div className="border-t border-border pt-4">
            <WebsiteNotes site={siteNotes} general={generalNotes} pages={content.pages} canComment={canComment} />
          </div>
        </section>
      </div>

      {historySlot}

      {canAct && (
        <DecisionBar>
          <div className="space-y-2">
            {decisionError && (
              <div className="rounded-md border border-error/40 bg-surface p-3 text-sm text-error" role="alert" aria-live="polite">
                {decisionError}
              </div>
            )}
            <div className={DECISION_ROW_CLASS}>
              <button
                type="button"
                onClick={requestChangesFromBar}
                disabled={sheetBusy}
                className={decisionButtonClass(primary === "changes")}
                data-testid="decision-changes"
                data-primary={primary === "changes"}
              >
                {sheetBusy ? "Invio…" : "Chiedi modifiche"}
              </button>
              <button
                type="button"
                onClick={approveFromBar}
                disabled={sheetBusy}
                className={decisionButtonClass(primary === "approve")}
                data-testid="decision-approve"
                data-primary={primary === "approve"}
              >
                Approva
              </button>
            </div>
          </div>
        </DecisionBar>
      )}

      {undoKey !== null && outcome === "approved" && (
        <UndoToast key={undoKey} onUndo={undoApprove} onClose={() => setUndoKey(null)} />
      )}

      <BottomSheet open={sheet === "approve"} title="Approvi questo sito?" onClose={closeSheet} busy={sheetBusy}>
        <p className="text-base">Approvi il sito nello stato in cui lo vedi oggi.</p>
        <p className="text-sm text-muted">
          Stai approvando il giro {content.round} (versione {post.versionNumber}): l&apos;agenzia lo metterà online così.
          Messa online prevista: {post.publishLabel}.
        </p>
        {canAct && <OpenFeedbackNotice comments={post.comments} />}
        <SheetError error={sheetError} stale={stale} onReload={reload} />
        <SheetButtons
          busy={sheetBusy}
          onCancel={closeSheet}
          onConfirm={confirmApprove}
          confirmLabel={sheetBusy ? "Approvazione…" : "Sì, approva"}
          confirmClass="bg-success text-white hover:opacity-90"
        />
      </BottomSheet>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function WebsiteStatusNotice({ post, hasEmail }: { post: PortalWebsitePost; hasEmail: boolean }) {
  let text: string;
  if (post.status === "CHANGES_REQUESTED") {
    text = hasEmail
      ? "Modifiche inviate all'agenzia. Le tue note sono registrate: riceverai un'email quando il nuovo giro del sito sarà pronto."
      : "Modifiche inviate all'agenzia. Le tue note sono registrate: l'agenzia ti avviserà quando il nuovo giro del sito sarà pronto.";
  } else if (post.status === "DELIVERED") {
    text = "Il sito è stato pubblicato. Per cambiare qualcosa, contatta l'agenzia.";
  } else if (post.status === "IN_REVIEW") {
    text = "Questo sito è in aggiornamento: ricarica la pagina tra poco.";
  } else {
    text = `${post.approvedLabel ? `Hai approvato questo sito ${post.approvedLabel}. ` : "Questo sito è approvato. "}L'agenzia lo metterà online (messa online prevista ${post.publishLabel}). Per cambiare qualcosa, contatta l'agenzia.`;
  }
  return (
    <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed" role="status">
      {text}
    </p>
  );
}

function WebsiteNotes({
  site,
  general,
  pages,
  canComment,
}: {
  site: PortalComment[];
  general: PortalComment[];
  pages: PortalWebsitePost["content"]["pages"];
  canComment: boolean;
}) {
  if (site.length === 0 && general.length === 0) {
    return (
      <p className="text-sm text-muted">
        {canComment
          ? "Ancora nessuna nota. Apri il sito, tocca Heili e indica un elemento da commentare, oppure scrivi qui sopra."
          : "Nessuna nota su questo giro."}
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {site.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Note sul sito</h3>
          <ul className="space-y-2">
            {site.map((c, index) => (
              <NoteItem key={c.id} comment={c} number={index + 1} chip={anchorChip(c.siteAnchor!, pages)} />
            ))}
          </ul>
        </div>
      )}
      {general.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {site.length > 0 ? "Commenti generali" : "Commenti"}
          </h3>
          <ul className="space-y-2">
            {general.map((c) => (
              <NoteItem key={c.id} comment={c} number={null} chip={null} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NoteItem({ comment, number, chip }: { comment: PortalComment; number: number | null; chip: string | null }) {
  const agency = comment.authorType === "AGENCY";
  return (
    <li
      id={`commento-${comment.id}`}
      className={`rounded-lg border p-3 ${agency ? "border-accent/40 bg-surface" : "border-border bg-background"} ${
        comment.resolved ? "opacity-70" : ""
      }`}
      data-testid="website-note"
    >
      <div className="flex items-start gap-3">
        {number !== null && (
          <span
            aria-label={`Nota ${number}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
          >
            {number}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs text-muted">
            <span className="font-medium text-foreground">
              {agency ? `${comment.authorName} · Agenzia` : comment.isMine ? "Tu" : comment.authorName}
            </span>{" "}
            · {comment.createdLabel}
            {comment.resolved && <span className="text-success"> · Risolto</span>}
          </p>
          {chip && <p className="break-words text-xs font-medium text-muted">{chip}</p>}
          <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
        </div>
      </div>
    </li>
  );
}
