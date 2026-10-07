"use client";

/**
 * GoogleAssetsList — the Google Ads texts of a variant as a readable list:
 * titoli, titoli lunghi, descrizioni (numbered, with their length), nome
 * dell'attività, URL visualizzato, parole chiave with the match type in words
 * ("generica", "a frase", "esatta") and the excluded ones.
 *
 * With onCommentAsset (client portal) every item is a button: tapping it
 * selects it and shows "Commenta questo titolo" (or "…questa descrizione",
 * "…questa parola chiave"); the parent opens its composer, passed back as
 * `composer` and shown right under the selected item. Items already
 * commented in this version carry a "commentato" chip.
 */

import { useId, useState, type ReactNode } from "react";
import {
  GOOGLE_ASSET_LABELS,
  GOOGLE_MATCH_LABELS,
  filled,
  formatKeyword,
  googleAssetName,
  googleAssetsOf,
  googleDisplayUrl,
  parseKeywordLine,
  type GoogleAssetKind,
  type GoogleAssetRef,
} from "@/lib/content/google-ads";
import type { AdVariant } from "@/lib/content/types";

export interface GoogleAssetsListProps {
  variant: Pick<AdVariant, "google" | "placements" | "destinationUrl">;
  /** Tap → "Commenta questo …" (absent: read only). */
  onCommentAsset?: (ref: GoogleAssetRef) => void;
  /** The asset being commented and the parent's form for it. */
  activeAsset?: GoogleAssetRef | null;
  composer?: ReactNode;
  /** Names of assets with a comment ("Titolo 3"), from parseAssetComment. */
  commented?: ReadonlySet<string>;
  className?: string;
}

function sameRef(a: GoogleAssetRef | null | undefined, b: GoogleAssetRef): boolean {
  return !!a && a.kind === b.kind && a.index === b.index && a.text === b.text;
}

