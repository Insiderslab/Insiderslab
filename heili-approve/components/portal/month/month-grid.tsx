/**
 * "Griglia": every post of the month in the Instagram profile grid (three
 * columns, newest first), each tile with its status chip and the corner icon
 * of a video or carousel; a tap opens the post review. A post that is not on
 * Instagram shows the start of its caption and the name of its network.
 */

import InstagramGrid, { type GridTile } from "@/components/plans/instagram-grid";
import { formatPlanSlot, portalPath, portalStatusLabel, portalTone } from "@/components/portal/helpers";
import { NETWORK_LABELS } from "@/lib/domain";
import { postLinkQuery } from "@/lib/month-rules";
import { instagramGridOrder } from "@/lib/plan-rules";
import type { ReviewerPostSummary } from "@/lib/posts";

const TILE_TONE = { action: "brand", waiting: "stale", done: "fresh" } as const;

/** Tiles in profile order (newest first) for the posts, opened with the way back to Griglia. */
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
}): GridTile[] {
  return instagramGridOrder(posts).map((p) => {
    const tone = portalTone(p.status, p.canAct);
    return {
      id: p.id,
      title: p.title,
      cover: p.cover,
      mediaCount: p.mediaCount,
      excerpt: p.excerpt,
      dateLabel: formatPlanSlot(p.publishAt, timeZone),
      status: { label: portalStatusLabel(p.kind, p.status), tone: TILE_TONE[tone] },
      badge: p.networks.includes("instagram") ? undefined : p.networks.map((n) => NETWORK_LABELS[n] ?? n).join(" · "),
      href: `${portalPath(token, p.id)}${postLinkQuery("griglia", { month })}`,
    };
  });
}

export default function MonthGrid({
  tiles,
  accountName,
  logoUrl,
  monthLabel,
}: {
  tiles: GridTile[];
  accountName: string;
  logoUrl: string | null;
  /** "ottobre". */
  monthLabel: string;
}) {
  return (
    <section className="space-y-3" aria-labelledby="month-grid" data-testid="month-grid">
      <div className="space-y-1">
        <h2 id="month-grid" className="text-lg font-semibold">
          Tutti i post di {monthLabel}
        </h2>
        <p className="text-sm text-muted">
          Come starebbero uno accanto all&apos;altro, dal più recente. Tocca un post per rivederlo.
        </p>
      </div>
      <InstagramGrid
        tiles={tiles}
        accountName={accountName}
        logoUrl={logoUrl}
        caption={tiles.length === 1 ? `1 post di ${monthLabel}` : `${tiles.length} post di ${monthLabel}`}
        ariaLabel={`Tutti i post di ${monthLabel}`}
        emptyText="Non ci sono ancora post da vedere in questo mese."
      />
    </section>
  );
}
