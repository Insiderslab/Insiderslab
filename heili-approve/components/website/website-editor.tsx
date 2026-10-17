"use client";

/**
 * WebsiteEditor — what the client reviews «Sul sito» (docs/SITO-WEB.md).
 *
 * - The test site's address (https; http only for localhost or for an
 *   address the agency marks as a test site in «Sul sito»).
 * - The round («Giro 2») and the note for the client on what to look at.
 * - The pages to review: name, address (a path like "/chi-siamo" is resolved
 *   on the site), an optional note. 1..20 pages, the home first.
 * - The devices to check (a hint for the client).
 *
 * Fully controlled: every change calls onChange with the whole
 * WebsiteContent. The review key and its allowed origins (the «Sul sito»
 * panel) live on the post page, they are not version content.
 */

import { useId, useState } from "react";
import {
  DEVICE_LABELS,
  WEBSITE_DEVICES,
  WEBSITE_LIMITS,
  newPage,
  normalizePageUrl,
  originOf,
  pagePath,
  sanitizePageUrl,
  validateWebsiteForReview,
  type WebsiteContent,
  type WebsitePage,
} from "@/lib/content/website";
import { isLocalHostname } from "@/lib/website/origins";

export interface WebsiteEditorProps {
  value: WebsiteContent;
  onChange: (next: WebsiteContent) => void;
  disabled?: boolean;
  /** Round of the version last saved: «Nuovo giro» raises it by one, once. */
  savedRound?: number;
  /** The client already saw a version: «Nuovo giro» makes sense. */
  canStartRound?: boolean;
}

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-base text-foreground outline-none transition-colors focus:border-accent/40 disabled:opacity-60 sm:text-sm";
const labelClass = "mb-1.5 block text-sm font-medium text-foreground";

/** Hint under the site address (no error yet: drafts may be half-typed). */
function siteUrlHint(value: string): { tone: "muted" | "warning" | "error"; text: string } | null {
  const raw = value.trim();
  if (!raw) return { tone: "muted", text: "L'indirizzo del sito di prova, per esempio https://prova.cliente.it" };
  const clean = sanitizePageUrl(raw);
  if (!clean) return { tone: "error", text: "Indirizzo non valido: scrivilo completo, con https://" };
  const url = new URL(clean);
  if (url.protocol === "http:" && !isLocalHostname(url.hostname)) {
    return {
      tone: "warning",
      text: "Indirizzo senza https: dopo il salvataggio segnalo come «sito di prova» in «Sul sito», altrimenti non si può usare.",
    };
  }
  return null;
}

