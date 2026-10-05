"use client";

/**
 * Post Review (agency side of the conversation with the client)
 *
 * Preview of a version with every comment on it: numbered pins on images,
 * markers on the video timeline (client comments, agency replies and the AI
 * assistant's timed action items), a "Note sul video" list sorted by moment
 * whose timecode chips seek the player, the comment threads with reply and
 * resolve, and the assistant transcripts (their chips seek the player too).
 *
 * The agency comments like the client does: click an image for a pin, or
 * "Commenta a m:ss" on a video for a moment (optionally a range).
 */

import { useState, useTransition } from "react";
import { addCommentAction, resolveCommentsAction } from "@/app/(dashboard)/posts/actions";
import { NetworkPreviewTabs, type PreviewPin, type PreviewVideoMarker } from "@/components/post-preview";
import AssistantTranscript, { type AssistantTranscriptSession } from "@/components/review/assistant-transcript";
import { formatTimecode, parseTimecode, type MediaItem, type Network } from "@/lib/domain";
import {
  buildCommentThreads,
  formatDateTime,
  formatMoment,
  sortThreadsByMoment,
  type CommentLike,
  type CommentThread,
} from "./helpers";

export interface ReviewVersionView {
  id: string;
  number: number;
  text: string;
  firstCommentText: string | null;
  media: MediaItem[];
  /** Sent to the client at least once. */
  sent: boolean;
  createdAt: Date | string;
}

export interface ReviewCommentView extends CommentLike {
  authorName: string;
  versionNumber: number | null;
}

/** Timed action item of an AI review session not already turned into a comment. */
export interface AssistantItemView {
  id: string;
  sessionId: string;
  versionNumber: number;
  mediaIndex: number | null;
  timeSec: number;
  timeEndSec: number | null;
  request: string;
  reviewerName: string;
}

export interface ReviewSessionView extends AssistantTranscriptSession {
  reviewerName: string;
}

interface PostReviewProps {
  postId: string;
  networks: Network[];
  networkOptions: unknown;
  accountName: string;
  accountAvatarUrl: string | null;
  publishAt: Date | string;
  timezone: string;
  /** Newest first. */
  versions: ReviewVersionView[];
  initialVersionNumber: number;
  comments: ReviewCommentView[];
  assistantItems: AssistantItemView[];
  sessions: ReviewSessionView[];
  canComment: boolean;
}

interface CommentTarget {
  mediaIndex: number;
  pinX?: number;
  pinY?: number;
  timeSec?: number;
}

type Seek = { timeSec: number; nonce: number; mediaIndex?: number };

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40";

