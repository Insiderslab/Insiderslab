"use client";

/**
 * AdPreview — one variant as it would appear in one placement.
 * AdPlacementPreviews — the same variant across its placements, one tab each.
 *
 * Stories/Reels and TikTok get a "Zone di sicurezza" switch that shades the
 * areas covered by the app's interface (approximate guides, see
 * safe-zones.tsx). Comment pins, image clicks and the video review props
 * (markers, "Commenta a m:ss", seekTo…) pass straight to the media.
 */

import { useId, useState } from "react";
import { PLACEMENT_SPECS, type AdPlacement } from "@/lib/content/ads";
import { GoogleDisplayAd, LinkedInAd, MetaFeedAd, StoriesReelsAd, TikTokAd, type AdMockupProps } from "./ad-mockups";
import { GooglePMaxAd, GoogleSearchAd } from "./google-mockups";

export interface AdPreviewProps extends AdMockupProps {
  placement: AdPlacement;
  /** Initial state of the "Zone di sicurezza" switch (vertical placements). */
  defaultSafeZones?: boolean;
  /** Hide the placement name above the mockup (when a tab already says it). */
  hideTitle?: boolean;
  className?: string;
}

export default function AdPreview({
  placement,
  defaultSafeZones = false,
  hideTitle = false,
  className = "",
  ...mockup
}: AdPreviewProps) {
  const switchId = useId();
  const [showSafeZones, setShowSafeZones] = useState(defaultSafeZones);
  const spec = PLACEMENT_SPECS[placement];
  const zones = spec.safeZones;

  return (
    <div className={`space-y-2 ${className}`}>
      {!hideTitle || zones ? (
        <div className="mx-auto flex max-w-[420px] flex-wrap items-center justify-between gap-2">
          {!hideTitle ? <p className="text-sm font-medium text-foreground">{spec.label}</p> : <span />}
          {zones ? (
            <label htmlFor={switchId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                id={switchId}
                type="checkbox"
                role="switch"
                checked={showSafeZones}
                onChange={(event) => setShowSafeZones(event.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Zone di sicurezza
            </label>
          ) : null}
        </div>
      ) : null}

      {placement === "meta_feed" ? <MetaFeedAd {...mockup} /> : null}
      {placement === "meta_stories_reels" && zones ? (
        <StoriesReelsAd {...mockup} safeZones={zones} showSafeZones={showSafeZones} />
      ) : null}
      {placement === "tiktok_in_feed" && zones ? (
        <TikTokAd {...mockup} safeZones={zones} showSafeZones={showSafeZones} />
      ) : null}
      {placement === "google_display" ? <GoogleDisplayAd {...mockup} /> : null}
      {placement === "google_search" ? <GoogleSearchAd {...mockup} /> : null}
      {placement === "google_pmax" ? <GooglePMaxAd {...mockup} /> : null}
      {placement === "linkedin_feed" ? <LinkedInAd {...mockup} /> : null}

      {zones && showSafeZones ? (
        <p className="mx-auto max-w-[340px] text-xs text-muted">
          Le zone colorate sono coperte dall&apos;interfaccia dell&apos;app: tieni fuori logo, prezzi e testi in
          sovrimpressione. Sono indicative e variano tra dispositivi.
        </p>
      ) : null}
    </div>
  );
}

export interface AdPlacementPreviewsProps extends AdMockupProps {
  placements: AdPlacement[];
  defaultSafeZones?: boolean;
  /** Controlled tab (optional): the placement on screen and its setter. */
  active?: AdPlacement;
  onActiveChange?: (placement: AdPlacement) => void;
  className?: string;
}

/** Tabs of placements; only the active preview is mounted (switching stops a video). */
export function AdPlacementPreviews({
  placements,
  active,
  onActiveChange,
  defaultSafeZones,
  className = "",
  ...mockup
}: AdPlacementPreviewsProps) {
  const tabsId = useId();
  const [own, setOwn] = useState<AdPlacement | null>(null);
  const wanted = active ?? own;
  const current = wanted && placements.includes(wanted) ? wanted : placements[0];

  if (!current) {
    return <p className={`text-sm text-muted ${className}`}>Nessun posizionamento scelto per questa variante.</p>;
  }

  function select(placement: AdPlacement) {
    setOwn(placement);
    onActiveChange?.(placement);
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {placements.length > 1 ? (
        <div
          role="tablist"
          aria-label="Posizionamenti"
          className="-mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1"
        >
          {placements.map((placement) => (
            <button
              key={placement}
              type="button"
              role="tab"
              id={`${tabsId}-${placement}`}
              aria-selected={placement === current}
              aria-controls={`${tabsId}-panel`}
              onClick={() => select(placement)}
              className={`min-h-11 shrink-0 snap-start whitespace-nowrap rounded-md border px-3 text-sm transition-colors ${
                placement === current
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface text-foreground hover:border-border-hover"
              }`}
            >
              {PLACEMENT_SPECS[placement].label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        role={placements.length > 1 ? "tabpanel" : undefined}
        id={`${tabsId}-panel`}
        aria-labelledby={placements.length > 1 ? `${tabsId}-${current}` : undefined}
      >
        <AdPreview
          key={current}
          placement={current}
          defaultSafeZones={defaultSafeZones}
          hideTitle={placements.length > 1}
          {...mockup}
        />
      </div>
    </div>
  );
}
