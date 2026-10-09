"use client";

/**
 * Client portal — a set of ads creatives under review.
 *
 * At the top the campaign (name, platform, objective, budget and audience
 * notes), then one card per variant (AdVariantReview): previews per
 * placement with pins and video moments, the copy, the comments, and the
 * decision "Approva variante" / "Scarta" (a note is required to discard).
 * The progress ("2 di 3 varianti decise") leads to "Invia le mie decisioni":
 * the set is approved when at least one variant is (the discarded ones reach
 * the agency with their notes), or goes back to the agency when all are
 * discarded. After sending, the outcome and the next item to review.
 *
 * Google Ads variants also list their titoli, descrizioni and parole chiave:
 * "Commenta questo titolo" opens a composer that quotes the asset in the
 * comment body (formatAssetComment), so the agency sees which one.
 *
 * The AI assistant gets the variant, placement and video moment on screen
 * (getContext) for its chip "Usa la variante e il momento attuali".
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ContentKind } from "@/app/generated/prisma/client";
import {
  addCommentAction,
  decideVariantAction,
  finalizeDecisionsAction,
  requestChangesAction,
} from "@/app/review/[token]/actions";
import AdVariantCompare from "@/components/ads/ad-variant-compare";
import AdVariantReview, { type AdCommentRequest } from "@/components/ads/ad-variant-review";
import AssetCommentComposer from "@/components/ads/asset-comment-composer";
import AdDecisionBadge from "@/components/ads/decision-badge";
import AssistantPanel, { type AssistantPanelHandle } from "@/components/review/assistant-panel";
import {
  AD_PLACEMENTS,
  AD_PLATFORM_LABELS,
  PLACEMENT_SPECS,
  variantDisplayName,
  type AdPlacement,
  type AdVariant,
  type GoogleAssetRef,
} from "@/lib/content/ads";
import type { AssistantAdsContext } from "@/lib/review-assistant/shared";
import BottomSheet from "./bottom-sheet";
import CommentComposer, { type CommentDraft, type CommentSubmission } from "./comment-composer";
import CommentList from "./comment-list";
import {
  countDecisions,
  decisionProgressLabel,
  mediaName,
  portalPath,
  portalStatusLabel,
  portalWording,
} from "./helpers";
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
} from "./review-pieces";
import type { PortalAdsPost, PortalQueue, PortalVariantDecision } from "./types";

type Outcome =
  | { kind: "decisions"; result: "APPROVED" | "CHANGES_REQUESTED"; approved: string[]; rejected: string[] }
  | { kind: "changes" };

type VariantDraft = { variantId: string; draft: CommentDraft };

const SEND_CANCELLED = "Invio annullato: puoi continuare a parlare con l'assistente.";

export interface AdsReviewProps {
  token: string;
  post: PortalAdsPost;
  client: { name: string; logoUrl: string | null };
  queue: PortalQueue;
  /** Kinds in the client's list (wording of the navigation). */
  listKinds: ContentKind[];
  assistantEnabled: boolean;
  /** Server-rendered "Cosa è cambiato", if there is an earlier version. */
  changesSlot?: ReactNode;
  /** Server-rendered history of earlier versions and their comments. */
  historySlot?: ReactNode;
}

/** Placement of a tab clicked inside AdPlacementPreviews (its id ends with "-<placement>"). */
function placementOfTab(target: EventTarget | null): AdPlacement | null {
  if (!(target instanceof Element)) return null;
  const tab = target.closest('[role="tab"]');
  const suffix = tab?.id.split("-").at(-1);
  return suffix && (AD_PLACEMENTS as readonly string[]).includes(suffix) ? (suffix as AdPlacement) : null;
}

function variantAnchorId(variantId: string): string {
  return `variante-${variantId}`;
}

