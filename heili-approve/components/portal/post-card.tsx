/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * One post in the portal home list: thumbnail, title, networks, publish date
 * in the client's time zone, version number and what the client has to do.
 * The whole card is the link (big tap target on phones).
 */

import Link from "next/link";
import type { PostStatus } from "@/app/generated/prisma/client";
import { NETWORK_LABELS, type MediaItem, type Network } from "@/lib/domain";
import { PORTAL_STATUS_LABELS, portalTone } from "./helpers";

export interface PortalPostCardData {
  id: string;
  title: string;
  status: PostStatus;
  canAct: boolean;
  networks: Network[];
  versionNumber: number;
  cover: MediaItem | null;
  mediaCount: number;
  excerpt: string;
  /** Pre-formatted in the client's time zone. */
  publishLabel: string;
  reviewDueLabel: string | null;
}

const toneClass = {
  action: "text-accent",
  waiting: "text-warning",
  done: "text-success",
} as const;

export function PostThumb({ cover, mediaCount }: { cover: MediaItem | null; mediaCount: number }) {
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-surface sm:h-24 sm:w-24">
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
          Solo testo
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

export default function PostCard({ post, href }: { post: PortalPostCardData; href: string }) {
  const tone = portalTone(post.status, post.canAct);
  return (
    <Link
      href={href}
      className="flex gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-border-hover hover:bg-surface"
    >
      <PostThumb cover={post.cover} mediaCount={post.mediaCount} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{post.title}</h3>
          <span className={`shrink-0 text-xs font-medium ${toneClass[tone]}`}>
            {PORTAL_STATUS_LABELS[post.status]}
          </span>
        </div>
        <p className="text-sm">
          <span className="text-muted">Pubblicazione: </span>
          {post.publishLabel}
        </p>
        <p className="truncate text-xs text-muted">
          {post.networks.map((n) => NETWORK_LABELS[n] ?? n).join(" · ")}
          {` · Versione ${post.versionNumber}`}
        </p>
        {post.canAct && post.reviewDueLabel && (
          <p className="text-xs font-medium text-warning">Da rivedere entro {post.reviewDueLabel}</p>
        )}
        {post.excerpt && <p className="line-clamp-2 text-xs text-muted">{post.excerpt}</p>}
      </div>
    </Link>
  );
}
