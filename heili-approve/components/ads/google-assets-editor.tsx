"use client";

/**
 * GoogleAssetsEditor — "Google Ads: titoli, descrizioni e parole chiave",
 * inside the variant form of AdSetEditor when the variant targets Google
 * Search (annuncio adattivo) or Performance Max.
 *
 * - Titoli (≤ 30), Titoli lunghi (PMax, ≤ 90), Descrizioni (≤ 90): editable
 *   lists with add / remove / reorder and a live counter per item; pasting
 *   several lines into a field adds one item per line.
 * - Nome dell'attività (PMax), Percorso URL 1 / 2 (display URL).
 * - Parole chiave (Search): paste a list, one per line; `"parola"` and
 *   `[parola]` set phrase and exact match, otherwise the chosen default.
 *   Each keyword keeps its own match-type select. Parole chiave escluse:
 *   one per line.
 * - Loghi (PMax), uploaded like the variant's media.
 *
 * Items are kept as typed (an empty row being written stays); the content
 * schema trims and drops empty ones on save.
 */

import { useId, useState, type ClipboardEvent } from "react";
import MediaUploader from "@/components/posts/media-uploader";
import {
  GOOGLE_MATCH_LABELS,
  GOOGLE_MATCH_TYPES,
  GOOGLE_SPECS,
  GOOGLE_STORAGE_LIMITS,
  formatKeyword,
  googleDisplayUrl,
  mergeKeywords,
  normalizeAssetText,
  parseKeywordLine,
  type AdGoogleAssets,
  type AssetListSpec,
  type GoogleKeyword,
  type GoogleMatchType,
} from "@/lib/content/google-ads";

