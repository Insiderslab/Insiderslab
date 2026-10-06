"use client";

/**
 * Ad Review (agency side of the review of an ad set)
 *
 * For the version shown:
 * - "Decisioni del cliente": one row per variant with the verdict
 *   (approvata / scartata / da decidere), the client's note — kept for the
 *   discarded variants too — who decided and when;
 * - the variants side by side (AdVariantCompare), "Apri" jumps to a variant;
 * - one card per variant: previews per placement with the numbered pins and
 *   video markers of its comments, the copy, the spec checks still open,
 *   and its comment threads with reply and resolve. The agency comments like
 *   the client: tap an image for a pin, "Commenta a m:ss" on a video, or a
 *   general comment on the variant;
 * - the comments on the whole set and the assistant transcripts.
 */

import { useState, useTransition, type ReactNode } from "react";
import { addCommentAction } from "@/app/(dashboard)/posts/actions";
import { AdPlacementPreviews } from "@/components/ads/ad-preview";
import AdVariantCompare from "@/components/ads/ad-variant-compare";
import AdDecisionBadge, { DECISION_LABELS, type AdVariantDecisionState } from "@/components/ads/decision-badge";
import { displayDomain, numberAdComments } from "@/components/ads/helpers";
import AdSpecChecklist from "@/components/ads/spec-checklist";
import type { PreviewPin, PreviewSeek, PreviewVideoMarker } from "@/components/post-preview/types";
import AssistantTranscript from "@/components/review/assistant-transcript";
import {
  AD_PLATFORM_LABELS,
  AD_TEXT_SPECS,
  adSpecChecks,
  describeSummary,
  summarizeChecks,
  variantDisplayName,
} from "@/lib/content/ads";
import type { AdContent, AdVariant } from "@/lib/content/types";
import { formatTimecode, parseTimecode } from "@/lib/domain";
import ThreadCard, { type ReviewCommentView } from "./comment-thread";
import { buildCommentThreads, formatDateTime, sortThreadsByMoment, type CommentThread } from "./helpers";
import type { ReviewSessionView } from "./post-review";

export interface AdReviewVersion {
  id: string;
  number: number;
  content: AdContent;
  /** Sent to the client at least once. */
  sent: boolean;
}

/** One client decision (CreativeDecision) as the page passes it. */
export interface AdDecisionView {
  versionNumber: number;
  variantId: string;
  verdict: "APPROVED" | "REJECTED";
  note: string | null;
  reviewerName: string;
  decidedAt: Date | string;
}

interface AdReviewProps {
  postId: string;
  timezone: string;
  accountName: string;
  accountAvatarUrl: string | null;
  /** Newest first. */
  versions: AdReviewVersion[];
  initialVersionNumber: number;
  comments: ReviewCommentView[];
  decisions: AdDecisionView[];
  sessions: ReviewSessionView[];
  canComment: boolean;
}

/** Where the agency is commenting: a variant (or the whole set) and optionally a spot / moment. */
interface CommentTarget {
  variantId: string | null;
  mediaIndex?: number;
  pinX?: number;
  pinY?: number;
  timeSec?: number;
}

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40";

function sectionId(variantId: string): string {
  return `variante-${variantId}`;
}

/** Located threads (pins, moments) numbered 1..n, as on the previews. */
/**
 * Pin/marker numbers of a variant's threads: the same order as the client
 * portal (numberAdComments: media, then moment, then creation), so "nota 2"
 * means the same note on both sides.
 */
function numberThreads(threads: CommentThread<ReviewCommentView>[]): Map<string, string> {
  const roots = threads.map((t) => ({ ...t.root, id: t.id, createdLabel: "" }));
  const { located } = numberAdComments(roots);
  return new Map(located.map((c) => [c.id, String(c.number)]));
}

