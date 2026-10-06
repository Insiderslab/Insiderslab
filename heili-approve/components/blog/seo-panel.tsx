/**
 * SeoPanel — the article's SEO and readability checks (seoChecks), each
 * with its outcome as a word (Ok / Avviso / Errore, never color alone) and a
 * one-line explanation, problems first; plus a preview of the Google result.
 * No hooks: works in server pages and inside the editor.
 */

import {
  META_DESCRIPTION_MAX,
  META_TITLE_IDEAL_MAX,
  SEO_STATUS_LABELS,
  charCount,
  seoChecks,
  summarizeSeo,
  type SeoCheck,
  type SeoStatus,
} from "@/lib/content/blog";
import type { BlogContent } from "@/lib/content/types";

const STATUS_STYLE: Record<SeoStatus, { badge: string; icon: string }> = {
  ok: { badge: "border-success/40 text-success", icon: "✓" },
  warning: { badge: "border-warning/50 text-warning", icon: "!" },
  error: { badge: "border-error/50 text-error", icon: "×" },
};

const ORDER: Record<SeoStatus, number> = { error: 0, warning: 1, ok: 2 };

export default function SeoPanel({
  content,
  checks: given,
  siteHost,
  showSerp = true,
  className = "",
}: {
  content: BlogContent;
  /** seoChecks(content), when the caller already has them. */
  checks?: SeoCheck[];
  /** Absolute links to this host count as internal; also shown in the Google preview. */
  siteHost?: string | null;
  showSerp?: boolean;
  className?: string;
}) {
  const checks = given ?? seoChecks(content, { siteHost });
  const counts = summarizeSeo(checks);
  const problems = checks.filter((c) => c.status !== "ok").sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const passed = checks.filter((c) => c.status === "ok");

  return (
    <section className={`space-y-4 ${className}`} aria-labelledby="seo-panel-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="seo-panel-title" className="text-sm font-semibold">
          SEO e leggibilità
        </h3>
        <p className="text-xs text-muted">
          <span className="text-success">{counts.ok} ok</span> ·{" "}
          <span className={counts.warning ? "text-warning" : ""}>
            {counts.warning} {counts.warning === 1 ? "avviso" : "avvisi"}
          </span>{" "}
          ·{" "}
          <span className={counts.error ? "text-error" : ""}>
            {counts.error} {counts.error === 1 ? "errore" : "errori"}
          </span>
        </p>
      </div>

      {showSerp && <SerpPreview content={content} siteHost={siteHost} />}

      {problems.length > 0 ? (
        <ul className="space-y-2">
          {problems.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-success">Tutti i controlli sono superati.</p>
      )}

      {passed.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted hover:text-foreground">
            Controlli superati ({passed.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {passed.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CheckRow({ check }: { check: SeoCheck }) {
  const style = STATUS_STYLE[check.status];
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] font-semibold ${style.badge}`}
      >
        <span aria-hidden>{style.icon}</span>
        {SEO_STATUS_LABELS[check.status]}
      </span>
      <span className="min-w-0">
        <span className="font-medium">{check.label}</span>
        <span className="text-muted"> — {check.message}</span>
      </span>
    </li>
  );
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

/** How the article might look in Google's results (approximate, by characters). */
export function SerpPreview({ content, siteHost }: { content: BlogContent; siteHost?: string | null }) {
  const title = content.metaTitle.trim() || content.headline.trim();
  const description = content.metaDescription.trim() || content.excerpt.trim();
  const host = siteHost?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "sito del cliente";
  return (
    <div className="rounded-md border border-border bg-background p-3" aria-label="Anteprima del risultato su Google">
      <p className="truncate text-xs text-muted">
        {host}
        {content.slug ? ` › ${content.slug}` : ""}
      </p>
      <p className="mt-0.5 break-words text-[17px] leading-snug text-accent">
        {title ? truncate(title, META_TITLE_IDEAL_MAX + 1) : <span className="text-muted">Titolo SEO</span>}
      </p>
      <p className="mt-1 break-words text-sm leading-snug text-muted">
        {description ? truncate(description, META_DESCRIPTION_MAX + 1) : "Meta description: il testo sotto il titolo nei risultati."}
      </p>
      {title && charCount(title) > META_TITLE_IDEAL_MAX && (
        <p className="mt-1 text-xs text-warning">Il titolo verrà tagliato da Google.</p>
      )}
    </div>
  );
}