export default function GoogleAssetsList({
  variant,
  onCommentAsset,
  activeAsset,
  composer,
  commented,
  className = "",
}: GoogleAssetsListProps) {
  const headingId = useId();
  const [selected, setSelected] = useState<GoogleAssetRef | null>(null);
  const g = googleAssetsOf(variant);
  const pmax = variant.placements.includes("google_pmax");
  const search = variant.placements.includes("google_search");
  const headlines = filled(g.headlines);
  const longHeadlines = pmax ? filled(g.longHeadlines) : [];
  const descriptions = filled(g.descriptions);
  const keywords = search ? g.keywords.filter((k) => k.text.trim()) : [];
  const negatives = search
    ? g.negativeKeywords.map((raw) => parseKeywordLine(raw)).filter((k) => k !== null)
    : [];
  const displayUrl = g.path1.trim() ? googleDisplayUrl(variant.destinationUrl, g) : null;
  const business = pmax ? g.businessName.trim() : "";

  if (
    headlines.length + longHeadlines.length + descriptions.length + keywords.length + negatives.length === 0 &&
    !business &&
    !displayUrl
  ) {
    return null;
  }

  const interactive = !!onCommentAsset;
  const current = activeAsset ?? selected;

  function item(ref: GoogleAssetRef, content: ReactNode, extra?: ReactNode) {
    const name = googleAssetName(ref);
    const isSelected = sameRef(current, ref);
    const isComposing = sameRef(activeAsset, ref);
    const done = commented?.has(name);
    return (
      <li key={`${ref.kind}-${ref.index}`} className={isSelected && interactive ? "rounded-lg bg-accent-soft" : ""}>
        {interactive ? (
          <button
            type="button"
            onClick={() => setSelected(isSelected ? null : ref)}
            aria-expanded={isSelected}
            className="flex min-h-11 w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover"
          >
            {content}
            {done ? <span className="chip chip-brand shrink-0">commentato</span> : null}
            {extra}
          </button>
        ) : (
          <div className="flex min-h-9 items-start gap-3 px-2 py-1.5">
            {content}
            {extra}
          </div>
        )}
        {interactive && isSelected && !isComposing ? (
          <div className="px-2 pb-2">
            <button type="button" className="btn btn-sm w-full sm:w-auto" onClick={() => onCommentAsset?.(ref)}>
              {GOOGLE_ASSET_LABELS[ref.kind].verb}
            </button>
          </div>
        ) : null}
        {isComposing && composer ? <div className="px-2 pb-2">{composer}</div> : null}
      </li>
    );
  }

  function numberedList(kind: GoogleAssetKind, title: string, items: string[], max: number) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1">
        <h4 className="label-caps">
          {title} <span className="tabular">({items.length})</span>
        </h4>
        <ol className="space-y-0.5">
          {items.map((text, index) =>
            item(
              { kind, index, text },
              <>
                <span
                  aria-hidden="true"
                  className="tabular mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-muted"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 break-words text-[15px] text-foreground">
                  <span className="sr-only">{googleAssetName({ kind, index })}: </span>
                  {text}
                </span>
                <span className="tabular mt-0.5 shrink-0 text-xs text-muted" aria-label={`${Array.from(text).length} caratteri su ${max}`}>
                  {Array.from(text).length}/{max}
                </span>
              </>
            )
          )}
        </ol>
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className={`space-y-4 ${className}`}>
      <div className="space-y-1">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          Testi Google Ads
        </h3>
        <p className="text-xs text-muted">
          Google li combina da solo nelle anteprime.
          {interactive ? " Tocca un testo per commentarlo." : ""}
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-surface p-2 sm:p-3">
        {numberedList("headline", "Titoli", headlines, 30)}
        {numberedList("longHeadline", "Titoli lunghi", longHeadlines, 90)}
        {numberedList("description", "Descrizioni", descriptions, 90)}

        {business || displayUrl ? (
          <ul className="space-y-0.5">
            {business
              ? item(
                  { kind: "businessName", index: null, text: business },
                  <span className="min-w-0 flex-1 text-[15px]">
                    <span className="block text-xs text-muted">Nome dell&apos;attività</span>
                    {business}
                  </span>
                )
              : null}
            {displayUrl
              ? item(
                  { kind: "path", index: null, text: displayUrl },
                  <span className="min-w-0 flex-1 break-all text-[15px]">
                    <span className="block text-xs text-muted">URL visualizzato</span>
                    {displayUrl}
                  </span>
                )
              : null}
          </ul>
        ) : null}

        {keywords.length > 0 ? (
          <div className="space-y-1">
            <h4 className="label-caps">
              Parole chiave <span className="tabular">({keywords.length})</span>
            </h4>
            <p className="px-2 text-xs text-muted">
              Le ricerche su Google per cui può comparire l&apos;annuncio. Corrispondenza generica: anche ricerche
              simili; a frase: ricerche che contengono il senso della frase; esatta: solo quella ricerca o quasi.
            </p>
            <ul className="space-y-0.5">
              {keywords.map((keyword, index) =>
                item(
                  { kind: "keyword", index, text: formatKeyword(keyword) },
                  <span className="min-w-0 flex-1 break-words text-[15px] text-foreground">{keyword.text}</span>,
                  <span
                    className={`chip shrink-0 ${keyword.match === "exact" ? "chip-node" : keyword.match === "phrase" ? "chip-brand" : "chip-offline"}`}
                  >
                    {GOOGLE_MATCH_LABELS[keyword.match]}
                  </span>
                )
              )}
            </ul>
          </div>
        ) : null}

        {negatives.length > 0 ? (
          <div className="space-y-1">
            <h4 className="label-caps">
              Parole escluse <span className="tabular">({negatives.length})</span>
            </h4>
            <p className="px-2 text-xs text-muted">Per queste ricerche l&apos;annuncio non compare.</p>
            <ul className="space-y-0.5">
              {negatives.map((keyword, index) =>
                item(
                  { kind: "negativeKeyword", index, text: formatKeyword(keyword) },
                  <span className="min-w-0 flex-1 break-words text-[15px] text-foreground">{keyword.text}</span>,
                  <span className="chip chip-critical shrink-0">esclusa</span>
                )
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
