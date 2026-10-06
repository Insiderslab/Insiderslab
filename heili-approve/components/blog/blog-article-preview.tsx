/**
 * BlogArticlePreview — the article "as on the site": featured image,
 * headline, byline with reading time, body and tags. Read-only and without
 * hooks: use it in server pages (agency view) and in the editor's live
 * preview. For the client's review with comments use BlogReader.
 */

import { readingTime, renderMarkdownSafe } from "@/lib/content/blog";
import type { BlogContent } from "@/lib/content/types";
import ArticleHeader from "./article-header";
import { ARTICLE_BODY_CLASS, ARTICLE_WIDTH_CLASS } from "./prose";

export default function BlogArticlePreview({
  content,
  html,
  dateLabel,
  showTags = true,
  className = "",
}: {
  content: BlogContent;
  /** renderMarkdownSafe(content.bodyMarkdown), when the caller already has it. */
  html?: string;
  /** "7 ottobre 2026": planned publication date, formatted by the caller. */
  dateLabel?: string | null;
  showTags?: boolean;
  className?: string;
}) {
  // Only sanitized HTML ever reaches dangerouslySetInnerHTML.
  const body = html ?? renderMarkdownSafe(content.bodyMarkdown);

  return (
    <article className={`space-y-8 ${className}`}>
      <ArticleHeader content={content} readingMinutes={readingTime(content.bodyMarkdown)} dateLabel={dateLabel} />
      {body ? (
        <div className={`${ARTICLE_WIDTH_CLASS} ${ARTICLE_BODY_CLASS}`} dangerouslySetInnerHTML={{ __html: body }} />
      ) : (
        <p className={`${ARTICLE_WIDTH_CLASS} text-muted`}>Il testo dell&apos;articolo comparirà qui.</p>
      )}
      {showTags && content.tags.length > 0 && (
        <ul className={`${ARTICLE_WIDTH_CLASS} flex flex-wrap gap-2 border-t border-border pt-4`} aria-label="Tag">
          {content.tags.map((tag) => (
            <li key={tag} className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted">
              #{tag}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