export default function AdsReview({
  token,
  post,
  client,
  queue,
  listKinds,
  assistantEnabled,
  changesSlot,
  historySlot,
}: AdsReviewProps) {
  const router = useRouter();
  const assistantRef = useRef<HTMLDivElement>(null);
  const assistantControl = useRef<AssistantPanelHandle>(null);
  const assistantSend = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const variants = post.content.variants;
  const { campaign } = post.content;

  // What the client is looking at, for the assistant (read by a poll: refs).
  const activeVariant = useRef<string | null>(variants[0]?.id ?? null);
  const placements = useRef<Record<string, AdPlacement>>({});
  const timeGetters = useRef<Record<string, () => number>>({});

  const [decided, setDecided] = useState<Record<string, PortalVariantDecision>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [draft, setDraft] = useState<VariantDraft | null>(
    post.canAct || post.status === "CHANGES_REQUESTED" ? { variantId: "", draft: { kind: "general" } } : null
  );
  const [assetDraft, setAssetDraft] = useState<{ variantId: string; asset: GoogleAssetRef } | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [commentDirty, setCommentDirty] = useState(false);
  const [commentListening, setCommentListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const [sheet, setSheet] = useState<null | "send">(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const ref = { id: post.id, versionNumber: post.versionNumber };
  const canAct = post.canAct && outcome === null;
  const canComment = (post.canAct || post.status === "CHANGES_REQUESTED") && outcome === null;
  const nextHref = queue.nextPostId ? portalPath(token, queue.nextPostId) : null;
  const homeHref = portalPath(token);
  const wording = portalWording(listKinds);

  // Decisions saved in this visit win over the (possibly older) server props.
  const decisions: Record<string, PortalVariantDecision> = { ...post.decisions, ...decided };
  const count = countDecisions(
    variants.map((v) => v.id),
    decisions
  );
  const nameOf = (id: string) => {
    const variant = variants.find((v) => v.id === id);
    return variant ? variantDisplayName(variant) : `Variante ${id}`;
  };
  const variantNames = Object.fromEntries(variants.map((v) => [v.id, variantDisplayName(v)]));
  const setComments = post.comments.filter((c) => c.variantId === null);
  const myOpenComments = post.comments.filter((c) => c.isMine && !c.resolved).length;

  // ─── Variant on screen ─────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.getAttribute("data-variant-id");
        if (id) activeVariant.current = id;
      },
      { threshold: [0.25, 0.5, 0.75] }
    );
    for (const variant of variants) {
      const el = document.getElementById(variantAnchorId(variant.id));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [variants]);

  const getContext = useCallback((): AssistantAdsContext | null => {
    const id = activeVariant.current;
    const variant = variants.find((v) => v.id === id);
    if (!variant) return null;
    const placement = placements.current[variant.id] ?? variant.placements[0] ?? null;
    const hasVideo = variant.media.some((m) => m.type === "video");
    const time = hasVideo ? timeGetters.current[variant.id]?.() : undefined;
    return {
      variantId: variant.id,
      variantName: variantDisplayName(variant),
      placement,
      placementLabel: placement ? PLACEMENT_SPECS[placement].label : null,
      timeSec: typeof time === "number" && Number.isFinite(time) ? time : null,
    };
  }, [variants]);

  const getPointContext = useCallback(() => {
    const current = draft?.draft;
    if (!current || (current.kind !== "pin" && current.kind !== "moment")) return null;
    if (current.kind === "moment" && (current.x === undefined || current.y === undefined)) return null;
    return {
      mediaIndex: current.mediaIndex,
      x: current.kind === "pin" ? current.x : (current.x ?? 0),
      y: current.kind === "pin" ? current.y : (current.y ?? 0),
      variantId: draft?.variantId ?? null,
      timeSec: current.kind === "moment" ? current.timeSec : null,
    };
  }, [draft]);

  function jumpTo(variantId: string) {
    activeVariant.current = variantId;
    document.getElementById(variantAnchorId(variantId))?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  function openDraft(variantId: string, next: CommentDraft) {
    if (commentDirty && (draft || assetDraft)) {
      setDecisionError("Hai una bozza non inviata. Inviala oppure annullala prima di spostarti su un altro punto.");
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-feedback-composer="active"] textarea')?.focus());
      return;
    }
    activeVariant.current = variantId;
    setNotice(null);
    setCommentDirty(false);
    setCommentListening(false);
    setAssetDraft(null);
    setDraft({ variantId, draft: next });
    setDraftKey((k) => k + 1);
  }

  function requestComment(variantId: string, request: AdCommentRequest) {
    if (request.timeSec !== undefined) {
      openDraft(variantId, {
        kind: "moment",
        mediaIndex: request.mediaIndex,
        timeSec: request.timeSec,
        x: request.x,
        y: request.y,
      });
    } else if (request.x !== undefined && request.y !== undefined) {
      openDraft(variantId, { kind: "pin", mediaIndex: request.mediaIndex, x: request.x, y: request.y });
    }
  }

  async function submitComment(variantId: string | null, input: CommentSubmission): Promise<string | null> {
    const result = await addCommentAction(token, {
      postId: ref.id,
      versionNumber: ref.versionNumber,
      ...input,
      ...(variantId ? { variantId } : {}),
    });
    if (!result.ok) {
      if (result.stale) setStale(true);
      return result.error;
    }
    setCommentDirty(false);
    setCommentListening(false);
    setDraft({ variantId: "", draft: { kind: "general" } });
    setAssetDraft(null);
    setDraftKey((key) => key + 1);
    setDecisionError(null);
    setNotice(post.status === "CHANGES_REQUESTED"
      ? "Commento aggiunto alla richiesta di modifiche già inviata."
      : "Commento salvato e visibile all’agenzia. Quando hai finito, premi «Chiedi modifiche» per inviare la richiesta.");
    return null;
  }

  function openAssetDraft(variantId: string, asset: GoogleAssetRef) {
    if (commentDirty && (draft || assetDraft)) {
      setDecisionError("Hai una bozza non inviata. Inviala oppure annullala prima di spostarti su un altro punto.");
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-feedback-composer="active"] textarea')?.focus());
      return;
    }
    activeVariant.current = variantId;
    setNotice(null);
    setCommentDirty(false);
    setCommentListening(false);
    setDraft(null);
    setAssetDraft({ variantId, asset });
  }

  // ─── Decisions ─────────────────────────────────────────────────────────────

  async function decide(variantId: string, input: { verdict: "APPROVED" | "REJECTED"; note: string | null }) {
    activeVariant.current = variantId;
    const result = await decideVariantAction(token, {
      postId: ref.id,
      versionNumber: ref.versionNumber,
      variantId,
      verdict: input.verdict,
      note: input.note,
    });
    if (!result.ok) {
      if (result.stale) setStale(true);
      return result.error;
    }
    setDecided((current) => ({
      ...current,
      [variantId]: { verdict: input.verdict, note: input.note, isMine: true, reviewerName: null },
    }));
    return null;
  }

  function finish(next: Outcome) {
    setOutcome(next);
    setCommentDirty(false);
    setDraft(null);
    setAssetDraft(null);
    setDecisionError(null);
    setSheet(null);
    setAssistantOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSheet(kind: "send") {
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
    setDecisionError(null);
    if (assistantOpen || assistantControl.current?.hasPendingFeedback()) {
      setAssistantOpen(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await assistantControl.current?.approve();
    } else {
      openSheet("send");
    }
  }

  function closeSheet() {
    if (sheetBusy) return;
    assistantSend.current?.reject(new Error(SEND_CANCELLED));
    assistantSend.current = null;
    setSheet(null);
    setSheetError(null);
  }

  async function confirmSend() {
    if (sheetBusy || blockUnsavedComment()) return;
    setSheetBusy(true);
    setSheetError(null);
    const result = await finalizeDecisionsAction(token, { postId: ref.id, versionNumber: ref.versionNumber });
    setSheetBusy(false);
    const fromAssistant = assistantSend.current;
    assistantSend.current = null;
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
    finish({
      kind: "decisions",
      result: result.data.result,
      approved: result.data.approved,
      rejected: result.data.rejected,
    });
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
    finish({ kind: "changes" });
  }

  // The assistant's "Invia le mie decisioni" goes through the same sheet,
  // and only once every variant has a decision taken by the client.
  const firstMissing = count.missing[0] ?? null;
  const sendFromAssistant = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (commentDirty) {
          reject(new Error(UNSAVED_COMMENT_MESSAGE));
          return;
        }
        if (firstMissing) {
          jumpTo(firstMissing);
          reject(new Error("Prima decidi ogni variante con «Approva variante» o «Scarta», poi invia le decisioni."));
          return;
        }
        assistantSend.current = { resolve, reject };
        setSheetError(null);
        setSheet("send");
      }),
    [firstMissing, commentDirty]
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
    finish({ kind: "changes" });
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
    setAssetDraft(null);
    setDecided({});
    router.refresh();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const statusLabel =
    outcome?.kind === "decisions"
      ? outcome.result === "APPROVED"
        ? "Approvate"
        : "Modifiche richieste"
      : outcome?.kind === "changes"
        ? "Modifiche richieste"
        : portalStatusLabel("AD_CREATIVE", post.status);
  const allRejected = count.decided === count.total && count.approved.length === 0 && count.total > 0;

  return (
    <div className="space-y-6">
      <ReviewNav homeHref={homeHref} nextHref={nextHref} queue={queue} wording={wording} showProgress={outcome === null} />

      {stale && <StaleBanner text="L'agenzia ha aggiornato queste creatività nel frattempo." onReload={reload} />}

      {outcome && (
        <SuccessPanel
          title={outcome.kind === "decisions" ? "Decisioni inviate all'agenzia." : "Modifiche inviate all'agenzia."}
          nextHref={nextHref}
          homeHref={homeHref}
          remaining={Math.max(0, queue.toReviewCount - (queue.position !== null ? 1 : 0))}
          wording={wording}
        >
          {outcome.kind === "decisions" ? (
            <OutcomeSummary
              approved={outcome.approved.map(nameOf)}
              rejected={outcome.rejected.map(nameOf)}
              result={outcome.result}
              publishLabel={post.publishLabel}
            />
          ) : (
            <p className="text-sm">
              L&apos;agenzia preparerà una nuova versione: riceverai un&apos;email quando sarà pronta da rivedere.
            </p>
          )}
        </SuccessPanel>
      )}

      <header className="space-y-2">
        <KindLabel kind="AD_CREATIVE" />
        <h1 className="text-xl font-semibold leading-snug sm:text-2xl">{post.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span
            className={`font-medium ${post.canAct && !outcome ? "text-accent" : post.status === "CHANGES_REQUESTED" ? "text-warning" : "text-success"}`}
          >
            {statusLabel}
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

      <CampaignSummary
        name={campaign.name}
        platform={AD_PLATFORM_LABELS[campaign.platform] ?? campaign.platform}
        objective={campaign.objective}
        budgetNote={campaign.budgetNote}
        audienceNote={campaign.audienceNote}
        variantCount={variants.length}
      />

      {outcome === null && !post.canAct && <AdsStatusNotice post={post} />}

      {changesSlot}

      {variants.length > 0 && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4" aria-labelledby="ads-progress">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ads-progress" className="text-base font-semibold">
              {decisionProgressLabel(count)}
            </h2>
            {canAct && count.decided < count.total && (
              <p className="text-sm text-muted">Approva o scarta ogni variante, poi invia le tue decisioni.</p>
            )}
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-background"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={count.total}
            aria-valuenow={count.decided}
            aria-label={decisionProgressLabel(count)}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${count.total > 0 ? Math.round((count.decided / count.total) * 100) : 0}%` }}
            />
          </div>
          {variants.length > 1 && (
            <ul className="flex flex-wrap gap-2">
              {variants.map((variant) => (
                <li key={variant.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(variant.id)}
                    className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 text-sm hover:border-border-hover"
                  >
                    <span className="truncate">{variantDisplayName(variant)}</span>
                    <AdDecisionBadge verdict={decisions[variant.id]?.verdict} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {variants.length > 1 && (
        <details
          className="rounded-lg border border-border"
          onToggle={(event) => setCompareOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
            Confronta le varianti affiancate
          </summary>
          {compareOpen && (
            <div className="border-t border-border p-4">
              <AdVariantCompare
                variants={variants}
                decisions={decisions}
                accountName={client.name}
                accountAvatarUrl={client.logoUrl}
                onOpenVariant={jumpTo}
              />
            </div>
          )}
        </details>
      )}

      {notice && (
        <p className="text-sm text-success" role="status">
          {notice}
        </p>
      )}

      {variants.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Questo set non contiene ancora varianti: l&apos;agenzia lo sta completando.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)] lg:items-start">
      <div className="space-y-4">
      {variants.map((variant, index) => (
        <div
          key={variant.id}
          id={variantAnchorId(variant.id)}
          data-variant-id={variant.id}
          className="scroll-mt-4 rounded-lg border border-border bg-background p-4"
          onClickCapture={(event) => {
            const placement = placementOfTab(event.target);
            if (placement) placements.current[variant.id] = placement;
            activeVariant.current = variant.id;
          }}
        >
          <AdVariantReview
            variant={variant}
            platform={campaign.platform}
            accountName={client.name}
            accountAvatarUrl={client.logoUrl}
            comments={post.comments.filter((c) => c.variantId === variant.id)}
            decision={decisions[variant.id] ?? null}
            canDecide={canAct}
            onDecide={(input) => decide(variant.id, input)}
            onRequestComment={canComment ? (request) => requestComment(variant.id, request) : undefined}
            onRequestGeneralComment={canComment ? () => openDraft(variant.id, { kind: "general" }) : undefined}
            composer={
              draft?.variantId === variant.id && canComment ? (
                <div hidden={assistantOpen}>
                <VariantComposer
                  key={draftKey}
                  variant={variant}
                  draft={draft.draft}
                  draftStorageScope={`${token}:${post.id}:${post.versionNumber}:variant:${variant.id}`}
                  onDirtyChange={setCommentDirty}
                  onListeningChange={setCommentListening}
                  assistantAction={
                    canAct && assistantEnabled ? <AssistantActionButton onToggle={toggleAssistant} /> : undefined
                  }
                  onSubmit={(input) => submitComment(variant.id, input)}
                  onCancel={() => {
                    setCommentDirty(false);
                    setCommentListening(false);
                    setDraft({ variantId: "", draft: { kind: "general" } });
                    setDraftKey((key) => key + 1);
                    setDecisionError(null);
                  }}
                />
                </div>
              ) : undefined
            }
            onCommentAsset={canComment ? (asset) => openAssetDraft(variant.id, asset) : undefined}
            activeAsset={assetDraft?.variantId === variant.id ? assetDraft.asset : null}
            assetComposer={
              assetDraft?.variantId === variant.id && canComment ? (
                <div hidden={assistantOpen}>
                <AssetCommentComposer
                  key={`${assetDraft.asset.kind}-${assetDraft.asset.index}`}
                  asset={assetDraft.asset}
                  draftStorageScope={`${token}:${post.id}:${post.versionNumber}:variant:${variant.id}:asset:${assetDraft.asset.kind}:${assetDraft.asset.index}`}
                  onDirtyChange={setCommentDirty}
                  onListeningChange={setCommentListening}
                  assistantAction={
                    canAct && assistantEnabled ? <AssistantActionButton onToggle={toggleAssistant} /> : undefined
                  }
                  onSubmit={(body) => submitComment(variant.id, { body })}
                  onCancel={() => {
                    setCommentDirty(false);
                    setCommentListening(false);
                    setAssetDraft(null);
                    setDraft({ variantId: "", draft: { kind: "general" } });
                    setDraftKey((key) => key + 1);
                    setDecisionError(null);
                  }}
                />
                </div>
              ) : undefined
            }
            draftPin={draftPinOf(draft, variant.id)}
            registerTimeGetter={(get) => {
              timeGetters.current[variant.id] = get;
            }}
            onTimeChange={() => {
              activeVariant.current = variant.id;
            }}
            position={variants.length > 1 ? { index, total: variants.length } : undefined}
          />
        </div>
      ))}
      </div>

      {(setComments.length > 0 || canComment || (canAct && assistantEnabled)) && (
        <section className="space-y-4 rounded-[20px] border border-border bg-surface p-4 sm:p-5 lg:sticky lg:top-4" aria-labelledby="set-comments-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Il tuo feedback</p>
              <h2 id="set-comments-title" className="mt-1 text-xl font-semibold">Cosa ne pensi?</h2>
              <p className="mt-1 text-sm text-muted">Sul set in generale puoi scrivere, dettare o parlare con Heili.</p>
            </div>
            {setComments.length > 0 && <span className="text-xs text-muted">{setComments.length} salvati</span>}
          </div>
            {canComment && !(draft?.variantId === "" && draft.draft.kind === "general") && (
              <button
                type="button"
                onClick={() => openDraft("", { kind: "general" })}
                className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm font-medium hover:border-border-hover"
              >
                Scrivi un commento
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
                onApprove={sendFromAssistant}
                kind="AD_CREATIVE"
                getContext={getContext}
                variantNames={variantNames}
                getPointContext={getPointContext}
              />
            </AssistantToggle>
          )}
          <div hidden={assistantOpen}>
          {draft?.variantId === "" && canComment && (
            <CommentComposer
              key={draftKey}
              draft={draft.draft}
              mediaLabel={null}
              draftStorageScope={`${token}:${post.id}:${post.versionNumber}:set`}
              onDirtyChange={setCommentDirty}
              onListeningChange={setCommentListening}
              assistantAction={
                canAct && assistantEnabled ? <AssistantActionButton onToggle={toggleAssistant} /> : undefined
              }
              onSubmit={(input) => submitComment(null, input)}
              onCancel={() => {
                setCommentDirty(false);
                setCommentListening(false);
                setDraft({ variantId: "", draft: { kind: "general" } });
                setDraftKey((key) => key + 1);
                setDecisionError(null);
              }}
              framed={false}
            />
          )}
          </div>
          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-semibold">Richieste raccolte</h3>
          <CommentList
            comments={setComments}
            media={[]}
            emptyText="Per la campagna in generale (date, budget, pubblico) scrivi qui; per una variante usa «Commenta la variante»."
          />
          </div>
        </section>
      )}
      </div>

      {historySlot}

      {canAct && variants.length > 0 && (
        <DecisionBar>
          <div className="space-y-2">
            <p className="text-center text-sm text-muted" aria-live="polite">
              {decisionProgressLabel(count)}
              {count.missing.length > 0 && count.missing.length < count.total
                ? ` · manca ${count.missing.map(nameOf).join(", ")}`
                : ""}
            </p>
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
                className="min-h-12 flex-1 rounded-lg border border-border bg-background px-3 text-base font-semibold text-foreground hover:border-border-hover disabled:opacity-50"
              >
                {sheetBusy ? "Invio…" : "Chiedi modifiche"}
              </button>
              <button
                type="button"
                onClick={approveFromBar}
                disabled={sheetBusy || count.missing.length > 0}
                className="min-h-12 flex-1 rounded-lg bg-accent px-3 text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Invia le mie decisioni
              </button>
            </div>
          </div>
        </DecisionBar>
      )}

      <BottomSheet open={sheet === "send"} title="Invii le tue decisioni?" onClose={closeSheet} busy={sheetBusy}>
        <DecisionList
          approved={count.approved.map(nameOf)}
          rejected={count.rejected.map((id) => ({ name: nameOf(id), note: decisions[id]?.note ?? null }))}
        />
        <p className="text-base">
          {allRejected
            ? "Hai scartato tutte le varianti: l'agenzia riceverà le tue note e preparerà nuove proposte."
            : `Le varianti approvate saranno usate per la campagna (${post.dateLabel.toLowerCase()}: ${post.publishLabel}). L'agenzia vedrà anche le note sulle varianti scartate.`}
        </p>
        <p className="text-sm text-muted">
          Stai decidendo sulla versione {post.versionNumber}: verranno usate esattamente le creatività che vedi.
        </p>
        {canAct && <OpenFeedbackNotice comments={post.comments} ads />}
        <SheetError error={sheetError} stale={stale} onReload={reload} />
        <SheetButtons
          busy={sheetBusy}
          onCancel={closeSheet}
          onConfirm={confirmSend}
          confirmLabel={sheetBusy ? "Invio…" : "Sì, invia"}
          confirmClass="bg-success text-white hover:opacity-90"
        />
      </BottomSheet>

    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** The "+" drawn while the composer is open on a point or a paused frame. */
function draftPinOf(
  draft: VariantDraft | null,
  variantId: string
): { mediaIndex: number; x: number; y: number; timeSec?: number } | null {
  if (!draft || draft.variantId !== variantId) return null;
  const d = draft.draft;
  if (d.kind === "pin") return { mediaIndex: d.mediaIndex, x: d.x, y: d.y };
  if (d.kind === "moment" && d.x !== undefined && d.y !== undefined) {
    return { mediaIndex: d.mediaIndex, x: d.x, y: d.y, timeSec: d.timeSec };
  }
  return null;
}

function VariantComposer({
  variant,
  draft,
  draftStorageScope,
  onSubmit,
  onCancel,
  onDirtyChange,
  onListeningChange,
  assistantAction,
}: {
  variant: AdVariant;
  draft: CommentDraft;
  draftStorageScope: string;
  onSubmit: (input: CommentSubmission) => Promise<string | null>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onListeningChange: (listening: boolean) => void;
  assistantAction?: ReactNode;
}) {
  const index = draft.kind === "pin" || draft.kind === "moment" ? draft.mediaIndex : null;
  const media = index !== null ? variant.media[index] : undefined;
  const name = variantDisplayName(variant);
  const label =
    index !== null && variant.media.length > 1 ? `${name} · ${mediaName(media?.type, index, variant.media.length)}` : name;
  return (
    <CommentComposer
      draft={draft}
      mediaLabel={label}
      durationSec={media?.durationSec}
      draftStorageScope={draftStorageScope}
      onDirtyChange={onDirtyChange}
      onListeningChange={onListeningChange}
      assistantAction={assistantAction}
      autoFocus
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

function CampaignSummary({
  name,
  platform,
  objective,
  budgetNote,
  audienceNote,
  variantCount,
}: {
  name: string;
  platform: string;
  objective: string;
  budgetNote: string;
  audienceNote: string;
  variantCount: number;
}) {
  const rows = [
    { label: "Piattaforma", value: platform },
    { label: "Obiettivo", value: objective.trim() },
    { label: "Budget", value: budgetNote.trim() },
    { label: "Pubblico", value: audienceNote.trim() },
  ].filter((row) => row.value);
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4" aria-labelledby="campaign-title">
      <div className="space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Campagna</p>
        <h2 id="campaign-title" className="break-words text-base font-semibold">
          {name.trim() || "Campagna senza nome"}
        </h2>
        <p className="text-sm text-muted">
          {variantCount === 1 ? "1 variante da rivedere" : `${variantCount} varianti da rivedere`}
        </p>
      </div>
      {rows.length > 0 && (
        <dl className="grid gap-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-xs text-muted">{row.label}</dt>
              <dd className="whitespace-pre-wrap break-words text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function DecisionList({
  approved,
  rejected,
}: {
  approved: string[];
  rejected: Array<{ name: string; note: string | null }>;
}) {
  return (
    <div className="space-y-3">
      {approved.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-success">Approvate ({approved.length})</p>
          <ul className="space-y-1 text-sm">
            {approved.map((name) => (
              <li key={name} className="break-words">
                ✓ {name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rejected.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-error">Scartate ({rejected.length})</p>
          <ul className="space-y-2 text-sm">
            {rejected.map((item) => (
              <li key={item.name} className="break-words">
                ✕ {item.name}
                {item.note && <span className="block whitespace-pre-wrap pl-4 text-muted">{item.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OutcomeSummary({
  approved,
  rejected,
  result,
  publishLabel,
}: {
  approved: string[];
  rejected: string[];
  result: "APPROVED" | "CHANGES_REQUESTED";
  publishLabel: string;
}) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        {result === "APPROVED"
          ? `L'agenzia userà le varianti approvate per la campagna, con inizio ${publishLabel}.`
          : "Hai scartato tutte le varianti: l'agenzia preparerà nuove proposte e riceverai un'email quando saranno pronte."}
      </p>
      {approved.length > 0 && (
        <p>
          <span className="font-medium text-success">Approvate:</span> {approved.join(", ")}
        </p>
      )}
      {rejected.length > 0 && (
        <p>
          <span className="font-medium text-error">Scartate:</span> {rejected.join(", ")}
        </p>
      )}
    </div>
  );
}

function AdsStatusNotice({ post }: { post: PortalAdsPost }) {
  let text: string;
  if (post.status === "CHANGES_REQUESTED") {
    text =
      "Modifiche inviate all'agenzia. I tuoi commenti sono stati registrati: riceverai un messaggio quando le nuove creatività saranno pronte.";
  } else if (post.status === "DELIVERED") {
    text = "Le creatività approvate sono state consegnate per la campagna. Per cambiare qualcosa, contatta l'agenzia.";
  } else if (post.status === "IN_REVIEW") {
    text = "Queste creatività sono in aggiornamento: ricarica la pagina tra poco.";
  } else {
    text = `${post.approvedLabel ? `Hai inviato le tue decisioni ${post.approvedLabel}. ` : "Le creatività sono approvate. "}L'agenzia preparerà la campagna (inizio ${post.publishLabel}). Per cambiare qualcosa, contatta l'agenzia.`;
  }
  return <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed" role="status">{text}</p>;
}
