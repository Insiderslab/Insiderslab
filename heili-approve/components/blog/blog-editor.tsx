"use client";

/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * BlogEditor — write an article in Markdown.
 *
 * - Headline and slug (generated from the headline until edited by hand).
 * - Body: a plain <textarea> with a toolbar that wraps the selection (H2, H3,
 *   grassetto, corsivo, elenchi, citazione, link) and inserts images uploaded
 *   through POST /api/uploads (button, paste or drop). Edits go through the
 *   browser's own undo stack (Ctrl/Cmd+Z works); Ctrl/Cmd+B, I, K shortcuts.
 * - Live preview "as on the site": side by side on wide screens, a
 *   Scrivi / Anteprima switch on phones. Word count and reading time.
 * - Excerpt, author, categories and tags; featured image with alt text.
 * - SEO: focus keyword, SEO title and meta description with counters, the
 *   Google preview and every SeoPanel check; then what still blocks sending
 *   the article to the client (validateBlogForReview).
 *
 * Fully controlled: every change calls onChange with the whole BlogContent,
 * so the parent can autosave (debounce there) or save on submit.
 */

import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BLOG_LIMITS,
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  META_TITLE_IDEAL_MAX,
  charCount,
  formatReadingTime,
  readingMinutesForWords,
  renderMarkdownSafe,
  seoChecks,
  slugify,
  validateBlogForReview,
  wordCount,
} from "@/lib/content/blog";
import type { BlogContent } from "@/lib/content/types";
import type { MediaItem } from "@/lib/domain";
import { formatCount } from "@/components/posts/helpers";
import { uploadMedia } from "@/components/posts/upload";
import BlogArticlePreview from "./blog-article-preview";
import LabelInput from "./label-input";
import { applyMarkdownAction, insertImageMarkdown, type MarkdownAction, type MarkdownEdit } from "./markdown-actions";
import SeoPanel from "./seo-panel";

export interface BlogEditorProps {
  value: BlogContent;
  onChange: (next: BlogContent) => void;
  disabled?: boolean;
  /** True while an image is uploading (the parent should not submit meanwhile). */
  onBusyChange?: (busy: boolean) => void;
  /** The client's site (e.g. "rossi.it"): its absolute links count as internal. */
  siteHost?: string | null;
  /** Planned publication date for the preview byline, e.g. "7 ottobre 2026". */
  dateLabel?: string | null;
  /** Show "Da sistemare prima dell'invio" (validateBlogForReview). Default true. */
  showReviewIssues?: boolean;
}

const IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/gif";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40 disabled:opacity-60";
const labelClass = "mb-1.5 block text-sm font-medium text-foreground";
const toolButton =
  "inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded border border-transparent px-2 text-sm text-foreground hover:border-border hover:bg-surface-hover disabled:opacity-40";

const TOOLBAR: Array<{ action: MarkdownAction; label: string; title: string; content: ReactNode }> = [
  { action: "h2", label: "Titolo di sezione (H2)", title: "Titolo di sezione (H2)", content: <span className="font-semibold">H2</span> },
  { action: "h3", label: "Sottotitolo (H3)", title: "Sottotitolo (H3)", content: <span className="font-semibold">H3</span> },
  { action: "bold", label: "Grassetto", title: "Grassetto (Ctrl/Cmd+B)", content: <span className="font-bold">G</span> },
  { action: "italic", label: "Corsivo", title: "Corsivo (Ctrl/Cmd+I)", content: <span className="italic">C</span> },
  { action: "ul", label: "Elenco puntato", title: "Elenco puntato", content: <span aria-hidden>• —</span> },
  { action: "ol", label: "Elenco numerato", title: "Elenco numerato", content: <span aria-hidden>1. —</span> },
  { action: "quote", label: "Citazione", title: "Citazione", content: <span aria-hidden className="text-lg leading-none">“</span> },
  { action: "link", label: "Link", title: "Link (Ctrl/Cmd+K)", content: <span className="underline">Link</span> },
];

