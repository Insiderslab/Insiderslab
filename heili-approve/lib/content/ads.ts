/**
 * Ad creatives (Post.kind = AD_CREATIVE): content schema, the per-placement
 * spec checks shown live in the editor, the review validation that blocks
 * sending a set to the client, and the pure builders of the export package
 * (file names, copy.csv, README.txt).
 *
 * Pure and isomorphic: the agency editor and the client portal import it in
 * the browser, the services and the export route on the server. No I/O.
 *
 * The specs are the platforms' published recommendations (autumn 2026),
 * simplified: they guide the agency, they do not replace the platforms' own
 * checks at upload time. Aspect ratios match within ±2%.
 */

import { z } from "zod";
import type { MediaItem } from "@/lib/domain";
import { ValidationError } from "@/lib/errors";
import {
  buildGoogleExportFiles,
  cloneGoogleAssets,
  emptyGoogleAssets,
  filled,
  formatKeyword,
  googleAssetChecks,
  googleAssetsOf,
  googleAssetsSchema,
  googleDisplayUrl,
  hasGoogleAssets,
  GOOGLE_MATCH_LABELS,
  type GoogleExportFile,
} from "./google-ads";
import {
  AD_PLACEMENTS,
  AD_PLATFORMS,
  type AdCampaign,
  type AdContent,
  type AdPlacement,
  type AdPlatform,
  type AdVariant,
  type VariantDecision,
} from "./types";

export type {
  AdCampaign,
  AdContent,
  AdGoogleAssets,
  AdPlacement,
  AdPlatform,
  AdVariant,
  GoogleKeyword,
  GoogleMatchType,
  VariantDecision,
} from "./types";
export { AD_PLACEMENTS, AD_PLATFORMS, GOOGLE_MATCH_TYPES } from "./types";
export * from "./google-ads";

// ─── Limits ──────────────────────────────────────────────────────────────────

export const AD_LIMITS = {
  campaignName: 120,
  objective: 120,
  budgetNote: 500,
  audienceNote: 2000,
  variantName: 120,
  primaryText: 3000,
  headline: 300,
  description: 500,
  cta: 40,
  url: 2048,
  variants: 10,
  mediaPerVariant: 10,
} as const;

/** Ratio tolerance: 1080×1350 and 1080×1349 are both 4:5. */
export const RATIO_TOLERANCE = 0.02;

/** Variant ids: "A", "B"… or short random ids; safe in file names and URLs. */
export const VARIANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// ─── Labels ──────────────────────────────────────────────────────────────────

export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
  meta: "Meta (Facebook e Instagram)",
  google: "Google Ads",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

/** Short platform names for chips and tables. */
export const AD_PLATFORM_SHORT_LABELS: Record<AdPlatform, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

export type AdCheckStatus = "ok" | "warning" | "error";

export const AD_CHECK_STATUS_LABELS: Record<AdCheckStatus, string> = {
  ok: "ok",
  warning: "avviso",
  error: "errore",
};

// ─── Placement specs ─────────────────────────────────────────────────────────

export interface RatioTarget {
  ratio: number;
  label: string;
}

/** Areas covered by the app's UI, as fractions of the 9:16 frame (approximate guides). */
export interface SafeZones {
  top: number;
  bottom: number;
  right: number;
}

export interface PlacementSpec {
  placement: AdPlacement;
  platform: AdPlatform;
  label: string;
  /** Segment used in exported file names. */
  fileSlug: string;
  /** Ratios that are "ok". */
  preferred: RatioTarget[];
  /** Outside the preferred ratios but inside this range: "avviso" (cropped or letterboxed). */
  accepted: { min: number; max: number };
  /** Below this shortest side (px) the media looks soft: "avviso". */
  minShortSide: number;
  /** How videos are handled: required (no images), allowed, or not used here. */
  video: "required" | "allowed" | "unsupported";
  /** Max media shown at once (carousel cards, story cards). */
  maxMedia: number;
  safeZones: SafeZones | null;
  /** False for text-only placements (Google Search): no media checks there. */
  usesMedia: boolean;
  /** The button: required, optional (the platform picks one when empty) or not shown. */
  cta: "required" | "optional" | "none";
}

export const PLACEMENT_SPECS: Record<AdPlacement, PlacementSpec> = {
  meta_feed: {
    placement: "meta_feed",
    platform: "meta",
    label: "Feed Facebook e Instagram",
    fileSlug: "feed",
    preferred: [
      { ratio: 1, label: "1:1" },
      { ratio: 4 / 5, label: "4:5" },
    ],
    // Vertical media are cropped to 4:5 in the feed.
    accepted: { min: 9 / 16, max: 1.91 },
    minShortSide: 600,
    video: "allowed",
    maxMedia: 10,
    safeZones: null,
    usesMedia: true,
    cta: "required",
  },
  meta_stories_reels: {
    placement: "meta_stories_reels",
    platform: "meta",
    label: "Storie e Reels",
    fileSlug: "storie-reels",
    preferred: [{ ratio: 9 / 16, label: "9:16" }],
    // Up to square, with bands above and below; landscape is wasted here.
    accepted: { min: 9 / 16, max: 1 },
    minShortSide: 500,
    video: "allowed",
    maxMedia: 10,
    safeZones: { top: 0.14, bottom: 0.35, right: 0 },
    usesMedia: true,
    cta: "required",
  },
  tiktok_in_feed: {
    placement: "tiktok_in_feed",
    platform: "tiktok",
    label: "TikTok in-feed",
    fileSlug: "tiktok-infeed",
    preferred: [{ ratio: 9 / 16, label: "9:16" }],
    accepted: { min: 9 / 16, max: 16 / 9 },
    minShortSide: 540,
    video: "required",
    maxMedia: 1,
    safeZones: { top: 0.14, bottom: 0.35, right: 0.15 },
    usesMedia: true,
    cta: "required",
  },
  google_display: {
    placement: "google_display",
    platform: "google",
    label: "Google Display (adattivo)",
    fileSlug: "display",
    preferred: [
      { ratio: 1.91, label: "1,91:1" },
      { ratio: 1, label: "1:1" },
    ],
    accepted: { min: 4 / 5, max: 1.91 },
    minShortSide: 300,
    video: "unsupported",
    maxMedia: 15,
    safeZones: null,
    usesMedia: true,
    cta: "required",
  },
  // Responsive search ad: text only (headlines, descriptions, paths, keywords).
  google_search: {
    placement: "google_search",
    platform: "google",
    label: "Google Ricerca (annuncio adattivo)",
    fileSlug: "search",
    preferred: [],
    accepted: { min: 0, max: 0 },
    minShortSide: 0,
    video: "unsupported",
    maxMedia: 0,
    safeZones: null,
    usesMedia: false,
    cta: "none",
  },
  // Performance Max asset group: landscape 1.91:1 and square 1:1 required,
  // portrait 4:5 optional (sizes checked per format in google-ads.ts).
  google_pmax: {
    placement: "google_pmax",
    platform: "google",
    label: "Performance Max",
    fileSlug: "pmax",
    preferred: [
      { ratio: 1.91, label: "1,91:1" },
      { ratio: 1, label: "1:1" },
      { ratio: 4 / 5, label: "4:5" },
    ],
    accepted: { min: 4 / 5, max: 1.91 },
    minShortSide: 300,
    video: "allowed",
    maxMedia: 25,
    safeZones: null,
    usesMedia: true,
    cta: "optional",
  },
  linkedin_feed: {
    placement: "linkedin_feed",
    platform: "linkedin",
    label: "Feed LinkedIn",
    fileSlug: "linkedin-feed",
    preferred: [
      { ratio: 1.91, label: "1,91:1" },
      { ratio: 1, label: "1:1" },
    ],
    accepted: { min: 9 / 16, max: 1.91 },
    minShortSide: 400,
    video: "allowed",
    maxMedia: 10,
    safeZones: null,
    usesMedia: true,
    cta: "required",
  },
};

