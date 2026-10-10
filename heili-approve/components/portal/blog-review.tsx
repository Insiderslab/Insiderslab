"use client";

/**
 * Client portal — one blog article under review.
 *
 * The client reads the article as it will look on the site (comfortable on a
 * phone), selects a sentence to comment exactly there ("Commenta questa
 * frase"), sees what changed since the version they last read (server-
 * rendered, word by word), can open the search-engine details (secondary),
 * and decides with "Approva" / "Chiedi modifiche" like on a social post. The
 * AI assistant can be handed the passage selected in the article.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ContentKind } from "@/app/generated/prisma/client";
import { addCommentAction, approvePostAction, requestChangesAction } from "@/app/review/[token]/actions";
import BlogReader, { type BlogReaderComment } from "@/components/blog/blog-reader";
import AssistantPanel, { type AssistantPanelHandle } from "@/components/review/assistant-panel";
import { buildAnchor } from "@/lib/content/blog-text";
import type { BlogAnchor } from "@/lib/content/types";
import BottomSheet from "./bottom-sheet";
import CommentComposer, { type CommentDraft, type CommentSubmission } from "./comment-composer";
import { PORTAL_STATUS_LABELS, portalPath, portalWording } from "./helpers";
import KindLabel from "./kind-label";
import {
  AssistantToggle,
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
} from "./review-pieces";
import type { PortalBlogPost, PortalPassageComment, PortalQueue } from "./types";

type Outcome = "approved" | "changes";

const APPROVE_CANCELLED = "Approvazione annullata: puoi continuare a parlare con l'assistente.";

export interface BlogReviewProps {
  token: string;
  post: PortalBlogPost;
  queue: PortalQueue;
  /** Kinds in the client's list (wording of the navigation). */
  listKinds: ContentKind[];
  assistantEnabled: boolean;
  /** Server-rendered "Cosa è cambiato" (BlogVersionDiff), if there is an earlier version. */
  changesSlot?: ReactNode;
  /** Server-rendered "Dettagli per i motori di ricerca". */
  seoSlot?: ReactNode;
  /** Server-rendered history of earlier versions and their comments. */
  historySlot?: ReactNode;
}

/**
 * The passage selected inside the article body, as a BlogAnchor (same
 * offsets BlogReader uses: the body's textContent), or null.
 */
function readArticleSelection(container: HTMLElement | null): BlogAnchor | null {
  const root = container?.querySelector("[data-block]")?.parentElement ?? null;
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(root)) return null;

  const clamped = range.cloneRange();
  if (!root.contains(clamped.startContainer)) clamped.setStart(root, 0);
  if (!root.contains(clamped.endContainer)) clamped.setEnd(root, root.childNodes.length);
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(clamped.startContainer, clamped.startOffset);
  const start = before.toString().length;
  const end = start + clamped.toString().length;

  const startElement =
    clamped.startContainer.nodeType === Node.ELEMENT_NODE
      ? (clamped.startContainer as Element)
      : clamped.startContainer.parentElement;
  const block = startElement?.closest("[data-block]");
  const blockIndex = block && root.contains(block) ? Number(block.getAttribute("data-block")) : null;
  return buildAnchor(root.textContent ?? "", start, end, Number.isFinite(blockIndex) ? blockIndex : null);
}

