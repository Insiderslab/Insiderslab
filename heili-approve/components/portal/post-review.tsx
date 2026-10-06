"use client";

/**
 * Client portal — one post under review.
 *
 * The client sees the post as it will appear on each network, can drop a
 * note on a point of an image or on a moment of a video, write general
 * comments, and then decides with two big buttons: "Approva" (after a
 * confirmation that says when it will be published) or "Chiedi modifiche"
 * (a message is required). Unsure clients can talk it through with the AI
 * assistant, which never decides for them. Each post is approved on its own;
 * after a decision the page offers the next post to review.
 */

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { ContentKind } from "@/app/generated/prisma/client";
import { approvePostAction, addCommentAction, requestChangesAction } from "@/app/review/[token]/actions";
import { NetworkPreviewTabs, type PreviewPin, type PreviewSeek, type PreviewVideoMarker } from "@/components/post-preview";
import AssistantPanel from "@/components/review/assistant-panel";
import BottomSheet from "./bottom-sheet";
import CommentComposer, { type CommentDraft, type CommentSubmission } from "./comment-composer";
import CommentList from "./comment-list";
import { PORTAL_STATUS_LABELS, mediaName, orderComments, portalPath, portalWording } from "./helpers";
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
import type { PortalClient, PortalComment, PortalPost, PortalQueue } from "./types";

type Outcome = "approved" | "changes";

const APPROVE_CANCELLED = "Approvazione annullata: puoi continuare a parlare con l'assistente.";

export interface PostReviewProps {
  token: string;
  post: PortalPost;
  client: PortalClient;
  queue: PortalQueue;
  assistantEnabled: boolean;
  /** The publish date is already behind us (the agency will pick a new one). */
  publishInPast: boolean;
  /** Server-rendered "Cosa è cambiato" block, if the post has earlier versions. */
  changesSlot?: ReactNode;
  /** Server-rendered history of earlier versions and their comments. */
  historySlot?: ReactNode;
  /** Kinds in the client's list (wording of the navigation); social only by default. */
  listKinds?: ContentKind[];
}

