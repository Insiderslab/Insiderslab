/**
 * Word-level diff rendered inline: insertions highlighted in green,
 * deletions struck through in red, with hidden labels for screen readers.
 * Same look as the social portal's "Cosa è cambiato". No hooks.
 */

import type { WordDiffSegment } from "@/lib/content/blog";

export default function DiffText({
  segments,
  className = "",
  as: Tag = "p",
}: {
  segments: WordDiffSegment[];
  className?: string;
  as?: "p" | "div" | "span";
}) {
  return (
    <Tag className={`whitespace-pre-wrap break-words ${className}`}>
      {segments.map((segment, i) =>
        segment.type === "added" ? (
          <ins key={i} className="rounded-sm bg-success/15 text-foreground no-underline decoration-success">
            <span className="sr-only">[aggiunto: </span>
            {segment.value}
            <span className="sr-only">]</span>
          </ins>
        ) : segment.type === "removed" ? (
          <del key={i} className="rounded-sm bg-error/10 text-error line-through">
            <span className="sr-only">[tolto: </span>
            {segment.value}
            <span className="sr-only">]</span>
          </del>
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </Tag>
  );
}

export function DiffLegend() {
  return (
    <p className="text-xs text-muted">
      <ins className="rounded-sm bg-success/15 px-0.5 text-foreground no-underline">Evidenziato</ins> = aggiunto ·{" "}
      <del className="rounded-sm bg-error/10 px-0.5 text-error line-through">barrato</del> = tolto
    </p>
  );
}
