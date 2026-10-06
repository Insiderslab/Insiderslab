"use client";

/**
 * AdVariantCompare — the variants of a set side by side in one placement,
 * each with the client's decision (and the note when discarded).
 *
 * Desktop: 2–3 columns. Phone: a horizontal strip that snaps one variant at
 * a time. Previews are read-only (comments happen in AdVariantReview).
 */

import { useId, useState } from "react";
import AdPreview from "./ad-preview";
import AdDecisionBadge, { type AdVariantDecisionState } from "./decision-badge";
import { unionPlacements } from "./helpers";
import { PLACEMENT_SPECS, variantDisplayName, type AdPlacement, type AdVariant } from "@/lib/content/ads";

export interface AdVariantCompareProps {
  variants: AdVariant[];
  /** Decision per variant id; missing or null = not decided yet. */
  decisions?: Record<string, AdVariantDecisionState | null | undefined>;
  accountName: string;
  accountAvatarUrl?: string | null;
  /** Placement shown first (default: the first one used by the variants). */
  initialPlacement?: AdPlacement;
  /** "Apri" under each variant (e.g. jump to its review card). */
  onOpenVariant?: (variantId: string) => void;
  className?: string;
}

export default function AdVariantCompare({
  variants,
  decisions = {},
  accountName,
  accountAvatarUrl,
  initialPlacement,
  onOpenVariant,
  className = "",
}: AdVariantCompareProps) {
  const selectId = useId();
  const placements = unionPlacements(variants);
  const [chosen, setChosen] = useState<AdPlacement | undefined>(initialPlacement);
  const placement = chosen && placements.includes(chosen) ? chosen : placements[0];

  if (variants.length === 0) {
    return <p className={`text-sm text-muted ${className}`}>Nessuna variante da confrontare.</p>;
  }

  const columns = variants.length >= 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2";

  return (
    <section className={`space-y-3 ${className}`} aria-label="Confronto tra le varianti">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Confronta le varianti</h2>
        {placements.length > 1 ? (
          <label htmlFor={selectId} className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm text-muted">
            Posizionamento
            <select
              id={selectId}
              value={placement}
              onChange={(event) => setChosen(event.target.value as AdPlacement)}
              className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            >
              {placements.map((p) => (
                <option key={p} value={p}>
                  {PLACEMENT_SPECS[p].label}
                </option>
              ))}
            </select>
          </label>
        ) : placement ? (
          <p className="text-sm text-muted">{PLACEMENT_SPECS[placement].label}</p>
        ) : null}
      </div>

      {variants.length > 1 ? (
        <p className="text-xs text-muted md:hidden">Scorri di lato per vedere le altre varianti.</p>
      ) : null}

      <ul
        className={`-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:snap-none md:overflow-visible md:px-0 ${columns}`}
      >
        {variants.map((variant, index) => {
          const decision = decisions[variant.id] ?? null;
          const inPlacement = placement ? variant.placements.includes(placement) : false;
          const name = variantDisplayName(variant);
          return (
            <li
              key={variant.id}
              aria-label={`${name}, ${index + 1} di ${variants.length}`}
              className="relative w-[85%] max-w-[420px] shrink-0 snap-center space-y-3 rounded-lg border border-border bg-surface p-3 md:w-auto md:max-w-none"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-semibold text-foreground">{name}</p>
                <AdDecisionBadge verdict={decision?.verdict} />
              </div>
              {decision?.verdict === "REJECTED" && decision.note ? (
                <p className="whitespace-pre-wrap break-words rounded-md border border-error/30 bg-background p-2 text-sm">
                  <span className="text-muted">Nota del cliente: </span>
                  {decision.note}
                </p>
              ) : null}
              {placement ? (
                <>
                  {!inPlacement ? (
                    <p className="text-xs text-warning">Questa variante non è prevista in questo posizionamento.</p>
                  ) : null}
                  <AdPreview
                    placement={placement}
                    hideTitle
                    variant={variant}
                    accountName={accountName}
                    accountAvatarUrl={accountAvatarUrl}
                  />
                </>
              ) : (
                <p className="text-sm text-muted">Nessun posizionamento scelto.</p>
              )}
              {onOpenVariant ? (
                <button
                  type="button"
                  onClick={() => onOpenVariant(variant.id)}
                  className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm hover:border-border-hover"
                >
                  Apri {name}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
