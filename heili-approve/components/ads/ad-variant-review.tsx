"use client";

/**
 * AdVariantReview — one variant of an ads set, as the client reviews it.
 *
 * - Previews per placement (tabs), with comment pins on images and the
 *   review player on videos (markers, "Commenta a m:ss", tap on the paused
 *   frame). Taps are reported through onRequestComment; the parent opens its
 *   comment form and passes it back as `composer`, shown under the preview.
 * - The copy in full (testo, titolo, descrizione, CTA, link) and, for Google
 *   Ads, the list of titoli, descrizioni and parole chiave: tapping one shows
 *   "Commenta questo titolo"; the parent opens its composer for that asset
 *   (onCommentAsset) and passes it back as `assetComposer`.
 * - The decision: "Approva variante" / "Scarta" (a note is required to
 *   discard: it goes to the agency). The parent wires the server action
 *   through onDecide and passes the saved decision back.
 * - The comments on this variant, numbered like the pins and markers; a
 *   timecode chip seeks the video there.
 */

import { useId, useState, type ReactNode } from "react";
import { AdPlacementPreviews } from "./ad-preview";
import AdDecisionBadge, { type AdVariantDecisionState, type AdVerdict } from "./decision-badge";
import GoogleAssetsList from "./google-assets-list";
import {
  commentMoment,
  displayDomain,
  markersForComments,
  numberAdComments,
  pinsForComments,
  type AdReviewComment,
  type NumberedComment,
} from "./helpers";
import type { PreviewPin, PreviewSeek } from "@/components/post-preview/types";
import {
  AD_TEXT_SPECS,
  parseAssetComment,
  usesGoogleAssets,
  variantDisplayName,
  type AdPlacement,
  type AdPlatform,
  type AdVariant,
  type GoogleAssetRef,
} from "@/lib/content/ads";

/** Same cap as lib/creative-decisions (MAX_DECISION_NOTE_LENGTH), not imported: that module is server-only. */
const MAX_NOTE = 2000;

/** Where the client wants to comment: a point on an image, or a moment (and point) of a video. */
export interface AdCommentRequest {
  mediaIndex: number;
  x?: number;
  y?: number;
  timeSec?: number;
}

export interface AdVariantReviewProps {
  variant: AdVariant;
  /** Placements to preview (default: the variant's own). */
  placements?: AdPlacement[];
  /** Campaign platform: names the copy fields as the platform does. */
  platform?: AdPlatform;
  accountName: string;
  accountAvatarUrl?: string | null;
  /** Comments on this variant, for the version shown. */
  comments: AdReviewComment[];
  /** The current decision on this variant (for this version), null when none yet. */
  decision: AdVariantDecisionState | null;
  canDecide: boolean;
  /** Saves a decision; resolve with an Italian error message, or nothing when saved. */
  onDecide: (input: { verdict: AdVerdict; note: string | null }) => Promise<string | null | void> | void;
  /** Tap on an image (x/y) or "Commenta a m:ss" / tap on a paused video (timeSec, x/y). */
  onRequestComment?: (request: AdCommentRequest) => void;
  /** "Commenta la variante" without a location. */
  onRequestGeneralComment?: () => void;
  /** The parent's comment form, rendered right under the preview. */
  composer?: ReactNode;
  /** Google Ads: "Commenta questo titolo" on a headline, description, keyword… */
  onCommentAsset?: (asset: GoogleAssetRef) => void;
  /** The asset being commented and the parent's form for it (shown under the asset). */
  activeAsset?: GoogleAssetRef | null;
  assetComposer?: ReactNode;
  /** Point being commented while the composer is open (drawn as "+"). */
  draftPin?: { mediaIndex: number; x: number; y: number; timeSec?: number } | null;
  /** External seek (e.g. from the assistant); timecode chips seek on their own. */
  seekTo?: PreviewSeek;
  registerTimeGetter?: (get: () => number) => void;
  onTimeChange?: (sec: number, mediaIndex: number) => void;
  /** "Variante 2 di 3". */
  position?: { index: number; total: number };
  className?: string;
}

