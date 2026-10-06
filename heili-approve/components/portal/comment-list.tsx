"use client";

/**
 * Comments on the version the client is looking at.
 *
 * - "Note sul video": moments sorted by time, each with a timecode chip that
 *   seeks the player there (`onSeek`).
 * - "Note sulle immagini": pins, numbered like the circles on the preview.
 * - "Commenti": general comments and agency replies, oldest first (an
 *   article comment shows the passage it is about).
 */

import type { MediaItem } from "@/lib/domain";
import { formatMoment, mediaName, orderComments } from "./helpers";
import type { PortalComment } from "./types";

type Numbered = PortalComment & { number?: number };

export default function CommentList({
  comments,
  media,
  onSeek,
  emptyText,
}: {
  comments: PortalComment[];
  media: MediaItem[];
  onSeek?: (comment: PortalComment) => void;
  emptyText?: string;
}) {
  const { located, general } = orderComments(comments);
  const moments = located.filter((c) => c.timeSec !== null);
  const pins = located.filter((c) => c.timeSec === null);

  if (comments.length === 0) {
    return emptyText ? <p className="text-sm text-muted">{emptyText}</p> : null;
  }

  return (
    <div className="space-y-5">
      {moments.length > 0 && (
        <Group title="Note sul video">
          {moments.map((c) => (
            <CommentItem key={c.id} comment={c} media={media} onSeek={onSeek} />
          ))}
        </Group>
      )}
      {pins.length > 0 && (
        <Group title="Note sulle immagini">
          {pins.map((c) => (
            <CommentItem key={c.id} comment={c} media={media} />
          ))}
        </Group>
      )}
      {general.length > 0 && (
        <Group title={located.length > 0 ? "Commenti generali" : "Commenti"}>
          {general.map((c) => (
            <CommentItem key={c.id} comment={c} media={media} />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function CommentItem({
  comment,
  media,
  onSeek,
}: {
  comment: Numbered;
  media: MediaItem[];
  onSeek?: (comment: PortalComment) => void;
}) {
  const agency = comment.authorType === "AGENCY";
  const item = comment.mediaIndex !== null ? media[comment.mediaIndex] : undefined;
  const showMediaName = comment.mediaIndex !== null && media.length > 1;

  return (
    <li
      className={`rounded-lg border p-3 ${
        agency ? "border-accent/40 bg-surface" : "border-border bg-background"
      } ${comment.resolved ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-3">
        {comment.number !== undefined && (
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
            {comment.resolved && <span className="text-success"> · Risolto</span>}
          </p>
          {(comment.timeSec !== null || showMediaName) && (
            <div className="flex flex-wrap items-center gap-2">
              {comment.timeSec !== null &&
                (onSeek ? (
                  <button
                    type="button"
                    onClick={() => onSeek(comment)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full border border-accent px-3 text-sm font-medium text-accent hover:bg-accent hover:text-white"
                    aria-label={`Vai al momento ${formatMoment(comment.timeSec, comment.timeEndSec)} del video`}
                  >
                    <span aria-hidden="true">▶</span>
                    {formatMoment(comment.timeSec, comment.timeEndSec)}
                  </button>
                ) : (
                  <span className="rounded-full border border-border px-3 py-1 text-sm">
                    {formatMoment(comment.timeSec, comment.timeEndSec)}
                  </span>
                ))}
              {showMediaName && (
                <span className="text-xs text-muted">
                  {mediaName(item?.type, comment.mediaIndex ?? 0, media.length)}
                </span>
              )}
            </div>
          )}
          {comment.anchor && (
            <blockquote className="line-clamp-3 border-l-2 border-warning pl-2 text-xs italic text-muted">
              «{comment.anchor.quote}»
            </blockquote>
          )}
          <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
        </div>
      </div>
    </li>
  );
}
