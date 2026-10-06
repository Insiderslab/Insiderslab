/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * BlogVersionDiff — what changed between two versions of an article, word
 * by word: headline, excerpt, SEO fields, categories and tags, the body as
 * readable text (only changed paragraphs open, unchanged runs folded), the
 * featured image, and optionally the raw Markdown for the agency.
 *
 * No hooks (folding uses <details>), so it renders on the server and the
 * client portal does not ship the diff engine.
 */

import { diffBlogContent, splitDiffIntoParagraphs, type BlogContentDiff } from "@/lib/content/blog";
import type { BlogContent } from "@/lib/content/types";
import DiffText, { DiffLegend } from "./diff-text";

export default function BlogVersionDiff({
  before,
  after,
  diff: precomputed,
  fromLabel,
  toLabel,
  showMarkdown = false,
  className = "",
}: {
  before: BlogContent;
  after: BlogContent;
  /** diffBlogContent(before, after), when the caller already computed it. */
  diff?: BlogContentDiff;
  /** "Versione 2" / "Versione 3". */
  fromLabel?: string;
  toLabel?: string;
  /** Agency only: also offer the diff of the raw Markdown (links, formatting). */
  showMarkdown?: boolean;
  className?: string;
}) {
  const diff = precomputed ?? diffBlogContent(before, after);

  if (!diff.changed) {
    return <p className={`text-sm text-muted ${className}`}>Nessuna differenza tra le due versioni.</p>;
  }

  return (
    <div className={`space-y-5 ${className}`}>
      {(fromLabel || toLabel) && (
        <p className="text-sm text-muted">
          Da {fromLabel ?? "la versione precedente"} a {toLabel ?? "questa versione"}
        </p>
      )}

      {diff.summary.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Riepilogo delle modifiche">
          {diff.summary.map((line) => (
            <li key={line} className="rounded-full border border-border bg-background px-3 py-1 text-xs">
              {line}
            </li>
          ))}
        </ul>
      )}

      {diff.fields.map((field) => (
        <div key={field.field} className="space-y-1">
          <p className="text-xs font-medium text-muted">{field.label}</p>
          <DiffText
            segments={field.segments}
            className={`rounded-md border border-border bg-background p-3 leading-relaxed ${
              field.field === "headline" ? "text-base font-semibold" : "text-sm"
            }`}
          />
        </div>
      ))}

      {diff.featuredImage && <FeaturedImageChange change={diff.featuredImage} />}

      {diff.body && <BodyDiff segments={diff.body} />}

      {diff.bodyMarkdown && !diff.body && (
        <p className="text-sm text-muted">
          Il testo che si legge è uguale: sono cambiati solo la formattazione o l&apos;indirizzo di qualche link.
        </p>
      )}

      {showMarkdown && diff.bodyMarkdown && (
        <details className="rounded-md border border-border bg-background">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Modifiche al Markdown</summary>
          <DiffText segments={diff.bodyMarkdown} className="border-t border-border p-3 font-mono text-xs leading-relaxed" />
        </details>
      )}

      <DiffLegend />
    </div>
  );
}

function BodyDiff({ segments }: { segments: BlogContentDiff["body"] & object }) {
  const paragraphs = splitDiffIntoParagraphs(segments);
  // Group consecutive unchanged paragraphs so they fold into one line.
  const groups: Array<{ changed: true; paragraph: (typeof paragraphs)[number] } | { changed: false; items: typeof paragraphs }> = [];
  for (const paragraph of paragraphs) {
    const last = groups[groups.length - 1];
    if (paragraph.changed) groups.push({ changed: true, paragraph });
    else if (last && !last.changed) last.items.push(paragraph);
    else groups.push({ changed: false, items: [paragraph] });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">Testo</p>
      <div className="space-y-3 rounded-md border border-border bg-background p-3 text-[15px] leading-relaxed sm:p-4 sm:text-base">
        {groups.map((group, i) =>
          group.changed ? (
            <DiffText key={i} segments={group.paragraph.segments} />
          ) : (
            <details key={i} className="text-muted">
              <summary className="cursor-pointer select-none text-xs">
                {group.items.length === 1 ? "1 paragrafo invariato" : `${group.items.length} paragrafi invariati`}
              </summary>
              <div className="mt-2 space-y-3">
                {group.items.map((item, k) => (
                  <DiffText key={k} segments={item.segments} />
                ))}
              </div>
            </details>
          )
        )}
      </div>
    </div>
  );
}

function FeaturedImageChange({ change }: { change: NonNullable<BlogContentDiff["featuredImage"]> }) {
  if (change.altOnly) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted">Testo alternativo dell&apos;immagine in evidenza</p>
        <p className="rounded-md border border-border bg-background p-3 text-sm">
          <del className="rounded-sm bg-error/10 text-error line-through">{change.before?.alt || "(vuoto)"}</del>{" "}
          <ins className="rounded-sm bg-success/15 text-foreground no-underline">{change.after?.alt || "(vuoto)"}</ins>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted">Immagine in evidenza</p>
      <div className="flex flex-wrap items-center gap-3">
        <Thumb label="Prima" url={change.before?.url} alt={change.before?.alt} />
        <span aria-hidden className="text-muted">
          →
        </span>
        <Thumb label="Ora" url={change.after?.url} alt={change.after?.alt} />
      </div>
    </div>
  );
}

function Thumb({ label, url, alt }: { label: string; url?: string; alt?: string }) {
  return (
    <figure className="space-y-1">
      {url ? (
        <img
          src={url}
          alt={alt ?? ""}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-20 w-32 rounded-md border border-border object-cover"
        />
      ) : (
        <span className="flex h-20 w-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted">
          Nessuna
        </span>
      )}
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}