export default function WebsiteEditor({
  value,
  onChange,
  disabled = false,
  savedRound,
  canStartRound = false,
}: WebsiteEditorProps) {
  const id = useId();
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
  const hint = siteUrlHint(value.siteUrl);
  const issues = validateWebsiteForReview(value);
  const origin = originOf(value.siteUrl);

  function update(patch: Partial<WebsiteContent>) {
    onChange({ ...value, ...patch });
  }

  function updatePage(pageId: string, patch: Partial<WebsitePage>) {
    update({ pages: value.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)) });
  }

  /** On blur: a path or an address becomes the page's absolute address on the site. */
  function normalizePage(page: WebsitePage) {
    try {
      const url = normalizePageUrl(page.url, value.siteUrl);
      setPageErrors((errors) => {
        const next = { ...errors };
        delete next[page.id];
        return next;
      });
      if (url !== page.url) updatePage(page.id, { url });
      if (url && origin && originOf(url) !== origin) {
        setPageErrors((errors) => ({ ...errors, [page.id]: `La pagina deve stare sullo stesso sito (${origin}).` }));
      }
    } catch (error) {
      setPageErrors((errors) => ({ ...errors, [page.id]: error instanceof Error ? error.message : "Indirizzo non valido" }));
    }
  }

  function normalizeSite() {
    const clean = sanitizePageUrl(value.siteUrl);
    if (!clean) return;
    // The home page follows the site address while it is still empty.
    const pages = value.pages.map((p, index) => (index === 0 && !p.url ? { ...p, url: clean } : p));
    update({ siteUrl: clean, pages });
  }

  function movePage(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= value.pages.length) return;
    const pages = [...value.pages];
    [pages[index], pages[target]] = [pages[target], pages[index]];
    update({ pages });
  }

  const roundRaised = savedRound !== undefined && value.round > savedRound;

  return (
    <div className="space-y-6">
      <section className="panel studio-panel space-y-5" aria-labelledby={`${id}-site`}>
        <div className="studio-section-heading">
          <div>
            <h2 id={`${id}-site`}>Il sito da rivedere</h2>
            <p>
              Il cliente apre il sito vero, tocca Heili, indica un elemento e lo commenta. Dopo il salvataggio trovi la riga
              di codice da installare in «Sul sito».
            </p>
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-url`} className={labelClass}>
            Indirizzo del sito di prova
          </label>
          <input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            value={value.siteUrl}
            onChange={(event) => update({ siteUrl: event.target.value })}
            onBlur={normalizeSite}
            placeholder="https://prova.cliente.it"
            maxLength={WEBSITE_LIMITS.url}
            disabled={disabled}
            className={inputClass}
            data-testid="website-site-url"
          />
          {hint && (
            <p className={`mt-1 text-xs ${hint.tone === "error" ? "text-error" : hint.tone === "warning" ? "text-warning" : "text-muted"}`}>
              {hint.text}
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
          <div className="space-y-2">
            <span className={labelClass}>Giro di revisione</span>
            <p className="text-2xl font-semibold" data-testid="website-round">
              Giro {value.round}
            </p>
            {canStartRound && (
              <button
                type="button"
                onClick={() => update({ round: Math.min(WEBSITE_LIMITS.round, value.round + 1), roundNote: "" })}
                disabled={disabled || roundRaised}
                className="btn btn-sm"
              >
                Nuovo giro
              </button>
            )}
            {roundRaised && <p className="text-xs text-muted">Il cliente vedrà il giro {value.round} come nuova versione.</p>}
          </div>
          <div>
            <label htmlFor={`${id}-note`} className={labelClass}>
              Cosa guardare in questo giro <span className="font-normal text-muted">(facoltativo, lo legge il cliente)</span>
            </label>
            <textarea
              id={`${id}-note`}
              value={value.roundNote}
              onChange={(event) => update({ roundNote: event.target.value })}
              rows={2}
              maxLength={WEBSITE_LIMITS.roundNote}
              disabled={disabled}
              placeholder="Es. Abbiamo rifatto il menu e la pagina Contatti: controlla soprattutto da telefono"
              className={`${inputClass} resize-y`}
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className={labelClass}>Da controllare su</legend>
          <div className="flex flex-wrap gap-4">
            {WEBSITE_DEVICES.map((device) => (
              <label key={device} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-accent"
                  checked={value.devices.includes(device)}
                  disabled={disabled}
                  onChange={(event) =>
                    update({
                      devices: WEBSITE_DEVICES.filter((d) =>
                        d === device ? event.target.checked : value.devices.includes(d)
                      ),
                    })
                  }
                />
                {DEVICE_LABELS[device]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="panel studio-panel space-y-4" aria-labelledby={`${id}-pages`}>
        <div className="studio-section-heading">
          <div>
            <h2 id={`${id}-pages`}>Pagine da rivedere</h2>
            <p>Il cliente le vede in elenco e può aprirle una per una. Puoi scrivere solo il percorso, es. /chi-siamo.</p>
          </div>
        </div>
        <ol className="space-y-3">
          {value.pages.map((page, index) => (
            <li key={page.id} className="space-y-2 rounded border border-border bg-background p-3" data-testid="website-page">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">Pagina {index + 1}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => movePage(index, -1)}
                    disabled={disabled || index === 0}
                    className="btn btn-quiet btn-sm min-w-11"
                    aria-label={`Sposta su la pagina ${index + 1}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => movePage(index, 1)}
                    disabled={disabled || index === value.pages.length - 1}
                    className="btn btn-quiet btn-sm min-w-11"
                    aria-label={`Sposta giù la pagina ${index + 1}`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => update({ pages: value.pages.filter((p) => p.id !== page.id) })}
                    disabled={disabled || value.pages.length === 1}
                    className="btn btn-quiet btn-sm"
                  >
                    Togli
                  </button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <input
                  type="text"
                  aria-label={`Nome della pagina ${index + 1}`}
                  value={page.title}
                  onChange={(event) => updatePage(page.id, { title: event.target.value })}
                  placeholder={index === 0 ? "Home" : "Es. Chi siamo"}
                  maxLength={WEBSITE_LIMITS.pageTitle}
                  disabled={disabled}
                  className={inputClass}
                />
                <input
                  type="text"
                  inputMode="url"
                  aria-label={`Indirizzo della pagina ${index + 1}`}
                  value={page.url}
                  onChange={(event) => updatePage(page.id, { url: event.target.value })}
                  onBlur={() => normalizePage(page)}
                  placeholder={origin ? `${origin}/…` : "/chi-siamo"}
                  maxLength={WEBSITE_LIMITS.url}
                  disabled={disabled}
                  className={inputClass}
                />
              </div>
              {pageErrors[page.id] && <p className="text-xs text-error">{pageErrors[page.id]}</p>}
              <input
                type="text"
                aria-label={`Nota per il cliente sulla pagina ${index + 1}`}
                value={page.note}
                onChange={(event) => updatePage(page.id, { note: event.target.value })}
                placeholder="Nota per il cliente (facoltativa): es. controlla il modulo in fondo"
                maxLength={WEBSITE_LIMITS.pageNote}
                disabled={disabled}
                className={inputClass}
              />
              {page.url && <p className="truncate text-xs text-muted">{pagePath(page.url)}</p>}
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => update({ pages: [...value.pages, newPage(value.pages)] })}
          disabled={disabled || value.pages.length >= WEBSITE_LIMITS.pages}
          className="btn"
        >
          Aggiungi pagina
        </button>
        {value.pages.length >= WEBSITE_LIMITS.pages && (
          <p className="text-xs text-muted">Massimo {WEBSITE_LIMITS.pages} pagine per giro.</p>
        )}
      </section>

      {issues.length > 0 && (
        <section className="panel studio-panel space-y-2" aria-label="Da sistemare prima dell'invio">
          <h3 className="text-sm font-semibold">Da sistemare prima dell&apos;invio</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
            {issues.map((issue) => (
              <li key={issue.message}>{issue.message}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
