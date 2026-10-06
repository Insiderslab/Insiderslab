"use client";

/**
 * Ad mockups per placement: sober, realistic, no platform logos (neutral
 * marks and the labels the apps use: "Sponsorizzato", "Promosso",
 * "Annuncio"). Media go through the post previews' MediaStage, so images
 * take comment pins and videos get the review player with markers and
 * "Commenta a m:ss".
 *
 * The UI over vertical formats is a non-interactive overlay (only "altro"
 * takes taps), so the paused frame can still be tapped for a pin.
 */

import type { ReactNode } from "react";
import Caption from "@/components/post-preview/caption";
import { CAPTION_LIMITS, toHandle } from "@/components/post-preview/helpers";
import {
  BookmarkIcon,
  ChevronRightIcon,
  CloseIcon,
  CommentIcon,
  HeartIcon,
  MoreIcon,
  SendIcon,
  ShareArrowIcon,
  ThumbIcon,
} from "@/components/post-preview/icons";
import MediaStage from "@/components/post-preview/media-stage";
import { Avatar, MockupFrame } from "@/components/post-preview/parts";
import type { MediaClickPoint, PreviewPin, VideoReviewProps } from "@/components/post-preview/types";
import type { AdVariant, SafeZones } from "@/lib/content/ads";
import { displayDomain } from "./helpers";
import SafeZoneOverlay from "./safe-zones";

export interface AdMockupProps extends VideoReviewProps {
  variant: Pick<AdVariant, "media" | "primaryText" | "headline" | "description" | "cta" | "destinationUrl">;
  accountName: string;
  accountAvatarUrl?: string | null;
  pins?: PreviewPin[];
  onMediaClick?: (p: MediaClickPoint) => void;
}

const SHADOW = "[text-shadow:0_1px_2px_rgba(0,0,0,0.6)]";

/** The props MediaStage takes from a mockup, passed through untouched. */
function stage(p: AdMockupProps) {
  return {
    media: p.variant.media,
    pins: p.pins,
    onMediaClick: p.onMediaClick,
    markers: p.markers,
    onRequestComment: p.onRequestComment,
    onTimeChange: p.onTimeChange,
    registerTimeGetter: p.registerTimeGetter,
    seekTo: p.seekTo,
  };
}

/** CTA text, or a visible placeholder while the agency has not chosen one. */
function CtaText({ cta }: { cta: string }) {
  return cta.trim() ? <>{cta.trim()}</> : <span className="italic opacity-60">Call to action</span>;
}

/** Decorative action ("Mi piace", "Commenta"…): one line even in narrow columns. */
function ActionItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[12px] font-semibold">
      {children}
      <span className="truncate">{label}</span>
    </span>
  );
}

function SponsoredLine({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {label}
      <span aria-hidden="true">·</span>
      {/* Neutral "public" mark instead of a platform icon. */}
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full border border-current" />
    </span>
  );
}

// ─── Meta feed ───────────────────────────────────────────────────────────────

