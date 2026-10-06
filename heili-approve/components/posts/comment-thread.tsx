"use client";

/**
 * Comment Thread (agency side)
 *
 * One discussion: the first comment and the replies on the same spot, with
 * "Rispondi" and "Segna come risolto" / "Riapri". A reply copies where the
 * first comment points (pin, video moment, the passage of an article, the
 * variant of an ad set), so it lands in the same thread; a reply to a
 * general comment names its author instead.
 *
 * Shared by the social review (post-review.tsx), the article review
 * (blog-review.tsx) and the ad set review (ad-review.tsx).
 */

import { useState, useTransition } from "react";
import { addCommentAction, resolveCommentsAction } from "@/app/(dashboard)/posts/actions";
import { formatDateTime, formatMoment, type CommentLike, type CommentThread } from "./helpers";

export interface ReviewCommentView extends CommentLike {
  authorName: string;
  versionNumber: number | null;
}

/** Where a blog comment's passage is in the version shown (lib/content/blog locateAnchors). */
export type PassageStatus = "exact" | "moved" | "missing";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40";

export function TimeChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Vai a ${label}`}
      className="rounded-full border border-border px-2 font-mono text-xs text-accent hover:border-accent"
    >
      {label}
    </button>
  );
}

export interface ThreadCardProps {
  postId: string;
  thread: CommentThread<ReviewCommentView>;
  /** Number shown on the pin / marker / highlight ("" = none). */
  number: string;
  timezone: string;
  canComment: boolean;
  /** Show "Media n" even on video comments (the version has several media). */
  multipleMedia: boolean;
  onSeek?: (timeSec: number, mediaIndex: number | null) => void;
  /** Blog: "Vai al passaggio" scrolls the article to the highlight. */
  onGoToPassage?: () => void;
  passageStatus?: PassageStatus;
  /** Ads: name of the variant, shown when the list mixes variants. */
  variantLabel?: string | null;
  /** Outline the card (the highlight / pin of this thread was tapped). */
  active?: boolean;
  /** DOM id, so the page can scroll to the card. */
  domId?: string;
}

export default function ThreadCard({
  postId,
  thread,
  number,
  timezone,
  canComment,
  multipleMedia,
  onSeek,
  onGoToPassage,
  passageStatus,
  variantLabel,
  active = false,
  domId,
}: ThreadCardProps) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { root } = thread;
  const all = [root, ...thread.replies];

  function sendReply() {
    const body = reply.trim();
    if (!body) return;
    setError(null);
    startTransition(async () => {
      const anchored = root.mediaIndex !== null || Boolean(root.anchor);
      const result = await addCommentAction({
        postId,
        // A general comment has no anchor to share: the reply names its author.
        body: anchored ? body : `@${root.authorName} ${body}`,
        ...(root.versionId ? { versionId: root.versionId } : {}),
        ...(root.anchor ? { anchor: root.anchor } : {}),
        ...(root.variantId ? { variantId: root.variantId } : {}),
        ...(root.mediaIndex !== null
          ? {
              mediaIndex: root.mediaIndex,
              ...(root.pinX !== null && root.pinY !== null ? { pinX: root.pinX, pinY: root.pinY } : {}),
              ...(root.timeSec !== null ? { timeSec: root.timeSec } : {}),
              ...(root.timeEndSec !== null ? { timeEndSec: root.timeEndSec } : {}),
            }
          : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReply("");
      setReplying(false);
    });
  }

  function toggleResolved() {
    setError(null);
    startTransition(async () => {
      const result = await resolveCommentsAction(
        postId,
        all.map((c) => c.id),
        !thread.resolved
      );
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <li
      id={domId}
      className={`scroll-mt-24 rounded border bg-background p-3 text-sm ${active ? "border-accent" : "border-border"} ${
        thread.resolved ? "opacity-70" : ""
      }`}
    >
      {root.anchor && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded border border-border bg-surface px-3 py-2">
          <blockquote className="min-w-0 flex-1 break-words text-sm italic text-foreground">
            «{root.anchor.quote.length > 280 ? `${root.anchor.quote.slice(0, 280)}…` : root.anchor.quote}»
          </blockquote>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {onGoToPassage && passageStatus !== "missing" && (
              <button type="button" onClick={onGoToPassage} className="text-xs font-medium text-accent hover:underline">
                Vai al passaggio
              </button>
            )}
            {passageStatus === "moved" && <span className="text-xs text-warning">Testo leggermente cambiato</span>}
            {passageStatus === "missing" && (
              <span className="text-xs text-warning">Passaggio non più presente in questa versione</span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {all.map((comment, i) => (
          <div key={comment.id} className={i > 0 ? "border-l-2 border-border pl-3" : ""}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              {i === 0 && number && (
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-medium text-white ${
                    comment.authorType === "CLIENT" ? "bg-accent" : "bg-muted"
                  }`}
                >
                  {number}
                </span>
              )}
              {i === 0 && variantLabel && <span className="font-medium text-foreground">{variantLabel}</span>}
              {i === 0 && comment.timeSec !== null && onSeek && (
                <TimeChip
                  label={formatMoment(comment.timeSec, comment.timeEndSec)}
                  onClick={() => onSeek(comment.timeSec ?? 0, comment.mediaIndex)}
                />
              )}
              {i === 0 && comment.mediaIndex !== null && (multipleMedia || comment.timeSec === null) && (
                <span>Media {comment.mediaIndex + 1}</span>
              )}
              <span className={`font-medium ${comment.authorType === "CLIENT" ? "text-foreground" : "text-muted"}`}>
                {comment.authorType === "CLIENT" ? `${comment.authorName} (cliente)` : `${comment.authorName} (agenzia)`}
              </span>
              <time dateTime={new Date(comment.createdAt).toISOString()}>
                {formatDateTime(comment.createdAt, timezone, { year: false })}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words">{comment.body}</p>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      {replying && (
        <div className="mt-3 space-y-2">
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="Rispondi (lo vede anche il cliente)"
            className={`${inputClass} resize-y`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReplying(false)} className="px-2 text-xs text-muted hover:text-foreground">
              Annulla
            </button>
            <button
              type="button"
              onClick={sendReply}
              disabled={pending || !reply.trim()}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Rispondi
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-3 text-xs">
        {thread.resolved && <span className="mr-auto text-success">Risolto</span>}
        {canComment && !replying && !thread.resolved && (
          <button type="button" onClick={() => setReplying(true)} className="text-muted hover:text-foreground">
            Rispondi
          </button>
        )}
        <button type="button" onClick={toggleResolved} disabled={pending} className="text-accent hover:underline disabled:opacity-50">
          {thread.resolved ? "Riapri" : "Segna come risolto"}
        </button>
      </div>
    </li>
  );
}
