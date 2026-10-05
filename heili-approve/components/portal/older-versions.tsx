/**
 * Earlier versions of the post, collapsed: date, the agency's note and the
 * comments made on each one (read-only, no seeking: their media changed).
 */

import CommentList from "./comment-list";
import type { PortalOlderVersion } from "./types";

export default function OlderVersions({ versions }: { versions: PortalOlderVersion[] }) {
  if (versions.length === 0) return null;
  return (
    <details className="rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
        Versioni precedenti ({versions.length})
      </summary>
      <div className="space-y-5 border-t border-border p-4">
        {versions.map((version) => (
          <div key={version.number} className="space-y-2">
            <p className="text-sm font-semibold">
              Versione {version.number} <span className="font-normal text-muted">· {version.dateLabel}</span>
            </p>
            {version.changeNote && (
              <p className="whitespace-pre-wrap break-words text-sm text-muted">
                Nota dell&apos;agenzia: {version.changeNote}
              </p>
            )}
            <CommentList comments={version.comments} media={[]} emptyText="Nessun commento su questa versione." />
          </div>
        ))}
      </div>
    </details>
  );
}
