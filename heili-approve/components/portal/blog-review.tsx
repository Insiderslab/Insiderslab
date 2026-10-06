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
import AssistantPanel from "@/components/review/assistant-panel";
import { buildAnchor } from "@/lib/content/blog-text";
import type { BlogAnchor } from "@/lib/content/types";
import BottomSheet from "./bottom-sheet";
import CommentComposer, { type CommentDraft, type CommentSubmission } from "./comment-composer";
import { PORTAL_STATUS_LABELS, portalPath, portalWording } from "./helpers";
import KindLabel from "./kind-label";
import {
  AssistantToggle,
  DecisionBar,
  ReviewNav,
  SheetButtons,
  SheetError,
  StaleBanner,
  SuccessPanel,
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
  const lastSelection = useRef<BlogAnchor | null>(null);
  const assistantApproval = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const [sheet, setSheet] = useState<null | "approve" | "changes">(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [changesMessage, setChangesMessage] = useState("");

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
    setNotice(null);
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
    setDraft(null);
    setNotice("Commento inviato: lo vedrà l'agenzia.");
    return null;
  }

  // ─── Decisions ─────────────────────────────────────────────────────────────

  function finish(result: Outcome) {
    setOutcome(result);
    setDraft(null);
    setSheet(null);
    setAssistantOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSheet(kind: "approve" | "changes") {
    setSheetError(null);
    setSheet(kind);
  }

  function closeSheet() {
    if (sheetBusy) return;
    assistantApproval.current?.reject(new Error(APPROVE_CANCELLED));
    assistantApproval.current = null;
    setSheet(null);
    setSheetError(null);
  }

  async function confirmApprove() {
    if (sheetBusy) return;
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

  async function confirmChanges() {
    const message = changesMessage.trim();
    if (sheetBusy || !message) return;
    setSheetBusy(true);
    setSheetError(null);
    const result = await requestChangesAction(token, { postId: ref.id, versionNumber: ref.versionNumber, message });
    setSheetBusy(false);
    if (!result.ok) {
      if (result.stale) setStale(true);
      setSheetError(result.error);
      return;
    }
    setChangesMessage("");
    finish("changes");
  }

  // The assistant's "Approva" goes through the same confirmation sheet.
  const approveFromAssistant = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        assistantApproval.current = { resolve, reject };
        setSheetError(null);
        setSheet("approve");
      }),
    []
  );

  async function submitFromAssistant(input: { message: string; reviewSessionId: string }) {
    const result = await requestChangesAction(token, {
      postId: ref.id,
      versionNumber: ref.versionNumber,
      message: input.message,
      reviewSessionId: input.reviewSessionId,
    });
    if (!result.ok) {
      if (result.stale) setStale(true);
      throw new Error(result.error);
    }
    finish("changes");
  }

  function toggleAssistant() {
    const open = !assistantOpen;
    setAssistantOpen(open);
    if (open) {
      requestAnimationFrame(() => assistantRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }

  function reload() {
    setStale(false);
    setSheet(null);
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
          title={outcome === "approved" ? "Fatto! Articolo approvato." : "Richiesta inviata all'agenzia."}
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

      {changesSlot}

      <section ref={readerRef} aria-label="Articolo" className="scroll-mt-4 rounded-lg border border-border bg-background px-4 py-6 sm:px-6">
        <BlogReader
          content={post.content}
          html={post.html}
          comments={readerComments}
          onCommentRequest={canComment ? (anchor) => openDraft({ kind: "passage", anchor }) : undefined}
          onCommentOpen={openComment}
          activeCommentId={activeCommentId}
          dateLabel={post.articleDateLabel}
        />
      </section>

      {seoSlot}

      {notice && (
        <p className="text-sm text-success" role="status">
          {notice}
        </p>
      )}

      {canAct && assistantEnabled && (
        <AssistantToggle open={assistantOpen} onToggle={toggleAssistant} containerRef={assistantRef}>
          <AssistantPanel
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

      <section className="space-y-3" aria-labelledby="comments-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="comments-title" className="text-base font-semibold">
            Commenti{post.comments.length > 0 ? ` (${post.comments.length})` : ""}
          </h2>
          {canComment && draft?.kind !== "general" && (
            <button
              type="button"
              onClick={() => openDraft({ kind: "general" })}
              className="min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:border-border-hover"
            >
              Commento generale
            </button>
          )}
        </div>
        {draft?.kind === "general" && canComment && (
          <CommentComposer
            key={draftKey}
            draft={draft}
            mediaLabel={null}
            onSubmit={submitComment}
            onCancel={() => setDraft(null)}
          />
        )}
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
      </section>

      {historySlot}

      {canAct && (
        <DecisionBar>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => openSheet("changes")}
              className="min-h-12 flex-1 rounded-lg border-2 border-foreground bg-background px-3 text-base font-semibold hover:bg-surface"
            >
              Chiedi modifiche
            </button>
            <button
              type="button"
              onClick={() => openSheet("approve")}
              className="min-h-12 flex-1 rounded-lg bg-success px-3 text-base font-semibold text-white hover:opacity-90"
            >
              Approva
            </button>
          </div>
        </DecisionBar>
      )}

      <BottomSheet
        open={draft?.kind === "passage" && canComment}
        title="Commenta il passaggio"
        onClose={() => setDraft(null)}
      >
        {draft?.kind === "passage" && (
          <CommentComposer
            key={draftKey}
            draft={draft}
            mediaLabel={null}
            onSubmit={submitComment}
            onCancel={() => setDraft(null)}
            framed={false}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "approve"} title="Approvi questo articolo?" onClose={closeSheet} busy={sheetBusy}>
        <p className="text-base">L&apos;agenzia lo pubblicherà sul sito così com&apos;è. {publishSentence}</p>
        <p className="text-sm text-muted">
          Stai approvando la versione {post.versionNumber}: verrà pubblicato esattamente il testo che vedi.
        </p>
        {myOpenComments > 0 && (
          <p className="text-sm text-warning">
            {myOpenComments === 1
              ? "Hai lasciato un commento su questa versione: se approvi, l'articolo uscirà così com'è."
              : `Hai lasciato ${myOpenComments} commenti su questa versione: se approvi, l'articolo uscirà così com'è.`}
          </p>
        )}
        <SheetError error={sheetError} stale={stale} onReload={reload} />
        <SheetButtons
          busy={sheetBusy}
          onCancel={closeSheet}
          onConfirm={confirmApprove}
          confirmLabel={sheetBusy ? "Approvazione…" : "Sì, approva"}
          confirmClass="bg-success text-white hover:opacity-90"
        />
      </BottomSheet>

      <BottomSheet open={sheet === "changes"} title="Cosa vorresti cambiare?" onClose={closeSheet} busy={sheetBusy}>
        <label className="block space-y-2">
          <span className="block text-sm text-muted">
            Scrivi all&apos;agenzia cosa non ti convince: preparerà una nuova versione da rivedere.
          </span>
          <textarea
            value={changesMessage}
            onChange={(e) => setChangesMessage(e.target.value.slice(0, 5000))}
            rows={5}
            placeholder="Per esempio: accorcerei l'introduzione e userei un tono più diretto."
            className="w-full resize-y rounded-md border border-border bg-background p-3 text-base outline-none focus:border-accent"
          />
        </label>
        {myOpenComments > 0 && (
          <p className="text-sm text-muted">
            {myOpenComments === 1
              ? "Il commento che hai lasciato sull'articolo arriverà all'agenzia insieme a questo messaggio."
              : `I ${myOpenComments} commenti che hai lasciato sull'articolo arriveranno all'agenzia insieme a questo messaggio.`}
          </p>
        )}
        <SheetError error={sheetError} stale={stale} onReload={reload} />
        <SheetButtons
          busy={sheetBusy}
          disabled={changesMessage.trim() === ""}
          onCancel={closeSheet}
          onConfirm={confirmChanges}
          confirmLabel={sheetBusy ? "Invio…" : "Invia la richiesta"}
          confirmClass="bg-foreground text-background hover:opacity-90"
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
      "Hai chiesto delle modifiche: l'agenzia sta preparando una nuova versione e ti scriverà quando sarà pronta. Se ti viene in mente altro, aggiungi pure un commento.";
  } else if (post.status === "DELIVERED") {
    text = "L'articolo è stato pubblicato sul sito. Per cambiare qualcosa, contatta l'agenzia.";
  } else if (post.status === "IN_REVIEW") {
    text = "Questo articolo è in aggiornamento: ricarica la pagina tra poco.";
  } else {
    text = `${post.approvedLabel ? `Hai approvato questo articolo ${post.approvedLabel}. ` : "Questo articolo è approvato. "}L'agenzia lo pubblicherà sul sito (pubblicazione prevista ${post.publishLabel}). Per cambiare qualcosa, contatta l'agenzia.`;
  }
  return <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed">{text}</p>;
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
