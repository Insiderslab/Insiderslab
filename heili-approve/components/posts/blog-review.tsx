"use client";

/**
 * Blog Review (agency side of the conversation on an article)
 *
 * The article of a version as the client reads it, with the commented
 * passages highlighted and numbered; next to it the comment threads: the
 * passage threads in reading order (each with its quote and "Vai al
 * passaggio", or a note when the text has changed since), then the general
 * comments, with reply and resolve. The agency can comment too: select a
 * sentence for a comment on the passage, or write a general one. Below,
 * the SEO checks of the version and the assistant transcripts.
 *
 * The HTML of each version is rendered and sanitized on the server
 * (renderMarkdownSafe) and so is the passage status of each comment
 * (locateAnchors): this component only anchors text.
 */

import { useState, useTransition } from "react";
import { addCommentAction } from "@/app/(dashboard)/posts/actions";
import BlogReader, { type BlogReaderComment } from "@/components/blog/blog-reader";
import SeoPanel from "@/components/blog/seo-panel";
import AssistantTranscript from "@/components/review/assistant-transcript";
import { numberPassageComments, type PassagePlacement } from "@/lib/content/blog-text";
import type { BlogAnchor, BlogContent } from "@/lib/content/types";
import ThreadCard, { type ReviewCommentView } from "./comment-thread";
import { buildCommentThreads } from "./helpers";
import type { ReviewSessionView } from "./post-review";

export interface BlogReviewVersion {
  id: string;
  number: number;
  content: BlogContent;
  /** renderMarkdownSafe(content.bodyMarkdown), from the server. */
  html: string;
  /** Sent to the client at least once. */
  sent: boolean;
}

/** Where a comment's passage is in a version (server-side locateAnchors). */
export type PassageLocation = PassagePlacement;

interface BlogReviewProps {
  postId: string;
  timezone: string;
  /** Newest first. */
  versions: BlogReviewVersion[];
  initialVersionNumber: number;
  comments: ReviewCommentView[];
  /**
   * By version id, then comment id: where each passage note of that version,
   * and each open note of an earlier version, sits in that version's text.
   */
  passages: Record<string, Record<string, PassageLocation>>;
  sessions: ReviewSessionView[];
  /** "7 ottobre 2026", the planned publication date shown in the article header. */
  dateLabel: string | null;
  canComment: boolean;
}

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40";