export default function AdVariantReview({
  variant,
  placements,
  platform,
  accountName,
  accountAvatarUrl,
  comments,
  decision,
  canDecide,
  onDecide,
  onRequestComment,
  onRequestGeneralComment,
  composer,
  onCommentAsset,
  activeAsset,
  assetComposer,
  draftPin,
  seekTo,
  registerTimeGetter,
  onTimeChange,
  position,
  className = "",
}: AdVariantReviewProps) {
  const headingId = useId();
  const { located, general } = numberAdComments(comments);
  const draft: PreviewPin[] = draftPin
    ? [{ id: "draft", mediaIndex: draftPin.mediaIndex, x: draftPin.x, y: draftPin.y, label: "+", timeSec: draftPin.timeSec }]
    : [];
  const pins = [...pinsForComments(located), ...draft];
  const markers = markersForComments(located);

  // Timecode chips seek locally; a new external seekTo takes over.
  const [seek, setSeek] = useState<PreviewSeek | undefined>(seekTo);
  const [seenExternal, setSeenExternal] = useState(seekTo?.nonce);
  if (seekTo && seekTo.nonce !== seenExternal) {
    setSeenExternal(seekTo.nonce);
    setSeek(seekTo);
  }

  function seekToComment(comment: NumberedComment) {
    if (comment.timeSec === null) return;
    setSeek((current) => ({
      timeSec: comment.timeSec ?? 0,
      mediaIndex: comment.mediaIndex ?? undefined,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }

  const name = variantDisplayName(variant);
  const shownPlacements = placements ?? variant.placements;

  return (
    <article aria-labelledby={headingId} className={`space-y-5 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {position ? (
            <p className="text-xs text-muted">
              Variante {position.index + 1} di {position.total}
            </p>
          ) : null}
          <h2 id={headingId} className="break-words text-lg font-semibold text-foreground">
            {name}
          </h2>
        </div>
        <AdDecisionBadge verdict={decision?.verdict} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <AdPlacementPreviews
            placements={shownPlacements}
            variant={variant}
            accountName={accountName}
            accountAvatarUrl={accountAvatarUrl}
            pins={pins}
            markers={markers}
            onMediaClick={onRequestComment ? (p) => onRequestComment({ mediaIndex: p.mediaIndex, x: p.x, y: p.y }) : undefined}
            onRequestComment={
              onRequestComment
                ? (p) => onRequestComment({ mediaIndex: p.mediaIndex, timeSec: p.timeSec, x: p.x, y: p.y })
                : undefined
            }
            seekTo={seek}
            registerTimeGetter={registerTimeGetter}
            onTimeChange={onTimeChange}
          />
          {onRequestComment ? (
            <p className="text-xs text-muted">
              Tocca un punto dell&apos;immagine per commentarlo; sui video usa «Commenta a…» per segnare il momento.
            </p>
          ) : null}
          {composer}
        </div>

        <div className="min-w-0 space-y-5">
          <CopySummary variant={variant} platform={platform} />

          {usesGoogleAssets(variant.placements) ? (
            <GoogleAssetsList
              variant={variant}
              onCommentAsset={onCommentAsset}
              activeAsset={activeAsset}
              composer={assetComposer}
              commented={commentedAssets(comments)}
            />
          ) : null}

          <DecisionPanel key={`${decision?.verdict ?? "none"}:${decision?.note ?? ""}`} decision={decision} canDecide={canDecide} onDecide={onDecide} variantName={name} />

          <section className="space-y-3" aria-label={`Commenti su ${name}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Commenti{comments.length > 0 ? ` (${comments.length})` : ""}
              </h3>
              {onRequestGeneralComment ? (
                <button
                  type="button"
                  onClick={onRequestGeneralComment}
                  className="min-h-11 rounded-md border border-border bg-background px-3 text-sm hover:border-border-hover"
                >
                  Commenta la variante
                </button>
              ) : null}
            </div>
            {comments.length === 0 ? (
              <p className="text-sm text-muted">Ancora nessun commento su questa variante.</p>
            ) : (
              <ul className="space-y-2">
                {located.map((c) => (
                  <CommentRow key={c.id} comment={c} number={c.number} onSeek={() => seekToComment(c)} />
                ))}
                {general.map((c) => (
                  <CommentRow key={c.id} comment={c} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}

/** Names ("Titolo 3") of the Google assets the comments quote. */
function commentedAssets(comments: readonly AdReviewComment[]): Set<string> {
  const names = new Set<string>();
  for (const c of comments) {
    const asset = parseAssetComment(c.body);
    if (asset) names.add(asset.name);
  }
  return names;
}

// ─── Copy ────────────────────────────────────────────────────────────────────

function CopySummary({ variant, platform }: { variant: AdVariant; platform?: AdPlatform }) {
  const specs = platform ? AD_TEXT_SPECS[platform] : AD_TEXT_SPECS.meta;
  const domain = displayDomain(variant.destinationUrl);
  const rows: Array<{ label: string; value: ReactNode }> = [];
  if (variant.primaryText.trim()) {
    rows.push({ label: specs.primaryText?.label ?? "Testo principale", value: variant.primaryText });
  }
  if (variant.headline.trim()) rows.push({ label: specs.headline?.label ?? "Titolo", value: variant.headline });
  if (variant.description.trim()) {
    rows.push({ label: specs.description?.label ?? "Descrizione", value: variant.description });
  }
  if (variant.cta.trim()) rows.push({ label: "Pulsante (CTA)", value: variant.cta });
  if (variant.destinationUrl.trim()) {
    rows.push({
      label: "Porta a",
      value: domain ? (
        <a
          href={variant.destinationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-accent underline underline-offset-2"
        >
          {variant.destinationUrl}
        </a>
      ) : (
        variant.destinationUrl
      ),
    });
  }
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Testi dell'annuncio">
      <h3 className="text-sm font-semibold text-foreground">Testi dell&apos;annuncio</h3>
      <dl className="space-y-2 rounded-lg border border-border bg-surface p-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="whitespace-pre-wrap break-words text-sm text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ─── Decision ────────────────────────────────────────────────────────────────

function DecisionPanel({
  decision,
  canDecide,
  onDecide,
  variantName,
}: {
  decision: AdVariantDecisionState | null;
  canDecide: boolean;
  onDecide: AdVariantReviewProps["onDecide"];
  variantName: string;
}) {
  const noteId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState(decision?.verdict === "REJECTED" ? (decision.note ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(verdict: AdVerdict) {
    if (busy) return;
    const trimmed = note.trim();
    if (verdict === "REJECTED" && !trimmed) {
      setError("Scrivi perché scarti questa variante: la nota arriva all'agenzia.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const failure = await onDecide({ verdict, note: verdict === "REJECTED" ? trimmed : null });
      if (failure) setError(failure);
      else setRejecting(false);
    } catch {
      setError("Non è stato possibile salvare la decisione. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  const status =
    decision?.verdict === "APPROVED"
      ? "Hai approvato questa variante."
      : decision?.verdict === "REJECTED"
        ? "Hai scartato questa variante."
        : null;

  if (!canDecide) {
    return (
      <section className="space-y-2 rounded-lg border border-border bg-surface p-3" aria-label="Decisione">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Decisione</h3>
          <AdDecisionBadge verdict={decision?.verdict} />
        </div>
        {decision?.note ? <p className="whitespace-pre-wrap break-words text-sm">{decision.note}</p> : null}
        {!decision ? <p className="text-sm text-muted">Nessuna decisione su questa versione.</p> : null}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-3" aria-label={`Decisione su ${variantName}`}>
      <h3 className="text-sm font-semibold text-foreground">La tua decisione</h3>
      {status ? <p className="text-sm text-foreground">{status}</p> : null}
      {decision?.verdict === "REJECTED" && decision.note && !rejecting ? (
        <p className="whitespace-pre-wrap break-words rounded-md bg-background p-2 text-sm">
          <span className="text-muted">Nota: </span>
          {decision.note}
        </p>
      ) : null}

      {rejecting ? (
        <div className="space-y-2">
          <label htmlFor={noteId} className="block text-sm font-medium text-foreground">
            Perché la scarti?
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE))}
            rows={3}
            autoFocus
            placeholder="Per esempio: il prodotto si vede poco, preferisco la foto della variante A"
            className="w-full resize-y rounded-md border border-border bg-background p-3 text-base outline-none focus:border-accent"
          />
          <p className="text-xs text-muted">La nota arriva all&apos;agenzia insieme alla decisione.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setError(null);
              }}
              className="min-h-11 rounded-md border border-border bg-background px-4 text-sm hover:border-border-hover disabled:opacity-50"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={busy || note.trim() === ""}
              onClick={() => decide("REJECTED")}
              className="min-h-11 rounded-md bg-error px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Salvataggio…" : "Conferma: scarta"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {decision?.verdict !== "APPROVED" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("APPROVED")}
              className="min-h-11 flex-1 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "Salvataggio…" : decision ? "Approva invece" : "Approva variante"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRejecting(true);
              setError(null);
            }}
            className="min-h-11 flex-1 rounded-md border border-error/50 bg-background px-4 text-sm font-semibold text-error hover:border-error disabled:opacity-50"
          >
            {decision?.verdict === "REJECTED" ? "Modifica la nota" : decision ? "Scarta invece" : "Scarta"}
          </button>
        </div>
      )}

      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ─── Comments ────────────────────────────────────────────────────────────────

function CommentRow({
  comment,
  number,
  onSeek,
}: {
  comment: AdReviewComment;
  number?: number;
  onSeek?: () => void;
}) {
  const agency = comment.authorType === "AGENCY";
  const moment = commentMoment(comment);
  return (
    <li
      className={`rounded-lg border p-3 ${agency ? "border-accent/40 bg-surface" : "border-border bg-background"} ${
        comment.resolved ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        {number !== undefined ? (
          <span
            aria-label={`Nota ${number}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
          >
            {number}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs text-muted">
            <span className="font-medium text-foreground">
              {agency ? `${comment.authorName} · Agenzia` : comment.isMine ? "Tu" : comment.authorName}
            </span>{" "}
            · {comment.createdLabel}
            {comment.resolved ? <span className="text-success"> · Risolto</span> : null}
          </p>
          {moment ? (
            onSeek ? (
              <button
                type="button"
                onClick={onSeek}
                aria-label={`Vai al momento ${moment} del video`}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-accent px-3 text-sm font-medium text-accent hover:bg-accent hover:text-white"
              >
                <span aria-hidden="true">▶</span>
                {moment}
              </button>
            ) : (
              <span className="rounded-full border border-border px-3 py-1 text-sm">{moment}</span>
            )
          ) : null}
          <CommentBody body={comment.body} />
        </div>
      </div>
    </li>
  );
}

/** The body, with the quoted Google asset (formatAssetComment) shown as a quote. */
function CommentBody({ body }: { body: string }) {
  const asset = parseAssetComment(body);
  if (!asset) return <p className="whitespace-pre-wrap break-words text-sm">{body}</p>;
  return (
    <div className="space-y-1">
      <blockquote className="border-l-2 border-accent pl-2 text-sm">
        <span className="block text-xs text-muted">{asset.name}</span>
        <span className="break-words">«{asset.quote}»</span>
      </blockquote>
      <p className="whitespace-pre-wrap break-words text-sm">{asset.text}</p>
    </div>
  );
}