export default function BlogReview({
  token,
  post,
  queue,
  listKinds,
  assistantEnabled,
  changesSlot,
  seoSlot,
  historySlot,
}: BlogReviewProps) {
  const router = useRouter();
  const readerRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<HTMLDivElement>(null);
  const assistantControl = useRef<AssistantPanelHandle>(null);
  const lastSelection = useRef<BlogAnchor | null>(null);
  const assistantApproval = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(
    post.canAct || post.status === "CHANGES_REQUESTED" ? { kind: "general" } : null
  );
  const [draftKey, setDraftKey] = useState(0);
  const [commentDirty, setCommentDirty] = useState(false);
  const [commentListening, setCommentListening] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const [sheet, setSheet] = useState<null | "approve">(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [draftSwitchNotice, setDraftSwitchNotice] = useState<string | null>(null);

  const ref = { id: post.id, versionNumber: post.versionNumber };
  const canAct = post.canAct && outcome === null;
  const canComment = (post.canAct || post.status === "CHANGES_REQUESTED") && outcome === null;
  const nextHref = queue.nextPostId ? portalPath(token, queue.nextPostId) : null;
  const homeHref = portalPath(token);
  const wording = portalWording(listKinds);
  // On this version (open notes carried over from earlier ones are not counted).
  const myOpenComments = post.comments.filter((c) => c.isMine && !c.resolved && c.fromVersion === null).length;

  const passageComments = post.comments
    .filter((c): c is PortalPassageComment & { anchor: BlogAnchor; number: number } => c.anchor !== null && c.number !== null)
    .sort((a, b) => a.number - b.number);
  const generalComments = post.comments.filter((c) => c.anchor === null || c.number === null);
  const readerComments: BlogReaderComment[] = passageComments.map((c) => ({
    id: c.id,
    number: c.number,
    anchor: c.anchor,
    resolved: c.resolved,
  }));

  // ─── Selected passage (for the assistant's chip) ───────────────────────────

  useEffect(() => {
    if (!assistantEnabled || !post.canAct) return;
    const onSelectionChange = () => {
      const anchor = readArticleSelection(readerRef.current);
      if (anchor) {
        lastSelection.current = anchor;
        return;
      }
      // A collapsed selection inside the article (a tap elsewhere in the text)
      // forgets the passage; taps outside it (the chip) keep it.
      const selection = window.getSelection();
      const node = selection?.anchorNode ?? null;
      if (selection?.isCollapsed && node && readerRef.current?.contains(node)) lastSelection.current = null;
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [assistantEnabled, post.canAct]);

  const getSelection = useCallback((): BlogAnchor | null => lastSelection.current, []);

  // ─── Comments ──────────────────────────────────────────────────────────────

  function openDraft(next: CommentDraft) {
    if (commentDirty && draft) {
      setDecisionError("Hai una bozza non inviata. Inviala oppure annullala prima di spostarti su un altro punto.");
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-feedback-composer="active"] textarea')?.focus());
      return;
    }
    setNotice(null);
    setDraftSwitchNotice(null);
    setCommentDirty(false);
    setCommentListening(false);
    setDraft(next);
    setDraftKey((k) => k + 1);
  }

  function openComment(commentId: string) {
    setActiveCommentId(commentId);
    requestAnimationFrame(() =>
      document.getElementById(`commento-${commentId}`)?.scrollIntoView({ block: "center", behavior: "smooth" })
    );
  }

  function showInText(commentId: string) {
    // BlogReader scrolls to the highlight of the active comment.
    setActiveCommentId(null);
    requestAnimationFrame(() => setActiveCommentId(commentId));
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
    setNotice(post.status === "CHANGES_REQUESTED"
      ? "Commento aggiunto alla richiesta di modifiche già inviata."
      : "Commento salvato e visibile all’agenzia. Quando hai finito, premi «Chiedi modifiche» per inviare la richiesta.");
    return null;
  }

  // ─── Decisions ─────────────────────────────────────────────────────────────

  function finish(result: Outcome) {
    setOutcome(result);
    setCommentDirty(false);
    setDraft(null);
    setDecisionError(null);
    setSheet(null);
    setAssistantOpen(false);
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
    if (assistantControl.current?.isLoadingFeedback()) {
      setDecisionError("Sto recuperando il feedback precedente. Riprova tra un momento.");
      return;
    }
    setDecisionError(null);
    if (assistantOpen || assistantControl.current?.hasPendingFeedback()) {
      setAssistantOpen(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await assistantControl.current?.requestChanges();
    } else {
      await requestSavedChanges();
    }
  }

  async function approveFromBar() {
    if (blockUnsavedComment() || sheetBusy) return;
    if (assistantControl.current?.isLoadingFeedback()) {
      setDecisionError("Sto recuperando il feedback precedente. Riprova tra un momento.");
      return;
    }
    setDecisionError(null);
    if (assistantOpen || assistantControl.current?.hasPendingFeedback()) {
      setAssistantOpen(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await assistantControl.current?.approve();
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

  async function toggleAssistant() {
    if (commentListening) {
      setDecisionError("Ferma la dettatura del commento prima di aprire Heili.");
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Ferma dettatura"]')?.focus());
      return;
    }
    if (assistantOpen && assistantControl.current && !(await assistantControl.current.close())) return;
    const open = !assistantOpen;
    setAssistantOpen(open);
    if (open) {
      requestAnimationFrame(() => assistantRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }

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

  const publishSentence = `Pubblicazione prevista: ${post.publishLabel}.`;

  return (
    <div className="space-y-6">
      <ReviewNav homeHref={homeHref} nextHref={nextHref} queue={queue} wording={wording} showProgress={outcome === null} />

      {stale && <StaleBanner text="L'agenzia ha aggiornato questo articolo nel frattempo." onReload={reload} />}

      {outcome && (
        <SuccessPanel
          title={outcome === "approved" ? "Fatto! Articolo approvato." : "Modifiche inviate all'agenzia."}
          nextHref={nextHref}
          homeHref={homeHref}
          remaining={Math.max(0, queue.toReviewCount - (queue.position !== null ? 1 : 0))}
          wording={wording}
        >
          <p className="text-sm">
            {outcome === "approved"
              ? `L'agenzia lo pubblicherà sul sito così come l'hai approvato. ${publishSentence}`
              : "L'agenzia preparerà una nuova versione: riceverai un'email quando sarà pronta da rivedere."}
          </p>
        </SuccessPanel>
      )}

      <header className="space-y-2">
        <KindLabel kind="BLOG_ARTICLE" />
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
          <span className="text-muted">Versione {post.versionNumber}</span>
        </div>
        <p className="text-base">
          <span className="text-muted">{post.dateLabel}: </span>
          <span className="font-medium">{post.publishLabel}</span>
        </p>
        {post.canAct && post.reviewDueLabel && outcome === null && (
          <p className="text-sm font-medium text-warning">Ti chiediamo di rispondere entro {post.reviewDueLabel}.</p>
        )}
      </header>

      {outcome === null && !post.canAct && <BlogStatusNotice post={post} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)] lg:items-start">
        <div className="space-y-4">
          {changesSlot}
          <section ref={readerRef} aria-label="Articolo" className="scroll-mt-4 rounded-[20px] border border-border bg-background px-4 py-6 sm:px-6">
            <BlogReader content={post.content} html={post.html} comments={readerComments}
              onCommentRequest={canComment ? (anchor) => openDraft({ kind: "passage", anchor }) : undefined}
              onCommentOpen={openComment} activeCommentId={activeCommentId} dateLabel={post.articleDateLabel} />
          </section>
          {seoSlot}
        </div>

      <section className="space-y-4 rounded-[20px] border border-border bg-surface p-4 sm:p-5" aria-labelledby="comments-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Il tuo feedback</p>
            <h2 id="comments-title" className="mt-1 text-xl font-semibold">Cosa ne pensi?</h2>
            <p className="mt-1 text-sm text-muted">{feedbackHint(canAct, assistantEnabled)}</p>
          </div>
          {post.comments.length > 0 && <span className="text-xs text-muted">{post.comments.length} salvati</span>}
        </div>
          {canComment && draft?.kind !== "general" && (
            <button
              type="button"
              onClick={() => openDraft({ kind: "general" })}
              className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm font-medium hover:border-border-hover"
            >
              Commento generale
            </button>
          )}
        {canAct && assistantEnabled && (
          <AssistantToggle open={assistantOpen} mounted showButton={assistantOpen} onToggle={toggleAssistant} containerRef={assistantRef}>
            <AssistantPanel
              key={`${post.id}-${post.versionNumber}`}
              controlRef={assistantControl}
              onRequestSavedChanges={requestSavedChanges}
              token={token}
              postId={post.id}
              versionNumber={post.versionNumber}
              onSubmitChanges={submitFromAssistant}
              onApprove={approveFromAssistant}
              kind="BLOG_ARTICLE"
              getSelection={getSelection}
            />
          </AssistantToggle>
        )}
        <div hidden={assistantOpen}>
        {draft?.kind === "general" && canComment && (
          <CommentComposer
            key={draftKey}
            draft={draft}
            mediaLabel={null}
            draftStorageScope={`${token}:${post.id}:${post.versionNumber}:general`}
            onSubmit={submitComment}
            onDirtyChange={setCommentDirty}
            onListeningChange={setCommentListening}
            assistantAction={
              canAct && assistantEnabled ? <AssistantActionButton onToggle={toggleAssistant} /> : undefined
            }
            onCancel={() => {
              setCommentDirty(false);
              setCommentListening(false);
              setDraft({ kind: "general" });
              setDraftKey((key) => key + 1);
              setDecisionError(null);
              setDraftSwitchNotice(null);
            }}
            framed={false}
          />
        )}
        </div>
        {notice && <p className="text-sm text-success" role="status">{notice}</p>}
        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-semibold">Richieste raccolte</h3>
        <BlogCommentList
          passages={passageComments}
          general={generalComments}
          activeCommentId={activeCommentId}
          onShowInText={showInText}
          emptyText={
            canComment
              ? "Ancora nessun commento su questa versione. Seleziona una frase dell'articolo per commentarla."
              : "Nessun commento su questa versione."
          }
        />
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
            <div className="flex gap-3">
              <button
                type="button"
                onClick={requestChangesFromBar}
                disabled={sheetBusy}
                className="min-h-12 flex-1 rounded-lg bg-accent px-3 text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {sheetBusy ? "Invio…" : "Chiedi modifiche"}
              </button>
              <button
                type="button"
                onClick={approveFromBar}
                disabled={sheetBusy}
                className="min-h-12 flex-1 rounded-lg border border-border bg-background px-3 text-base font-semibold text-foreground hover:border-border-hover disabled:opacity-50"
              >
                Approva
              </button>
            </div>
          </div>
        </DecisionBar>
      )}

      <BottomSheet
        open={draft?.kind === "passage" && canComment && !assistantOpen}
        title="Commenta il passaggio"
        onClose={() => {
          if (commentDirty) {
            setDraftSwitchNotice("Hai una bozza non inviata. Inviala oppure annullala prima di chiudere.");
            requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-feedback-composer="active"] textarea')?.focus());
            return;
          }
          setDraft({ kind: "general" });
          setDraftKey((key) => key + 1);
        }}
      >
        {draft?.kind === "passage" && (
          <>
          {draftSwitchNotice && (
            <p className="rounded-md border border-error/40 bg-surface p-3 text-sm text-error" role="alert">
              {draftSwitchNotice}
            </p>
          )}
          <CommentComposer
            key={draftKey}
            draft={draft}
            mediaLabel={null}
            draftStorageScope={`${token}:${post.id}:${post.versionNumber}:passage`}
            onSubmit={submitComment}
            onDirtyChange={setCommentDirty}
            onListeningChange={setCommentListening}
            assistantAction={
              canAct && assistantEnabled ? <AssistantActionButton onToggle={toggleAssistant} /> : undefined
            }
            onCancel={() => {
              setCommentDirty(false);
              setCommentListening(false);
              setDraft({ kind: "general" });
              setDraftKey((key) => key + 1);
              setDecisionError(null);
              setDraftSwitchNotice(null);
            }}
            framed={false}
          />
          </>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "approve"} title="Approvi questo articolo?" onClose={closeSheet} busy={sheetBusy}>
        <p className="text-base">L&apos;agenzia lo pubblicherà sul sito così com&apos;è. {publishSentence}</p>
        <p className="text-sm text-muted">
          Stai approvando la versione {post.versionNumber}: verrà pubblicato esattamente il testo che vedi.
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

function BlogStatusNotice({ post }: { post: PortalBlogPost }) {
  let text: string;
  if (post.status === "CHANGES_REQUESTED") {
    text =
      "Modifiche inviate all'agenzia. I tuoi commenti sono stati registrati: riceverai un messaggio quando la nuova versione dell'articolo sarà pronta.";
  } else if (post.status === "DELIVERED") {
    text = "L'articolo è stato pubblicato sul sito. Per cambiare qualcosa, contatta l'agenzia.";
  } else if (post.status === "IN_REVIEW") {
    text = "Questo articolo è in aggiornamento: ricarica la pagina tra poco.";
  } else {
    text = `${post.approvedLabel ? `Hai approvato questo articolo ${post.approvedLabel}. ` : "Questo articolo è approvato. "}L'agenzia lo pubblicherà sul sito (pubblicazione prevista ${post.publishLabel}). Per cambiare qualcosa, contatta l'agenzia.`;
  }
  return <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed" role="status">{text}</p>;
}

function BlogCommentList({
  passages,
  general,
  activeCommentId,
  onShowInText,
  emptyText,
}: {
  passages: Array<PortalPassageComment & { anchor: BlogAnchor; number: number }>;
  general: PortalPassageComment[];
  activeCommentId: string | null;
  onShowInText: (commentId: string) => void;
  emptyText: string;
}) {
  if (passages.length === 0 && general.length === 0) return <p className="text-sm text-muted">{emptyText}</p>;
  return (
    <div className="space-y-5">
      {passages.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Note sul testo</h3>
          <ul className="space-y-2">
            {passages.map((c) => (
              <BlogCommentItem key={c.id} comment={c} active={c.id === activeCommentId} onShowInText={onShowInText} />
            ))}
          </ul>
        </div>
      )}
      {general.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {passages.length > 0 ? "Commenti generali" : "Commenti"}
          </h3>
          <ul className="space-y-2">
            {general.map((c) => (
              <BlogCommentItem key={c.id} comment={c} active={c.id === activeCommentId} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BlogCommentItem({
  comment,
  active,
  onShowInText,
}: {
  comment: PortalPassageComment;
  active: boolean;
  onShowInText?: (commentId: string) => void;
}) {
  const agency = comment.authorType === "AGENCY";
  const missing = comment.placement === "missing";
  return (
    <li
      id={`commento-${comment.id}`}
      className={`scroll-mt-24 rounded-lg border p-3 ${
        active ? "border-accent" : agency ? "border-accent/40" : "border-border"
      } ${agency ? "bg-surface" : "bg-background"} ${comment.resolved ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-3">
        {comment.number !== null && (
          <span
            aria-label={`Nota ${comment.number}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
          >
            {comment.number}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs text-muted">
            <span className="font-medium text-foreground">
              {agency ? `${comment.authorName} · Agenzia` : comment.isMine ? "Tu" : comment.authorName}
            </span>{" "}
            · {comment.createdLabel}
            {comment.fromVersion !== null && <> · sulla versione {comment.fromVersion}</>}
            {comment.resolved && <span className="text-success"> · Risolto</span>}
          </p>
          {comment.anchor && (
            <blockquote
              className={`line-clamp-3 border-l-2 border-warning pl-2 text-sm italic text-muted ${missing ? "line-through" : ""}`}
            >
              «{comment.anchor.quote}»
            </blockquote>
          )}
          {comment.placement === "moved" && (
            <p className="text-xs text-muted">Il passaggio è stato modificato: è evidenziato il testo più simile.</p>
          )}
          {missing && <p className="text-xs text-muted">Il passaggio è stato riscritto e non è più nel testo.</p>}
          <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
          {onShowInText && !missing && (
            <button
              type="button"
              onClick={() => onShowInText(comment.id)}
              className="min-h-9 text-sm font-medium text-accent underline underline-offset-2"
            >
              Mostra nel testo
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