function cardId(threadId: string): string {
  return `commento-${threadId}`;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

export default function BlogReview({
  postId,
  timezone,
  versions,
  initialVersionNumber,
  comments,
  passages,
  sessions,
  dateLabel,
  canComment,
}: BlogReviewProps) {
  const [versionNumber, setVersionNumber] = useState(initialVersionNumber);
  const [showResolved, setShowResolved] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [target, setTarget] = useState<BlogAnchor | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const version = versions.find((v) => v.number === versionNumber) ?? versions[0];
  const versionComments = version ? comments.filter((c) => c.versionId === version.id) : [];
  // Open passage notes of earlier versions, re-anchored on this text: the
  // agency sees on the new version which notes it still has to deal with.
  const carriedThreads = version
    ? buildCommentThreads(
        comments.filter((c) => c.versionNumber !== null && c.versionNumber < version.number)
      ).filter((t) => t.root.anchor && !t.resolved)
    : [];
  const carriedCount = carriedThreads.reduce((sum, t) => sum + 1 + t.replies.length, 0);
  const otherVersionComments = comments.length - versionComments.length - carriedCount;
  const versionPassages = (version && passages[version.id]) || {};
  const threads = [...buildCommentThreads(versionComments), ...carriedThreads];
  const resolvedCount = threads.filter((t) => t.resolved).length;
  const visible = threads.filter((t) => showResolved || !t.resolved);

  // Passage threads in reading order (missing passages last), then the general ones by date.
  const passageThreads = visible.filter((t) => t.root.anchor);
  const generalThreads = visible.filter((t) => !t.root.anchor);
  // Numbers over every passage thread of the version (resolved ones too), in
  // the same order as the client portal: "nota 2" is the same note for both.
  const anchoredThreads = threads.filter((t) => t.root.anchor);
  const numbers = numberPassageComments(
    anchoredThreads.map((t) => ({ id: t.id, createdAt: new Date(t.root.createdAt) })),
    new Map(
      anchoredThreads.map((t) => [t.id, versionPassages[t.root.id] ?? { status: "missing" as const, start: null }] as const)
    )
  );
  passageThreads.sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));

  const readerComments: BlogReaderComment[] = passageThreads.flatMap((t) =>
    t.root.anchor ? [{ id: t.id, number: numbers.get(t.id) ?? 0, anchor: t.root.anchor, resolved: t.resolved }] : []
  );

  function changeVersion(number: number) {
    setVersionNumber(number);
    setActiveId(null);
    setTarget(null);
    setError(null);
  }

  /** "Vai al passaggio": outline the highlight and bring it on screen (again on every click). */
  function goToPassage(threadId: string) {
    setActiveId(threadId);
    document
      .querySelector<HTMLElement>(`mark[data-comment-id="${cssEscape(threadId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /** A highlight was tapped: show its thread. */
  function openThread(threadId: string) {
    const thread = threads.find((t) => t.id === threadId);
    if (thread?.resolved) setShowResolved(true);
    setActiveId(threadId);
    // After the list re-renders with the resolved threads, if they were hidden.
    requestAnimationFrame(() =>
      document.getElementById(cardId(threadId))?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    );
  }

  function submitComment() {
    if (!version) return;
    const body = draft.trim();
    if (!body) {
      setError("Scrivi il commento.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addCommentAction({
        postId,
        body,
        versionId: version.id,
        ...(target ? { anchor: target } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft("");
      setTarget(null);
    });
  }

  if (!version) return <p className="text-sm text-muted">Nessuna versione disponibile.</p>;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      {/* ── Article ── */}
      <div className="min-w-0 space-y-3">
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
        <div className="panel rounded px-4 py-6 sm:px-8">
          <BlogReader
            key={version.id}
            content={version.content}
            html={version.html}
            comments={readerComments}
            onCommentRequest={canComment ? (anchor) => setTarget(anchor) : undefined}
            onCommentOpen={openThread}
            activeCommentId={activeId}
            showResolved={showResolved}
            dateLabel={dateLabel}
          />
        </div>
        <details className="panel rounded p-4">
          <summary className="cursor-pointer text-sm font-medium">Controlli SEO della versione {version.number}</summary>
          <SeoPanel content={version.content} showSerp className="mt-4" />
        </details>
      </div>

      {/* ── Comments ── */}
      <div className="min-w-0 space-y-6 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
        {canComment && (
          <section className="panel space-y-3 rounded p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{target ? "Nuovo commento sul passaggio" : "Nuovo commento generale"}</h3>
              {target && (
                <button type="button" onClick={() => setTarget(null)} className="text-xs text-muted hover:text-foreground">
                  Rendi generale
                </button>
              )}
            </div>
            {target ? (
              <blockquote className="break-words rounded border border-border bg-surface px-3 py-2 text-sm italic">
                «{target.quote.length > 280 ? `${target.quote.slice(0, 280)}…` : target.quote}»
              </blockquote>
            ) : (
              <p className="text-xs text-muted">Seleziona una frase dell&apos;articolo per commentare un passaggio preciso.</p>
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
            {carriedThreads.length > 0 ? ` (${carriedThreads.length} aperte da versioni precedenti)` : ""}
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

        {passageThreads.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Commenti sul testo</h3>
            <ol className="space-y-2">
              {passageThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  domId={cardId(thread.id)}
                  postId={postId}
                  thread={thread}
                  number={String(numbers.get(thread.id) ?? "")}
                  timezone={timezone}
                  canComment={canComment}
                  multipleMedia={false}
                  passageStatus={versionPassages[thread.root.id]?.status}
                  fromVersionNumber={
                    thread.root.versionId !== version.id ? (thread.root.versionNumber ?? undefined) : undefined
                  }
                  onGoToPassage={() => goToPassage(thread.id)}
                  active={activeId === thread.id}
                />
              ))}
            </ol>
          </section>
        )}

        {generalThreads.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Commenti generali</h3>
            <ol className="space-y-2">
              {generalThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  domId={cardId(thread.id)}
                  postId={postId}
                  thread={thread}
                  number=""
                  timezone={timezone}
                  canComment={canComment}
                  multipleMedia={false}
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
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
