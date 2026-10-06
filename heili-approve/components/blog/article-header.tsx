/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * Top of an article "as on the site": categories, headline, excerpt, byline
 * (author · date · reading time) and featured image. Shared by the preview
 * and the client reader; no hooks, so it renders on the server too, and it
 * only depends on blog-text (no Markdown renderer in the client bundle).
 */

import { formatReadingTime } from "@/lib/content/blog-text";
import type { BlogContent } from "@/lib/content/types";
import { ARTICLE_WIDTH_CLASS } from "./prose";

export default function ArticleHeader({
  content,
  readingMinutes,
  dateLabel,
}: {
  content: BlogContent;
  readingMinutes: number;
  /** "7 ottobre 2026", formatted by the caller in the client's time zone. */
  dateLabel?: string | null;
}) {
  const byline = [content.author.trim(), dateLabel?.trim(), readingMinutes > 0 ? formatReadingTime(readingMinutes) : null]
    .filter(Boolean)
    .join(" · ");
  const image = content.featuredImage;

  return (
    <header className={`${ARTICLE_WIDTH_CLASS} space-y-4`}>
      {content.categories.length > 0 && (
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">{content.categories.join(" · ")}</p>
      )}
      <h1 className="break-words text-[1.75rem] font-semibold leading-tight text-foreground sm:text-[2.25rem]">
        {content.headline.trim() || <span className="text-muted">Titolo dell&apos;articolo</span>}
      </h1>
      {content.excerpt.trim() && (
        <p className="break-words text-[1.1rem] leading-relaxed text-muted sm:text-[1.2rem]">{content.excerpt}</p>
      )}
      {byline && <p className="text-sm text-muted">{byline}</p>}
      {image && image.type === "image" && (
        <figure className="-mx-4 sm:mx-0">
          <img
            src={image.url}
            alt={image.alt ?? ""}
            width={image.width}
            height={image.height}
            referrerPolicy="no-referrer"
            className="h-auto w-full bg-surface-hover object-cover sm:rounded-lg"
          />
        </figure>
      )}
    </header>
  );
}