export default function PostReview({
  postId,
  networks,
  networkOptions,
  accountName,
  accountAvatarUrl,
  publishAt,
  timezone,
  versions,
  initialVersionNumber,
  comments,
  assistantItems,
  sessions,
  canComment,
}: PostReviewProps) {
  const [versionNumber, setVersionNumber] = useState(initialVersionNumber);
  const [showResolved, setShowResolved] = useState(false);
  const [seek, setSeek] = useState<Seek | undefined>(undefined);
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const version = versions.find((v) => v.number === versionNumber) ?? versions[0];
  const versionComments = comments.filter((c) => c.versionId === version?.id);
  const otherVersionComments = comments.length - versionComments.length;
  const threads = sortThreadsByMoment(buildCommentThreads(versionComments));
  const visibleThreads = threads.filter((t) => showResolved || !t.resolved);
  const resolvedCount = threads.length - threads.filter((t) => !t.resolved).length;
  const versionItems = assistantItems.filter((item) => item.versionNumber === version?.number);

  // Numbers shared by pins, markers and the lists.
  const numbered = new Map<string, string>();
  visibleThreads.forEach((thread, i) => numbered.set(thread.id, String(i + 1)));
  versionItems.forEach((item, i) => numbered.set(item.id, `A${i + 1}`));

  const pins: PreviewPin[] = visibleThreads
    .filter((t) => t.root.mediaIndex !== null && t.root.pinX !== null && t.root.pinY !== null)
    .map((t) => ({
      id: t.id,
      mediaIndex: t.root.mediaIndex ?? 0,
      x: t.root.pinX ?? 0,
      y: t.root.pinY ?? 0,
      label: numbered.get(t.id) ?? "",
      timeSec: t.root.timeSec,
      timeEndSec: t.root.timeEndSec,
    }));

  const markers: PreviewVideoMarker[] = [
    ...visibleThreads
      .filter((t) => t.root.timeSec !== null)
      .map((t) => ({
        id: t.id,
        timeSec: t.root.timeSec ?? 0,
        timeEndSec: t.root.timeEndSec,
        label: numbered.get(t.id) ?? "",
        tone: t.root.authorType === "CLIENT" ? ("client" as const) : ("agency" as const),
        mediaIndex: t.root.mediaIndex ?? undefined,
      })),
    ...versionItems.map((item) => ({
      id: item.id,
      timeSec: item.timeSec,
      timeEndSec: item.timeEndSec,
      label: numbered.get(item.id) ?? "",
      tone: "assistant" as const,
      mediaIndex: item.mediaIndex ?? undefined,
    })),
  ];

  const videoThreads = visibleThreads.filter((t) => t.root.timeSec !== null);
  const otherThreads = visibleThreads.filter((t) => t.root.timeSec === null);
  const videoNotes: Array<{ kind: "thread"; thread: CommentThread<ReviewCommentView> } | { kind: "item"; item: AssistantItemView }> = [
    ...videoThreads.map((thread) => ({ kind: "thread" as const, thread })),
    ...versionItems.map((item) => ({ kind: "item" as const, item })),
  ].sort((a, b) => {
    const ma = a.kind === "thread" ? (a.thread.root.mediaIndex ?? 0) : (a.item.mediaIndex ?? 0);
    const mb = b.kind === "thread" ? (b.thread.root.mediaIndex ?? 0) : (b.item.mediaIndex ?? 0);
    const ta = a.kind === "thread" ? (a.thread.root.timeSec ?? 0) : a.item.timeSec;
    const tb = b.kind === "thread" ? (b.thread.root.timeSec ?? 0) : b.item.timeSec;
    return ma - mb || ta - tb;
  });

  function seekTo(timeSec: number, mediaIndex: number | null) {
    // A new nonce makes the player seek even to the same moment again.
    setSeek((previous) => ({
      timeSec,
      nonce: (previous?.nonce ?? 0) + 1,
      ...(mediaIndex !== null ? { mediaIndex } : {}),
    }));
  }

  function seekInSession(sessionVersion: number, timeSec: number, mediaIndex: number | null) {
    if (versions.some((v) => v.number === sessionVersion)) setVersionNumber(sessionVersion);
    seekTo(timeSec, mediaIndex);
  }

  function openComposer(next: CommentTarget | null) {
    setTarget(next);
    setRangeEnd("");
    setError(null);
  }

  function submitComment() {
    if (!version) return;
    const body = draft.trim();
    if (!body) {
      setError("Scrivi il commento.");
      return;
    }
    let timeEndSec: number | undefined;
    if (target?.timeSec !== undefined && rangeEnd.trim()) {
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
        ...(target
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

  if (!version) {
    return <p className="text-sm text-muted">Nessuna versione disponibile.</p>;
  }

  const media = version.media;
  const targetLabel = target
    ? target.timeSec !== undefined
      ? `Media ${target.mediaIndex + 1} · ${formatTimecode(target.timeSec)}${target.pinX !== undefined ? " · punto sul fotogramma" : ""}`
      : `Media ${target.mediaIndex + 1} · punto sull'immagine`
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* ── Preview ── */}
      <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
        {versions.length > 1 && (
          <label className="block text-sm">
            <span className="sr-only">Versione mostrata</span>
            <select
              value={version.number}
              onChange={(event) => {
                setVersionNumber(Number(event.target.value));
                openComposer(null);
              }}
              className={inputClass}
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
        <NetworkPreviewTabs
          networks={networks}
          networkOptions={networkOptions}
          text={version.text}
          firstCommentText={version.firstCommentText}
          media={media}
          accountName={accountName}
          accountAvatarUrl={accountAvatarUrl}
          publishAt={publishAt}
          timeZone={timezone}
          pins={pins}
          markers={markers}
          seekTo={seek}
          onMediaClick={
            canComment ? ({ mediaIndex, x, y }) => openComposer({ mediaIndex, pinX: x, pinY: y }) : undefined
          }
          onRequestComment={
            canComment
              ? ({ mediaIndex, timeSec, x, y }) =>
                  openComposer({
                    mediaIndex,
                    timeSec,
                    ...(x !== undefined && y !== undefined ? { pinX: x, pinY: y } : {}),
                  })
              : undefined
          }
        />
        {canComment && media.length > 0 && (
          <p className="text-xs text-muted">
            Tocca un&apos;immagine per un commento puntato, o usa &quot;Commenta a…&quot; sul video per un momento preciso.
          </p>
        )}
      </div>

      {/* ── Comments ── */}
      <div className="min-w-0 space-y-6">
        {canComment && (
          <section className="panel space-y-3 rounded p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">
                {targetLabel ? `Nuovo commento · ${targetLabel}` : "Nuovo commento generale"}
              </h3>
              {target && (
                <button type="button" onClick={() => openComposer(null)} className="text-xs text-muted hover:text-foreground">
                  Rendi generale
                </button>
              )}
            </div>
            {target?.timeSec !== undefined && (
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
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            Versione {version.number}: {threads.length === 0 ? "nessun commento" : `${threads.length} discussioni`}
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

        {videoNotes.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Note sul video</h3>
            <ol className="space-y-2">
              {videoNotes.map((note) =>
                note.kind === "thread" ? (
                  <ThreadCard
                    key={note.thread.id}
                    postId={postId}
                    thread={note.thread}
                    number={numbered.get(note.thread.id) ?? ""}
                    timezone={timezone}
                    canComment={canComment}
                    multipleMedia={media.length > 1}
                    onSeek={seekTo}
                  />
                ) : (
                  <li key={note.item.id} className="rounded border border-border bg-background p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-medium text-white">
                        {numbered.get(note.item.id)}
                      </span>
                      <TimeChip
                        label={formatMoment(note.item.timeSec, note.item.timeEndSec)}
                        onClick={() => seekTo(note.item.timeSec, note.item.mediaIndex)}
                      />
                      {media.length > 1 && note.item.mediaIndex !== null && <span>Media {note.item.mediaIndex + 1}</span>}
                      <span>Assistente AI · conversazione con {note.item.reviewerName}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{note.item.request}</p>
                  </li>
                )
              )}
            </ol>
          </section>
        )}

        {otherThreads.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Commenti</h3>
            <ol className="space-y-2">
              {otherThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  postId={postId}
                  thread={thread}
                  number={thread.root.mediaIndex !== null ? (numbered.get(thread.id) ?? "") : ""}
                  timezone={timezone}
                  canComment={canComment}
                  multipleMedia={media.length > 1}
                  onSeek={seekTo}
                />
              ))}
            </ol>
          </section>
        )}

        {sessions.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Conversazioni con l&apos;assistente AI</h3>
            {sessions.map((session) => (
              <AssistantTranscript
                key={session.id}
                session={session}
                reviewerName={session.reviewerName}
                timezone={timezone}
                onSeek={({ mediaIndex, timeSec }) => seekInSession(session.versionNumber, timeSec, mediaIndex)}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Thread ──────────────────────────────────────────────────────────────────

function ThreadCard({
  postId,
  thread,
  number,
  timezone,
  canComment,
  multipleMedia,
  onSeek,
}: {
  postId: string;
  thread: CommentThread<ReviewCommentView>;
  number: string;
  timezone: string;
  canComment: boolean;
  multipleMedia: boolean;
  onSeek: (timeSec: number, mediaIndex: number | null) => void;
}) {
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
      const anchored = root.mediaIndex !== null;
      const result = await addCommentAction({
        postId,
        // A general comment has no anchor to share: the reply names its author.
        body: anchored ? body : `@${root.authorName} ${body}`,
        ...(root.versionId ? { versionId: root.versionId } : {}),
        ...(anchored
          ? {
              mediaIndex: root.mediaIndex ?? undefined,
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
    <li className={`rounded border border-border bg-background p-3 text-sm ${thread.resolved ? "opacity-70" : ""}`}>
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
              {i === 0 && comment.timeSec !== null && (
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

function TimeChip({ label, onClick }: { label: string; onClick: () => void }) {
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
