"use client";

/**
 * AdSetEditor — the agency prepares a set of ad creatives.
 *
 * - Campaign: name, platform, objective, budget and audience notes.
 * - Variants A, B, C…: add, duplicate, remove, reorder. For each one: media
 *   uploaded through /api/uploads (the posts' MediaUploader), copy with
 *   counters named as the platform names the fields, CTA with the
 *   platform's suggestions, destination URL, placements.
 * - Google Ads (Search, Performance Max): titoli, titoli lunghi, descrizioni,
 *   nome dell'attività, percorsi, parole chiave e loghi (GoogleAssetsEditor).
 * - Live spec checks (format ±2%, duration, text limits, CTA, https) and the
 *   preview per placement next to the form; then what still blocks sending
 *   the set to the client (validateAdsForReview).
 *
 * Media sizes: images get theirs from the upload on save; videos (and any
 * media without one) are measured in the browser so the format checks work
 * right away.
 *
 * Fully controlled: every change calls onChange with the whole AdContent.
 */

import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import MediaUploader from "@/components/posts/media-uploader";
import {
  AD_LIMITS,
  AD_PLATFORM_LABELS,
  AD_PLATFORMS,
  AD_TEXT_SPECS,
  CTA_SUGGESTIONS,
  PLACEMENT_SPECS,
  adSpecChecks,
  charCount,
  duplicateVariant,
  emptyGoogleAssets,
  newVariant,
  placementsForPlatform,
  summarizeChecks,
  validateAdsForReview,
  variantDisplayName,
  type AdCheckStatus,
  type AdContent,
  type AdPlacement,
  type AdPlatform,
  type AdTextField,
  type AdVariant,
} from "@/lib/content/ads";
import type { MediaItem } from "@/lib/domain";
import { AdPlacementPreviews } from "./ad-preview";
import { moveVariant, patchVariant, switchPlatform, withMediaDimensions } from "./helpers";
import GoogleAssetsEditor from "./google-assets-editor";
import AdSpecChecklist from "./spec-checklist";

export interface AdSetEditorProps {
  value: AdContent;
  onChange: (next: AdContent) => void;
  /** Client name and logo for the previews. */
  accountName: string;
  accountAvatarUrl?: string | null;
  disabled?: boolean;
  /** True while a file is uploading (the parent should not submit meanwhile). */
  onBusyChange?: (busy: boolean) => void;
  /** Show "Da sistemare prima dell'invio" (validateAdsForReview). Default true. */
  showReviewIssues?: boolean;
}

const OBJECTIVES = ["Notorietà", "Traffico", "Interazione", "Contatti", "Promozione dell'app", "Vendite"];

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40 disabled:opacity-60";
const labelClass = "mb-1.5 block text-sm font-medium text-foreground";
const smallButton =
  "inline-flex min-h-9 items-center justify-center rounded border border-border bg-background px-2.5 text-xs text-foreground hover:border-border-hover disabled:opacity-40";

const DOT: Record<AdCheckStatus, string> = { ok: "bg-success", warning: "bg-warning", error: "bg-error" };

