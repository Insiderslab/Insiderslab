/**
 * «Griglia» (K-13): every content of the month at a glance — every network
 * and format, in calendar order — as compact tiles with the date, the status
 * in words and where it goes («Instagram · Reel», «Facebook»). A tap opens
 * the post review, with the way back to the grid.
 *
 * Not the Instagram profile: that is «Anteprima Instagram» (instagram-grid.tsx),
 * only the feed posts, newest first, in the feed's proportions.
 */

import Link from "next/link";
import { TileMedia } from "@/components/plans/instagram-grid";
import { formatGridSlot, formatPlanSlot, portalPath, portalStatusLabel, portalTone } from "@/components/portal/helpers";
import { formatLabel } from "@/components/post-preview/helpers";
import { NETWORK_LABELS, type MediaItem, type Network } from "@/lib/domain";
import { postLinkQuery } from "@/lib/month-rules";
import { byPublishAsc } from "@/lib/plan-rules";
import type { ReviewerPostSummary } from "@/lib/posts";

const CHIP = { action: "chip chip-brand", waiting: "chip chip-stale", done: "chip chip-fresh" } as const;

export interface MonthGridTile {
  id: string;
  title: string;
  cover: MediaItem | null;
  mediaCount: number;
  excerpt: string;
  /** "ven 6 nov · 09:30" (under the tile). */
  dateLabel: string;
  /** "ven 6 novembre · 09:30" (hover and screen readers). */
  fullDateLabel: string;
  status: { label: string; tone: keyof typeof CHIP };
  /** "Instagram Reel", "Instagram · Facebook". */
  channels: string;
  href: string;
}

/** Where a post goes, in words: the networks, with the Instagram / Facebook format when it is not a plain post. */
export function channelsLabel(networks: readonly Network[], instagramFormat: string | null): string {
  return networks
    .map((network) => {
      const name = NETWORK_LABELS[network] ?? network;
      if (network !== "instagram" || !instagramFormat || instagramFormat === "POST") return name;
      return `${name} ${formatLabel(network, instagramFormat)}`;
    })
    .join(" · ");
}

/** Tiles in calendar order for the posts, opened with the way back to Griglia. */
export function monthGridTiles({
  token,
  posts,
  timeZone,
  month,
}: {
  token: string;
  posts: readonly ReviewerPostSummary[];
  timeZone: string;
  /** Set on the month route (posts without a plan): the way back needs it. */
  month?: string;
}): MonthGridTile[] {
  return byPublishAsc(posts).map((p) => ({
    id: p.id,
    title: p.title,
    cover: p.cover,
    mediaCount: p.mediaCount,
    excerpt: p.excerpt,
    dateLabel: formatGridSlot(p.publishAt, timeZone),
    fullDateLabel: formatPlanSlot(p.publishAt, timeZone),
    status: { label: portalStatusLabel(p.kind, p.status), tone: portalTone(p.status, p.canAct) },
    channels: channelsLabel(p.networks, p.instagramFormat),
    href: `${portalPath(token, p.id)}${postLinkQuery("griglia", { month })}`,
  }));
}

export default function MonthGrid({
  tiles,
  monthLabel,
}: {
  tiles: MonthGridTile[];
  /** "novembre". */
  monthLabel: string;
}) {
  return (
    <section className="space-y-3" aria-labelledby="month-grid-title" data-testid="month-grid">
      <div className="space-y-1">
        <h2 id="month-grid-title" className="text-lg font-semibold">
          Griglia di {monthLabel}
        </h2>
        <p className="text-sm text-muted">
          Tutti i contenuti del mese a colpo d&apos;occhio, in ordine di data, con lo stato di ciascuno. Tocca un post per aprirlo.
        </p>
      </div>
      {tiles.length === 0 ? (
        <p className="panel p-4 text-sm text-muted">Non ci sono ancora post da vedere in questo mese.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label={`Tutti i contenuti di ${monthLabel}`}>
          {tiles.map((tile) => (
            <li key={tile.id} className="min-w-0">
              <Link
                href={tile.href}
                className="panel block h-full overflow-hidden !rounded-xl transition-colors hover:border-line-strong"
                title={`${tile.fullDateLabel} · ${tile.title}`}
              >
                <span className="relative block aspect-square bg-surface-sunken">
                  <TileMedia tile={tile} />
                  {tile.mediaCount > 1 && (
                    <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
                      1/{tile.mediaCount}
                    </span>
                  )}
                </span>
                <span className="block space-y-1 p-1.5 sm:p-2">
                  <span className="block truncate text-[11px] font-medium tabular text-muted">{tile.dateLabel}</span>
                  <span className={`${CHIP[tile.status.tone]} !px-1.5 !py-0 !text-[10px]`}>{tile.status.label}</span>
                  <span className="block truncate text-[11px] text-muted">{tile.channels}</span>
                  <span className="sr-only">{tile.title}, {tile.fullDateLabel}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
