/**
 * Blog article components (Post.kind = BLOG_ARTICLE).
 *
 * Bundle note: BlogReader is meant for the client portal and depends only on
 * lib/content/blog-text. In client components import it from
 * "@/components/blog/blog-reader" directly rather than from this barrel, so
 * the Markdown renderer and sanitizer pulled in by the editor and preview
 * do not ship to the phone.
 */

export { default as BlogEditor, type BlogEditorProps } from "./blog-editor";
export { default as BlogArticlePreview } from "./blog-article-preview";
export { default as BlogReader, type BlogReaderComment, type BlogReaderProps } from "./blog-reader";
export { default as BlogVersionDiff } from "./blog-version-diff";
export { default as SeoPanel, SerpPreview } from "./seo-panel";
export { default as DiffText, DiffLegend } from "./diff-text";
export { default as ArticleHeader } from "./article-header";
export { ARTICLE_BODY_CLASS, ARTICLE_WIDTH_CLASS } from "./prose";