export default function AdSetEditor({
  value,
  onChange,
  accountName,
  accountAvatarUrl,
  disabled = false,
  onBusyChange,
  showReviewIssues = true,
}: AdSetEditorProps) {
  const ids = useId();
  const valueRef = useRef(value);
  const [selectedId, setSelectedId] = useState<string | null>(value.variants[0]?.id ?? null);
  const [busyVariants, setBusyVariants] = useState<Set<string>>(() => new Set());

  // Async completions (uploads, measurements) merge into the latest value.
  useLayoutEffect(() => {
    valueRef.current = value;
  });

  const busy = busyVariants.size > 0;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useMeasureMissingDimensions(value, (url, width, height) => {
    const next = withMediaDimensions(valueRef.current, url, width, height);
    if (next !== valueRef.current) onChange(next);
  });

  const platform = value.campaign.platform;
  const selected = value.variants.find((v) => v.id === selectedId) ?? value.variants[0] ?? null;
  const selectedIndex = selected ? value.variants.indexOf(selected) : -1;
  // Google Ads: Search is text only; the Display fields and the button belong to some formats only.
  const selectedPlacements = selected?.placements ?? [];
  const googleSearch = platform === "google" && selectedPlacements.includes("google_search");
  const googlePmax = platform === "google" && selectedPlacements.includes("google_pmax");
  const textOnly = selectedPlacements.length > 0 && selectedPlacements.every((p) => !PLACEMENT_SPECS[p].usesMedia);
  const showCta = !(selectedPlacements.length > 0 && selectedPlacements.every((p) => PLACEMENT_SPECS[p].cta === "none"));
  const showCopy = !(platform === "google" && selectedPlacements.length > 0 && !selectedPlacements.includes("google_display"));

  const deferred = useDeferredValue(value);
  const statusById = useMemo(() => {
    const map = new Map<string, AdCheckStatus>();
    for (const v of deferred.variants) {
      map.set(v.id, summarizeChecks(adSpecChecks(v, { platform: deferred.campaign.platform })).worst);
    }
    return map;
  }, [deferred]);
  const issues = useMemo(() => validateAdsForReview(deferred), [deferred]);
  const selectedChecks = useMemo(() => {
    const v = deferred.variants.find((x) => x.id === selected?.id);
    return v ? adSpecChecks(v, { platform: deferred.campaign.platform }) : [];
  }, [deferred, selected?.id]);

  function commit(next: AdContent) {
    valueRef.current = next;
    onChange(next);
  }

  function setCampaign(patch: Partial<AdContent["campaign"]>) {
    const current = valueRef.current;
    commit({ ...current, campaign: { ...current.campaign, ...patch } });
  }

  function setPlatform(next: AdPlatform) {
    commit(switchPlatform(valueRef.current, next));
  }

  function updateVariant(id: string, patch: Partial<Omit<AdVariant, "id">>) {
    commit(patchVariant(valueRef.current, id, patch));
  }

  function addVariant() {
    const current = valueRef.current;
    if (current.variants.length >= AD_LIMITS.variants) return;
    const variant = newVariant(current.variants.length, {
      platform: current.campaign.platform,
      existingIds: current.variants.map((v) => v.id),
    });
    commit({ ...current, variants: [...current.variants, variant] });
    setSelectedId(variant.id);
  }

  function duplicate(id: string) {
    const current = valueRef.current;
    const source = current.variants.find((v) => v.id === id);
    if (!source || current.variants.length >= AD_LIMITS.variants) return;
    const copy = duplicateVariant(
      source,
      current.variants.map((v) => v.id)
    );
    const at = current.variants.indexOf(source) + 1;
    commit({ ...current, variants: [...current.variants.slice(0, at), copy, ...current.variants.slice(at)] });
    setSelectedId(copy.id);
  }

  function remove(id: string) {
    const current = valueRef.current;
    const variant = current.variants.find((v) => v.id === id);
    if (!variant || current.variants.length <= 1) return;
    const hasWork = variant.media.length > 0 || variant.primaryText.trim() || variant.headline.trim();
    if (hasWork && !window.confirm(`Rimuovere ${variantDisplayName(variant)}? Media e testi della variante andranno persi.`)) {
      return;
    }
    const index = current.variants.indexOf(variant);
    const variants = current.variants.filter((v) => v.id !== id);
    commit({ ...current, variants });
    setSelectedId(variants[Math.max(0, index - 1)]?.id ?? null);
  }

  function move(id: string, direction: -1 | 1) {
    const current = valueRef.current;
    const index = current.variants.findIndex((v) => v.id === id);
    commit({ ...current, variants: moveVariant(current.variants, index, index + direction) });
  }

  function setMedia(id: string, update: (current: MediaItem[]) => MediaItem[]) {
    const variant = valueRef.current.variants.find((v) => v.id === id);
    if (!variant) return;
    updateVariant(id, { media: update(variant.media).slice(0, AD_LIMITS.mediaPerVariant) });
  }

  function setVariantBusy(id: string, isBusy: boolean) {
    setBusyVariants((current) => {
      if (current.has(id) === isBusy) return current;
      const next = new Set(current);
      if (isBusy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePlacement(variant: AdVariant, placement: AdPlacement, on: boolean) {
    const list = on ? [...variant.placements, placement] : variant.placements.filter((p) => p !== placement);
    updateVariant(variant.id, { placements: placementsForPlatform(platform).filter((p) => list.includes(p)) });
  }

  return (
    // inline-size containment: the wide parts (variant tabs, uploads) scroll or
    // wrap inside instead of widening a parent <fieldset> (min-width: min-content).
    <div className="min-w-0 space-y-6 [contain:inline-size]">
      {/* ── Campaign ── */}
      <section className="panel space-y-4 p-4" aria-labelledby={`${ids}-campaign`}>
        <h2 id={`${ids}-campaign`} className="text-base font-semibold text-foreground">
          Campagna
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-name`} className={labelClass}>
              Nome della campagna
            </label>
            <input
              id={`${ids}-name`}
              value={value.campaign.name}
              onChange={(e) => setCampaign({ name: e.target.value })}
              maxLength={AD_LIMITS.campaignName}
              disabled={disabled}
              placeholder="Es. Saldi d'autunno"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-platform`} className={labelClass}>
              Piattaforma
            </label>
            <select
              id={`${ids}-platform`}
              value={platform}
              onChange={(e) => setPlatform(e.target.value as AdPlatform)}
              disabled={disabled}
              className={inputClass}
            >
              {AD_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {AD_PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${ids}-objective`} className={labelClass}>
              Obiettivo
            </label>
            <input
              id={`${ids}-objective`}
              value={value.campaign.objective}
              onChange={(e) => setCampaign({ objective: e.target.value })}
              list={`${ids}-objectives`}
              maxLength={AD_LIMITS.objective}
              disabled={disabled}
              placeholder="Es. Vendite"
              className={inputClass}
            />
            <datalist id={`${ids}-objectives`}>
              {OBJECTIVES.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor={`${ids}-budget`} className={labelClass}>
              Budget e durata <span className="font-normal text-muted">(facoltativo)</span>
            </label>
            <input
              id={`${ids}-budget`}
              value={value.campaign.budgetNote}
              onChange={(e) => setCampaign({ budgetNote: e.target.value })}
              maxLength={AD_LIMITS.budgetNote}
              disabled={disabled}
              placeholder="Es. 30 € al giorno per 14 giorni"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${ids}-audience`} className={labelClass}>
            Pubblico <span className="font-normal text-muted">(facoltativo, lo vede il cliente)</span>
          </label>
          <textarea
            id={`${ids}-audience`}
            value={value.campaign.audienceNote}
            onChange={(e) => setCampaign({ audienceNote: e.target.value })}
            maxLength={AD_LIMITS.audienceNote}
            rows={2}
            disabled={disabled}
            placeholder="Es. donne 25–45 anni, Milano e provincia, interessate a moda sostenibile"
            className={`${inputClass} resize-y`}
          />
        </div>
      </section>

      {/* ── Variant tabs ── */}
      <section className="space-y-4" aria-labelledby={`${ids}-variants`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${ids}-variants`} className="text-base font-semibold text-foreground">
            Varianti <span className="font-normal text-muted">({value.variants.length})</span>
          </h2>
          <button
            type="button"
            onClick={addVariant}
            disabled={disabled || value.variants.length >= AD_LIMITS.variants}
            className="min-h-10 rounded bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Aggiungi variante
          </button>
        </div>

        <div role="tablist" aria-label="Varianti" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {value.variants.map((variant) => {
            const status = statusById.get(variant.id) ?? "ok";
            const active = variant.id === selected?.id;
            return (
              <button
                key={variant.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(variant.id)}
                title={variantDisplayName(variant)}
                className={`relative inline-flex min-h-11 max-w-[220px] shrink-0 items-center gap-2 rounded-md border px-3 text-sm ${
                  active ? "border-accent bg-accent text-white" : "border-border bg-surface text-foreground hover:border-border-hover"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden="true" />
                <span className="truncate">{variantDisplayName(variant)}</span>
                <span className="sr-only">
                  {status === "error" ? ", da sistemare" : status === "warning" ? ", con avvisi" : ", in regola"}
                </span>
              </button>
            );
          })}
        </div>

        {selected ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
            <div className="panel min-w-0 space-y-5 p-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-[1_1_14rem]">
                  <label htmlFor={`${ids}-vname`} className={labelClass}>
                    Nome della variante
                  </label>
                  <input
                    id={`${ids}-vname`}
                    value={selected.name}
                    onChange={(e) => updateVariant(selected.id, { name: e.target.value })}
                    maxLength={AD_LIMITS.variantName}
                    disabled={disabled}
                    placeholder={`Variante ${selected.id}`}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className={smallButton}
                    disabled={disabled || selectedIndex <= 0}
                    onClick={() => move(selected.id, -1)}
                    aria-label="Sposta la variante prima"
                  >
                    ← Prima
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={disabled || selectedIndex === value.variants.length - 1}
                    onClick={() => move(selected.id, 1)}
                    aria-label="Sposta la variante dopo"
                  >
                    Dopo →
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={disabled || value.variants.length >= AD_LIMITS.variants}
                    onClick={() => duplicate(selected.id)}
                  >
                    Duplica
                  </button>
                  <button
                    type="button"
                    className={`${smallButton} text-error`}
                    disabled={disabled || value.variants.length <= 1 || busyVariants.has(selected.id)}
                    onClick={() => remove(selected.id)}
                  >
                    Rimuovi
                  </button>
                </div>
              </div>

              {textOnly && selected.media.length === 0 ? (
                <p className="inset p-3 text-sm text-muted">
                  Gli annunci della rete di ricerca sono solo testo: niente immagini né video. Scrivi titoli, descrizioni e
                  parole chiave qui sotto.
                </p>
              ) : (
              <fieldset className="space-y-2">
                <legend className={labelClass}>Immagini e video</legend>
                <p className="text-xs text-muted">
                  {googlePmax
                    ? "Performance Max: almeno un'immagine orizzontale 1,91:1 e una quadrata 1:1, meglio anche una verticale 4:5; un video è facoltativo."
                    : `Più media = carosello (o più schede nelle Storie). Massimo ${AD_LIMITS.mediaPerVariant} per variante.`}
                </p>
                <MediaUploader
                  key={selected.id}
                  media={selected.media}
                  onChange={(update) => setMedia(selected.id, update)}
                  onBusyChange={(isBusy) => setVariantBusy(selected.id, isBusy)}
                  disabled={disabled}
                />
              </fieldset>
              )}

              {showCopy ? (
                <CopyFields variant={selected} platform={platform} disabled={disabled} onChange={(patch) => updateVariant(selected.id, patch)} ids={ids} />
              ) : null}

              {showCta ? (
              <div>
                <label htmlFor={`${ids}-cta`} className={labelClass}>
                  Pulsante (call to action)
                </label>
                <input
                  id={`${ids}-cta`}
                  value={selected.cta}
                  onChange={(e) => updateVariant(selected.id, { cta: e.target.value })}
                  list={`${ids}-ctas`}
                  maxLength={AD_LIMITS.cta}
                  disabled={disabled}
                  placeholder="Es. Scopri di più"
                  className={inputClass}
                />
                <datalist id={`${ids}-ctas`}>
                  {CTA_SUGGESTIONS[platform].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="CTA suggerite">
                  {CTA_SUGGESTIONS[platform].slice(0, 6).map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={disabled}
                      onClick={() => updateVariant(selected.id, { cta: c })}
                      aria-pressed={selected.cta === c}
                      className={`min-h-8 rounded-full border px-3 text-xs ${
                        selected.cta === c
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border bg-background text-muted hover:text-foreground"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {googlePmax && !selectedPlacements.includes("google_display") ? (
                  <p className="mt-1 text-xs text-muted">Facoltativo: se lo lasci vuoto lo sceglie Google.</p>
                ) : null}
              </div>
              ) : null}

              <div>
                <label htmlFor={`${ids}-url`} className={labelClass}>
                  URL di destinazione
                </label>
                <input
                  id={`${ids}-url`}
                  type="url"
                  inputMode="url"
                  value={selected.destinationUrl}
                  onChange={(e) => updateVariant(selected.id, { destinationUrl: e.target.value })}
                  maxLength={AD_LIMITS.url}
                  disabled={disabled}
                  placeholder="https://www.esempio.it/offerta"
                  className={inputClass}
                />
              </div>

              <fieldset>
                <legend className={labelClass}>Posizionamenti</legend>
                <div className="space-y-1">
                  {placementsForPlatform(platform).map((placement) => {
                    const spec = PLACEMENT_SPECS[placement];
                    return (
                      <label key={placement} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={selected.placements.includes(placement)}
                          onChange={(e) => togglePlacement(selected, placement, e.target.checked)}
                          disabled={disabled}
                          className="h-4 w-4 accent-accent"
                        />
                        <span>
                          {spec.label}{" "}
                          <span className="text-muted">
                            · {spec.usesMedia ? spec.preferred.map((r) => r.label).join(" o ") : "solo testo e parole chiave"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {googleSearch || googlePmax ? (
                <GoogleAssetsEditor
                  key={`google-${selected.id}`}
                  assets={selected.google ?? emptyGoogleAssets()}
                  onChange={(update) => {
                    const current = valueRef.current.variants.find((v) => v.id === selected.id);
                    if (current) updateVariant(selected.id, { google: update(current.google ?? emptyGoogleAssets()) });
                  }}
                  search={googleSearch}
                  pmax={googlePmax}
                  finalUrl={selected.destinationUrl}
                  disabled={disabled}
                  onBusyChange={(isBusy) => setVariantBusy(`${selected.id}:logos`, isBusy)}
                />
              ) : null}
            </div>

            <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Anteprima e controlli">
              <div className="panel space-y-3 p-4">
                <h3 className="text-sm font-semibold text-foreground">Anteprima</h3>
                <AdPlacementPreviews
                  placements={selected.placements}
                  variant={selected}
                  accountName={accountName}
                  accountAvatarUrl={accountAvatarUrl}
                />
              </div>
              <div className="panel space-y-3 p-4">
                <h3 className="text-sm font-semibold text-foreground">Controlli delle specifiche</h3>
                <AdSpecChecklist checks={selectedChecks} />
              </div>
            </aside>
          </div>
        ) : (
          <p className="text-sm text-muted">Aggiungi la prima variante.</p>
        )}
      </section>

      {showReviewIssues ? (
        <section className="panel space-y-2 p-4" aria-live="polite" aria-labelledby={`${ids}-issues`}>
          <h2 id={`${ids}-issues`} className="text-sm font-semibold text-foreground">
            {issues.length === 0 ? "Pronto per il cliente" : "Da sistemare prima dell'invio"}
          </h2>
          {issues.length === 0 ? (
            <p className="text-sm text-success">Nessun errore bloccante: puoi inviare il set in revisione.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-error">
              {issues.map((issue, i) => (
                <li key={`${issue.variantId ?? "campaign"}-${i}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ─── Copy fields ─────────────────────────────────────────────────────────────

function CopyFields({
  variant,
  platform,
  disabled,
  onChange,
  ids,
}: {
  variant: AdVariant;
  platform: AdPlatform;
  disabled: boolean;
  onChange: (patch: Partial<Pick<AdVariant, AdTextField>>) => void;
  ids: string;
}) {
  const specs = AD_TEXT_SPECS[platform];
  const fields: Array<{ field: AdTextField; multiline: boolean; max: number; placeholder: string }> = [
    { field: "primaryText", multiline: true, max: AD_LIMITS.primaryText, placeholder: "Il testo sopra (o sotto) l'immagine" },
    { field: "headline", multiline: false, max: AD_LIMITS.headline, placeholder: "Il titolo vicino al pulsante" },
    { field: "description", multiline: false, max: AD_LIMITS.description, placeholder: "Una riga in più, facoltativa" },
  ];

  return (
    <div className="space-y-4">
      {fields.map(({ field, multiline, max, placeholder }) => {
        const spec = specs[field];
        // Fields the platform does not show are hidden unless they already hold text.
        if (!spec && !variant[field].trim()) return null;
        const id = `${ids}-${field}`;
        const count = charCount(variant[field].trim());
        const limit = spec?.recommended ?? spec?.max;
        const over = spec?.max !== undefined && count > spec.max ? "error" : limit !== undefined && count > limit ? "warning" : null;
        return (
          <div key={field}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor={id} className="text-sm font-medium text-foreground">
                {spec?.label ?? "Testo non usato su questa piattaforma"}
                {spec?.required ? null : <span className="font-normal text-muted"> (facoltativo)</span>}
              </label>
              <span
                className={`shrink-0 text-xs tabular-nums ${over === "error" ? "text-error" : over === "warning" ? "text-warning" : "text-muted"}`}
              >
                {count}
                {limit !== undefined ? `/${limit}` : ""}
              </span>
            </div>
            {multiline ? (
              <textarea
                id={id}
                value={variant[field]}
                onChange={(e) => onChange({ [field]: e.target.value })}
                maxLength={max}
                rows={4}
                disabled={disabled}
                placeholder={placeholder}
                className={`${inputClass} resize-y`}
              />
            ) : (
              <input
                id={id}
                value={variant[field]}
                onChange={(e) => onChange({ [field]: e.target.value })}
                maxLength={max}
                disabled={disabled}
                placeholder={placeholder}
                className={inputClass}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Media size measurement ──────────────────────────────────────────────────

const MEASURE_TIMEOUT_MS = 15_000;

function measureMedia(item: MediaItem): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (size: { width: number; height: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(size && size.width > 0 && size.height > 0 ? size : null);
    };
    const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
    if (item.type === "video") {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        finish({ width: video.videoWidth, height: video.videoHeight });
        video.removeAttribute("src");
        video.load();
      };
      video.onerror = () => finish(null);
      video.src = item.url;
    } else {
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => finish(null);
      image.src = item.url;
    }
  });
}

/** Measures, once per URL, the media that have no pixel size yet. */
function useMeasureMissingDimensions(content: AdContent, onMeasured: (url: string, width: number, height: number) => void) {
  const attempted = useRef(new Set<string>());
  const callback = useRef(onMeasured);
  useLayoutEffect(() => {
    callback.current = onMeasured;
  });

  const missing = content.variants
    .flatMap((v) => [...v.media, ...(v.google?.logos ?? [])])
    .filter((m) => !m.width || !m.height)
    .filter((m, i, list) => list.findIndex((x) => x.url === m.url) === i);
  const key = missing.map((m) => m.url).join("\n");

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const item of missing) {
      if (attempted.current.has(item.url)) continue;
      attempted.current.add(item.url);
      // Not cancelled when the list changes: each URL is measured only once.
      void measureMedia(item).then((size) => {
        if (mounted.current && size) callback.current(item.url, size.width, size.height);
      });
    }
    // `key` captures the list of URLs to measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