export function MetaFeedAd(p: AdMockupProps) {
  const { variant } = p;
  const domain = displayDomain(variant.destinationUrl);
  return (
    <MockupFrame
      label="feed Facebook e Instagram, annuncio"
      className="max-w-[400px] overflow-hidden rounded-lg border border-[#dadde1] bg-white text-[#050505]"
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight">{p.accountName}</p>
          <SponsoredLine label="Sponsorizzato" className="text-[12px] text-[#65676b]" />
        </div>
        <span aria-hidden="true" className="text-[#65676b]">
          <MoreIcon className="h-5 w-5" />
        </span>
      </header>

      {variant.primaryText.trim() ? (
        <div className="px-3 pb-2 text-[14px] leading-snug">
          <Caption
            text={variant.primaryText}
            limit={{ maxChars: 125, maxLines: 3 }}
            linkClassName="text-[#385898]"
            moreLabel="Altro..."
            moreClassName="font-semibold text-[#65676b]"
          />
        </div>
      ) : null}

      {/* Feed accepts 4:5 to 1.91:1; 1:1 when the size is not known yet. */}
      <MediaStage
        {...stage(p)}
        label="Annuncio nel feed"
        ratio={{ min: 4 / 5, max: 1.91, fallback: 1 }}
        indicators="dots"
        dotsClassName="bg-white pt-1"
        emptyLabel="Aggiungi un'immagine o un video"
      />

      <div className="flex items-center gap-3 bg-[#f0f2f5] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {domain ? <p className="truncate text-[12px] uppercase text-[#65676b]">{domain}</p> : null}
          <p className="line-clamp-2 text-[15px] font-semibold leading-tight">
            {variant.headline.trim() || <span className="italic text-[#65676b]">Titolo</span>}
          </p>
          {variant.description.trim() ? (
            <p className="truncate text-[13px] text-[#65676b]">{variant.description}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-md bg-[#e4e6eb] px-3 py-2 text-[14px] font-semibold">
          <CtaText cta={variant.cta} />
        </span>
      </div>

      <div className="flex justify-around gap-2 overflow-hidden border-t border-[#dadde1] px-2 py-2 text-[#65676b]" aria-hidden="true">
        <ActionItem label="Mi piace"><ThumbIcon className="h-4 w-4" /></ActionItem>
        <ActionItem label="Commenta"><CommentIcon className="h-4 w-4" /></ActionItem>
        <ActionItem label="Condividi"><ShareArrowIcon className="h-4 w-4" /></ActionItem>
      </div>
    </MockupFrame>
  );
}

// ─── Vertical frames (Stories / Reels, TikTok) ───────────────────────────────

function VerticalFrame({
  label,
  p,
  chrome,
  safeZones,
  showSafeZones,
  indicators,
  emptyLabel,
}: {
  label: string;
  p: AdMockupProps;
  chrome: ReactNode;
  safeZones: SafeZones;
  showSafeZones: boolean;
  indicators: "story" | "counter";
  emptyLabel: string;
}) {
  return (
    <MockupFrame label={label} className="max-w-[340px] overflow-hidden rounded-xl border border-border bg-black">
      <MediaStage
        {...stage(p)}
        label={label}
        ratio={9 / 16}
        overlay={
          <>
            {chrome}
            {showSafeZones ? <SafeZoneOverlay zones={safeZones} /> : null}
          </>
        }
        indicators={indicators}
        emptyLabel={emptyLabel}
      />
    </MockupFrame>
  );
}

export function StoriesReelsAd(p: AdMockupProps & { safeZones: SafeZones; showSafeZones: boolean }) {
  const { variant } = p;
  const chrome = (
    <div className={`absolute inset-0 text-white ${SHADOW}`}>
      {variant.media.length <= 1 ? (
        <span className="absolute inset-x-2 top-2 h-0.5 rounded-full bg-white" aria-hidden="true" />
      ) : null}
      <div className="absolute inset-x-3 top-5 flex items-center gap-2" aria-hidden="true">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold">{p.accountName}</p>
          <p className="text-[12px] text-white/85">Sponsorizzato</p>
        </div>
        <MoreIcon className="h-5 w-5 shrink-0" />
        <CloseIcon className="h-6 w-6 shrink-0" />
      </div>
      <div className="absolute inset-x-3 bottom-4 space-y-3">
        {variant.primaryText.trim() ? (
          <Caption
            text={variant.primaryText}
            limit={{ maxChars: 72, maxLines: 2 }}
            linkClassName="font-semibold"
            moreLabel="altro"
            moreClassName="text-white/75"
            className="text-[13px] leading-snug"
          />
        ) : null}
        <div className="flex flex-col items-center gap-1" aria-hidden="true">
          <span className="text-[12px] leading-none">⌃</span>
          <span className="max-w-full truncate rounded-full bg-white px-5 py-2 text-[14px] font-semibold text-black [text-shadow:none]">
            <CtaText cta={variant.cta} />
          </span>
        </div>
      </div>
    </div>
  );
  return (
    <VerticalFrame
      label="Storie e Reels, annuncio"
      p={p}
      chrome={chrome}
      safeZones={p.safeZones}
      showSafeZones={p.showSafeZones}
      indicators="story"
      emptyLabel="Aggiungi un video o un'immagine 9:16"
    />
  );
}

export function TikTokAd(p: AdMockupProps & { safeZones: SafeZones; showSafeZones: boolean }) {
  const { variant } = p;
  const chrome = (
    <div className={`absolute inset-0 text-white ${SHADOW}`}>
      <p className="absolute inset-x-0 top-3 text-center text-[15px] font-semibold" aria-hidden="true">
        Per te
      </p>
      <div className="absolute bottom-28 right-2 flex flex-col items-center gap-4" aria-hidden="true">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={40} className="rounded-full border border-white" />
        <HeartIcon className="h-8 w-8" />
        <CommentIcon className="h-8 w-8" />
        <BookmarkIcon className="h-7 w-7" />
        <ShareArrowIcon className="h-7 w-7" />
        <span className="h-8 w-8 rounded-full border-4 border-white/70 bg-black/60" />
      </div>
      <div className="absolute bottom-3 left-3 right-16 space-y-1.5">
        <p className="truncate text-[15px] font-semibold" aria-hidden="true">
          {toHandle(p.accountName)}
        </p>
        {variant.primaryText.trim() ? (
          <Caption
            text={variant.primaryText}
            limit={CAPTION_LIMITS.tiktok}
            linkClassName="font-semibold"
            moreLabel="altro"
            moreClassName="font-semibold text-white"
            className="text-[13px] leading-snug"
          />
        ) : null}
        <p aria-hidden="true">
          <span className="rounded bg-white/25 px-1.5 py-0.5 text-[11px] font-medium">Sponsorizzato</span>
        </p>
        <span
          aria-hidden="true"
          className="mt-1 flex items-center justify-between rounded bg-white/90 px-3 py-2 text-[14px] font-semibold text-black [text-shadow:none]"
        >
          <span className="truncate">
            <CtaText cta={variant.cta} />
          </span>
          <ChevronRightIcon className="h-4 w-4 shrink-0" />
        </span>
      </div>
    </div>
  );
  return (
    <VerticalFrame
      label="TikTok in-feed, annuncio"
      p={p}
      chrome={chrome}
      safeZones={p.safeZones}
      showSafeZones={p.showSafeZones}
      indicators="counter"
      emptyLabel="TikTok richiede un video 9:16"
    />
  );
}

// ─── Google display (responsive) ─────────────────────────────────────────────

function AdBadge() {
  return (
    <span className="rounded border border-[#70757a] px-1 text-[11px] font-semibold leading-4 text-[#3c4043]">
      Annuncio
    </span>
  );
}

export function GoogleDisplayAd(p: AdMockupProps) {
  const { variant } = p;
  const domain = displayDomain(variant.destinationUrl);
  const headline = variant.headline.trim() || variant.primaryText.trim();
  return (
    <MockupFrame label="Google Display, annuncio adattivo" className="max-w-[400px] space-y-3">
      <p className="text-xs text-muted">Google adatta l&apos;annuncio allo spazio: due formati tipici.</p>

      {/* Landscape slot, 1.91:1 */}
      <div className="overflow-hidden rounded-lg border border-[#dadce0] bg-white text-[#202124]">
        <MediaStage
          {...stage(p)}
          label="Annuncio display orizzontale"
          ratio={1.91}
          indicators="counter"
          emptyLabel="Aggiungi un'immagine 1,91:1"
        />
        <div className="space-y-1 px-3 py-2.5">
          <p className="line-clamp-2 text-[16px] font-medium leading-tight">
            {headline || <span className="italic text-[#5f6368]">Titolo</span>}
          </p>
          {variant.description.trim() ? (
            <p className="line-clamp-2 text-[13px] text-[#5f6368]">{variant.description}</p>
          ) : null}
          <div className="flex items-center gap-2 pt-1">
            <AdBadge />
            <span className="min-w-0 flex-1 truncate text-[12px] text-[#5f6368]">{domain ?? p.accountName}</span>
            <span className="flex h-8 shrink-0 items-center rounded-full bg-[#f1f3f4] px-3 text-[13px] font-medium text-[#202124]">
              <CtaText cta={variant.cta} />
            </span>
          </div>
        </div>
      </div>

      {/* Square slot, 1:1 */}
      <div className="mx-auto max-w-[260px] overflow-hidden rounded-lg border border-[#dadce0] bg-white text-[#202124]">
        {/* Video review stays on the first slot: one player registers the time getter. */}
        <MediaStage
          media={variant.media}
          pins={p.pins}
          onMediaClick={p.onMediaClick}
          label="Annuncio display quadrato"
          ratio={1}
          indicators="none"
          emptyLabel="Aggiungi un'immagine 1:1"
        />
        <div className="space-y-1.5 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <AdBadge />
            <p className="line-clamp-2 min-w-0 flex-1 text-[14px] font-medium leading-tight">
              {variant.headline.trim() || <span className="italic text-[#5f6368]">Titolo breve</span>}
            </p>
          </div>
          <span className="flex h-8 w-full items-center justify-center rounded-full border border-[#dadce0] text-[13px] font-medium text-[#202124]">
            <CtaText cta={variant.cta} />
          </span>
        </div>
      </div>
    </MockupFrame>
  );
}

// ─── LinkedIn feed ───────────────────────────────────────────────────────────

export function LinkedInAd(p: AdMockupProps) {
  const { variant } = p;
  const domain = displayDomain(variant.destinationUrl);
  return (
    <MockupFrame
      label="feed LinkedIn, annuncio"
      className="max-w-[420px] overflow-hidden rounded-lg border border-[#e0dfdc] bg-white text-[#191919]"
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={44} square />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold">{p.accountName}</p>
          <p className="text-[12px] text-[#666666]">Promosso</p>
        </div>
        <span aria-hidden="true" className="text-[#666666]">
          <MoreIcon className="h-5 w-5" />
        </span>
      </header>

      {variant.primaryText.trim() ? (
        <div className="px-3 pb-2 text-[14px] leading-snug">
          <Caption
            text={variant.primaryText}
            limit={{ maxChars: 150, maxLines: 3 }}
            linkClassName="font-semibold text-[#3a3a3a]"
            moreLabel="altro"
            moreClassName="text-[#666666]"
          />
        </div>
      ) : null}

      <MediaStage
        {...stage(p)}
        label="Annuncio LinkedIn"
        ratio={{ min: 9 / 16, max: 1.91, fallback: 1.91 }}
        indicators="dots"
        dotsClassName="pt-1"
        emptyLabel="Aggiungi un'immagine o un video"
      />

      <div className="flex items-center gap-3 bg-[#eef3f8] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[14px] font-semibold leading-tight">
            {variant.headline.trim() || <span className="italic text-[#666666]">Titolo</span>}
          </p>
          {domain ? <p className="truncate text-[12px] text-[#666666]">{domain}</p> : null}
        </div>
        <span className="shrink-0 rounded-full border border-[#191919]/70 px-3 py-1.5 text-[14px] font-semibold">
          <CtaText cta={variant.cta} />
        </span>
      </div>

      <div className="flex justify-around gap-2 overflow-hidden border-t border-[#e0dfdc] px-2 py-2 text-[#666666]" aria-hidden="true">
        <ActionItem label="Consiglia"><ThumbIcon className="h-4 w-4" /></ActionItem>
        <ActionItem label="Commenta"><CommentIcon className="h-4 w-4" /></ActionItem>
        <ActionItem label="Invia"><SendIcon className="h-4 w-4" /></ActionItem>
      </div>
    </MockupFrame>
  );
}