export const AD_PLACEMENT_LABELS: Record<AdPlacement, string> = Object.fromEntries(
  AD_PLACEMENTS.map((p) => [p, PLACEMENT_SPECS[p].label])
) as Record<AdPlacement, string>;

export function placementsForPlatform(platform: AdPlatform): AdPlacement[] {
  return AD_PLACEMENTS.filter((p) => PLACEMENT_SPECS[p].platform === platform);
}

/**
 * Placements a new variant starts with: all of the platform's, except Google
 * Ads, where Search, Performance Max and Display are different campaigns and
 * a variant usually targets one (Search first).
 */
export function defaultPlacementsForPlatform(platform: AdPlatform): AdPlacement[] {
  return platform === "google" ? ["google_search"] : placementsForPlatform(platform);
}

/** Placements whose Google assets (titoli, descrizioni, parole chiave) apply. */
export const GOOGLE_ASSET_PLACEMENTS = ["google_search", "google_pmax"] as const satisfies readonly AdPlacement[];

export function usesGoogleAssets(placements: readonly AdPlacement[]): boolean {
  return placements.some((p) => p === "google_search" || p === "google_pmax");
}

export function isAdPlatform(value: unknown): value is AdPlatform {
  return typeof value === "string" && (AD_PLATFORMS as readonly string[]).includes(value);
}

export function isAdPlacement(value: unknown): value is AdPlacement {
  return typeof value === "string" && (AD_PLACEMENTS as readonly string[]).includes(value);
}

// ─── Text specs ──────────────────────────────────────────────────────────────

export type AdTextField = "primaryText" | "headline" | "description";

export interface TextSpec {
  /** How the platform calls the field. */
  label: string;
  /** Over this: "avviso" (the platform truncates with "altro"). */
  recommended?: number;
  /** Over this: "errore" (the platform rejects it). */
  max?: number;
  required?: boolean;
}

/**
 * Text limits per platform. A field missing from a platform is not shown
 * there (e.g. TikTok has no headline or description).
 */
export const AD_TEXT_SPECS: Record<AdPlatform, Partial<Record<AdTextField, TextSpec>>> = {
  meta: {
    primaryText: { label: "Testo principale", recommended: 125 },
    headline: { label: "Titolo", recommended: 40 },
    description: { label: "Descrizione", recommended: 30 },
  },
  google: {
    primaryText: { label: "Titolo lungo", max: 90 },
    headline: { label: "Titolo breve", max: 30, required: true },
    description: { label: "Descrizione", max: 90, required: true },
  },
  tiktok: {
    primaryText: { label: "Testo dell'annuncio", max: 100, required: true },
  },
  linkedin: {
    primaryText: { label: "Testo introduttivo", recommended: 150, max: 600 },
    headline: { label: "Titolo", recommended: 70, max: 200 },
    description: { label: "Descrizione", recommended: 100 },
  },
};

/** CTA labels as the platforms show them in Italian (the editor suggests them). */
export const CTA_SUGGESTIONS: Record<AdPlatform, string[]> = {
  meta: [
    "Scopri di più",
    "Acquista ora",
    "Prenota ora",
    "Iscriviti",
    "Contattaci",
    "Richiedi preventivo",
    "Invia messaggio",
    "Ottieni offerta",
    "Scarica",
    "Chiama ora",
  ],
  google: ["Scopri di più", "Acquista ora", "Prenota ora", "Iscriviti", "Contattaci", "Visita il sito", "Richiedi preventivo"],
  tiktok: ["Scopri di più", "Acquista ora", "Prenota ora", "Iscriviti", "Contattaci", "Scarica", "Candidati ora"],
  linkedin: ["Scopri di più", "Iscriviti", "Registrati", "Scarica", "Richiedi una demo", "Candidati", "Partecipa"],
};

// ─── Schema ──────────────────────────────────────────────────────────────────

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const httpUrl = z
  .string()
  .trim()
  .max(AD_LIMITS.url)
  .refine((value) => isHttpUrl(value), "URL del media non valido");

