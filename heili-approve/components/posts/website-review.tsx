"use client";

/**
 * Website Review (agency side of a «Sul sito» review, docs/SITO-WEB.md)
 *
 * The round of a version (address of the test site, note, pages) and next to
 * it the client's notes: first those on an element of the site, each with
 * its chip «Home · Telefono · «Scopri la collezione»» and, when the review
 * key is active, «Apri nel punto»; then the general ones; reply and resolve
 * as on every content; the assistant transcripts below.
 */

import { useState, useTransition } from "react";
import { addCommentAction } from "@/app/(dashboard)/posts/actions";
import AssistantTranscript from "@/components/review/assistant-transcript";
import OpenOnSite from "@/components/website/open-on-site";
import { anchorChip, DEVICE_LABELS, pagePath, type WebsiteContent } from "@/lib/content/website";
import ThreadCard, { type ReviewCommentView } from "./comment-thread";
import { buildCommentThreads } from "./helpers";
import type { ReviewSessionView } from "./post-review";

export interface WebsiteReviewVersion {
  id: string;
  number: number;
  content: WebsiteContent;
  /** Sent to the client at least once. */
  sent: boolean;
}

interface WebsiteReviewProps {
  postId: string;
  timezone: string;
  /** Newest first. */
  versions: WebsiteReviewVersion[];
  initialVersionNumber: number;
  comments: ReviewCommentView[];
  sessions: ReviewSessionView[];
  canComment: boolean;
  /** The review key is active: «Apri nel punto» can open the site at a comment. */
  canOpenOnSite?: boolean;
}

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40";

export default function WebsiteReview({
  postId,
  timezone,
  versions,
  initialVersionNumber,
  comments,
  sessions,
  canComment,
  canOpenOnSite = false,
}: WebsiteReviewProps) {
  const [versionNumber, setVersionNumber] = useState(initialVersionNumber);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const version = versions.find((v) => v.number === versionNumber) ?? versions[0];
  const versionComments = version ? comments.filter((c) => c.versionId === version.id) : [];
  const threads = buildCommentThreads(versionComments);
  const resolvedCount = threads.filter((t) => t.resolved).length;
  const visible = threads.filter((t) => showResolved || !t.resolved);
  const siteThreads = visible.filter((t) => t.root.siteAnchor);
  const generalThreads = visible.filter((t) => !t.root.siteAnchor);
  const otherVersionComments = comments.length - versionComments.length;

  function submitComment() {
    if (!version) return;
    const body = draft.trim();
    if (!body) {
      setError("Scrivi il commento.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addCommentAction({ postId, body, versionId: version.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft("");
    });
  }

  if (!version) return <p className="text-sm text-muted">Nessuna versione disponibile.</p>;
  const content = version.content;
  const pages = content.pages.filter((p) => p.url);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-3">
        {versions.length > 1 && (
          <label className="block text-sm">
            <span className="sr-only">Versione mostrata</span>
            <select
              value={version.number}
              onChange={(event) => setVersionNumber(Number(event.target.value))}
              className={`${inputClass} sm:w-auto`}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.number}>
                  Versione {v.number} · Giro {v.content.round}
                  {v.number === versions[0].number ? " (attuale)" : ""}
                  {v.sent ? "" : " · non ancora inviata"}
                </option>
              ))}
            </select>
          </label>
        )}
        <section className="panel space-y-4 rounded p-4" aria-label="Il sito in revisione">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">Giro {content.round}</h3>
            {content.siteUrl && (
              <a
                href={content.siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sm text-accent hover:underline"
              >
                {content.siteUrl}
              </a>
            )}
          </div>
          {content.roundNote && <p className="whitespace-pre-wrap break-words text-sm">{content.roundNote}</p>}
          <p className="text-xs text-muted">
            Da controllare su: {content.devices.map((d) => DEVICE_LABELS[d]).join(" e ") || "—"}
          </p>
          <ol className="space-y-2">
            {pages.map((page, index) => (
              <li key={page.id} className="rounded border border-border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {index + 1}. {page.title || pagePath(page.url)}
                  </span>
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-xs text-accent hover:underline"
                  >
                    {pagePath(page.url)}
                  </a>
                </div>
                {page.note && <p className="mt-1 text-xs text-muted">{page.note}</p>}
              </li>
            ))}
            {pages.length === 0 && <li className="text-sm text-muted">Nessuna pagina in questa versione.</li>}
          </ol>
        </section>
      </div>

      <div className="min-w-0 space-y-6">
        {canComment && (
          <section className="panel space-y-3 rounded p-4">
            <h3 className="text-sm font-medium">Nuovo commento generale</h3>
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
                className="btn btn-primary"
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

        {siteThreads.length > 0 && (
          <section className="space-y-2" aria-label="Note sul sito">
            <h3 className="text-sm font-semibold">Note sul sito</h3>
            <ol className="space-y-2">
              {siteThreads.map((thread, index) => {
                const anchor = thread.root.siteAnchor!;
                return (
                  <ThreadCard
                    key={thread.id}
                    domId={`commento-${thread.id}`}
                    postId={postId}
                    thread={thread}
                    number={String(index + 1)}
                    timezone={timezone}
                    canComment={canComment}
                    multipleMedia={false}
                    siteLabel={anchorChip(anchor, content.pages)}
                    siteAction={canOpenOnSite ? <OpenOnSite commentId={thread.root.id} /> : null}
                  />
                );
              })}
            </ol>
          </section>
        )}

        {generalThreads.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{siteThreads.length > 0 ? "Commenti generali" : "Commenti"}</h3>
            <ol className="space-y-2">
              {generalThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  domId={`commento-${thread.id}`}
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
