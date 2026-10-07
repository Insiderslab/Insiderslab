"use client";

/* eslint-disable @next/next/no-img-element -- logos are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * Google Ads mockups: the responsive search ad as a result on the Google
 * results page, and the Performance Max surfaces (Display, YouTube, Gmail,
 * Discover, Ricerca) built from the same asset group.
 *
 * Google combines headlines, descriptions and images on its own: the
 * previews show one combination at a time and "Mostra un'altra
 * combinazione" rotates them, so the client sees every asset in context.
 * Sober and neutral: no Google logos, only the labels the pages use
 * ("Sponsorizzato", "Annuncio").
 *
 * Images keep comment pins and taps: each surface shows one media of the
 * variant, and its index is mapped back to the variant's media list.
 */

import { useState, type ReactNode } from "react";
import { MoreIcon, PlayIcon } from "@/components/post-preview/icons";
import MediaStage from "@/components/post-preview/media-stage";
import { Avatar, MockupFrame } from "@/components/post-preview/parts";
import type { PreviewPin, PreviewVideoMarker } from "@/components/post-preview/types";
import {
  filled,
  googleAssetsOf,
  googleCombination,
  googleCombinationCount,
  googleDisplayUrl,
  pmaxImages,
  pmaxLogoKind,
  type GoogleCombination,
} from "@/lib/content/google-ads";
import type { MediaItem } from "@/lib/domain";
import type { AdMockupProps } from "./ad-mockups";
import { displayDomain } from "./helpers";

const LINK_BLUE = "text-[#1a0dab]";
const INK = "text-[#202124]";
const GREY = "text-[#4d5156]";

// ─── Shared pieces ───────────────────────────────────────────────────────────

