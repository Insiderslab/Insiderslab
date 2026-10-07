/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * One item in the portal home list: its kind ("Post social", "Articolo",
 * "Creatività ads"), thumbnail, title, networks or variants, the planned date
 * in the client's time zone (labelled per kind), version number and what the
 * client has to do. The whole card is the link (big tap target on phones).
 */

import Link from "next/link";
import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import { NETWORK_LABELS, type MediaItem, type Network } from "@/lib/domain";
import { dateLabelFor, portalStatusLabel, portalTone } from "./helpers";
import KindLabel from "./kind-label";

export interface PortalPostCardData {
  id: string;
  kind: ContentKind;
  title: string;
  status: PostStatus;
  canAct: boolean;
  networks: Network[];
  versionNumber: number;
  cover: MediaItem | null;
  mediaCount: number;
  /** Ads: variants in the set; null for other kinds. */
  variantCount: number | null;
  excerpt: string;
  /** Pre-formatted in the client's time zone. */
  publishLabel: string;
  reviewDueLabel: string | null;
}

const toneChip = {
  action: "chip chip-brand",
  waiting: "chip chip-stale",
  done: "chip chip-fresh",
} as const;

export function PostThumb({
  cover,
  mediaCount,
  emptyLabel = "Solo testo",
}: {
  cover: MediaItem | null;
  mediaCount: number;
  /** Shown when there is no media ("Solo testo", "Articolo"). */
  emptyLabel?: string;
}) {
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-sunken sm:h-24 sm:w-24">
      {cover?.type === "image" && (
        <img
          src={cover.url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      )}
      {cover?.type === "video" &&
        (cover.posterUrl ? (
          <img
            src={cover.posterUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <video
            src={`${cover.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            className="pointer-events-none h-full w-full object-cover"
          />
        ))}
      {!cover && (
        <span className="flex h-full w-full items-center justify-center px-1 text-center text-[11px] text-muted">
          {emptyLabel}
        </span>
      )}
      {cover?.type === "video" && (
        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Video
        </span>
      )}
      {mediaCount > 1 && (
        <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          1/{mediaCount}
        </span>
      )}
    </div>
  );
}

/** "Instagram · Facebook", "3 varianti", "" (articles). */
function contentLine(post: PortalPostCardData): string {
  if (post.kind === "SOCIAL_POST") return post.networks.map((n) => NETWORK_LABELS[n] ?? n).join(" · ");
  if (post.kind === "AD_CREATIVE" && post.variantCount !== null) {
    return post.variantCount === 1 ? "1 variante" : `${post.variantCount} varianti`;
  }
  return "";
}

export default function PostCard({ post, href }: { post: PortalPostCardData; href: string }) {
  const tone = portalTone(post.status, post.canAct);
  const line = contentLine(post);
  return (
    <Link
      href={href}
      className="panel flex gap-3 p-3 transition-colors hover:border-line-strong sm:p-4"
    >
      <PostThumb
        cover={post.cover}
        mediaCount={post.kind === "AD_CREATIVE" ? 0 : post.mediaCount}
        emptyLabel={post.kind === "BLOG_ARTICLE" ? "Articolo" : "Solo testo"}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <KindLabel kind={post.kind} />
        <h3 className="line-clamp-2 text-base font-semibold leading-snug">{post.title}</h3>
        <span className={toneChip[tone]}>{portalStatusLabel(post.kind, post.status)}</span>
        <p className="text-sm">
          <span className="text-muted">{dateLabelFor(post.kind)}: </span>
          {post.publishLabel}
        </p>
        <p className="truncate text-xs text-muted">
          {line ? `${line} · ` : ""}
          {`Versione ${post.versionNumber}`}
        </p>
        {post.canAct && post.reviewDueLabel && (
          <p className="text-xs font-medium text-warning">Da rivedere entro {post.reviewDueLabel}</p>
        )}
        {post.excerpt && <p className="line-clamp-2 text-xs text-muted">{post.excerpt}</p>}
      </div>
    </Link>
  );
}
