/**
 * "Zone di sicurezza" over a 9:16 frame: the areas the app's own interface
 * covers (account and progress bar on top, caption and CTA at the bottom,
 * TikTok's action rail on the right). Logos, prices and on-screen text should
 * stay out of them. Approximate guides, not the platforms' exact pixels,
 * which change between app versions and devices.
 */

import type { SafeZones } from "@/lib/content/ads";

const ZONE = "absolute flex p-1 border-dashed border-error bg-error/25";
const ZONE_LABEL = "rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-white";

export default function SafeZoneOverlay({ zones }: { zones: SafeZones }) {
  const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
      {zones.top > 0 ? (
        <div className={`${ZONE} inset-x-0 top-0 items-end justify-end border-b-2`} style={{ height: pct(zones.top) }}>
          <span className={ZONE_LABEL}>Coperto dall&apos;interfaccia</span>
        </div>
      ) : null}
      {zones.bottom > 0 ? (
        <div className={`${ZONE} inset-x-0 bottom-0 items-start justify-end border-t-2`} style={{ height: pct(zones.bottom) }}>
          <span className={ZONE_LABEL}>Testo e pulsante dell&apos;annuncio</span>
        </div>
      ) : null}
      {zones.right > 0 ? (
        <div
          className={`${ZONE} right-0 items-center justify-center border-l-2`}
          style={{ top: pct(zones.top), bottom: pct(zones.bottom), width: pct(zones.right) }}
        >
          <span className={`${ZONE_LABEL} [writing-mode:vertical-rl]`}>Pulsanti</span>
        </div>
      ) : null}
      <span className="absolute left-2 top-1/2 -translate-y-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
        Area sicura (indicativa)
      </span>
    </div>
  );
}
