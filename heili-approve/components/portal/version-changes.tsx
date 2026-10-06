/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * "Cosa è cambiato": what the agency changed since the version the client
 * last saw — the agency's notes, a word-level diff of the caption and first
 * comment, and the media changes. Rendered on the server. Articles and ads
 * sets pass their own diff as children (BlogVersionDiff, variant changes).
 */

import type { ReactNode } from "react";
import type { DiffSegment } from "@/lib/posts";
import type { PortalVersionChanges } from "./types";

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return (
    <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-sm leading-relaxed">
      {segments.map((segment, i) =>
        segment.type === "added" ? (
          <ins key={i} className="rounded-sm bg-success/15 text-foreground no-underline">
            {segment.value}
          </ins>
        ) : segment.type === "removed" ? (
          <del key={i} className="rounded-sm bg-error/10 text-error line-through">
            {segment.value}
          </del>
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </p>
  );
}

export default function VersionChanges({
  changes,
  currentNumber,
  children,
}: {
  changes: PortalVersionChanges;
  currentNumber: number;
  /** Kind-specific diff, under the agency's notes. */
  children?: ReactNode;
}) {
  const nothingVisible =
    !children &&
    changes.notes.length === 0 &&
    changes.summary.length === 0 &&
    changes.text.length === 0 &&
    changes.firstComment.length === 0;

  return (
    <section className="space-y-3 rounded-lg border border-accent/40 bg-surface p-4" aria-labelledby="changes-title">
      <div className="space-y-1">
        <h2 id="changes-title" className="text-base font-semibold">
          Cosa è cambiato
        </h2>
        <p className="text-sm text-muted">
          {changes.seenByReviewer
            ? `Rispetto alla versione ${changes.fromNumber}, l'ultima che hai visto. Ora stai guardando la versione ${currentNumber}.`
            : `Rispetto alla versione ${changes.fromNumber}. Ora stai guardando la versione ${currentNumber}.`}
        </p>
      </div>

      {changes.notes.map((note) => (
        <blockquote key={note.number} className="space-y-1 border-l-2 border-accent pl-3">
          <p className="text-xs text-muted">
            Nota dell&apos;agenzia · versione {note.number} · {note.dateLabel}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm">{note.note}</p>
        </blockquote>
      ))}

      {changes.summary.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {changes.summary.map((line) => (
            <li key={line} className="rounded-full border border-border bg-background px-3 py-1 text-xs">
              {line}
            </li>
          ))}
        </ul>
      )}

      {changes.text.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted">Testo del post</p>
          <DiffText segments={changes.text} />
        </div>
      )}

      {changes.firstComment.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted">Primo commento</p>
          <DiffText segments={changes.firstComment} />
        </div>
      )}

      {children}

      {changes.addedMedia.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted">Nuovi media</p>
          <div className="flex flex-wrap gap-2">
            {changes.addedMedia.map((media) =>
              media.type === "image" ? (
                <img
                  key={media.url}
                  src={media.url}
                  alt={media.alt ?? ""}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
              ) : (
                <span
                  key={media.url}
                  className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-background text-xs text-muted"
                >
                  Video
                </span>
              )
            )}
          </div>
        </div>
      )}

      {(changes.text.length > 0 || changes.firstComment.length > 0) && (
        <p className="text-xs text-muted">
          <ins className="bg-success/15 no-underline">Evidenziato</ins> = aggiunto ·{" "}
          <del className="text-error">barrato</del> = tolto
        </p>
      )}

      {nothingVisible && (
        <p className="text-sm text-muted">Il contenuto è lo stesso: è cambiato solo qualche dettaglio tecnico.</p>
      )}
    </section>
  );
}
