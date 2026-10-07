/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * Instagram profile-grid preview of a monthly plan: the month's posts as the
 * profile will show them — three columns, newest first, portrait 3:4 tiles
 * like today's Instagram grid — so agency and client judge the visual
 * coherence of the month at a glance. Carousels and videos carry Instagram's
 * corner icons; a post without media shows the start of its caption.
 *
 * Presentational only (no hooks): used by the agency's plan page and by the
 * client portal. Tiles are links when `href` is given.
 */

import Link from "next/link";
import type { MediaItem } from "@/lib/domain";

export interface GridTile {
  id: string;
  title: string;
  cover: MediaItem | null;
  mediaCount: number;
  /** Caption start, shown when there is no media. */
  excerpt: string;
  /** "ven 9 ott" — under the tile for screen readers and on hover. */
  dateLabel: string;
  /** Small chip on the tile ("Approvato", "Da approvare"); omit for none. */
  status?: { label: string; tone: "brand" | "fresh" | "stale" | "offline" };
  href?: string;
}

const CHIP: Record<NonNullable<GridTile["status"]>["tone"], string> = {
  brand: "chip chip-brand",
  fresh: "chip chip-fresh",
  stale: "chip chip-stale",
  offline: "chip chip-offline",
};

function CarouselIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M7 3h11a3 3 0 0 1 3 3v11h-2V6a1 1 0 0 0-1-1H7z" />
      <rect x="3" y="7" width="14" height="14" rx="2.5" />
    </svg>
  );
}

function ReelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm4 6.2v6.6c0 .5.5.8.9.5l5.2-3.3a.6.6 0 0 0 0-1l-5.2-3.3a.6.6 0 0 0-.9.5z" />
    </svg>
  );
}

function TileMedia({ tile }: { tile: GridTile }) {
  const cover = tile.cover;
  if (cover?.type === "image") {
    return <img src={cover.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />;
  }
  if (cover?.type === "video") {
    return cover.posterUrl ? (
      <img src={cover.posterUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
    ) : (
      <video
        src={`${cover.url}#t=0.5`}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        className="pointer-events-none h-full w-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-full w-full items-center bg-surface-sunken p-2 text-left text-[11px] leading-tight text-muted">
      <span className="line-clamp-6">{tile.excerpt || tile.title}</span>
    </span>
  );
}

export default function InstagramGrid({
  tiles,
  accountName,
  logoUrl,
  caption,
}: {
  /** Already in Instagram order (newest first, see instagramGridOrder). */
  tiles: GridTile[];
  accountName: string;
  logoUrl?: string | null;
  /** Line under the account name ("12 post a ottobre"). */
  caption: string;
}) {
  const initial = accountName.trim().charAt(0).toUpperCase() || "?";
  return (
    <figure className="space-y-3" data-testid="instagram-grid">
      <figcaption className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-base font-semibold text-accent">
          {logoUrl ? (
            <img src={logoUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{accountName}</span>
          <span className="block text-xs text-muted">{caption}</span>
        </span>
      </figcaption>
      {tiles.length === 0 ? (
        <p className="inset p-4 text-sm text-muted">Nessun post con immagini in questo mese.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg" aria-label="Anteprima della griglia del profilo">
          {tiles.map((tile) => {
            const inner = (
              <>
                <TileMedia tile={tile} />
                {tile.mediaCount > 1 ? (
                  <span className="absolute right-1.5 top-1.5 text-white drop-shadow">
                    <CarouselIcon />
                  </span>
                ) : tile.cover?.type === "video" ? (
                  <span className="absolute right-1.5 top-1.5 text-white drop-shadow">
                    <ReelIcon />
                  </span>
                ) : null}
                {tile.status && (
                  <span className={`${CHIP[tile.status.tone]} absolute bottom-1 left-1 !px-1.5 !py-0 !text-[10px] shadow-sm`}>
                    {tile.status.label}
                  </span>
                )}
                <span className="sr-only">
                  {tile.title}, {tile.dateLabel}
                  {tile.status ? `, ${tile.status.label}` : ""}
                </span>
              </>
            );
            return (
              <li key={tile.id} className="relative aspect-[3/4] bg-surface-sunken" title={`${tile.dateLabel} · ${tile.title}`}>
                {tile.href ? (
                  <Link href={tile.href} className="relative block h-full w-full focus-visible:outline-offset-[-2px]">
                    {inner}
                  </Link>
                ) : (
                  <div className="relative h-full w-full">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