export default function PostReview({
  token,
  post,
  client,
  queue,
  assistantEnabled,
  publishInPast,
  changesSlot,
  historySlot,
  listKinds = ["SOCIAL_POST"],
}: PostReviewProps) {
  const router = useRouter();
  const previewRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<HTMLDivElement>(null);
  const timeGetter = useRef<(() => number) | null>(null);
  const assistantApproval = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [seek, setSeek] = useState<PreviewSeek | undefined>(undefined);
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
  const hasVideo = post.media.some((m) => m.type === "video");
  const nextHref = queue.nextPostId ? portalPath(token, queue.nextPostId) : null;
  const homeHref = portalPath(token);
  const wording = portalWording(listKinds);
  const mixedList = new Set(listKinds).size > 1;
  const myOpenComments = post.comments.filter((c) => c.isMine && !c.resolved).length;

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

  function seekTo(comment: PortalComment) {
    if (comment.timeSec === null) return;
    setSeek({ timeSec: comment.timeSec, nonce: Date.now(), mediaIndex: comment.mediaIndex ?? undefined });
    previewRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  function openDraft(next: CommentDraft) {
    setNotice(null);
    setDraft(next);
    setDraftKey((k) => k + 1);
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
    const result = await requestChangesAction(token, {
      postId: ref.id,
      versionNumber: ref.versionNumber,
      message,
    });
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

  const draftIndex = draft && (draft.kind === "pin" || draft.kind === "moment") ? draft.mediaIndex : null;
  const draftMedia = draftIndex !== null ? post.media[draftIndex] : undefined;
  const scheduleSentence = client.autoSchedule
    ? `Il post verrà programmato su Metricool per ${post.publishLabel}.`
    : `L'agenzia programmerà il post per ${post.publishLabel}.`;

  return (
    <div className="space-y-6">
      <ReviewNav homeHref={homeHref} nextHref={nextHref} queue={queue} wording={wording} showProgress={outcome === null} />

      {stale && <StaleBanner text="L'agenzia ha aggiornato questo post nel frattempo." onReload={reload} />}

      {outcome && (
        <SuccessPanel
          title={outcome === "approved" ? "Fatto! Post approvato." : "Richiesta inviata all'agenzia."}
          nextHref={nextHref}
          homeHref={homeHref}
          remaining={Math.max(0, queue.toReviewCount - (queue.position !== null ? 1 : 0))}
          wording={wording}
        >
          <p className="text-sm">
            {outcome === "approved"
              ? scheduleSentence
              : "L'agenzia preparerà una nuova versione: riceverai un'email quando sarà pronta da rivedere."}
          </p>
        </SuccessPanel>
      )}

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

      {outcome === null && !post.canAct && <StatusNotice post={post} />}

      {changesSlot}

      <section ref={previewRef} className="scroll-mt-4 space-y-3" aria-label="Anteprima del post">
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
          onMediaClick={canComment ? (p) => openDraft({ kind: "pin", mediaIndex: p.mediaIndex, x: p.x, y: p.y }) : undefined}
          onRequestComment={
            canComment
              ? (p) => openDraft({ kind: "moment", mediaIndex: p.mediaIndex, timeSec: p.timeSec, x: p.x, y: p.y })
              : undefined
          }
          registerTimeGetter={hasVideo ? registerTimeGetter : undefined}
          seekTo={seek}
        />
      </section>

      {draft && canComment && (
        <CommentComposer
          key={draftKey}
          draft={draft}
          mediaLabel={
            draftIndex !== null && post.media.length > 1
              ? mediaName(draftMedia?.type, draftIndex, post.media.length)
              : null
          }
          durationSec={draftMedia?.durationSec}
          onSubmit={submitComment}
          onCancel={() => setDraft(null)}
        />
      )}

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
            getVideoTime={hasVideo ? getVideoTime : undefined}
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
              Scrivi un commento
            </button>
          )}
        </div>
        <CommentList
          comments={post.comments}
          media={post.media}
          onSeek={hasVideo ? seekTo : undefined}
          emptyText={
            canComment
              ? "Ancora nessun commento su questa versione."
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
        {myOpenComments > 0 && (
          <p className="text-sm text-warning">
            {myOpenComments === 1
              ? "Hai lasciato un commento su questa versione: se approvi, il post uscirà così com'è."
              : `Hai lasciato ${myOpenComments} commenti su questa versione: se approvi, il post uscirà così com'è.`}
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
            placeholder="Per esempio: cambierei la prima frase e userei una foto più luminosa."
            className="w-full resize-y rounded-md border border-border bg-background p-3 text-base outline-none focus:border-accent"
          />
        </label>
        {myOpenComments > 0 && (
          <p className="text-sm text-muted">
            {myOpenComments === 1
              ? "Il commento che hai lasciato sul post arriverà all'agenzia insieme a questo messaggio."
              : `I ${myOpenComments} commenti che hai lasciato sul post arriveranno all'agenzia insieme a questo messaggio.`}
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

function StatusNotice({ post }: { post: PortalPost }) {
  let text: string;
  if (post.status === "CHANGES_REQUESTED") {
    text =
      "Hai chiesto delle modifiche: l'agenzia sta preparando una nuova versione e ti scriverà quando sarà pronta. Se ti viene in mente altro, aggiungi pure un commento.";
  } else if (post.status === "SCHEDULED") {
    text = `Il post è programmato e uscirà ${post.publishLabel}. Per cambiare qualcosa, contatta l'agenzia.`;
  } else if (post.status === "IN_REVIEW") {
    text = "Questo post è in aggiornamento: ricarica la pagina tra poco.";
  } else {
    text = `${post.approvedLabel ? `Hai approvato questo post ${post.approvedLabel}. ` : "Questo post è approvato. "}Uscirà ${post.publishLabel}. Per cambiare qualcosa, contatta l'agenzia.`;
  }
  return <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed">{text}</p>;
}