export default function AdReview({
  postId,
  timezone,
  accountName,
  accountAvatarUrl,
  versions,
  initialVersionNumber,
  comments,
  decisions,
  sessions,
  canComment,
}: AdReviewProps) {
  const [versionNumber, setVersionNumber] = useState(initialVersionNumber);
  const [showResolved, setShowResolved] = useState(false);
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seek, setSeek] = useState<{ variantId: string; seek: PreviewSeek } | null>(null);
  const [pending, startTransition] = useTransition();

  const version = versions.find((v) => v.number === versionNumber) ?? versions[0];
  if (!version) return <p className="text-sm text-muted">Nessuna versione disponibile.</p>;

  const { campaign, variants } = version.content;
  const versionComments = comments.filter((c) => c.versionId === version.id);
  const otherVersionComments = comments.length - versionComments.length;
  const allThreads = buildCommentThreads(versionComments);
  const resolvedCount = allThreads.filter((t) => t.resolved).length;
  const variantIds = new Set(variants.map((v) => v.id));

  const versionDecisions = decisions.filter((d) => d.versionNumber === version.number);
  const decisionOf = (variantId: string) => versionDecisions.find((d) => d.variantId === variantId) ?? null;
  const decisionStates: Record<string, AdVariantDecisionState | null> = Object.fromEntries(
    variants.map((v) => {
      const d = decisionOf(v.id);
      return [v.id, d ? { verdict: d.verdict, note: d.note } : null];
    })
  );
  const approved = versionDecisions.filter((d) => d.verdict === "APPROVED" && variantIds.has(d.variantId)).length;
  const rejected = versionDecisions.filter((d) => d.verdict === "REJECTED" && variantIds.has(d.variantId)).length;
  const undecided = variants.length - approved - rejected;

  const threadsOf = (variantId: string | null) =>
    sortThreadsByMoment(
      allThreads.filter((t) =>
        variantId === null
          ? !t.root.variantId || !variantIds.has(t.root.variantId)
          : t.root.variantId === variantId
      )
    ).filter((t) => showResolved || !t.resolved);

  function changeVersion(number: number) {
    setVersionNumber(number);
    setTarget(null);
    setError(null);
  }

  function openComposer(next: CommentTarget | null) {
    setTarget(next);
    setRangeEnd("");
    setError(null);
  }

  function seekTo(variantId: string, timeSec: number, mediaIndex: number | null) {
    setSeek((previous) => ({
      variantId,
      seek: {
        timeSec,
        nonce: (previous?.seek.nonce ?? 0) + 1,
        ...(mediaIndex !== null ? { mediaIndex } : {}),
      },
    }));
  }

  function submitComment() {
    if (!target) return;
    const body = draft.trim();
    if (!body) {
      setError("Scrivi il commento.");
      return;
    }
    let timeEndSec: number | undefined;
    if (target.timeSec !== undefined && rangeEnd.trim()) {
      const parsed = parseTimecode(rangeEnd);
      if (parsed === null || parsed <= target.timeSec) {
        setError(`La fine dell'intervallo deve essere un momento dopo ${formatTimecode(target.timeSec)} (es. 0:12).`);
        return;
      }
      timeEndSec = parsed;
    }
    setError(null);
    startTransition(async () => {
      const result = await addCommentAction({
        postId,
        body,
        versionId: version.id,
        ...(target.variantId ? { variantId: target.variantId } : {}),
        ...(target.mediaIndex !== undefined
          ? {
              mediaIndex: target.mediaIndex,
              ...(target.pinX !== undefined && target.pinY !== undefined ? { pinX: target.pinX, pinY: target.pinY } : {}),
              ...(target.timeSec !== undefined ? { timeSec: target.timeSec } : {}),
              ...(timeEndSec !== undefined ? { timeEndSec } : {}),
            }
          : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft("");
      setTarget(null);
      setRangeEnd("");
    });
  }

  function composer(variantId: string | null) {
    if (!canComment || !target || target.variantId !== variantId) return null;
    const where =
      target.mediaIndex === undefined
        ? variantId
          ? "commento generale sulla variante"
          : "commento sul set"
        : target.timeSec !== undefined
          ? `media ${target.mediaIndex + 1} · ${formatTimecode(target.timeSec)}${target.pinX !== undefined ? " · punto sul fotogramma" : ""}`
          : `media ${target.mediaIndex + 1} · punto sull'immagine`;
    return (
      <div className="panel space-y-3 rounded p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Nuovo commento · {where}</h4>
          <button type="button" onClick={() => openComposer(null)} className="text-xs text-muted hover:text-foreground">
            Chiudi
          </button>
        </div>
        {target.timeSec !== undefined && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Fino a
            <input
              type="text"
              inputMode="numeric"
              value={rangeEnd}
              onChange={(event) => setRangeEnd(event.target.value)}
              placeholder="es. 0:12 (facoltativo)"
              className="w-36 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent/40"
            />
          </label>
        )}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={5000}
          placeholder={`Commento sulla versione ${version.number} (lo vede anche il cliente)`}
          className={`${inputClass} resize-y`}
          autoFocus
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submitComment}
            disabled={pending || !draft.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? "Invio…" : "Aggiungi commento"}
          </button>
        </div>
      </div>
    );
  }

  const setThreads = threadsOf(null);

  return (
    <div className="space-y-8">
      {/* ── Version and summary ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {campaign.name ? `${campaign.name} · ` : ""}
          {AD_PLATFORM_LABELS[campaign.platform]}
          {campaign.objective ? ` · ${campaign.objective}` : ""}
        </p>
        {versions.length > 1 && (
          <label className="block text-sm">
            <span className="sr-only">Versione mostrata</span>
            <select
              value={version.number}
              onChange={(event) => changeVersion(Number(event.target.value))}
              className={`${inputClass} sm:w-auto`}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.number}>
                  Versione {v.number}
                  {v.number === versions[0].number ? " (attuale)" : ""}
                  {v.sent ? "" : " · non ancora inviata"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* ── Decisions ── */}
      <section className="panel space-y-3 rounded p-4 sm:p-5" aria-label="Decisioni del cliente">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">Decisioni del cliente · versione {version.number}</h3>
          <p className="text-sm text-muted">
            {approved} {approved === 1 ? "approvata" : "approvate"} · {rejected}{" "}
            {rejected === 1 ? "scartata" : "scartate"} · {undecided} da decidere
          </p>
        </div>
        {!version.sent ? (
          <p className="text-sm text-muted">Questa versione non è ancora stata inviata al cliente.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-background">
            {variants.map((variant) => {
              const decision = decisionOf(variant.id);
              return (
                <li key={variant.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2 sm:w-56 sm:shrink-0">
                    <a href={`#${sectionId(variant.id)}`} className="truncate text-sm font-medium hover:underline">
                      {variantDisplayName(variant)}
                    </a>
                  </div>
                  <div className="shrink-0">
                    <AdDecisionBadge verdict={decision?.verdict} />
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    {decision?.note ? (
                      <p className="whitespace-pre-wrap break-words">«{decision.note}»</p>
                    ) : decision ? (
                      <p className="text-muted">Nessuna nota.</p>
                    ) : (
                      <p className="text-muted">Il cliente non ha ancora deciso.</p>
                    )}
                    {decision && (
                      <p className="mt-0.5 text-xs text-muted">
                        {DECISION_LABELS[decision.verdict]} da {decision.reviewerName},{" "}
                        {formatDateTime(decision.decidedAt, timezone, { year: false })}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Side by side ── */}
      {variants.length > 1 && (
        <AdVariantCompare
          variants={variants}
          decisions={decisionStates}
          accountName={accountName}
          accountAvatarUrl={accountAvatarUrl}
          onOpenVariant={(variantId) =>
            document.getElementById(sectionId(variantId))?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Versione {version.number}: {allThreads.length === 0 ? "nessun commento" : `${allThreads.length} discussioni`}
          {otherVersionComments > 0 ? ` · ${otherVersionComments} commenti su altre versioni` : ""}
        </span>
        {resolvedCount > 0 && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
              className="accent-accent"
            />
            Mostra risolti ({resolvedCount})
          </label>
        )}
      </div>

      {/* ── Variants ── */}
      {variants.map((variant, index) => (
        <VariantCard
          key={`${version.id}-${variant.id}`}
          postId={postId}
          variant={variant}
          index={index}
          total={variants.length}
          platform={campaign.platform}
          accountName={accountName}
          accountAvatarUrl={accountAvatarUrl}
          decision={decisionStates[variant.id] ?? null}
          threads={threadsOf(variant.id)}
          timezone={timezone}
          canComment={canComment}
          target={target?.variantId === variant.id ? target : null}
          onRequestComment={(next) => openComposer({ variantId: variant.id, ...next })}
          composer={composer(variant.id)}
          seek={seek?.variantId === variant.id ? seek.seek : undefined}
          onSeek={(timeSec, mediaIndex) => seekTo(variant.id, timeSec, mediaIndex)}
        />
      ))}

      {/* ── Whole set ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Commenti sul set</h3>
          {canComment && target?.variantId !== null && (
            <button
              type="button"
              onClick={() => openComposer({ variantId: null })}
              className="rounded border border-border bg-background px-3 py-1.5 text-sm hover:border-border-hover"
            >
              Commenta il set
            </button>
          )}
        </div>
        {composer(null)}
        {setThreads.length === 0 ? (
          <p className="text-sm text-muted">Nessun commento generale.</p>
        ) : (
          <ol className="space-y-2">
            {setThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                postId={postId}
                thread={thread}
                number=""
                timezone={timezone}
                canComment={canComment}
                multipleMedia={false}
              />
            ))}
          </ol>
        )}
      </section>

      {sessions.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">Conversazioni con l&apos;assistente AI</h3>
          {sessions.map((session) => (
            <AssistantTranscript
              key={session.id}
              session={session}
              reviewerName={session.reviewerName}
              timezone={timezone}
              variantNames={Object.fromEntries(variants.map((v) => [v.id, variantDisplayName(v)]))}
            />
          ))}
        </section>
      )}
    </div>
  );
}

// ─── One variant ─────────────────────────────────────────────────────────────

function VariantCard({
  postId,
  variant,
  index,
  total,
  platform,
  accountName,
  accountAvatarUrl,
  decision,
  threads,
  timezone,
  canComment,
  target,
  onRequestComment,
  composer,
  seek,
  onSeek,
}: {
  postId: string;
  variant: AdVariant;
  index: number;
  total: number;
  platform: AdContent["campaign"]["platform"];
  accountName: string;
  accountAvatarUrl: string | null;
  decision: AdVariantDecisionState | null;
  threads: CommentThread<ReviewCommentView>[];
  timezone: string;
  canComment: boolean;
  target: CommentTarget | null;
  onRequestComment: (next: Omit<CommentTarget, "variantId">) => void;
  composer: ReactNode;
  seek?: PreviewSeek;
  onSeek: (timeSec: number, mediaIndex: number | null) => void;
}) {
  const name = variantDisplayName(variant);
  const numbers = numberThreads(threads);
  const checks = adSpecChecks(variant, { platform });
  const summary = summarizeChecks(checks);
  const specs = AD_TEXT_SPECS[platform];
  const domain = displayDomain(variant.destinationUrl);

  const pins: PreviewPin[] = [
    ...threads
      .filter((t) => t.root.mediaIndex !== null && t.root.pinX !== null && t.root.pinY !== null)
      .map((t) => ({
        id: t.id,
        mediaIndex: t.root.mediaIndex ?? 0,
        x: t.root.pinX ?? 0,
        y: t.root.pinY ?? 0,
        label: numbers.get(t.id) ?? "",
        timeSec: t.root.timeSec,
        timeEndSec: t.root.timeEndSec,
      })),
    // The spot being commented, while the composer is open.
    ...(target && target.mediaIndex !== undefined && target.pinX !== undefined && target.pinY !== undefined
      ? [{ id: "draft", mediaIndex: target.mediaIndex, x: target.pinX, y: target.pinY, label: "+", timeSec: target.timeSec }]
      : []),
  ];
  const markers: PreviewVideoMarker[] = threads
    .filter((t) => t.root.timeSec !== null)
    .map((t) => ({
      id: t.id,
      timeSec: t.root.timeSec ?? 0,
      timeEndSec: t.root.timeEndSec,
      label: numbers.get(t.id) ?? "",
      tone: t.root.authorType === "CLIENT" ? ("client" as const) : ("agency" as const),
      mediaIndex: t.root.mediaIndex ?? undefined,
    }));

  const copy: Array<{ label: string; value: string }> = [
    { label: specs.primaryText?.label ?? "Testo principale", value: variant.primaryText },
    { label: specs.headline?.label ?? "Titolo", value: variant.headline },
    { label: specs.description?.label ?? "Descrizione", value: variant.description },
    { label: "Pulsante (CTA)", value: variant.cta },
  ].filter((row) => row.value.trim());

  return (
    <section id={sectionId(variant.id)} className="panel scroll-mt-20 space-y-4 rounded p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            Variante {index + 1} di {total}
          </p>
          <h3 className="break-words text-lg font-semibold">{name}</h3>
        </div>
        <AdDecisionBadge verdict={decision?.verdict} />
      </header>

      {decision?.verdict === "REJECTED" && (
        <div className="rounded border border-error/40 bg-error/5 p-3 text-sm">
          <p className="font-medium text-error">Scartata dal cliente</p>
          {decision.note && <p className="mt-1 whitespace-pre-wrap break-words">«{decision.note}»</p>}
        </div>
      )}
      {decision?.verdict === "APPROVED" && decision.note && (
        <div className="rounded border border-success/40 bg-success/5 p-3 text-sm">
          <p className="font-medium text-success">Nota del cliente</p>
          <p className="mt-1 whitespace-pre-wrap break-words">«{decision.note}»</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <AdPlacementPreviews
            placements={variant.placements}
            variant={variant}
            accountName={accountName}
            accountAvatarUrl={accountAvatarUrl}
            pins={pins}
            markers={markers}
            seekTo={seek}
            onMediaClick={canComment ? (p) => onRequestComment({ mediaIndex: p.mediaIndex, pinX: p.x, pinY: p.y }) : undefined}
            onRequestComment={
              canComment
                ? (p) =>
                    onRequestComment({
                      mediaIndex: p.mediaIndex,
                      timeSec: p.timeSec,
                      ...(p.x !== undefined && p.y !== undefined ? { pinX: p.x, pinY: p.y } : {}),
                    })
                : undefined
            }
          />
          {canComment && variant.media.length > 0 && (
            <p className="text-xs text-muted">
              Tocca un&apos;immagine per un commento puntato, o usa &quot;Commenta a…&quot; sul video per un momento preciso.
            </p>
          )}
          {composer}
        </div>

        <div className="min-w-0 space-y-5">
          {(copy.length > 0 || variant.destinationUrl.trim()) && (
            <dl className="space-y-2 text-sm">
              {copy.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-muted">{row.label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{row.value}</dd>
                </div>
              ))}
              {variant.destinationUrl.trim() && (
                <div>
                  <dt className="text-xs text-muted">Porta a</dt>
                  <dd className="break-all">
                    {domain ? (
                      <a
                        href={variant.destinationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline underline-offset-2"
                      >
                        {variant.destinationUrl}
                      </a>
                    ) : (
                      variant.destinationUrl
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <details className="rounded border border-border bg-background p-3" open={summary.errors > 0}>
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">Specifiche</span>{" "}
              <span className={summary.errors > 0 ? "text-error" : summary.warnings > 0 ? "text-warning" : "text-success"}>
                · {describeSummary(summary)}
              </span>
            </summary>
            <AdSpecChecklist checks={checks} hideOk className="mt-3" />
          </details>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Commenti{threads.length > 0 ? ` (${threads.length})` : ""}</h4>
              {canComment && !(target && target.mediaIndex === undefined) && (
                <button
                  type="button"
                  onClick={() => onRequestComment({})}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs hover:border-border-hover"
                >
                  Commenta la variante
                </button>
              )}
            </div>
            {threads.length === 0 ? (
              <p className="text-sm text-muted">Nessun commento su questa variante.</p>
            ) : (
              <ol className="space-y-2">
                {threads.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    postId={postId}
                    thread={thread}
                    number={numbers.get(thread.id) ?? ""}
                    timezone={timezone}
                    canComment={canComment}
                    multipleMedia={variant.media.length > 1}
                    onSeek={onSeek}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