/** "Mostra un'altra combinazione" with the position, under a preview. */
function CombinationControls({
  step,
  count,
  onNext,
}: {
  step: number;
  count: number;
  onNext: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted">
        Google combina da solo titoli, descrizioni e immagini: questa è una combinazione possibile
        {count > 1 ? ` (${(step % count) + 1} di ${count})` : ""}.
      </p>
      {count > 1 ? (
        <button type="button" onClick={onNext} className="btn btn-sm">
          Mostra un&apos;altra combinazione
        </button>
      ) : null}
    </div>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return <span className="italic opacity-60">{children}</span>;
}

/** The business logo: the first square logo of the asset group, else the client's picture. */
function BusinessLogo({ p, size, className = "" }: { p: AdMockupProps; size: number; className?: string }) {
  const logos = googleAssetsOf(p.variant).logos;
  const logo = logos.find((l) => pmaxLogoKind(l) === "square") ?? logos[0];
  const name = businessName(p);
  if (logo) {
    return (
      <img
        src={logo.url}
        alt=""
        referrerPolicy="no-referrer"
        className={`block shrink-0 rounded-full border border-[#dadce0] bg-white object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return <Avatar name={name} url={p.accountAvatarUrl} size={size} className={className} />;
}

function businessName(p: AdMockupProps): string {
  return googleAssetsOf(p.variant).businessName.trim() || p.accountName;
}

function AdLabel({ className = "" }: { className?: string }) {
  return <span className={`text-[12px] font-semibold ${INK} ${className}`}>Sponsorizzato</span>;
}

function CtaPill({ cta, className = "" }: { cta: string; className?: string }) {
  return (
    <span className={`inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-[14px] font-medium ${className}`}>
      {cta.trim() || "Scopri di più"}
    </span>
  );
}

/**
 * One media of the variant inside a surface: pins, taps and the video review
 * props are mapped between the variant's media list and this single slot.
 */
function SingleMedia({
  p,
  media,
  label,
  ratio,
  emptyLabel,
  withVideoReview = false,
  overlay,
}: {
  p: AdMockupProps;
  media: { item: MediaItem; index: number } | null;
  label: string;
  ratio: number;
  emptyLabel: string;
  withVideoReview?: boolean;
  overlay?: ReactNode;
}) {
  if (!media) {
    return <MediaStage media={[]} ratio={ratio} label={label} indicators="none" emptyLabel={emptyLabel} overlay={overlay} />;
  }
  const { item, index } = media;
  const firstVideo = p.variant.media.findIndex((m) => m.type === "video");
  const mine = (i: number | undefined) => (i === undefined ? index === firstVideo : i === index);
  const pins: PreviewPin[] = (p.pins ?? []).filter((pin) => pin.mediaIndex === index).map((pin) => ({ ...pin, mediaIndex: 0 }));
  const video = withVideoReview && item.type === "video";
  const markers: PreviewVideoMarker[] | undefined = video
    ? (p.markers ?? []).filter((m) => mine(m.mediaIndex)).map((m) => ({ ...m, mediaIndex: 0 }))
    : undefined;
  return (
    <MediaStage
      media={[item]}
      ratio={ratio}
      label={label}
      indicators="none"
      overlay={overlay}
      pins={pins}
      onMediaClick={p.onMediaClick ? (point) => p.onMediaClick?.({ ...point, mediaIndex: index }) : undefined}
      markers={markers}
      onRequestComment={
        video && p.onRequestComment ? (request) => p.onRequestComment?.({ ...request, mediaIndex: index }) : undefined
      }
      onTimeChange={video && p.onTimeChange ? (sec) => p.onTimeChange?.(sec, index) : undefined}
      registerTimeGetter={video ? p.registerTimeGetter : undefined}
      seekTo={video && p.seekTo && mine(p.seekTo.mediaIndex) ? { ...p.seekTo, mediaIndex: 0 } : undefined}
    />
  );
}

// ─── Search result (RSA) ─────────────────────────────────────────────────────

function SearchResult({
  p,
  combo,
  displayUrl,
}: {
  p: AdMockupProps;
  combo: GoogleCombination;
  displayUrl: string | null;
}) {
  const name = businessName(p);
  return (
    <div className={`space-y-1.5 rounded-lg border border-[#dadce0] bg-white p-4 ${INK}`}>
      <AdLabel />
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#dadce0] bg-[#f1f3f4]">
          <BusinessLogo p={p} size={18} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px]">{name}</p>
          <p className={`truncate text-[12px] ${GREY}`}>
            {displayUrl ? `https://${displayUrl.replace(/\//g, " › ")}` : <Placeholder>dominio del sito</Placeholder>}
          </p>
        </div>
        <span aria-hidden="true" className={GREY}>
          <MoreIcon className="h-4 w-4 rotate-90" />
        </span>
      </div>
      <p className={`text-[19px] leading-snug ${LINK_BLUE}`}>
        {combo.headlines.length > 0 ? combo.headlines.join(" | ") : <Placeholder>Titolo 1 | Titolo 2 | Titolo 3</Placeholder>}
      </p>
      <p className={`text-[14px] leading-normal ${GREY}`}>
        {combo.descriptions.length > 0 ? combo.descriptions.join(" ") : <Placeholder>Descrizione dell&apos;annuncio</Placeholder>}
      </p>
    </div>
  );
}

/** Responsive search ad on the results page, with the rotation of combinations. */
export function GoogleSearchAd(p: AdMockupProps) {
  const [step, setStep] = useState(0);
  const assets = googleAssetsOf(p.variant);
  const combo = googleCombination(assets, step);
  const count = googleCombinationCount(assets);
  const displayUrl = googleDisplayUrl(p.variant.destinationUrl, assets);
  return (
    <MockupFrame label="Google, rete di ricerca, annuncio adattivo" className="max-w-[420px] space-y-3">
      <div className="space-y-2 rounded-xl bg-[#f8f9fa] p-3">
        <div className={`flex items-center gap-2 rounded-full border border-[#dfe1e5] bg-white px-4 py-2 text-[14px] ${GREY}`} aria-hidden="true">
          <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current" />
          <span className="truncate">{assets.keywords[0]?.text ?? "ricerca dell'utente"}</span>
        </div>
        <SearchResult p={p} combo={combo} displayUrl={displayUrl} />
        <div aria-hidden="true" className="space-y-1.5 px-1 pt-1">
          <span className="block h-2.5 w-2/3 rounded bg-[#e8eaed]" />
          <span className="block h-2.5 w-11/12 rounded bg-[#e8eaed]" />
          <span className="block h-2.5 w-1/2 rounded bg-[#e8eaed]" />
        </div>
      </div>
      <CombinationControls step={step} count={count} onNext={() => setStep((s) => s + 1)} />
    </MockupFrame>
  );
}

// ─── Performance Max ─────────────────────────────────────────────────────────

const PMAX_SURFACES = [
  { id: "display", label: "Display" },
  { id: "youtube", label: "YouTube" },
  { id: "gmail", label: "Gmail" },
  { id: "discover", label: "Discover" },
  { id: "search", label: "Ricerca" },
] as const;
type PmaxSurface = (typeof PMAX_SURFACES)[number]["id"];

/** Performance Max: where the asset group appears, one surface at a time. */
export function GooglePMaxAd(p: AdMockupProps) {
  const [surface, setSurface] = useState<PmaxSurface>("display");
  const [step, setStep] = useState(0);
  const assets = googleAssetsOf(p.variant);
  const combo = googleCombination(assets, step, { headlines: 1, descriptions: 1 });
  const searchCombo = googleCombination(assets, step);
  // One headline and one description per surface: rotate through the longest list.
  const count = Math.max(
    1,
    filled(assets.headlines).length,
    filled(assets.descriptions).length,
    filled(assets.longHeadlines).length
  );
  const images = pmaxImages(p.variant.media);
  const videoIndex = p.variant.media.findIndex((m) => m.type === "video");
  const video = videoIndex >= 0 ? { item: p.variant.media[videoIndex], index: videoIndex } : null;
  // Rotate the images too, among the formats a surface accepts.
  const landscape = images.landscape ?? images.square ?? null;
  const square = images.square ?? images.landscape ?? null;
  const tall = images.portrait ?? images.landscape ?? images.square ?? null;
  const headline = combo.headlines[0];
  const description = combo.descriptions[0];
  const name = businessName(p);
  const domain = displayDomain(p.variant.destinationUrl);

  const headlineText = headline ?? <Placeholder>Titolo</Placeholder>;
  const longText = combo.longHeadline ?? headline ?? <Placeholder>Titolo lungo</Placeholder>;
  const descriptionText = description ?? <Placeholder>Descrizione</Placeholder>;

  return (
    <MockupFrame label="Performance Max, gruppo di asset" className="max-w-[420px] space-y-3">
      <div role="group" aria-label="Dove compare l'annuncio" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {PMAX_SURFACES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={surface === s.id}
            onClick={() => setSurface(s.id)}
            className={`min-h-9 shrink-0 rounded-full border px-3 text-[13px] font-medium ${
              surface === s.id ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {surface === "display" ? (
        <div className={`overflow-hidden rounded-lg border border-[#dadce0] bg-white ${INK}`}>
          <SingleMedia p={p} media={landscape} label="Annuncio display" ratio={1.91} emptyLabel="Aggiungi un'immagine 1,91:1" />
          <div className="space-y-1 px-3 py-2.5">
            <p className="line-clamp-2 text-[16px] font-medium leading-tight">{longText}</p>
            <p className={`line-clamp-2 text-[13px] ${GREY}`}>{descriptionText}</p>
            <div className="flex items-center gap-2 pt-1">
              <BusinessLogo p={p} size={22} />
              <span className="min-w-0 flex-1 truncate text-[12px]">
                <span className="font-semibold">Annuncio</span> · {name}
              </span>
              <CtaPill cta={p.variant.cta} className="bg-[#1a73e8] text-white" />
            </div>
          </div>
        </div>
      ) : null}

      {surface === "youtube" ? (
        <div className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white text-[#0f0f0f]">
          <SingleMedia
            p={p}
            media={video ?? landscape}
            label="Annuncio su YouTube"
            ratio={16 / 9}
            withVideoReview
            emptyLabel="Aggiungi un video o un'immagine orizzontale"
            overlay={
              video ? undefined : (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
                    <PlayIcon className="h-6 w-6" />
                  </span>
                </span>
              )
            }
          />
          <div className="flex gap-3 px-3 py-2.5">
            <BusinessLogo p={p} size={36} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="line-clamp-2 text-[15px] font-medium leading-snug">{headlineText}</p>
              <p className="truncate text-[12px] text-[#606060]">
                <span className="font-semibold text-[#0f0f0f]">Sponsorizzato</span> · {name}
              </p>
            </div>
          </div>
          <div className="px-3 pb-3">
            <CtaPill cta={p.variant.cta} className="w-full bg-[#065fd4] text-white" />
          </div>
          {!video ? (
            <p className="border-t border-[#e5e5e5] px-3 py-2 text-[12px] text-[#606060]">
              Senza un vostro video, Google ne crea uno automaticamente con immagini e testi.
            </p>
          ) : null}
        </div>
      ) : null}

      {surface === "gmail" ? (
        <div className={`overflow-hidden rounded-lg border border-[#dadce0] bg-white ${INK}`}>
          <div className="flex gap-3 border-b border-[#f1f3f4] px-3 py-3">
            <BusinessLogo p={p} size={36} />
            <div className="min-w-0 flex-1 leading-snug">
              <p className="flex items-center gap-1.5 text-[14px]">
                <span className="rounded border border-[#5f6368] px-1 text-[11px] font-semibold leading-4">Annuncio</span>
                <span className="truncate font-semibold">{name}</span>
              </p>
              <p className="truncate text-[14px] font-semibold">{headlineText}</p>
              <p className={`truncate text-[13px] ${GREY}`}>{descriptionText}</p>
            </div>
          </div>
          <div className="space-y-2 bg-[#f8f9fa] p-3">
            <p className="text-[12px] text-[#5f6368]">Aperto, l&apos;annuncio diventa così:</p>
            <div className="overflow-hidden rounded-lg border border-[#dadce0] bg-white">
              <SingleMedia p={p} media={square} label="Annuncio Gmail" ratio={1} emptyLabel="Aggiungi un'immagine 1:1" />
              <div className="space-y-1 p-3">
                <p className="text-[16px] font-medium leading-tight">{longText}</p>
                <p className={`text-[13px] ${GREY}`}>{descriptionText}</p>
                <CtaPill cta={p.variant.cta} className="mt-1 bg-[#1a73e8] text-white" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {surface === "discover" ? (
        <div className={`overflow-hidden rounded-2xl border border-[#dadce0] bg-white ${INK}`}>
          <SingleMedia
            p={p}
            media={tall}
            label="Annuncio Discover"
            ratio={tall && tall === images.portrait ? 4 / 5 : 1.91}
            emptyLabel="Aggiungi un'immagine 4:5 o 1,91:1"
          />
          <div className="space-y-2 px-4 py-3">
            <p className="line-clamp-3 text-[17px] leading-snug">{longText}</p>
            <div className="flex items-center gap-2">
              <BusinessLogo p={p} size={20} />
              <span className="min-w-0 flex-1 truncate text-[12px]">
                <AdLabel /> <span className={GREY}>· {name}</span>
              </span>
              <CtaPill cta={p.variant.cta} className="h-8 border border-[#dadce0] text-[13px] text-[#1a73e8]" />
            </div>
          </div>
        </div>
      ) : null}

      {surface === "search" ? (
        <SearchResult
          p={p}
          combo={searchCombo}
          displayUrl={googleDisplayUrl(p.variant.destinationUrl, assets) ?? domain}
        />
      ) : null}

      <CombinationControls step={step} count={count} onNext={() => setStep((s) => s + 1)} />
    </MockupFrame>
  );
}