const mediaItemSchema = z.object({
  url: httpUrl,
  type: z.enum(["image", "video"], { error: "Tipo di media non valido" }),
  mimeType: z.string().trim().min(1).max(100),
  assetId: z.string().min(1).max(64).optional(),
  alt: z.string().trim().max(1000).optional(),
  durationSec: z.number().positive().optional(),
  posterUrl: httpUrl.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const text = (max: number, message: string) => z.string().trim().max(max, message).default("");

export const adCampaignSchema = z.object({
  name: text(AD_LIMITS.campaignName, "Nome della campagna troppo lungo"),
  platform: z.enum(AD_PLATFORMS, { error: "Piattaforma non valida" }).default("meta"),
  objective: text(AD_LIMITS.objective, "Obiettivo troppo lungo"),
  budgetNote: text(AD_LIMITS.budgetNote, "Nota sul budget troppo lunga"),
  audienceNote: text(AD_LIMITS.audienceNote, "Nota sul pubblico troppo lunga"),
});

export const adVariantSchema = z.object({
  id: z.string().trim().regex(VARIANT_ID_PATTERN, "Identificativo della variante non valido"),
  name: text(AD_LIMITS.variantName, "Nome della variante troppo lungo"),
  media: z
    .array(mediaItemSchema)
    .max(AD_LIMITS.mediaPerVariant, `Al massimo ${AD_LIMITS.mediaPerVariant} media per variante`)
    .default([]),
  // Copy keeps the agency's line breaks; only trailing spaces go.
  primaryText: z.string().max(AD_LIMITS.primaryText, "Testo principale troppo lungo").default("").transform(trimEnd),
  headline: text(AD_LIMITS.headline, "Titolo troppo lungo"),
  description: text(AD_LIMITS.description, "Descrizione troppo lunga"),
  cta: text(AD_LIMITS.cta, "Call to action troppo lunga"),
  destinationUrl: text(AD_LIMITS.url, "URL di destinazione troppo lungo"),
  placements: z
    .array(z.enum(AD_PLACEMENTS, { error: "Posizionamento non valido" }))
    .max(AD_PLACEMENTS.length)
    .default([])
    .transform((list) => AD_PLACEMENTS.filter((p) => list.includes(p))),
  // Absent on sets saved before Google Ads: kept absent, so they read as before.
  google: googleAssetsSchema.optional(),
});

/**
 * AdContent as stored in PostVersion.content. Lenient on purpose (drafts are
 * saved half-written): shape and size only. What a set needs before the
 * client sees it is validateAdsForReview's job.
 */
export const adContentSchema = z
  .object({
    campaign: adCampaignSchema.default({
      name: "",
      platform: "meta",
      objective: "",
      budgetNote: "",
      audienceNote: "",
    }),
    variants: z
      .array(adVariantSchema)
      .max(AD_LIMITS.variants, `Al massimo ${AD_LIMITS.variants} varianti per set`)
      .default([]),
  })
  .refine((content) => new Set(content.variants.map((v) => v.id)).size === content.variants.length, {
    message: "Due varianti hanno lo stesso identificativo",
    path: ["variants"],
  });

function trimEnd(value: string): string {
  return value.replace(/\s+$/u, "");
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function toAdContent(data: z.output<typeof adContentSchema>): AdContent {
  return {
    campaign: { ...data.campaign },
    variants: data.variants.map(({ google, ...v }) => ({
      ...v,
      media: v.media.map((m) => stripUndefined(m) as MediaItem),
      ...(google ? { google: { ...google, logos: google.logos.map((m) => stripUndefined(m) as MediaItem) } } : {}),
    })),
  };
}

/** Validates input content (editor, API): throws ValidationError in Italian. */
export function parseAdContent(value: unknown): AdContent {
  const result = adContentSchema.safeParse(value ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Set di creatività non valido");
  }
  return toAdContent(result.data);
}

export function safeParseAdContent(value: unknown): { ok: true; content: AdContent } | { ok: false; error: string } {
  try {
    return { ok: true, content: parseAdContent(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Set di creatività non valido" };
  }
}

/**
 * Never throws: reads whatever is stored for display, keeping the valid
 * campaign fields and variants and dropping the rest. Use parseAdContent
 * for input.
 */
export function coerceAdContent(value: unknown): AdContent {
  const whole = adContentSchema.safeParse(value ?? {});
  if (whole.success) return toAdContent(whole.data);

  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const campaign = adCampaignSchema.safeParse(record.campaign ?? {});
  const seen = new Set<string>();
  const variants: Array<z.output<typeof adVariantSchema>> = [];
  for (const raw of Array.isArray(record.variants) ? record.variants : []) {
    const parsed = adVariantSchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id) || variants.length >= AD_LIMITS.variants) continue;
    seen.add(parsed.data.id);
    variants.push(parsed.data);
  }
  return toAdContent({
    campaign: campaign.success ? campaign.data : adCampaignSchema.parse({}),
    variants,
  });
}

// ─── Factories ───────────────────────────────────────────────────────────────

/** "A", "B", … "Z", then "AA", "AB"… (spreadsheet-style). */
export function variantLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/** First letter id (from `index` on) not used by another variant. */
export function nextVariantId(existingIds: readonly string[], fromIndex = 0): string {
  const taken = new Set(existingIds.map((id) => id.toUpperCase()));
  for (let i = Math.max(0, fromIndex); ; i++) {
    const id = variantLetter(i);
    if (!taken.has(id)) return id;
  }
}

/**
 * A blank variant. `index` picks the letter ("Variante A" for 0); pass the
 * ids already in the set to skip letters in use, and the campaign platform
 * to preselect its placements.
 */
export function newVariant(
  index: number,
  options: { platform?: AdPlatform; existingIds?: readonly string[] } = {}
): AdVariant {
  const id = nextVariantId(options.existingIds ?? [], index);
  const platform = options.platform ?? "meta";
  return {
    id,
    name: `Variante ${id}`,
    media: [],
    primaryText: "",
    headline: "",
    description: "",
    cta: "",
    destinationUrl: "",
    placements: defaultPlacementsForPlatform(platform),
    ...(platform === "google" ? { google: emptyGoogleAssets() } : {}),
  };
}

/** Copy of a variant with a free id ("Variante C — Prima/dopo (copia)"). */
export function duplicateVariant(variant: AdVariant, existingIds: readonly string[]): AdVariant {
  const id = nextVariantId(existingIds);
  const base = variant.name.trim() || `Variante ${variant.id}`;
  const renamed = base.replace(new RegExp(`^Variante ${escapeRegExp(variant.id)}\\b`), `Variante ${id}`);
  return {
    ...variant,
    id,
    name: `${renamed} (copia)`.slice(0, AD_LIMITS.variantName),
    media: variant.media.map((m) => ({ ...m })),
    placements: [...variant.placements],
    ...(variant.google ? { google: cloneGoogleAssets(variant.google) } : {}),
  };
}

export function emptyAdContent(platform: AdPlatform = "meta"): AdContent {
  return {
    campaign: { name: "", platform, objective: "", budgetNote: "", audienceNote: "" },
    variants: [newVariant(0, { platform })],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Variante A — Prima/dopo", or "Variante A" when unnamed. */
export function variantDisplayName(variant: Pick<AdVariant, "id" | "name">): string {
  return variant.name.trim() || `Variante ${variant.id}`;
}

// ─── Geometry ────────────────────────────────────────────────────────────────

export function charCount(value: string): number {
  return Array.from(value).length;
}

/** Width / height when both are known and positive, else null. */
export function mediaRatio(media: Pick<MediaItem, "width" | "height">): number | null {
  const { width, height } = media;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return null;
  return width / height;
}

/** True when `actual` is within ±2% of `target`. */
export function ratioMatches(actual: number, target: number, tolerance = RATIO_TOLERANCE): boolean {
  if (!(actual > 0) || !(target > 0)) return false;
  return Math.abs(actual / target - 1) <= tolerance;
}

const NAMED_RATIOS: RatioTarget[] = [
  { ratio: 1, label: "1:1" },
  { ratio: 4 / 5, label: "4:5" },
  { ratio: 9 / 16, label: "9:16" },
  { ratio: 16 / 9, label: "16:9" },
  { ratio: 1.91, label: "1,91:1" },
  { ratio: 2 / 3, label: "2:3" },
  { ratio: 3 / 2, label: "3:2" },
  { ratio: 3 / 4, label: "3:4" },
  { ratio: 4 / 3, label: "4:3" },
];

/** "9:16", "1,91:1" when close to a common ratio, else "1,50:1" (Italian decimals). */
export function formatAspectRatio(ratio: number): string {
  const named = NAMED_RATIOS.find((r) => ratioMatches(ratio, r.ratio));
  if (named) return named.label;
  return `${ratio.toFixed(2).replace(".", ",")}:1`;
}

export type RatioVerdict = { status: AdCheckStatus; actual: string; preferred: string };

/** Ratio against a placement: preferred → ok, accepted range → avviso, else errore. */
export function evaluateRatio(ratio: number, placement: AdPlacement): RatioVerdict {
  const spec = PLACEMENT_SPECS[placement];
  const preferred = spec.preferred.map((r) => r.label).join(" o ");
  const actual = formatAspectRatio(ratio);
  if (spec.preferred.some((r) => ratioMatches(ratio, r.ratio))) return { status: "ok", actual, preferred };
  const { min, max } = spec.accepted;
  const inRange = ratio >= min * (1 - RATIO_TOLERANCE) && ratio <= max * (1 + RATIO_TOLERANCE);
  return { status: inRange ? "warning" : "error", actual, preferred };
}

// ─── Spec checks ─────────────────────────────────────────────────────────────

export type AdVariantField = "media" | "placements" | AdTextField | "cta" | "destinationUrl" | "google";

export interface AdSpecCheck {
  /** Stable key for React lists. */
  id: string;
  status: AdCheckStatus;
  /** Topic: "Formato", "Durata", "Titolo", "CTA", "URL"… */
  label: string;
  /** Italian, readable on its own. */
  message: string;
  /** Null for checks that do not depend on the placement (copy, URL). */
  placement: AdPlacement | null;
  platform: AdPlatform | null;
  field: AdVariantField;
  mediaIndex: number | null;
}

export const UNKNOWN_SIZE_MESSAGE = "dimensioni non note, verifica il formato";

function mediaName(index: number, total: number, item: Pick<MediaItem, "type">): string {
  const kind = item.type === "video" ? "Video" : "Immagine";
  return total > 1 ? `${kind} ${index + 1}` : kind;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Checks of one variant, per placement (format, resolution, duration, media
 * type) and per platform (text lengths, CTA, URL). `platform` is the
 * campaign's: placements of another platform are an error. Every check is
 * returned, ok ones included, so the editor can show a full checklist.
 */
export function adSpecChecks(variant: AdVariant, options: { platform?: AdPlatform } = {}): AdSpecCheck[] {
  const checks: AdSpecCheck[] = [];
  const add = (check: Omit<AdSpecCheck, "id"> & { key: string }) => {
    const { key, ...rest } = check;
    checks.push({ id: key, ...rest });
  };

  const placements = variant.placements.filter(isAdPlacement);
  const media = variant.media;

  if (placements.length === 0) {
    add({
      key: "placements",
      status: "error",
      label: "Posizionamenti",
      message: "Scegli almeno un posizionamento.",
      placement: null,
      platform: options.platform ?? null,
      field: "placements",
      mediaIndex: null,
    });
  }

  // Text-only placements (Google Search) need no media.
  const needsMedia = placements.length === 0 || placements.some((p) => PLACEMENT_SPECS[p].usesMedia);
  if (media.length === 0 && needsMedia) {
    add({
      key: "media:none",
      status: "error",
      label: "Media",
      message: "Aggiungi almeno un'immagine o un video.",
      placement: null,
      platform: options.platform ?? null,
      field: "media",
      mediaIndex: null,
    });
  }

  for (const placement of placements) {
    const spec = PLACEMENT_SPECS[placement];
    const base = { placement, platform: spec.platform, field: "media" as const };

    if (options.platform && spec.platform !== options.platform) {
      add({
        ...base,
        key: `${placement}:platform`,
        status: "error",
        label: "Posizionamento",
        message: `${spec.label} non appartiene a ${AD_PLATFORM_SHORT_LABELS[options.platform]}: toglilo o cambia piattaforma.`,
        field: "placements",
        mediaIndex: null,
      });
    }

    if (placement === "google_search" || placement === "google_pmax") {
      for (const check of googleAssetChecks(variant, placement)) checks.push(check);
    }
    if (!spec.usesMedia) continue;

    if (media.length > spec.maxMedia) {
      add({
        ...base,
        key: `${placement}:count`,
        status: spec.maxMedia === 1 ? "warning" : "error",
        label: "Numero di media",
        message:
          spec.maxMedia === 1
            ? `${spec.label} mostra un solo media: verrà usato il primo.`
            : `${spec.label} accetta al massimo ${spec.maxMedia} media.`,
        mediaIndex: null,
      });
    }

    if (placement === "linkedin_feed" && media.length > 1 && media.some((m) => m.type === "video")) {
      add({
        ...base,
        key: `${placement}:mixed`,
        status: "warning",
        label: "Carosello",
        message: "Il carosello di LinkedIn accetta solo immagini: il video va in un annuncio a parte.",
        mediaIndex: null,
      });
    }

    media.forEach((item, index) => {
      const name = mediaName(index, media.length, item);
      const key = `${placement}:${index}`;

      // Media type.
      if (item.type === "video" && spec.video === "unsupported") {
        add({
          ...base,
          key: `${key}:type`,
          status: "warning",
          label: "Tipo di media",
          message: `${name}: gli annunci display adattivi usano video caricati su YouTube, non questo file.`,
          mediaIndex: index,
        });
      } else if (item.type === "image" && spec.video === "required") {
        add({
          ...base,
          key: `${key}:type`,
          status: "error",
          label: "Tipo di media",
          message: `${name}: ${spec.label} richiede un video.`,
          mediaIndex: index,
        });
      } else if (item.type === "image" && placement === "meta_stories_reels") {
        add({
          ...base,
          key: `${key}:type`,
          status: "warning",
          label: "Tipo di media",
          message: `${name}: va bene nelle Storie, nei Reels serve un video.`,
          mediaIndex: index,
        });
      }

      // Performance Max takes YouTube videos of any shape.
      if (placement === "google_pmax" && item.type === "video") return;

      // Aspect ratio.
      const ratio = mediaRatio(item);
      const preferred = spec.preferred.map((r) => r.label).join(" o ");
      if (ratio === null) {
        add({
          ...base,
          key: `${key}:ratio`,
          status: "warning",
          label: "Formato",
          message: `${name}: ${UNKNOWN_SIZE_MESSAGE} (consigliato ${preferred}).`,
          mediaIndex: index,
        });
      } else {
        const verdict = evaluateRatio(ratio, placement);
        add({
          ...base,
          key: `${key}:ratio`,
          status: verdict.status,
          label: "Formato",
          message:
            verdict.status === "ok"
              ? `${name}: ${verdict.actual}, adatto.`
              : verdict.status === "warning"
                ? `${name}: ${verdict.actual} viene accettato ma ritagliato o con bande; consigliato ${preferred}.`
                : `${name}: ${verdict.actual} non è adatto a ${spec.label}; usa ${preferred}.`,
          mediaIndex: index,
        });

        // Performance Max minimums depend on the format: checked in google-ads.ts.
        const shortSide = Math.min(item.width ?? 0, item.height ?? 0);
        if (placement !== "google_pmax" && shortSide > 0 && shortSide < spec.minShortSide) {
          add({
            ...base,
            key: `${key}:size`,
            status: "warning",
            label: "Risoluzione",
            message: `${name}: ${item.width}×${item.height} px è bassa, almeno ${spec.minShortSide} px sul lato corto (meglio 1080).`,
            mediaIndex: index,
          });
        }
      }

      // Video duration.
      if (item.type === "video" && spec.video !== "unsupported") {
        const duration = durationCheck(placement, item.durationSec);
        if (duration) {
          add({
            ...base,
            key: `${key}:duration`,
            status: duration.status,
            label: "Durata",
            message: `${name}: ${duration.message}`,
            mediaIndex: index,
          });
        }
      }
    });
  }

  // Copy, CTA and URL: once per platform among the placements.
  const platforms = [...new Set(placements.map((p) => PLACEMENT_SPECS[p].platform))];
  if (platforms.length === 0) platforms.push(options.platform ?? "meta");

  for (const platform of platforms) {
    const own = placements.filter((p) => PLACEMENT_SPECS[p].platform === platform);
    // Google: these three fields are the Display ad's; Search and PMax use the Google assets.
    const textFields = platform === "google" && own.length > 0 && !own.includes("google_display") ? [] : (["primaryText", "headline", "description"] as const);
    const specs = AD_TEXT_SPECS[platform];
    for (const field of textFields) {
      const spec = specs[field];
      if (!spec) continue;
      const result = textCheck(variant[field], spec);
      if (!result) continue;
      add({
        key: `${platform}:${field}`,
        status: result.status,
        label: spec.label,
        message: result.message,
        placement: null,
        platform,
        field,
        mediaIndex: null,
      });
    }

    const ctaMode = own.length === 0 || own.some((p) => PLACEMENT_SPECS[p].cta === "required")
      ? "required"
      : own.some((p) => PLACEMENT_SPECS[p].cta === "optional")
        ? "optional"
        : "none";
    if (ctaMode === "none") continue;
    const cta = variant.cta.trim();
    const suggestions = CTA_SUGGESTIONS[platform];
    if (!cta && ctaMode === "optional") {
      add({
        key: `${platform}:cta`,
        status: "ok",
        label: "CTA",
        message: "Nessun pulsante scelto: lo sceglie Google in automatico.",
        placement: null,
        platform,
        field: "cta",
        mediaIndex: null,
      });
      continue;
    }
    add({
      key: `${platform}:cta`,
      status: !cta ? "error" : suggestionMatch(cta, suggestions) ? "ok" : "warning",
      label: "CTA",
      message: !cta
        ? "Scegli una call to action (es. «Scopri di più»)."
        : suggestionMatch(cta, suggestions)
          ? `«${cta}» è una CTA disponibile su ${AD_PLATFORM_SHORT_LABELS[platform]}.`
          : `«${cta}» non è tra le CTA standard di ${AD_PLATFORM_SHORT_LABELS[platform]}: verifica che sia disponibile.`,
      placement: null,
      platform,
      field: "cta",
      mediaIndex: null,
    });
  }

  const url = checkDestinationUrl(variant.destinationUrl);
  add({
    key: "url",
    status: url.status,
    label: "URL",
    message: url.message,
    placement: null,
    platform: platforms.length === 1 ? platforms[0] : null,
    field: "destinationUrl",
    mediaIndex: null,
  });

  return checks;
}

function suggestionMatch(cta: string, suggestions: readonly string[]): boolean {
  const normalized = cta.trim().toLocaleLowerCase("it-IT");
  return suggestions.some((s) => s.toLocaleLowerCase("it-IT") === normalized);
}

function textCheck(value: string, spec: TextSpec): { status: AdCheckStatus; message: string } | null {
  const length = charCount(value.trim());
  if (length === 0) {
    return spec.required ? { status: "error", message: `Inserisci: ${spec.label.toLocaleLowerCase("it-IT")}.` } : null;
  }
  if (spec.max !== undefined && length > spec.max) {
    return { status: "error", message: `${length} caratteri, al massimo ${spec.max}.` };
  }
  if (spec.recommended !== undefined && length > spec.recommended) {
    return {
      status: "warning",
      message: `${length} caratteri: oltre i ${spec.recommended} consigliati il testo viene troncato.`,
    };
  }
  const limit = spec.recommended ?? spec.max;
  return { status: "ok", message: limit ? `${length}/${limit} caratteri.` : `${length} caratteri.` };
}

function durationCheck(
  placement: AdPlacement,
  durationSec: number | undefined
): { status: AdCheckStatus; message: string } | null {
  const known = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0;
  const seconds = known ? Math.round(durationSec * 10) / 10 : 0;
  const shown = `${String(seconds).replace(".", ",")} s`;
  switch (placement) {
    case "meta_stories_reels":
      if (!known) return { status: "warning", message: "durata non nota: nei Reels resta entro 90 s." };
      return seconds <= 90
        ? { status: "ok", message: `${shown}, entro i 90 s dei Reels.` }
        : { status: "warning", message: `${shown}: nei Reels resta entro 90 s (le Storie lo dividono in parti).` };
    case "tiktok_in_feed":
      if (!known) return { status: "warning", message: "durata non nota: su TikTok sono consigliati 5–60 s." };
      if (seconds > 600) return { status: "error", message: `${shown}: TikTok accetta al massimo 10 minuti.` };
      return seconds >= 5 && seconds <= 60
        ? { status: "ok", message: `${shown}, nei 5–60 s consigliati.` }
        : { status: "warning", message: `${shown}: su TikTok sono consigliati 5–60 s.` };
    case "linkedin_feed":
      if (!known) return { status: "warning", message: "durata non nota: LinkedIn accetta 3 s – 30 min." };
      return seconds >= 3 && seconds <= 1800
        ? { status: "ok", message: `${shown}, accettato da LinkedIn.` }
        : { status: "error", message: `${shown}: LinkedIn accetta video da 3 s a 30 minuti.` };
    case "meta_feed":
      if (!known) return null;
      return seconds <= 241 * 60
        ? { status: "ok", message: `${shown}.` }
        : { status: "error", message: `${shown}: nel feed il video può durare al massimo 241 minuti.` };
    default:
      return null;
  }
}

/** Destination URL: present, valid, https. */
export function checkDestinationUrl(value: string): { status: AdCheckStatus; message: string } {
  const raw = value.trim();
  if (!raw) return { status: "error", message: "Inserisci l'URL di destinazione." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { status: "error", message: "URL non valido: scrivilo completo, es. https://www.esempio.it/offerta." };
  }
  if (url.protocol !== "https:") {
    return { status: "error", message: "L'URL deve iniziare con https://." };
  }
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) {
    return { status: "error", message: "Il dominio dell'URL non è valido." };
  }
  return { status: "ok", message: `Porta a ${url.hostname}.` };
}

export interface AdCheckSummary {
  errors: number;
  warnings: number;
  ok: number;
  worst: AdCheckStatus;
}

export function summarizeChecks(checks: readonly Pick<AdSpecCheck, "status">[]): AdCheckSummary {
  const errors = checks.filter((c) => c.status === "error").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  return {
    errors,
    warnings,
    ok: checks.length - errors - warnings,
    worst: errors > 0 ? "error" : warnings > 0 ? "warning" : "ok",
  };
}

/** "2 errori, 1 avviso" / "Tutto in regola". */
export function describeSummary(summary: AdCheckSummary): string {
  const parts: string[] = [];
  if (summary.errors) parts.push(`${summary.errors} ${plural(summary.errors, "errore", "errori")}`);
  if (summary.warnings) parts.push(`${summary.warnings} ${plural(summary.warnings, "avviso", "avvisi")}`);
  return parts.length ? parts.join(", ") : "Tutto in regola";
}

// ─── Review validation ───────────────────────────────────────────────────────

export interface AdValidationIssue {
  /** Null for campaign-level issues. */
  variantId: string | null;
  field: AdVariantField | "campaign" | "variants";
  message: string;
}

/**
 * What blocks sending a set to the client (Italian messages, empty = ready):
 * campaign name, at least one variant, and every "errore" of adSpecChecks.
 * Warnings never block.
 */
export function validateAdsForReview(content: AdContent): AdValidationIssue[] {
  const issues: AdValidationIssue[] = [];
  if (!content.campaign.name.trim()) {
    issues.push({ variantId: null, field: "campaign", message: "Inserisci il nome della campagna." });
  }
  if (content.variants.length === 0) {
    issues.push({ variantId: null, field: "variants", message: "Aggiungi almeno una variante." });
  }
  const ids = new Set<string>();
  for (const variant of content.variants) {
    if (ids.has(variant.id)) {
      issues.push({ variantId: variant.id, field: "variants", message: "Due varianti hanno lo stesso identificativo." });
    }
    ids.add(variant.id);
    const name = variantDisplayName(variant);
    for (const check of adSpecChecks(variant, { platform: content.campaign.platform })) {
      if (check.status !== "error") continue;
      const where = check.placement ? ` · ${PLACEMENT_SPECS[check.placement].label}` : "";
      const topic = check.placement || check.field === "media" ? "" : `${check.label}: `;
      issues.push({ variantId: variant.id, field: check.field, message: `${name}${where}: ${topic}${check.message}` });
    }
  }
  return issues;
}

/** Throws the first review issue as a ValidationError (services). */
export function assertAdsReadyForReview(content: AdContent): void {
  const [first] = validateAdsForReview(content);
  if (first) throw new ValidationError(first.message);
}

// ─── Export package (pure builders) ──────────────────────────────────────────

/**
 * A safe, readable file-name segment: accents dropped, lowercase ASCII
 * letters/digits separated by dashes, capped. Never empty, never a dot name.
 */
export function sanitizeFileSegment(value: string, fallback: string, maxLength = 40): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  if (cleaned) return cleaned;
  return fallback === value ? "file" : sanitizeFileSegment(fallback, "file", maxLength);
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** File extension of a media from its MIME type (or URL), never trusting odd values. */
export function extensionForMedia(item: Pick<MediaItem, "mimeType" | "url" | "type">): string {
  const byMime = EXTENSIONS[item.mimeType.toLowerCase()];
  if (byMime) return byMime;
  const match = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(item.url);
  const ext = match?.[1]?.toLowerCase();
  if (ext && Object.values(EXTENSIONS).includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return item.type === "video" ? "mp4" : "jpg";
}

/** Placements a media suits best: those whose ratio check is ok, else all of the variant's. */
export function placementsForMedia(variant: Pick<AdVariant, "placements">, item: MediaItem): AdPlacement[] {
  const placements = variant.placements.filter((p) => isAdPlacement(p) && PLACEMENT_SPECS[p].usesMedia);
  const ratio = mediaRatio(item);
  if (ratio === null) return placements;
  const fitting = placements.filter((p) => evaluateRatio(ratio, p).status === "ok");
  return fitting.length > 0 ? fitting : placements;
}

export interface PlannedExportFile {
  variantId: string;
  mediaIndex: number;
  media: MediaItem;
  /** "<cliente>_<campagna>_<variante>_<posizionamento>[_n].<ext>", unique in the package. */
  fileName: string;
}

/**
 * Names of the files of the approved variants in the ZIP:
 * `<cliente>_<campagna>_<variante>_<posizionamenti>.<ext>`, with `_2`, `_3`…
 * for the further media of a variant and a numeric suffix on collisions.
 */
export function planAdExportFiles(input: {
  clientName: string;
  campaignName: string;
  variants: AdVariant[];
}): PlannedExportFile[] {
  const client = sanitizeFileSegment(input.clientName, "cliente", 30);
  const campaign = sanitizeFileSegment(input.campaignName, "campagna", 40);
  const used = new Set<string>();
  const files: PlannedExportFile[] = [];

  for (const variant of input.variants) {
    const variantSlug = sanitizeFileSegment(variant.id, "variante", 32);
    variant.media.forEach((media, mediaIndex) => {
      const placements = placementsForMedia(variant, media).map((p) => PLACEMENT_SPECS[p].fileSlug);
      const placementSlug = placements.length > 0 ? placements.join("-") : "media";
      const counter = variant.media.length > 1 ? `_${mediaIndex + 1}` : "";
      const ext = extensionForMedia(media);
      const stem = `${client}_${campaign}_${variantSlug}_${placementSlug}${counter}`;
      let fileName = `${stem}.${ext}`;
      for (let n = 2; used.has(fileName.toLowerCase()); n++) fileName = `${stem}-${n}.${ext}`;
      used.add(fileName.toLowerCase());
      files.push({ variantId: variant.id, mediaIndex, media, fileName });
    });
  }
  return files;
}

/**
 * One CSV cell: quoted when it contains the separator, quotes or line
 * breaks. Cells that a spreadsheet would run as a formula (=, +, -, @, tab,
 * CR at the start) get a leading apostrophe; README.txt carries the copy
 * verbatim for pasting.
 */
export function csvCell(value: string, separator = ";"): string {
  let cell = value.replace(/\r\n?/g, "\n");
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  const needsQuotes = cell.includes(separator) || /["\n]/.test(cell) || /^\s|\s$/.test(cell);
  return needsQuotes ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export const CSV_BOM = "﻿";

/**
 * copy.csv of the approved variants: UTF-8 with BOM and ";" separators, so
 * Excel with Italian settings opens it in columns with accents intact;
 * CRLF rows as RFC 4180 asks.
 */
export function buildAdsCopyCsv(variants: AdVariant[], files: readonly PlannedExportFile[] = []): string {
  const header = [
    "Variante",
    "Nome",
    "Testo principale",
    "Titolo",
    "Descrizione",
    "CTA",
    "URL",
    "Posizionamenti",
    "File",
  ];
  const rows = variants.map((v) => [
    v.id,
    variantDisplayName(v),
    v.primaryText,
    v.headline,
    v.description,
    v.cta,
    v.destinationUrl,
    v.placements.map((p) => AD_PLACEMENT_LABELS[p]).join(", "),
    files
      .filter((f) => f.variantId === v.id)
      .map((f) => f.fileName)
      .join(", "),
  ]);
  // Google Ads columns only when a variant has Google assets: other sets keep their columns.
  if (variants.some((v) => hasGoogleAssets(v.google))) {
    header.push(
      "Titoli Google",
      "Titoli lunghi",
      "Descrizioni Google",
      "Nome attività",
      "URL visualizzato",
      "Parole chiave",
      "Parole chiave escluse"
    );
    variants.forEach((v, i) => {
      const g = googleAssetsOf(v);
      rows[i].push(
        filled(g.headlines).join(" | "),
        filled(g.longHeadlines).join(" | "),
        filled(g.descriptions).join(" | "),
        g.businessName,
        hasGoogleAssets(v.google) ? (googleDisplayUrl(v.destinationUrl, g) ?? "") : "",
        g.keywords.map(formatKeyword).join(" | "),
        g.negativeKeywords.join(" | ")
      );
    });
  }
  return CSV_BOM + [header, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(";")).join("\r\n") + "\r\n";
}

export interface ReadmeDecision extends VariantDecision {
  reviewerName?: string | null;
  decidedAt?: Date | null;
}

export interface AdsReadmeInput {
  clientName: string;
  campaign: AdCampaign;
  versionNumber: number;
  approvedAt: Date | null;
  generatedAt: Date;
  timeZone: string;
  /** Every variant of the version (decided or not). */
  variants: AdVariant[];
  decisions: ReadmeDecision[];
  files: ReadonlyArray<Pick<PlannedExportFile, "variantId" | "fileName">>;
  /** Media not stored by the app: listed as links, not downloaded. */
  externalMedia: Array<{ variantId: string; mediaIndex: number; url: string }>;
  /** Uploaded media whose file is no longer on disk. */
  missingMedia: Array<{ variantId: string; mediaIndex: number; fileName: string }>;
  /** Google Ads Editor files in the package (buildGoogleExportFiles). */
  googleFiles?: ReadonlyArray<Pick<GoogleExportFile, "fileName" | "description">>;
}

function formatReadmeDate(date: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("it-IT", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("it-IT", { ...options, timeZone: "Europe/Rome" }).format(date);
  }
}

/** README.txt: campaign, the client's decision and note on every variant, files and copy. */
export function buildAdsReadme(input: AdsReadmeInput): string {
  const lines: string[] = [];
  const { campaign } = input;
  const decisionOf = new Map(input.decisions.map((d) => [d.variantId, d]));
  const approved = input.variants.filter((v) => decisionOf.get(v.id)?.verdict === "APPROVED");

  lines.push("CREATIVITÀ APPROVATE — Approve by Heili", "");
  lines.push(`Cliente: ${input.clientName}`);
  lines.push(`Campagna: ${campaign.name || "(senza nome)"}`);
  lines.push(`Piattaforma: ${AD_PLATFORM_LABELS[campaign.platform]}`);
  if (campaign.objective) lines.push(`Obiettivo: ${campaign.objective}`);
  if (campaign.budgetNote) lines.push(`Budget: ${campaign.budgetNote}`);
  if (campaign.audienceNote) lines.push(`Pubblico: ${campaign.audienceNote}`);
  lines.push(`Versione: ${input.versionNumber}`);
  if (input.approvedAt) lines.push(`Approvata il: ${formatReadmeDate(input.approvedAt, input.timeZone)}`);
  lines.push(`Pacchetto generato il: ${formatReadmeDate(input.generatedAt, input.timeZone)}`, "");

  lines.push("DECISIONI DEL CLIENTE", "");
  for (const variant of input.variants) {
    const decision = decisionOf.get(variant.id);
    const verdict = !decision ? "senza decisione" : decision.verdict === "APPROVED" ? "APPROVATA" : "SCARTATA";
    const by = decision?.reviewerName ? ` da ${decision.reviewerName}` : "";
    const when = decision?.decidedAt ? ` il ${formatReadmeDate(decision.decidedAt, input.timeZone)}` : "";
    lines.push(`- ${variantDisplayName(variant)}: ${verdict}${decision ? `${by}${when}` : ""}`);
    if (decision?.note) lines.push(...indent(`Nota del cliente: ${decision.note}`));
  }
  lines.push("");

  lines.push("FILE INCLUSI", "");
  if (input.files.length === 0) lines.push("(nessun file caricato nell'app)");
  for (const file of input.files) lines.push(`- ${file.fileName}`);
  lines.push("- copy.csv (testi delle varianti approvate)");
  for (const file of input.googleFiles ?? []) lines.push(`- ${file.fileName} (${file.description})`);
  lines.push("");

  if (input.externalMedia.length > 0) {
    lines.push("MEDIA ESTERNI (non inclusi, scaricali da questi link)", "");
    for (const m of input.externalMedia) {
      const variant = input.variants.find((v) => v.id === m.variantId);
      lines.push(`- ${variant ? variantDisplayName(variant) : m.variantId}, media ${m.mediaIndex + 1}: ${m.url}`);
    }
    lines.push("");
  }

  if (input.missingMedia.length > 0) {
    lines.push("MEDIA NON TROVATI (ricaricali nell'app)", "");
    for (const m of input.missingMedia) {
      const variant = input.variants.find((v) => v.id === m.variantId);
      lines.push(`- ${variant ? variantDisplayName(variant) : m.variantId}, media ${m.mediaIndex + 1} (${m.fileName})`);
    }
    lines.push("");
  }

  lines.push("TESTI DELLE VARIANTI APPROVATE", "");
  for (const variant of approved) {
    const specs = AD_TEXT_SPECS[campaign.platform];
    lines.push(`== ${variantDisplayName(variant)} ==`);
    lines.push(`Posizionamenti: ${variant.placements.map((p) => AD_PLACEMENT_LABELS[p]).join(", ") || "-"}`);
    lines.push(`${specs.primaryText?.label ?? "Testo principale"}:`, ...indent(variant.primaryText || "-"));
    lines.push(`${specs.headline?.label ?? "Titolo"}: ${variant.headline || "-"}`);
    lines.push(`${specs.description?.label ?? "Descrizione"}: ${variant.description || "-"}`);
    lines.push(`CTA: ${variant.cta || "-"}`);
    lines.push(`URL: ${variant.destinationUrl || "-"}`);
    if (hasGoogleAssets(variant.google)) lines.push(...googleReadmeLines(variant));
    lines.push("");
  }

  return lines.join("\r\n");
}

/** The Google Ads assets of a variant, numbered, for README.txt. */
function googleReadmeLines(variant: AdVariant): string[] {
  const g = googleAssetsOf(variant);
  const lines: string[] = ["Google Ads:"];
  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`  ${title} (${items.length}):`);
    items.forEach((item, i) => lines.push(`    ${i + 1}. ${item}`));
  };
  list("Titoli", filled(g.headlines));
  list("Titoli lunghi", filled(g.longHeadlines));
  list("Descrizioni", filled(g.descriptions));
  if (g.businessName.trim()) lines.push(`  Nome attività: ${g.businessName.trim()}`);
  const shown = googleDisplayUrl(variant.destinationUrl, g);
  if (shown && (g.path1.trim() || g.path2.trim())) lines.push(`  URL visualizzato: ${shown}`);
  list(
    "Parole chiave",
    g.keywords.map((k) => `${formatKeyword(k)} (${GOOGLE_MATCH_LABELS[k.match]})`)
  );
  list("Parole chiave escluse", g.negativeKeywords);
  if (g.logos.length > 0) lines.push(`  Loghi: ${g.logos.length} (${g.logos.map((l) => l.url).join(", ")})`);
  return lines;
}

/** The Google Ads Editor CSVs of the approved variants (empty for other sets). */
export function adsGoogleExportFiles(campaign: Pick<AdCampaign, "name">, approvedVariants: AdVariant[]): GoogleExportFile[] {
  return buildGoogleExportFiles(campaign.name, approvedVariants);
}

function indent(text: string): string[] {
  return text.split(/\r\n?|\n/).map((line) => `  ${line}`);
}

/** Download name of the package: "<cliente>_<campagna>_creativita-approvate.zip". */
export function adExportZipName(clientName: string, campaignName: string): string {
  return `${sanitizeFileSegment(clientName, "cliente", 30)}_${sanitizeFileSegment(campaignName, "campagna", 40)}_creativita-approvate.zip`;
}