export interface GoogleAssetsEditorProps {
  assets: AdGoogleAssets;
  /** Receives an update of the latest assets (uploads finish asynchronously). */
  onChange: (update: (current: AdGoogleAssets) => AdGoogleAssets) => void;
  /** Which formats the variant targets (decides the fields and limits shown). */
  search: boolean;
  pmax: boolean;
  /** Final URL of the variant, for the display URL preview. */
  finalUrl: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

function count(value: string): number {
  return Array.from(value.trim()).length;
}

/** Counter tone: over the limit is an error. */
function counterClass(n: number, max: number): string {
  return n > max ? "text-error font-semibold" : "text-muted";
}

export default function GoogleAssetsEditor({
  assets,
  onChange,
  search,
  pmax,
  finalUrl,
  disabled = false,
  onBusyChange,
}: GoogleAssetsEditorProps) {
  const ids = useId();
  const set = (patch: Partial<AdGoogleAssets>) => onChange((current) => ({ ...current, ...patch }));

  // RSA and PMax share the lists: show the stricter limits of the two.
  const headlineSpec: AssetListSpec = pmax ? GOOGLE_SPECS.pmax.headlines : GOOGLE_SPECS.search.headlines;
  const descriptionSpec: AssetListSpec = search
    ? { ...GOOGLE_SPECS.search.descriptions, short: pmax ? GOOGLE_SPECS.pmax.descriptions.short : undefined }
    : GOOGLE_SPECS.pmax.descriptions;
  const formats = [search ? "Rete di ricerca" : null, pmax ? "Performance Max" : null].filter(Boolean).join(" e ");
  const displayUrl = googleDisplayUrl(finalUrl, assets);
  const domain = googleDisplayUrl(finalUrl, { path1: "", path2: "" });

  return (
    <section className="space-y-4 border-t border-border pt-5" aria-labelledby={`${ids}-title`}>
      <div className="space-y-1">
        <h3 id={`${ids}-title`} className="text-base font-semibold text-foreground">
          Google Ads: titoli, descrizioni e parole chiave
        </h3>
        <p className="text-sm text-muted">
          Per {formats}. Google combina da solo questi testi: scrivi frasi che stiano in piedi da sole e in qualsiasi
          ordine.
        </p>
      </div>

      <AssetList
        id={`${ids}-headlines`}
        label="Titoli"
        one="titolo"
        items={assets.headlines}
        spec={headlineSpec}
        placeholder="Es. Prova gratis per 7 giorni"
        disabled={disabled}
        onChange={(headlines) => set({ headlines })}
      />

      {pmax ? (
        <AssetList
          id={`${ids}-long`}
          label="Titoli lunghi"
          one="titolo lungo"
          items={assets.longHeadlines}
          spec={GOOGLE_SPECS.pmax.longHeadlines}
          placeholder="Es. Allenati con un istruttore che ti segue: la prima settimana è gratis"
          disabled={disabled}
          onChange={(longHeadlines) => set({ longHeadlines })}
          note="Solo Performance Max: compaiono sopra o accanto all'immagine."
        />
      ) : null}

      <AssetList
        id={`${ids}-descriptions`}
        label="Descrizioni"
        one="descrizione"
        items={assets.descriptions}
        spec={descriptionSpec}
        placeholder="Es. Sala pesi, corsi e un istruttore dedicato. Prenota la prova online."
        disabled={disabled}
        onChange={(descriptions) => set({ descriptions })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {pmax ? (
          <div className="sm:col-span-2">
            <FieldHeader
              htmlFor={`${ids}-business`}
              label="Nome dell'attività"
              counter={`${count(assets.businessName)}/${GOOGLE_SPECS.pmax.businessNameChars}`}
              over={count(assets.businessName) > GOOGLE_SPECS.pmax.businessNameChars}
            />
            <input
              id={`${ids}-business`}
              value={assets.businessName}
              onChange={(e) => set({ businessName: e.target.value })}
              maxLength={GOOGLE_STORAGE_LIMITS.shortText}
              disabled={disabled}
              placeholder="Es. Palestra Kinetik"
              className="field"
            />
          </div>
        ) : null}
        {(["path1", "path2"] as const).map((key, i) => (
          <div key={key}>
            <FieldHeader
              htmlFor={`${ids}-${key}`}
              label={`Percorso URL ${i + 1}`}
              optional
              counter={`${count(assets[key])}/${GOOGLE_SPECS.search.pathChars}`}
              over={count(assets[key]) > GOOGLE_SPECS.search.pathChars}
            />
            <input
              id={`${ids}-${key}`}
              value={assets[key]}
              onChange={(e) => set({ [key]: e.target.value.replace(/\s+/g, "-") })}
              maxLength={GOOGLE_STORAGE_LIMITS.shortText}
              disabled={disabled}
              placeholder={i === 0 ? "Es. prova" : "Es. gratis"}
              className="field"
            />
          </div>
        ))}
        <p className="text-xs text-muted sm:col-span-2">
          URL visualizzato:{" "}
          <span className="font-medium text-foreground">
            {displayUrl ?? (domain ? domain : "inserisci prima l'URL di destinazione")}
          </span>
        </p>
      </div>

      {search ? (
        <KeywordsEditor
          id={`${ids}-keywords`}
          keywords={assets.keywords}
          negatives={assets.negativeKeywords}
          disabled={disabled}
          onKeywords={(keywords) => set({ keywords })}
          onNegatives={(negativeKeywords) => set({ negativeKeywords })}
        />
      ) : null}

      {pmax ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-foreground">
            Loghi <span className="font-normal text-muted">(1:1 almeno 128×128; 4:1 facoltativo)</span>
          </legend>
          <p className="text-xs text-muted">
            Le immagini del gruppo di asset sono quelle della variante, qui sopra: almeno una orizzontale 1,91:1 e una
            quadrata 1:1, meglio anche una verticale 4:5.
          </p>
          <MediaUploader
            media={assets.logos}
            onChange={(update) =>
              onChange((current) => ({ ...current, logos: update(current.logos).slice(0, GOOGLE_STORAGE_LIMITS.logos) }))
            }
            onBusyChange={onBusyChange}
            disabled={disabled}
          />
        </fieldset>
      ) : null}
    </section>
  );
}

function FieldHeader({
  htmlFor,
  label,
  counter,
  over,
  optional = false,
}: {
  htmlFor: string;
  label: string;
  counter: string;
  over: boolean;
  optional?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {optional ? <span className="font-normal text-muted"> (facoltativo)</span> : null}
      </label>
      <span className={`tabular shrink-0 text-xs ${over ? "font-semibold text-error" : "text-muted"}`}>{counter}</span>
    </div>
  );
}

// ─── Asset list ──────────────────────────────────────────────────────────────

function AssetList({
  id,
  label,
  one,
  items,
  spec,
  placeholder,
  disabled,
  onChange,
  note,
}: {
  id: string;
  label: string;
  one: string;
  items: string[];
  spec: AssetListSpec;
  placeholder: string;
  disabled: boolean;
  onChange: (next: string[]) => void;
  note?: string;
}) {
  const filledCount = items.filter((i) => i.trim()).length;
  const full = items.length >= spec.max;
  const firstOf = new Map<string, number>();
  items.forEach((item, index) => {
    const norm = normalizeAssetText(item);
    if (norm && !firstOf.has(norm)) firstOf.set(norm, index);
  });

  function update(index: number, value: string) {
    onChange(items.map((item, i) => (i === index ? value : item)));
  }
  function move(index: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  }
  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  function add() {
    if (!full) onChange([...items, ""]);
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(`[data-asset-list="${CSS.escape(id)}"] input`);
      inputs[inputs.length - 1]?.focus();
    });
  }
  /** Several lines pasted into one field: one item per line. */
  function paste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    event.preventDefault();
    const next = [...items];
    const head = next[index].trim() ? [next[index], ...lines] : lines;
    next.splice(index, 1, ...head);
    onChange(next.slice(0, GOOGLE_STORAGE_LIMITS.items));
  }

  return (
    <fieldset className="inset space-y-2 p-3" data-asset-list={id}>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground" aria-hidden="true">
          {label}{" "}
          <span className="font-normal text-muted">
            ({spec.min}–{spec.max}, al massimo {spec.chars} caratteri)
          </span>
        </p>
        <span
          className={`chip ${filledCount < spec.min || filledCount > spec.max ? "chip-stale" : "chip-fresh"} tabular`}
        >
          {filledCount} di {spec.max}
        </span>
      </div>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {spec.short ? (
        <p className="text-xs text-muted">Almeno uno entro {spec.short} caratteri, per gli spazi piccoli.</p>
      ) : null}
      {items.length === 0 ? <p className="text-sm text-muted">Nessun {one} ancora.</p> : null}
      <ol className="space-y-2">
        {items.map((item, index) => {
          const n = count(item);
          const norm = normalizeAssetText(item);
          const duplicateOf = norm ? firstOf.get(norm) : undefined;
          const duplicate = duplicateOf !== undefined && duplicateOf !== index;
          const fieldId = `${id}-${index}`;
          return (
            <li key={index} className="space-y-1">
              <div className="flex items-center gap-2">
                <label htmlFor={fieldId} className="tabular w-5 shrink-0 text-right text-xs text-muted">
                  <span className="sr-only">
                    {label} {index + 1}
                  </span>
                  <span aria-hidden="true">{index + 1}</span>
                </label>
                <input
                  id={fieldId}
                  value={item}
                  onChange={(e) => update(index, e.target.value)}
                  onPaste={(e) => paste(index, e)}
                  maxLength={GOOGLE_STORAGE_LIMITS.itemChars}
                  disabled={disabled}
                  placeholder={index === 0 ? placeholder : undefined}
                  aria-invalid={n > spec.chars || duplicate || undefined}
                  className={`field min-w-0 flex-1 ${n > spec.chars || duplicate ? "border-error" : ""}`}
                />
                <span className={`tabular w-12 shrink-0 text-right text-xs ${counterClass(n, spec.chars)}`}>
                  {n}/{spec.chars}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pl-7">
                <span className="min-w-0 text-xs text-error">
                  {duplicate ? `Uguale a ${one} ${(duplicateOf ?? 0) + 1}` : n > spec.chars ? `${n - spec.chars} caratteri di troppo` : ""}
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm px-2"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, index - 1)}
                    aria-label={`Sposta ${one} ${index + 1} su`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm px-2"
                    disabled={disabled || index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                    aria-label={`Sposta ${one} ${index + 1} giù`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm px-2 text-error"
                    disabled={disabled}
                    onClick={() => remove(index)}
                    aria-label={`Togli ${one} ${index + 1}`}
                  >
                    Togli
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn btn-sm" disabled={disabled || full} onClick={add}>
        Aggiungi {one}
      </button>
    </fieldset>
  );
}

// ─── Keywords ────────────────────────────────────────────────────────────────

const MATCH_SYNTAX: Record<GoogleMatchType, string> = {
  broad: "parola",
  phrase: '"parola"',
  exact: "[parola]",
};

function KeywordsEditor({
  id,
  keywords,
  negatives,
  disabled,
  onKeywords,
  onNegatives,
}: {
  id: string;
  keywords: GoogleKeyword[];
  negatives: string[];
  disabled: boolean;
  onKeywords: (next: GoogleKeyword[]) => void;
  onNegatives: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [match, setMatch] = useState<GoogleMatchType>("broad");
  const [notice, setNotice] = useState<string | null>(null);

  function addDraft() {
    // Lines without syntax take the chosen match type; "…" and […] keep theirs.
    const parsed = draft.split(/[\r\n,]+/).flatMap((line) => {
      const keyword = parseKeywordLine(line);
      if (!keyword) return [];
      const explicit = /^\s*(\[.*\]|["“”«»„].*["“”«»„])\s*$/u.test(line);
      return [explicit ? keyword : { ...keyword, match }];
    });
    if (parsed.length === 0) return;
    const next = mergeKeywords(keywords, parsed).slice(0, GOOGLE_STORAGE_LIMITS.keywords);
    const added = next.length - keywords.length;
    onKeywords(next);
    setDraft("");
    setNotice(
      added === parsed.length
        ? `${added === 1 ? "Aggiunta 1 parola chiave" : `Aggiunte ${added} parole chiave`}.`
        : `Aggiunte ${added} parole chiave, ${parsed.length - added} erano già in elenco.`
    );
  }

  const counts = GOOGLE_MATCH_TYPES.map((m) => ({ m, n: keywords.filter((k) => k.match === m).length }));
  const seen = new Set<string>();

  return (
    <div className="space-y-4">
      <fieldset className="inset space-y-3 p-3">
        <legend className="sr-only">Parole chiave</legend>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-foreground" aria-hidden="true">
            Parole chiave
          </p>
          <span className={`chip tabular ${keywords.length === 0 ? "chip-stale" : "chip-fresh"}`}>
            {keywords.length} {keywords.length === 1 ? "parola" : "parole"}
          </span>
        </div>
        <p className="text-xs text-muted">
          Corrispondenza: generica <code className="tabular">{MATCH_SYNTAX.broad}</code> · a frase{" "}
          <code className="tabular">{MATCH_SYNTAX.phrase}</code> · esatta <code className="tabular">{MATCH_SYNTAX.exact}</code>.
          Al massimo {GOOGLE_SPECS.keyword.chars} caratteri e {GOOGLE_SPECS.keyword.words} parole.
        </p>

        <div className="space-y-2">
          <label htmlFor={`${id}-paste`} className="block text-sm text-foreground">
            Aggiungi parole chiave, una per riga
          </label>
          <textarea
            id={`${id}-paste`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setNotice(null);
            }}
            rows={3}
            disabled={disabled}
            placeholder={'palestra milano\n"prova gratuita palestra"\n[palestra kinetik]'}
            className="field resize-y"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-match`} className="text-sm text-muted">
              Senza simboli usa
            </label>
            <select
              id={`${id}-match`}
              value={match}
              onChange={(e) => setMatch(e.target.value as GoogleMatchType)}
              disabled={disabled}
              className="field w-auto"
            >
              {GOOGLE_MATCH_TYPES.map((m) => (
                <option key={m} value={m}>
                  {GOOGLE_MATCH_LABELS[m]}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" disabled={disabled || !draft.trim()} onClick={addDraft}>
              Aggiungi all&apos;elenco
            </button>
          </div>
          {notice ? (
            <p className="text-xs text-success" role="status">
              {notice}
            </p>
          ) : null}
        </div>

        {keywords.length > 0 ? (
          <>
            <p className="text-xs text-muted">
              {counts
                .filter((c) => c.n > 0)
                .map((c) => `${c.n} ${GOOGLE_MATCH_LABELS[c.m]}`)
                .join(" · ")}
            </p>
            <ul className="divide-y divide-border rounded-lg bg-surface">
              {keywords.map((keyword, index) => {
                const key = `${keyword.match}:${normalizeAssetText(keyword.text)}`;
                const repeated = seen.has(key);
                seen.add(key);
                const tooLong = count(keyword.text) > GOOGLE_SPECS.keyword.chars;
                return (
                  <li key={index} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                    <input
                      value={keyword.text}
                      onChange={(e) =>
                        onKeywords(keywords.map((k, i) => (i === index ? { ...k, text: e.target.value } : k)))
                      }
                      aria-label={`Parola chiave ${index + 1}`}
                      disabled={disabled}
                      className={`field min-w-0 flex-[1_1_10rem] ${tooLong ? "border-error" : ""}`}
                    />
                    <select
                      value={keyword.match}
                      onChange={(e) =>
                        onKeywords(
                          keywords.map((k, i) => (i === index ? { ...k, match: e.target.value as GoogleMatchType } : k))
                        )
                      }
                      aria-label={`Corrispondenza di ${formatKeyword(keyword)}`}
                      disabled={disabled}
                      className="field w-auto"
                    >
                      {GOOGLE_MATCH_TYPES.map((m) => (
                        <option key={m} value={m}>
                          {GOOGLE_MATCH_LABELS[m]}
                        </option>
                      ))}
                    </select>
                    <code className="tabular hidden min-w-0 truncate text-xs text-muted sm:inline">{formatKeyword(keyword)}</code>
                    {repeated ? <span className="chip chip-stale">ripetuta</span> : null}
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm ml-auto px-2 text-error"
                      disabled={disabled}
                      onClick={() => onKeywords(keywords.filter((_, i) => i !== index))}
                      aria-label={`Togli ${formatKeyword(keyword)}`}
                    >
                      Togli
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </fieldset>

      <div className="inset space-y-2 p-3">
        <label htmlFor={`${id}-negatives`} className="block text-sm font-medium text-foreground">
          Parole chiave escluse <span className="font-normal text-muted">(facoltative, una per riga)</span>
        </label>
        <p className="text-xs text-muted">Le ricerche che le contengono non mostrano l&apos;annuncio. Anche qui valgono &quot;…&quot; e […].</p>
        <textarea
          id={`${id}-negatives`}
          value={negatives.join("\n")}
          onChange={(e) => onNegatives(e.target.value.split("\n").slice(0, GOOGLE_STORAGE_LIMITS.negativeKeywords))}
          rows={3}
          disabled={disabled}
          placeholder={"gratis lavoro\nistruttore corso"}
          className="field resize-y"
        />
      </div>
    </div>
  );
}