interface UploadState {
  progress: number;
  error: string | null;
}

export default function BlogEditor({
  value,
  onChange,
  disabled = false,
  onBusyChange,
  siteHost,
  dateLabel,
  showReviewIssues = true,
}: BlogEditorProps) {
  const ids = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyFileRef = useRef<HTMLInputElement>(null);
  const featuredFileRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const pendingSelection = useRef<[number, number] | null>(null);
  const insertAt = useRef<[number, number] | null>(null);

  const [slugTouched, setSlugTouched] = useState(() => value.slug !== "" && value.slug !== slugify(value.headline));
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [bodyUpload, setBodyUpload] = useState<UploadState | null>(null);
  const [featuredUpload, setFeaturedUpload] = useState<UploadState | null>(null);

  // Async completions (uploads) must merge into the latest value, not the
  // one captured when they started.
  useLayoutEffect(() => {
    valueRef.current = value;
  });

  // Restore the selection after a fallback (non-undoable) toolbar edit.
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea) return;
    pendingSelection.current = null;
    textarea.focus();
    textarea.setSelectionRange(selection[0], selection[1]);
  }, [value.bodyMarkdown]);

  const busy = (bodyUpload !== null && bodyUpload.error === null) || (featuredUpload !== null && featuredUpload.error === null);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Heavier work (Markdown rendering, checks) follows typing at its own pace.
  const deferred = useDeferredValue(value);
  const previewHtml = useMemo(() => renderMarkdownSafe(deferred.bodyMarkdown), [deferred.bodyMarkdown]);
  const words = useMemo(() => wordCount(deferred.bodyMarkdown), [deferred.bodyMarkdown]);
  const checks = useMemo(() => seoChecks(deferred, { siteHost }), [deferred, siteHost]);
  const issues = useMemo(() => validateBlogForReview(deferred), [deferred]);

  function update(patch: Partial<BlogContent>) {
    onChange({ ...valueRef.current, ...patch });
  }

  function setHeadline(headline: string) {
    update(slugTouched ? { headline } : { headline, slug: slugify(headline) });
  }

  // ── Body edits ────────────────────────────────────────────────────────────
  function applyEdit(edit: MarkdownEdit) {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const before = textarea.value;
    const expected = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    textarea.focus();
    textarea.setSelectionRange(edit.start, edit.end);
    let applied = false;
    try {
      // Goes through the browser's undo stack and fires a normal input event.
      applied = document.execCommand("insertText", false, edit.text);
    } catch {
      applied = false;
    }
    if (applied && textarea.value === expected) {
      textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      return;
    }
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    update({ bodyMarkdown: expected });
  }

  function runAction(action: MarkdownAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyEdit(applyMarkdownAction(textarea.value, textarea.selectionStart, textarea.selectionEnd, action));
  }

  async function insertImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setBodyUpload({ progress: 0, error: "Nel testo si possono inserire solo immagini (JPG, PNG, WebP, GIF)." });
      return;
    }
    const textarea = textareaRef.current;
    const at = insertAt.current ?? (textarea ? [textarea.selectionStart, textarea.selectionEnd] : [0, 0]);
    insertAt.current = null;
    setBodyUpload({ progress: 0, error: null });
    try {
      const media = await uploadMedia(file, { onProgress: (progress) => setBodyUpload({ progress, error: null }) });
      setBodyUpload(null);
      const current = textareaRef.current?.value ?? valueRef.current.bodyMarkdown;
      const start = Math.min(at[0], current.length);
      const end = Math.min(Math.max(at[1], start), current.length);
      applyEdit(insertImageMarkdown(current, start, end, media.url, ""));
    } catch (error) {
      setBodyUpload({ progress: 0, error: error instanceof Error ? error.message : "Caricamento non riuscito." });
    }
  }

  function firstImage(files: FileList | null | undefined): File | null {
    return Array.from(files ?? []).find((file) => file.type.startsWith("image/")) ?? null;
  }

  // ── Featured image ────────────────────────────────────────────────────────
  async function uploadFeatured(file: File) {
    if (!file.type.startsWith("image/")) {
      setFeaturedUpload({ progress: 0, error: "Scegli un'immagine (JPG, PNG, WebP, GIF)." });
      return;
    }
    setFeaturedUpload({ progress: 0, error: null });
    try {
      const media: MediaItem = await uploadMedia(file, {
        onProgress: (progress) => setFeaturedUpload({ progress, error: null }),
      });
      setFeaturedUpload(null);
      const previousAlt = valueRef.current.featuredImage?.alt ?? "";
      update({ featuredImage: { ...media, alt: media.alt ?? previousAlt } });
    } catch (error) {
      setFeaturedUpload({ progress: 0, error: error instanceof Error ? error.message : "Caricamento non riuscito." });
    }
  }

  const metaTitleLength = charCount(value.metaTitle.trim() || value.headline.trim());
  const metaDescriptionLength = charCount(value.metaDescription.trim());
  const metaDescriptionOk =
    metaDescriptionLength >= META_DESCRIPTION_MIN && metaDescriptionLength <= META_DESCRIPTION_MAX;
  const slugPreview = value.slug || slugify(value.headline);

  const writePane = (
    <div className="min-w-0 space-y-2">
      <div
        role="toolbar"
        aria-label="Formattazione"
        aria-controls={`${ids}-body`}
        className="sticky top-0 z-10 -mx-1 flex gap-0.5 overflow-x-auto border-b border-border bg-surface px-1 pb-1.5"
      >
        {TOOLBAR.map((tool) => (
          <button
            key={tool.action}
            type="button"
            disabled={disabled}
            aria-label={tool.label}
            title={tool.title}
            // Keep the textarea's selection: the click must not steal focus.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runAction(tool.action)}
            className={toolButton}
          >
            {tool.content}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || busy}
          title="Inserisci un'immagine nel testo"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const textarea = textareaRef.current;
            insertAt.current = textarea ? [textarea.selectionStart, textarea.selectionEnd] : null;
            bodyFileRef.current?.click();
          }}
          className={toolButton}
        >
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current">
            <path d="M3 4.75A1.75 1.75 0 0 1 4.75 3h10.5A1.75 1.75 0 0 1 17 4.75v10.5A1.75 1.75 0 0 1 15.25 17H4.75A1.75 1.75 0 0 1 3 15.25V4.75Zm1.5 8.56v1.94c0 .14.11.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.69l-3-3-3.97 3.97a.75.75 0 0 1-1.06 0L7.5 11.56l-3 1.75ZM7 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
          </svg>
          Immagine
        </button>
        <input
            disabled={disabled}
          ref={bodyFileRef}
          type="file"
          accept={IMAGE_TYPES}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void insertImage(file);
          }}
        />
      </div>

      <label htmlFor={`${ids}-body`} className="sr-only">
        Testo dell&apos;articolo (Markdown)
      </label>
      <textarea
        id={`${ids}-body`}
        ref={textareaRef}
        value={value.bodyMarkdown}
        disabled={disabled}
        onChange={(event) => update({ bodyMarkdown: event.target.value })}
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
          const key = event.key.toLowerCase();
          const action: MarkdownAction | null = key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
          if (!action) return;
          event.preventDefault();
          runAction(action);
        }}
        onPaste={(event) => {
          const file = firstImage(event.clipboardData?.files);
          if (!file) return;
          event.preventDefault();
          void insertImage(file);
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault();
        }}
        onDrop={(event) => {
          const file = firstImage(event.dataTransfer.files);
          if (!file) return;
          event.preventDefault();
          void insertImage(file);
        }}
        maxLength={BLOG_LIMITS.body}
        spellCheck
        lang="it"
        placeholder={"Scrivi qui l'articolo.\n\n## Titolo di una sezione\n\nUn paragrafo con **grassetto**, _corsivo_ e un [link](https://esempio.it)."}
        className={`${inputClass} min-h-[55vh] resize-y font-mono text-[15px] leading-7 sm:text-sm lg:min-h-[70vh]`}
      />

      {bodyUpload && (
        <div className="text-xs" aria-live="polite">
          {bodyUpload.error ? (
            <p className="text-error">
              {bodyUpload.error}{" "}
              <button type="button" onClick={() => setBodyUpload(null)} className="text-muted underline">
                Chiudi
              </button>
            </p>
          ) : (
            <div className="flex items-center gap-2 text-muted">
              <span>Caricamento immagine…</span>
              <span className="h-1.5 w-32 overflow-hidden rounded bg-surface-hover">
                <span className="block h-full bg-accent" style={{ width: `${Math.round(bodyUpload.progress * 100)}%` }} />
              </span>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted" aria-live="polite">
        {formatCount(words)} {words === 1 ? "parola" : "parole"}
        {words > 0 ? ` · ${formatReadingTime(readingMinutesForWords(words))}` : ""} ·{" "}
        {formatCount(charCount(value.bodyMarkdown))} caratteri
      </p>
    </div>
  );

  const previewPane = (
    <div className="min-w-0 rounded-lg border border-border bg-background p-4 sm:p-6 lg:max-h-[calc(70vh+5rem)] lg:overflow-y-auto">
      <BlogArticlePreview content={deferred} html={previewHtml} dateLabel={dateLabel} />
    </div>
  );

  return (
    <div className="min-w-0 space-y-6">
      <section className="panel space-y-4 rounded p-4 sm:p-5">
        <div>
          <label htmlFor={`${ids}-headline`} className={labelClass}>
            Titolo dell&apos;articolo
          </label>
          <input
            disabled={disabled}
            id={`${ids}-headline`}
            type="text"
            value={value.headline}
            onChange={(event) => setHeadline(event.target.value)}
            maxLength={BLOG_LIMITS.headline}
            placeholder="Es. Perché il caffè specialty costa di più"
            className={`${inputClass} text-base font-semibold`}
          />
          <p className="mt-1 text-xs text-muted">È l&apos;H1 della pagina, quello che il lettore vede per primo.</p>
        </div>

        <div>
          <label htmlFor={`${ids}-slug`} className={labelClass}>
            Slug <span className="font-normal text-muted">(indirizzo della pagina)</span>
          </label>
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded border border-border bg-background focus-within:border-accent/40">
              <span className="pl-3 text-sm text-muted" aria-hidden>
                /
              </span>
              <input
            disabled={disabled}
                id={`${ids}-slug`}
                type="text"
                value={value.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  update({ slug: event.target.value.toLowerCase().replace(/\s+/g, "-") });
                }}
                onBlur={() => {
                  const clean = slugify(value.slug);
                  if (clean !== value.slug) update({ slug: clean });
                }}
                maxLength={BLOG_LIMITS.slug}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                placeholder={slugPreview || "perche-il-caffe-costa-di-piu"}
                className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-foreground outline-none"
              />
            </div>
            {slugTouched && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setSlugTouched(false);
                  update({ slug: slugify(value.headline) });
                }}
                className="shrink-0 rounded border border-border bg-background px-3 text-sm text-muted hover:border-border-hover hover:text-foreground"
              >
                Dal titolo
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            {slugTouched
              ? "Modificato a mano: non segue più il titolo."
              : "Si aggiorna dal titolo finché non lo modifichi."}{" "}
            Solo lettere minuscole senza accenti, numeri e trattini.
          </p>
        </div>
      </section>

      <section className="panel space-y-3 rounded p-4 sm:p-5" aria-label="Testo dell'articolo">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Testo</h3>
          <div className="flex rounded border border-border p-0.5 lg:hidden" role="tablist" aria-label="Vista">
            {(["write", "preview"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                onClick={() => setTab(option)}
                className={`min-h-9 rounded px-3 text-sm ${tab === option ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
              >
                {option === "write" ? "Scrivi" : "Anteprima"}
              </button>
            ))}
          </div>
          <span className="hidden text-xs text-muted lg:inline">Anteprima come sul sito, a destra</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={tab === "write" ? "" : "hidden lg:block"}>{writePane}</div>
          <div className={tab === "preview" ? "" : "hidden lg:block"}>{previewPane}</div>
        </div>
      </section>

      <section className="panel space-y-4 rounded p-4 sm:p-5">
        <h3 className="text-sm font-semibold">Riassunto e pubblicazione</h3>
        <div>
          <label htmlFor={`${ids}-excerpt`} className={labelClass}>
            Riassunto <span className="font-normal text-muted">(compare negli elenchi del blog)</span>
          </label>
          <textarea
            disabled={disabled}
            id={`${ids}-excerpt`}
            value={value.excerpt}
            onChange={(event) => update({ excerpt: event.target.value })}
            rows={3}
            maxLength={BLOG_LIMITS.excerpt}
            className={`${inputClass} resize-y`}
            placeholder="Due righe che invoglino a leggere l'articolo."
          />
          <p className="mt-1 text-right text-xs text-muted">{charCount(value.excerpt)} / {BLOG_LIMITS.excerpt}</p>
        </div>
        <div>
          <label htmlFor={`${ids}-author`} className={labelClass}>
            Autore <span className="font-normal text-muted">(facoltativo)</span>
          </label>
          <input
            disabled={disabled}
            id={`${ids}-author`}
            type="text"
            value={value.author}
            onChange={(event) => update({ author: event.target.value })}
            maxLength={BLOG_LIMITS.author}
            className={inputClass}
            placeholder="Es. Giulia Rossi"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <LabelInput
            label="Categorie"
            values={value.categories}
            onChange={(categories) => update({ categories })}
            placeholder="Es. Guide"
            max={BLOG_LIMITS.listItems}
            maxLength={BLOG_LIMITS.listItem}
            disabled={disabled}
          />
          <LabelInput
            label="Tag"
            values={value.tags}
            onChange={(tags) => update({ tags })}
            placeholder="Es. caffè, Milano"
            max={BLOG_LIMITS.listItems}
            maxLength={BLOG_LIMITS.listItem}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="panel space-y-3 rounded p-4 sm:p-5">
        <h3 className="text-sm font-semibold">Immagine in evidenza</h3>
        <input
            disabled={disabled}
          ref={featuredFileRef}
          type="file"
          accept={IMAGE_TYPES}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void uploadFeatured(file);
          }}
        />
        {value.featuredImage ? (
          <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
            <img
              src={value.featuredImage.url}
              alt={value.featuredImage.alt ?? ""}
              referrerPolicy="no-referrer"
              className="aspect-[1.91/1] w-full rounded-md border border-border bg-surface-hover object-cover"
            />
            <div className="space-y-2">
              <label htmlFor={`${ids}-featured-alt`} className={labelClass}>
                Testo alternativo
              </label>
              <input
            disabled={disabled}
                id={`${ids}-featured-alt`}
                type="text"
                value={value.featuredImage.alt ?? ""}
                onChange={(event) => {
                  const image = valueRef.current.featuredImage;
                  if (image) update({ featuredImage: { ...image, alt: event.target.value } });
                }}
                maxLength={1000}
                className={inputClass}
                placeholder="Descrivi cosa mostra l'immagine"
                aria-invalid={!value.featuredImage.alt?.trim()}
              />
              <p className="text-xs text-muted">Serve a chi usa un lettore di schermo e a Google Immagini.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => featuredFileRef.current?.click()}
                  className="rounded border border-border bg-background px-3 py-1.5 text-sm hover:border-border-hover disabled:opacity-50"
                >
                  Sostituisci
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => update({ featuredImage: null })}
                  className="px-2 py-1.5 text-sm text-muted hover:text-error"
                >
                  Rimuovi
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => featuredFileRef.current?.click()}
            className="flex min-h-24 w-full items-center justify-center rounded-md border border-dashed border-border bg-background px-4 text-sm text-muted hover:border-border-hover hover:text-foreground disabled:opacity-50"
          >
            Carica l&apos;immagine in evidenza (JPG, PNG, WebP)
          </button>
        )}
        {featuredUpload && (
          <div className="text-xs" aria-live="polite">
            {featuredUpload.error ? (
              <p className="text-error">{featuredUpload.error}</p>
            ) : (
              <div className="flex items-center gap-2 text-muted">
                <span>Caricamento…</span>
                <span className="h-1.5 w-32 overflow-hidden rounded bg-surface-hover">
                  <span
                    className="block h-full bg-accent"
                    style={{ width: `${Math.round(featuredUpload.progress * 100)}%` }}
                  />
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel space-y-4 rounded p-4 sm:p-5">
        <h3 className="text-sm font-semibold">SEO</h3>
        <div>
          <label htmlFor={`${ids}-keyword`} className={labelClass}>
            Parola chiave principale
          </label>
          <input
            disabled={disabled}
            id={`${ids}-keyword`}
            type="text"
            value={value.focusKeyword}
            onChange={(event) => update({ focusKeyword: event.target.value })}
            maxLength={BLOG_LIMITS.focusKeyword}
            className={inputClass}
            placeholder="Es. caffè specialty"
          />
          <p className="mt-1 text-xs text-muted">La ricerca per cui l&apos;articolo deve farsi trovare.</p>
        </div>
        <div>
          <label htmlFor={`${ids}-meta-title`} className={labelClass}>
            Titolo SEO <span className="font-normal text-muted">(se vuoto si usa il titolo)</span>
          </label>
          <input
            disabled={disabled}
            id={`${ids}-meta-title`}
            type="text"
            value={value.metaTitle}
            onChange={(event) => update({ metaTitle: event.target.value })}
            maxLength={BLOG_LIMITS.metaTitle}
            className={inputClass}
            placeholder={value.headline || "Titolo nei risultati di Google"}
          />
          <p className={`mt-1 text-right text-xs ${metaTitleLength > META_TITLE_IDEAL_MAX ? "text-warning" : "text-muted"}`}>
            {metaTitleLength} / {META_TITLE_IDEAL_MAX}
            {metaTitleLength > META_TITLE_IDEAL_MAX ? " · verrà tagliato" : ""}
          </p>
        </div>
        <div>
          <label htmlFor={`${ids}-meta-description`} className={labelClass}>
            Meta description
          </label>
          <textarea
            disabled={disabled}
            id={`${ids}-meta-description`}
            value={value.metaDescription}
            onChange={(event) => update({ metaDescription: event.target.value })}
            rows={3}
            maxLength={BLOG_LIMITS.metaDescription}
            className={`${inputClass} resize-y`}
            placeholder="Il testo sotto il titolo nei risultati di Google: cosa trova il lettore e perché cliccare."
            aria-invalid={metaDescriptionLength > 0 && !metaDescriptionOk}
          />
          <p
            className={`mt-1 text-right text-xs ${
              metaDescriptionLength === 0 ? "text-muted" : metaDescriptionOk ? "text-success" : "text-error"
            }`}
          >
            {metaDescriptionLength} / {META_DESCRIPTION_MAX}
            {metaDescriptionLength > 0 && metaDescriptionLength < META_DESCRIPTION_MIN
              ? ` · almeno ${META_DESCRIPTION_MIN}`
              : metaDescriptionLength > META_DESCRIPTION_MAX
                ? " · troppo lunga"
                : ""}
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <SeoPanel content={deferred} checks={checks} siteHost={siteHost} />
        </div>
      </section>

      {showReviewIssues &&
        (issues.length > 0 ? (
          <section className="panel rounded p-4 sm:p-5" aria-live="polite">
            <h3 className="text-sm font-medium text-warning">Da sistemare prima dell&apos;invio al cliente</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {issues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-success">L&apos;articolo è pronto per essere inviato al cliente.</p>
        ))}
    </div>
  );
}
