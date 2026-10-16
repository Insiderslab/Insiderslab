"use client";

/**
 * Client portal — one post under review.
 *
 * The client sees the post as it will appear on each network, can drop a
 * note on a point of an image or on a moment of a video, write general
 * comments, and then decides with two big buttons: "Approva" (after a
 * confirmation that says when it will be published) or "Chiedi modifiche",
 * which sends the comments already saved on the post. Unsure clients can talk it through with the AI
 * assistant, which never decides for them. Each post is approved on its own;
 * after a decision the page offers the next post to review.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ContentKind } from "@/app/generated/prisma/client";
import {
  addAssistantFeedbackAction,
  approvePostAction,
  addCommentAction,
  requestChangesAction,
  undoApprovalAction,
} from "@/components/portal/safe-actions";
import { NetworkPreviewTabs, type PreviewPin, type PreviewSeek, type PreviewVideoMarker } from "@/components/post-preview";
import { useHeili, useHeiliPage } from "@/components/portal/heili/context";
import type { HeiliDestination } from "@/components/portal/heili/types";
import BottomSheet from "./bottom-sheet";
import CommentComposer, { type CommentDraft, type CommentSubmission } from "./comment-composer";
import CommentList from "./comment-list";
import { DECISION_ROW_CLASS, decisionButtonClass, hasDecisionFeedback, primaryDecision } from "./decision";
import { PORTAL_STATUS_LABELS, mediaName, orderComments, portalPath, portalWording } from "./helpers";
import KindLabel from "./kind-label";
import {
  AssistantActionButton,
  DecisionBar,
  ReviewNav,
  SheetButtons,
  SheetError,
  StaleBanner,
  SuccessPanel,
  savedFeedbackBlocker,
  UNSAVED_COMMENT_MESSAGE,
  OpenFeedbackNotice,
  feedbackHint,
  newVersionNotice,
} from "./review-pieces";
import type { AssistantMode } from "@/lib/review-assistant/shared";
import type { PortalClient, PortalComment, PortalPlanNav, PortalPost, PortalQueue } from "./types";
import UndoToast from "./undo-toast";

type Outcome = "approved" | "changes";

const APPROVE_CANCELLED = "Approvazione annullata: puoi continuare a parlare con l'assistente.";

export interface PostReviewProps {
  token: string;
  post: PortalPost;
  client: PortalClient;
  queue: PortalQueue;
  assistantEnabled: boolean;
  /** False when the reviewer has no email: notices must not promise one. */
  reviewerHasEmail: boolean;
  /** Open Heili as the page loads (Sfoglia's "Parla con Heili"). */
  openAssistant?: boolean;
  /** The publish date is already behind us (the agency will pick a new one). */
  publishInPast: boolean;
  /** Server-rendered "Cosa è cambiato" block, if the post has earlier versions. */
  changesSlot?: ReactNode;
  /** Server-rendered history of earlier versions and their comments. */
  historySlot?: ReactNode;
  /** Kinds in the client's list (wording of the navigation); social only by default. */
  listKinds?: ContentKind[];
  /** The post belongs to a monthly plan: previous / next of the plan and "Torna al piano". */
  plan?: PortalPlanNav;
}

