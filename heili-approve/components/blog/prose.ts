/**
 * Reading typography for article bodies (sanitized HTML from
 * renderMarkdownSafe), shared by the preview, the client reader and the
 * agency view. No typography plugin: arbitrary child variants on Heili
 * tokens. 17px on phones, 18px from `sm`, ~68 characters per line.
 */

export const ARTICLE_WIDTH_CLASS = "mx-auto w-full max-w-[68ch]";

export const ARTICLE_BODY_CLASS = [
  "break-words text-[17px] leading-[1.7] text-foreground sm:text-[18px]",
  "[&>*:first-child]:mt-0",
  "[&_p]:my-5",
  "[&_h1]:mb-4 [&_h1]:mt-10 [&_h1]:text-[1.6em] [&_h1]:font-semibold [&_h1]:leading-tight",
  "[&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-[1.35em] [&_h2]:font-semibold [&_h2]:leading-snug",
  "[&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:text-[1.15em] [&_h3]:font-semibold [&_h3]:leading-snug",
  "[&_h4]:mb-2 [&_h4]:mt-6 [&_h4]:font-semibold",
  "[&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_li>p]:my-1",
  "[&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-accent/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
  "[&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md",
  "[&_figure]:my-6 [&_figcaption]:mt-2 [&_figcaption]:text-sm [&_figcaption]:text-muted",
  "[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-hover [&_pre]:p-4 [&_pre]:text-sm",
  "[&_code]:rounded [&_code]:bg-surface-hover [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.88em] [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-8 [&_hr]:border-border",
  "[&_table]:my-5 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:text-[0.9em]",
  "[&_th]:border [&_th]:border-border [&_th]:bg-surface-hover [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
].join(" ");

/** Highlight of a commented passage (set on <mark> elements by BlogReader). */
export const COMMENT_MARK_CLASS =
  "cursor-pointer rounded-sm bg-warning/15 text-foreground underline decoration-warning/70 decoration-2 underline-offset-4";
export const COMMENT_MARK_ACTIVE_CLASS = "bg-warning/35 outline outline-2 outline-warning/60";
export const COMMENT_MARK_MOVED_CLASS = "decoration-dashed";
export const COMMENT_MARK_RESOLVED_CLASS = "bg-success/10 decoration-success/60";
/** Numbered badge after the last segment of a highlight (a pseudo-element: it never enters the text). */
export const COMMENT_MARK_BADGE_CLASS =
  "after:ml-0.5 after:inline-block after:rounded-full after:bg-warning after:px-1.5 after:align-super after:text-[0.65em] after:font-semibold after:leading-[1.5] after:text-white after:no-underline after:content-[attr(data-number)]";
export const COMMENT_MARK_BADGE_RESOLVED_CLASS = "after:bg-success";
