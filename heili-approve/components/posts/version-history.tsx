/**
 * Version History
 *
 * Every version of the post, newest first: who made it and when, whether the
 * client has been sent it, the agency's note, a summary of what changed and
 * the word-level diff of the caption and first comment against the previous
 * version. Diffs are computed on the server (lib/posts diffVersions).
 * Articles and ad sets pass their own diff as `detail` (BlogVersionDiff,
 * the list of variant changes) and a summary line instead of the media count.
 */

import type { ReactNode } from "react";
import type { DiffSegment } from "@/lib/posts";
import { formatDateTime } from "./helpers";

export interface VersionHistoryEntry {
  id: string;
  number: number;
  createdAt: Date | string;
  authorName: string | null;
  changeNote: string | null;
  sent: boolean;
  approved: boolean;
  isCurrent: boolean;
  /** "Testo modificato", "1 media aggiunto"… (empty for version 1). */
  changes: string[];
  textDiff: DiffSegment[];
  firstCommentDiff: DiffSegment[];
  /** Full caption, shown for the first version. */
  text: string;
  mediaCount: number;
  /** Replaces "N media" in the header line (e.g. "3 varianti", "1.240 parole"). */
  summaryLabel?: string;
  /** Kind-specific diff against the previous version, server-rendered. */
  detail?: ReactNode;
  /** Title of the `detail` fold. */
  detailLabel?: string;
}

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return (
    <p className="whitespace-pre-wrap break-words rounded border border-border bg-background p-3 text-sm">
      {segments.map((segment, i) =>
        segment.type === "same" ? (
          <span key={i}>{segment.value}</span>
        ) : segment.type === "added" ? (
          <ins key={i} className="bg-success/15 text-success no-underline">
            {segment.value}
          </ins>
        ) : (
          <del key={i} className="bg-error/10 text-error">
            {segment.value}
          </del>
        )
      )}
    </p>
  );
}

export default function VersionHistory({ versions, timezone }: { versions: VersionHistoryEntry[]; timezone: string }) {
  if (versions.length === 0) return <p className="text-sm text-muted">Nessuna versione.</p>;

  return (
    <ol className="space-y-3">
      {versions.map((version) => (
        <li key={version.id} className="panel rounded p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Versione {version.number}
              {version.isCurrent && <span className="ml-2 font-normal text-muted">attuale</span>}
            </h3>
            <p className="text-xs">
              {version.approved ? (
                <span className="text-success">Approvata dal cliente</span>
              ) : version.sent ? (
                <span className="text-accent">Inviata al cliente</span>
              ) : (
                <span className="text-muted">Non ancora inviata</span>
              )}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted">
            {formatDateTime(version.createdAt, timezone)}
            {version.authorName ? ` · ${version.authorName}` : ""} ·{" "}
            {version.summaryLabel ?? `${version.mediaCount} media`}
          </p>

          {version.changeNote && (
            <p className="mt-2 text-sm">
              <span className="text-muted">Nota per il cliente: </span>
              {version.changeNote}
            </p>
          )}

          {version.changes.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {version.changes.map((change) => (
                <li key={change}>• {change}</li>
              ))}
            </ul>
          )}

          {version.detail && (
            <details className="mt-3" open={version.isCurrent}>
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">
                {version.detailLabel ?? "Cosa è cambiato"}
              </summary>
              <div className="mt-3">{version.detail}</div>
            </details>
          )}

          {version.textDiff.length > 0 ? (
            <details className="mt-3" open={version.isCurrent}>
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">
                Differenze nel testo
              </summary>
              <div className="mt-2">
                <DiffText segments={version.textDiff} />
              </div>
            </details>
          ) : (
            version.number === 1 &&
            version.text && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">Testo</summary>
                <p className="mt-2 whitespace-pre-wrap break-words rounded border border-border bg-background p-3 text-sm">
                  {version.text}
                </p>
              </details>
            )
          )}

          {version.firstCommentDiff.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">
                Differenze nel primo commento
              </summary>
              <div className="mt-2">
                <DiffText segments={version.firstCommentDiff} />
              </div>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