export default function PostReview({
  token,
  post,
  client,
  queue,
  assistantEnabled,
  reviewerHasEmail,
  openAssistant = false,
  publishInPast,
  changesSlot,
  historySlot,
  listKinds = ["SOCIAL_POST"],
  plan,
}: PostReviewProps) {
  const router = useRouter();
  const previewRef = useRef<HTMLDivElement>(null);
  const timeGetter = useRef<(() => number) | null>(null);
  const assistantApproval = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const heili = useHeili();

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // One «Approvato · Annulla» toast per approval (the key restarts its clock).
  const [undoKey, setUndoKey] = useState<number | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(
    post.canAct || post.status === "CHANGES_REQUESTED" ? { kind: "general" } : null
  );
  const [draftKey, setDraftKey] = useState(0);
  const [commentDirty, setCommentDirty] = useState(false);
  const [commentListening, setCommentListening] = useState(false);
  const [seek, setSeek] = useState<PreviewSeek | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const openedOnArrival = openAssistant && assistantEnabled && (post.canAct || post.status === "CHANGES_REQUESTED");
  // Bumped after Heili's feedback was added: the next conversation starts fresh.
  const [assistantKey, setAssistantKey] = useState(0);

  const [sheet, setSheet] = useState<null | "approve">(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const ref = { id: post.id, versionNumber: post.versionNumber };
  const canAct = post.canAct && outcome === null;
  // After "Chiedi modifiche" the page behaves like a reloaded CHANGES_REQUESTED
  // one: more feedback (and Heili in feedback mode) stays available, "Approva" never returns.
  const feedbackOpen = post.status === "CHANGES_REQUESTED" || outcome === "changes";
  const canComment = (post.canAct || feedbackOpen) && outcome !== "approved";
  // Heili is wherever the client can comment: deciding (IN_REVIEW) or, after
  // «Chiedi modifiche», adding feedback (CHANGES_REQUESTED, current version).
  const assistantAvailable = assistantEnabled && canComment;
  const assistantMode: AssistantMode = canAct ? "decision" : "feedback";
  const hasVideo = post.media.some((m) => m.type === "video");
  // Opened from Sfoglia, "next" is the next card; otherwise the next post waiting.
  const nextHref = plan?.browse ? plan.browse.nextHref : queue.nextPostId ? portalPath(token, queue.nextPostId) : null;
  const homeHref = plan?.href ?? portalPath(token);
  const baseWording = portalWording(listKinds);
  // Inside a plan the way back is the plan (or the month view it came from), and "next" stays in the plan.
  const backText = plan?.backLabel ?? "Torna al piano";
  const wording = plan
    ? {
        ...baseWording,
        backLabel: `← ${backText}`,
        homeLabel: backText,
        allDone: "Hai rivisto tutti i post del piano in attesa. Grazie!",
      }
    : baseWording;
  const mixedList = new Set(listKinds).size > 1;
  const myOpenComments = post.comments.filter((c) => c.isMine && !c.resolved).length;
  // «Approva» is the primary button until there is feedback; then «Chiedi modifiche».
  const primary = primaryDecision({
    hasFeedback: hasDecisionFeedback({
      savedComments: myOpenComments,
      hasDraft: commentDirty,
      heiliPending: heili.pendingFeedback,
    }),
  });

  // ─── Pins and markers (numbers match the comment list) ─────────────────────

  const { located } = orderComments(post.comments);
  const pins: PreviewPin[] = located
    .filter((c) => c.pinX !== null && c.pinY !== null)
    .map((c) => ({
      id: c.id,
      mediaIndex: c.mediaIndex ?? 0,
      x: c.pinX ?? 0,
      y: c.pinY ?? 0,
      label: String(c.number),
      timeSec: c.timeSec,
      timeEndSec: c.timeEndSec,
    }));
  const markers: PreviewVideoMarker[] = located
    .filter((c) => c.timeSec !== null)
    .map((c) => ({
      id: c.id,
      timeSec: c.timeSec ?? 0,
      timeEndSec: c.timeEndSec,
      label: String(c.number),
      tone: c.authorType === "AGENCY" ? "agency" : "client",
      mediaIndex: c.mediaIndex ?? undefined,
    }));
  if (draft?.kind === "pin") {
    pins.push({ id: "draft", mediaIndex: draft.mediaIndex, x: draft.x, y: draft.y, label: "+" });
  }
  if (draft?.kind === "moment") {
    markers.push({ id: "draft", timeSec: draft.timeSec, label: "+", tone: "client", mediaIndex: draft.mediaIndex });
    if (draft.x !== undefined && draft.y !== undefined) {
      pins.push({
        id: "draft",
        mediaIndex: draft.mediaIndex,
        x: draft.x,
        y: draft.y,
        label: "+",
        timeSec: draft.timeSec,
      });
    }
  }

  // ─── Video ─────────────────────────────────────────────────────────────────

  const registerTimeGetter = useCallback((get: () => number) => {
    timeGetter.current = get;
  }, []);

  // For the assistant's "Usa il momento attuale" chip; null without a video.
  const getVideoTime = useCallback((): number | null => {
    const get = timeGetter.current;
    return get ? get() : null;
  }, []);

  const getPointContext = useCallback(() => {
    if (!draft || (draft.kind !== "pin" && draft.kind !== "moment")) return null;
    if (draft.kind === "moment" && (draft.x === undefined || draft.y === undefined)) return null;
    return {
      mediaIndex: draft.mediaIndex,
      x: draft.kind === "pin" ? draft.x : (draft.x ?? 0),
      y: draft.kind === "pin" ? draft.y : (draft.y ?? 0),
      timeSec: draft.kind === "moment" ? draft.timeSec : null,
    };
  }, [draft]);

  function seekTo(comment: PortalComment) {
    if (comment.timeSec === null) return;
    setSeek({ timeSec: comment.timeSec, nonce: Date.now(), mediaIndex: comment.mediaIndex ?? undefined });
    previewRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  function openDraft(next: CommentDraft) {
    if (commentDirty && draft) {
      setDecisionError("Hai una bozza non inviata. Inviala oppure annullala prima di spostarti su un altro punto.");
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-feedback-composer="active"] textarea')?.focus());
      return;
    }
    setNotice(null);
    setCommentDirty(false);
    setCommentListening(false);
    setDraft(next);
    setDraftKey((k) => k + 1);
  }

  /**
   * «Indica un punto sull'immagine» / «Indica il momento sul video» dal dock:
   * il tocco non apre il commento manuale, diventa un marcatore nel messaggio
   * di Heili e il dock si riapre.
   */
  function pickOrOpenDraft(next: CommentDraft) {
    if (heili.pick && (next.kind === "pin" || next.kind === "moment")) {
      heili.completePick(
        next.kind === "pin"
          ? { kind: "pin", mediaIndex: next.mediaIndex, x: next.x, y: next.y }
          : { kind: "moment", mediaIndex: next.mediaIndex, timeSec: next.timeSec, x: next.x, y: next.y }
      );
      return;
    }
    openDraft(next);
  }

  async function submitComment(input: CommentSubmission): Promise<string | null> {
    const result = await addCommentAction(token, { postId: ref.id, versionNumber: ref.versionNumber, ...input });
    if (!result.ok) {
      if (result.stale) setStale(true);
      return result.error;
    }
    setCommentDirty(false);
    setCommentListening(false);
    setDraft({ kind: "general" });
    setDraftKey((key) => key + 1);
    setDecisionError(null);
    setNotice(feedbackOpen
      ? "Commento aggiunto alla richiesta di modifiche già inviata."
      : "Commento salvato e visibile all’agenzia. Quando hai finito, premi «Chiedi modifiche» per inviare la richiesta.");
    return null;
  }

  // ─── Decisions ─────────────────────────────────────────────────────────────

  function finish(result: Outcome) {
    setOutcome(result);
    setCommentDirty(false);
    // "Chiedi modifiche": reopen a general draft so the client can add more right away.
    setDraft(result === "changes" ? { kind: "general" } : null);
    setDecisionError(null);
    setSheet(null);
    heili.closeDock();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSheet(kind: "approve") {
    if (blockUnsavedComment()) return;
    setDecisionError(null);
    setSheetError(null);
    setSheet(kind);
  }

  function blockUnsavedComment(): boolean {
    if (!commentDirty) return false;
    setDecisionError(UNSAVED_COMMENT_MESSAGE);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-feedback-composer="active"] textarea')?.focus());
    return true;
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
      openSheet("approve");
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

  // «Annulla» of the toast: the post goes back to "Da approvare", as it was.
  async function undoApprove(): Promise<string | null> {
    const result = await undoApprovalAction(token, { postId: ref.id, versionNumber: ref.versionNumber });
    if (!result.ok) return result.error;
    setOutcome(null);
    setDraft({ kind: "general" });
    setDraftKey((key) => key + 1);
    setNotice(null);
    setDecisionError(null);
    setStale(false);
    return null;
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

  // The assistant's "Approva" goes through the same confirmation sheet.
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

  // «Aggiungi al feedback»: the conclusion of Heili once the changes were already requested.
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

  function openHeili() {
    if (commentListening) {
      setDecisionError("Ferma la dettatura del commento prima di aprire Heili.");
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Ferma dettatura"]')?.focus());
      return;
    }
    heili.openDock("feedback");
  }

  // ─── Heili: what this page offers the dock ─────────────────────────────────

  const position = plan?.position ?? queue.position;
  const total = plan?.total ?? queue.toReviewCount;
  const networks = post.networks.map((network) => network.charAt(0).toUpperCase() + network.slice(1));
  const heiliHeading = position !== null && total > 0 ? `Post ${position} di ${total}${networks[0] ? ` · ${networks[0]}` : ""}` : post.title;
  const heiliDestinations: HeiliDestination[] = [];
  if (nextHref) {
    heiliDestinations.push({ id: "next", label: "Rivedi il prossimo post", href: nextHref, kind: "next" });
  }
  if (plan) {
    heiliDestinations.push({ id: "plan", label: plan.backLabel ?? "Torna al piano", href: plan.href, kind: "plan" });
  }
  heiliDestinations.push({ id: "home", label: "Torna all'inizio", href: portalPath(token), kind: "home" });

  useHeiliPage({
    page: "post",
    title: heiliHeading,
    summary: canAct ? "Da approvare" : feedbackOpen ? "Modifiche già chieste, puoi aggiungere altro" : undefined,
    destinations: heiliDestinations,
    services: listKinds,
    review: assistantAvailable
      ? {
          postId: post.id,
          versionNumber: post.versionNumber,
          mode: assistantMode,
          kind: "SOCIAL_POST",
          heading: heiliHeading,
          sessionKey: assistantKey,
          canPickPoint: canComment && post.media.length > 0,
          canPickMoment: canComment && hasVideo,
          getVideoTime: hasVideo ? getVideoTime : undefined,
          getPointContext,
          onSubmitChanges: canAct ? submitFromAssistant : addFromAssistant,
          onApprove: canAct ? approveFromAssistant : undefined,
          onRequestSavedChanges: requestSavedChanges,
        }
      : undefined,
  });

  // «?heili=1» (from Sfoglia's «Parla con Heili»): open the dock on the conversation on arrival.
  // After useHeiliPage on purpose: its effect registers this page's context, and the dock
  // picks the Feedback tab from the registered context; before it, the dock still saw the
  // previous page (Guida only) and opened on the Guida (QA-16).
  const openDock = heili.openDock;
  useEffect(() => {
    if (openedOnArrival) openDock("feedback");
  }, [openDock, openedOnArrival]);

  function reload() {
    setStale(false);
    setDecisionError(null);
    setSheet(null);
    setCommentDirty(false);
    setCommentListening(false);
    setDraft(null);
    router.refresh();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const draftIndex = draft && (draft.kind === "pin" || draft.kind === "moment") ? draft.mediaIndex : null;
  const draftMedia = draftIndex !== null ? post.media[draftIndex] : undefined;
  const scheduleSentence = client.schedulingOn
    ? `Il post verrà programmato per ${post.publishLabel}.`
    : `L'agenzia programmerà il post per ${post.publishLabel}.`;

  return (
    <div className="space-y-6">
      {plan ? (
        <PlanNav plan={plan} />
      ) : (
        <ReviewNav homeHref={homeHref} nextHref={nextHref} queue={queue} wording={wording} showProgress={outcome === null} />
      )}

      {stale && <StaleBanner text="L'agenzia ha aggiornato questo post nel frattempo." onReload={reload} />}

      {outcome && (
        <SuccessPanel
          title={outcome === "approved" ? "Fatto! Post approvato." : "Modifiche inviate all'agenzia."}
          nextHref={nextHref}
          homeHref={homeHref}
          remaining={Math.max(0, queue.toReviewCount - (queue.position !== null ? 1 : 0))}
          wording={wording}
        >
          <p className="text-sm">
            {outcome === "approved"
              ? scheduleSentence
              : newVersionNotice(reviewerHasEmail)}
          </p>
        </SuccessPanel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,640px)_minmax(340px,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">
          <header className="space-y-2">
            {mixedList && <KindLabel kind="SOCIAL_POST" />}
            <h1 className="text-xl font-semibold leading-snug sm:text-2xl">{post.title}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className={`font-medium ${post.canAct ? "text-accent" : post.status === "CHANGES_REQUESTED" ? "text-warning" : "text-success"}`}>
                {outcome === "approved"
                  ? "Approvato"
                  : outcome === "changes"
                    ? "Modifiche richieste"
                    : PORTAL_STATUS_LABELS[post.status]}
              </span>
              <span className="text-muted">Versione {post.versionNumber}</span>
            </div>
            <p className="text-base">
              <span className="text-muted">Pubblicazione: </span>
              <span className="font-medium">{post.publishLabel}</span>
            </p>
            {post.canAct && post.reviewDueLabel && outcome === null && (
              <p className="text-sm font-medium text-warning">Ti chiediamo di rispondere entro {post.reviewDueLabel}.</p>
            )}
          </header>

          {outcome === null && !post.canAct && <StatusNotice post={post} schedulingOn={client.schedulingOn} hasEmail={reviewerHasEmail} />}
        </div>

        <section
          ref={previewRef}
          className="scroll-mt-4 space-y-3 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:rounded-xl lg:border lg:border-border lg:bg-surface lg:p-5"
          aria-label="Anteprima del post"
        >
          {canComment && (
            <p className="text-sm text-muted">
              {hasVideo
                ? "Metti in pausa o tocca «Commenta» sul video per lasciare una nota su un momento preciso."
                : post.media.length > 0
                  ? "Tocca un punto dell'immagine per lasciare una nota proprio lì."
                  : "Leggi il testo e lasciaci un commento se vuoi cambiare qualcosa."}
            </p>
          )}
          <NetworkPreviewTabs
            networks={post.networks}
            networkOptions={post.networkOptions}
            text={post.text}
            firstCommentText={post.firstCommentText}
            media={post.media}
            accountName={client.name}
            accountAvatarUrl={client.logoUrl}
            publishAt={post.publishAt}
            timeZone={post.timeZone}
            pins={pins}
            markers={markers}
            onMediaClick={canComment ? (p) => pickOrOpenDraft({ kind: "pin", mediaIndex: p.mediaIndex, x: p.x, y: p.y }) : undefined}
            onRequestComment={
              canComment
                ? (p) => pickOrOpenDraft({ kind: "moment", mediaIndex: p.mediaIndex, timeSec: p.timeSec, x: p.x, y: p.y })
                : undefined
            }
            registerTimeGetter={hasVideo ? registerTimeGetter : undefined}
            seekTo={seek}
          />
        </section>

        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-2">
          {(post.text || post.firstCommentText) && (
            <details className="rounded-lg border border-border bg-surface">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 text-base font-semibold text-accent">
                Leggi il testo completo
              </summary>
              <div className="space-y-4 border-t border-border p-4">
                {post.text && (
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold">Testo del post</h2>
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-base leading-relaxed">{post.text}</p>
                  </div>
                )}
                {post.firstCommentText && (
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold">Primo commento</h2>
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-base leading-relaxed">{post.firstCommentText}</p>
                  </div>
                )}
              </div>
            </details>
          )}

          {changesSlot && (
            <details className="rounded-lg border border-accent/40 bg-surface">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 text-base font-semibold text-accent">
                Modifiche dalla versione precedente
              </summary>
              <div className="border-t border-border p-2 sm:p-3">{changesSlot}</div>
            </details>
          )}
          <section className="space-y-4 rounded-[20px] border border-border bg-surface p-4 sm:p-5" aria-labelledby="comments-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Il tuo feedback</p>
                <h2 id="comments-title" className="mt-1 text-xl font-semibold">Cosa ne pensi?</h2>
                <p className="mt-1 text-sm text-muted">{feedbackHint(canComment, assistantEnabled, feedbackOpen)}</p>
              </div>
              {post.comments.length > 0 && <span className="text-xs text-muted">{post.comments.length} salvati</span>}
            </div>
            {draft && canComment ? (
              <CommentComposer
                key={draftKey}
                draft={draft}
                mediaLabel={draftIndex !== null && post.media.length > 1 ? mediaName(draftMedia?.type, draftIndex, post.media.length) : null}
                durationSec={draftMedia?.durationSec}
                draftStorageScope={`${token}:${post.id}:${post.versionNumber}`}
                onSubmit={submitComment}
                onDirtyChange={setCommentDirty}
                onListeningChange={setCommentListening}
                assistantAction={
                  assistantAvailable ? <AssistantActionButton onToggle={openHeili} /> : undefined
                }
                onCancel={() => {
                  setCommentDirty(false);
                  setCommentListening(false);
                  setDraft({ kind: "general" });
                  setDraftKey((key) => key + 1);
                  setDecisionError(null);
                }}
                framed={false}
              />
            ) : canComment ? (
              <button type="button" onClick={() => openDraft({ kind: "general" })}
                className="min-h-12 w-full rounded-xl border border-border bg-background px-4 text-left text-sm text-muted hover:border-border-hover">
                Scrivi un commento per l&apos;agenzia…
              </button>
            ) : null}
            {notice && <p className="text-sm text-success" role="status">{notice}</p>}
            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Richieste raccolte</h3>
                <span className="text-xs text-muted">{post.comments.length}</span>
              </div>
              <CommentList comments={post.comments} media={post.media} onSeek={hasVideo ? seekTo : undefined}
                emptyText={canComment ? "Qui ritrovi i commenti salvati, anche quelli preparati con Heili." : "Nessun commento su questa versione."} />
            </div>
          </section>
        </div>
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

      <BottomSheet open={sheet === "approve"} title="Approvi questo post?" onClose={closeSheet} busy={sheetBusy}>
        <p className="text-base">{scheduleSentence}</p>
        <p className="text-sm text-muted">
          Stai approvando la versione {post.versionNumber}: verrà pubblicato esattamente quello che vedi.
        </p>
        {publishInPast && (
          <p className="text-sm text-warning">
            La data di pubblicazione è già passata: l&apos;agenzia ti proporrà un nuovo orario.
          </p>
        )}
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

/** "Piano social di ottobre · Post 3 di 12" with "Post precedente / successivo del piano". */
function PlanNav({ plan }: { plan: PortalPlanNav }) {
  if (plan.browse) {
    // From Sfoglia: the way back is the card; no previous / next of the plan.
    return (
      <nav className="inset space-y-2 p-3" aria-label="Post del piano" data-testid="plan-nav">
        <p className="label-caps">{plan.heading}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <Link href={plan.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
            ← {plan.backLabel ?? "Torna a Sfoglia"}
          </Link>
          <span className="text-sm text-muted tabular">
            Post {plan.position} di {plan.total}
          </span>
        </div>
      </nav>
    );
  }
  return (
    <nav className="inset space-y-2 p-3" aria-label="Post del piano" data-testid="plan-nav">
      <p className="label-caps">{plan.heading}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <Link href={plan.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
          ← {plan.backLabel ?? "Torna al piano"}
        </Link>
        <span className="text-sm text-muted tabular">
          Post {plan.position} di {plan.total}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {plan.prevHref ? (
          <Link
            href={plan.prevHref}
            className="flex min-h-11 items-center justify-start rounded-md border border-border bg-surface px-3 text-sm font-medium hover:border-border-hover"
          >
            Post precedente
          </Link>
        ) : (
          <span className="flex min-h-11 items-center px-3 text-sm text-muted">Primo del piano</span>
        )}
        {plan.nextHref ? (
          <Link
            href={plan.nextHref}
            className="flex min-h-11 items-center justify-end rounded-md border border-border bg-surface px-3 text-sm font-medium hover:border-border-hover"
          >
            Post successivo
          </Link>
        ) : (
          <span className="flex min-h-11 items-center justify-end px-3 text-sm text-muted">Ultimo del piano</span>
        )}
      </div>
    </nav>
  );
}

function StatusNotice({ post, schedulingOn, hasEmail }: { post: PortalPost; schedulingOn: boolean; hasEmail: boolean }) {
  let text: string;
  if (post.status === "CHANGES_REQUESTED") {
    text = hasEmail
      ? "Modifiche inviate all'agenzia. I tuoi commenti sono stati registrati: riceverai un'email quando la nuova versione sarà pronta."
      : "Modifiche inviate all'agenzia. I tuoi commenti sono stati registrati: l'agenzia ti avviserà quando la nuova versione sarà pronta.";
  } else if (post.status === "SCHEDULED") {
    text = `Il post è programmato e uscirà ${post.publishLabel}. Per cambiare qualcosa, contatta l'agenzia.`;
  } else if (post.status === "IN_REVIEW") {
    text = "Questo post è in aggiornamento: ricarica la pagina tra poco.";
  } else {
    const approved = post.approvedLabel ? `Hai approvato questo post ${post.approvedLabel}. ` : "Questo post è approvato. ";
    text = schedulingOn
      ? `${approved}Uscirà ${post.publishLabel}. Per cambiare qualcosa, contatta l'agenzia.`
      : `${approved}L'agenzia lo programmerà per la sua data. Per cambiare qualcosa, contattala.`;
  }
  return <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed" role="status">{text}</p>;
}
