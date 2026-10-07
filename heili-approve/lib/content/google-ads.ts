/**
 * Google Ads assets of an ad creative (AdVariant.google): Search responsive
 * ads (RSA, placement "google_search") and Performance Max asset groups
 * (placement "google_pmax"). Schema, keyword syntax, the asset spec checks,
 * the rotation of combinations shown in the previews, and the Google Ads
 * Editor CSV builders of the export.
 *
 * Pure and isomorphic, no I/O. Imports from ./ads only types (ads.ts imports
 * this module at load time, so a runtime import back would be a cycle).
 *
 * Specs (Google Ads Help, checked October 2026; they guide the agency, Google
 * still validates at upload):
 * - Responsive search ads, "About responsive search ads" / "Create effective
 *   Search ads": 3–15 headlines ≤ 30 characters, 2–4 descriptions ≤ 90,
 *   two display-URL paths ≤ 15 each (path 2 needs path 1), final URL.
 *   Headlines and descriptions must be unique.
 * - Performance Max, "Asset requirements for Performance Max campaigns":
 *   3–15 headlines ≤ 30 (at least one ≤ 15 recommended), 1–5 long headlines
 *   ≤ 90, 2–5 descriptions ≤ 90 (at least one ≤ 60), business name ≤ 25;
 *   images: landscape 1.91:1 (min 600×314, required), square 1:1 (min
 *   300×300, required), portrait 4:5 (min 480×600, optional), up to 20;
 *   logos: square 1:1 (min 128×128) and optional landscape 4:1 (min
 *   512×128), up to 5; videos optional (YouTube, ≥ 10 s): without one Google
 *   may generate a video from the images and texts.
 * - Keywords, "About keyword matching options" / "Keyword limits": broad
 *   `parola`, phrase `"parola"`, exact `[parola]`; at most 80 characters and
 *   10 words; some symbols (! @ % , * …) are not allowed.
 * Character counts are code points (Google counts CJK as 2: irrelevant for
 * Italian copy).
 */

import { z } from "zod";
import type { MediaItem } from "@/lib/domain";
import type { AdPlacement, AdSpecCheck, AdVariant } from "./ads";
import {
  GOOGLE_MATCH_TYPES,
  type AdGoogleAssets,
  type GoogleKeyword,
  type GoogleMatchType,
} from "./types";

export type { AdGoogleAssets, GoogleKeyword, GoogleMatchType } from "./types";
export { GOOGLE_MATCH_TYPES } from "./types";

// ─── Specs ───────────────────────────────────────────────────────────────────

export interface AssetListSpec {
  min: number;
  max: number;
  /** Characters per item. */
  chars: number;
  /** At least one item this short is recommended (PMax), else "avviso". */
  short?: number;
}

export const GOOGLE_SPECS = {
  search: {
    headlines: { min: 3, max: 15, chars: 30 },
    descriptions: { min: 2, max: 4, chars: 90 },
    pathChars: 15,
  },
  pmax: {
    headlines: { min: 3, max: 15, chars: 30, short: 15 },
    longHeadlines: { min: 1, max: 5, chars: 90 },
    descriptions: { min: 2, max: 5, chars: 90, short: 60 },
    businessNameChars: 25,
    pathChars: 15,
    maxImages: 20,
    maxLogos: 5,
    minVideoSec: 10,
  },
  keyword: { chars: 80, words: 10 },
} as const satisfies Record<string, unknown>;

export type PmaxImageKind = "landscape" | "square" | "portrait";
export type PmaxLogoKind = "square" | "landscape";

interface SizedRatio {
  ratio: number;
  label: string;
  minWidth: number;
  minHeight: number;
  name: string;
}

export const PMAX_IMAGE_SPECS: Record<PmaxImageKind, SizedRatio & { required: boolean }> = {
  landscape: { ratio: 1.91, label: "1,91:1", minWidth: 600, minHeight: 314, name: "orizzontale", required: true },
  square: { ratio: 1, label: "1:1", minWidth: 300, minHeight: 300, name: "quadrata", required: true },
  portrait: { ratio: 4 / 5, label: "4:5", minWidth: 480, minHeight: 600, name: "verticale", required: false },
};

export const PMAX_LOGO_SPECS: Record<PmaxLogoKind, SizedRatio & { required: boolean }> = {
  square: { ratio: 1, label: "1:1", minWidth: 128, minHeight: 128, name: "quadrato", required: true },
  landscape: { ratio: 4, label: "4:1", minWidth: 512, minHeight: 128, name: "orizzontale", required: false },
};

/** Lenient storage caps (drafts are saved half-written; the spec checks say what Google accepts). */
export const GOOGLE_STORAGE_LIMITS = {
  items: 30,
  itemChars: 300,
  keywords: 300,
  keywordChars: 200,
  negativeKeywords: 300,
  shortText: 100,
  logos: 5,
} as const;

export const GOOGLE_MATCH_LABELS: Record<GoogleMatchType, string> = {
  broad: "generica",
  phrase: "a frase",
  exact: "esatta",
};

/** Google Ads Editor "Criterion Type" values. */
const MATCH_EDITOR_LABELS: Record<GoogleMatchType, string> = {
  broad: "Broad",
  phrase: "Phrase",
  exact: "Exact",
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
  .max(2048)
  .refine((value) => isHttpUrl(value), "URL del media non valido");

const logoSchema = z.object({
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

/** Items keep their place (an empty row being typed stays); only line breaks and outer spaces go. */
const assetText = z
  .string()
  .max(GOOGLE_STORAGE_LIMITS.itemChars, "Testo Google troppo lungo")
  .transform((value) => value.replace(/[\r\n]+/g, " ").replace(/^\s+|\s+$/g, ""));

const assetList = (label: string) =>
  z
    .array(assetText)
    .max(GOOGLE_STORAGE_LIMITS.items, `Troppi elementi in «${label}»`)
    .default([]);

const keywordObject = z.object({
  text: z
    .string()
    .max(GOOGLE_STORAGE_LIMITS.keywordChars, "Parola chiave troppo lunga")
    .transform((value) => value.replace(/\s+/g, " ").trim()),
  match: z.enum(GOOGLE_MATCH_TYPES, { error: "Corrispondenza non valida" }).default("broad"),
});

/** A keyword object, or a line with match-type syntax (`"parola"`, `[parola]`). */
const keywordSchema = z.preprocess(
  (value) => (typeof value === "string" ? (parseKeywordLine(value) ?? { text: "" }) : value),
  keywordObject
);

const shortText = (message: string) =>
  z
    .string()
    .max(GOOGLE_STORAGE_LIMITS.shortText, message)
    .default("")
    .transform((value) => value.trim());

export const googleAssetsSchema = z.object({
  headlines: assetList("Titoli"),
  longHeadlines: assetList("Titoli lunghi"),
  descriptions: assetList("Descrizioni"),
  businessName: shortText("Nome dell'attività troppo lungo"),
  path1: shortText("Percorso 1 troppo lungo"),
  path2: shortText("Percorso 2 troppo lungo"),
  keywords: z
    .array(keywordSchema)
    .max(GOOGLE_STORAGE_LIMITS.keywords, `Al massimo ${GOOGLE_STORAGE_LIMITS.keywords} parole chiave`)
    .default([])
    .transform((list) => list.filter((k) => k.text !== "")),
  negativeKeywords: z
    .array(z.string().max(GOOGLE_STORAGE_LIMITS.keywordChars, "Parola chiave esclusa troppo lunga"))
    .max(GOOGLE_STORAGE_LIMITS.negativeKeywords, `Al massimo ${GOOGLE_STORAGE_LIMITS.negativeKeywords} parole escluse`)
    .default([])
    .transform((list) => list.map((k) => k.replace(/\s+/g, " ").trim()).filter(Boolean)),
  logos: z
    .array(logoSchema)
    .max(GOOGLE_STORAGE_LIMITS.logos, `Al massimo ${GOOGLE_STORAGE_LIMITS.logos} loghi`)
    .default([]),
});

export function emptyGoogleAssets(): AdGoogleAssets {
  return {
    headlines: [],
    longHeadlines: [],
    descriptions: [],
    businessName: "",
    path1: "",
    path2: "",
    keywords: [],
    negativeKeywords: [],
    logos: [],
  };
}

/** The variant's Google assets, or empty ones (older sets have none). */
export function googleAssetsOf(variant: Pick<AdVariant, "google">): AdGoogleAssets {
  return variant.google ?? emptyGoogleAssets();
}

/** True when any Google text, keyword or logo was filled in. */
export function hasGoogleAssets(assets: AdGoogleAssets | undefined): boolean {
  if (!assets) return false;
  return (
    filled(assets.headlines).length > 0 ||
    filled(assets.longHeadlines).length > 0 ||
    filled(assets.descriptions).length > 0 ||
    assets.businessName.trim() !== "" ||
    assets.path1.trim() !== "" ||
    assets.path2.trim() !== "" ||
    assets.keywords.length > 0 ||
    assets.negativeKeywords.length > 0 ||
    assets.logos.length > 0
  );
}

/** Non-empty items, trimmed, in order. */
export function filled(list: readonly string[]): string[] {
  return list.map((item) => item.trim()).filter(Boolean);
}

export function cloneGoogleAssets(assets: AdGoogleAssets): AdGoogleAssets {
  return {
    ...assets,
    headlines: [...assets.headlines],
    longHeadlines: [...assets.longHeadlines],
    descriptions: [...assets.descriptions],
    keywords: assets.keywords.map((k) => ({ ...k })),
    negativeKeywords: [...assets.negativeKeywords],
    logos: assets.logos.map((m) => ({ ...m })),
  };
}

// ─── Keywords ────────────────────────────────────────────────────────────────

const PHRASE_QUOTES = /^["“”«»„](.*)["“”«»„]$/u;

/**
 * One keyword line with Google's syntax: `parola` → generica, `"parola"` →
 * a frase, `[parola]` → esatta. The retired broad match modifier (+parola)
 * is dropped. Null for an empty line.
 */
export function parseKeywordLine(line: string): GoogleKeyword | null {
  let text = line.replace(/\s+/g, " ").trim();
  if (!text) return null;
  let match: GoogleMatchType = "broad";
  const exact = /^\[(.*)\]$/u.exec(text);
  const phrase = PHRASE_QUOTES.exec(text);
  if (exact) {
    match = "exact";
    text = exact[1];
  } else if (phrase) {
    match = "phrase";
    text = phrase[1];
  } else {
    text = text.replace(/(^|\s)\+(?=\S)/g, "$1");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text ? { text, match } : null;
}

/** A pasted list: one keyword per line (commas also split, Google does not allow them in keywords). */
export function parseKeywordList(input: string): GoogleKeyword[] {
  return input
    .split(/[\r\n,]+/)
    .map(parseKeywordLine)
    .filter((k): k is GoogleKeyword => k !== null);
}

/** `parola`, `"parola"` or `[parola]`. */
export function formatKeyword(keyword: GoogleKeyword): string {
  if (keyword.match === "exact") return `[${keyword.text}]`;
  if (keyword.match === "phrase") return `"${keyword.text}"`;
  return keyword.text;
}

/** For duplicate detection: lowercase, single spaces. */
export function normalizeAssetText(value: string): string {
  return value.toLocaleLowerCase("it-IT").replace(/\s+/g, " ").trim();
}

/** Adds keywords to a list, skipping exact duplicates (same text and match type). */
export function mergeKeywords(current: readonly GoogleKeyword[], added: readonly GoogleKeyword[]): GoogleKeyword[] {
  const seen = new Set(current.map((k) => `${k.match}:${normalizeAssetText(k.text)}`));
  const next = [...current];
  for (const keyword of added) {
    const key = `${keyword.match}:${normalizeAssetText(keyword.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(keyword);
  }
  return next;
}

const INVALID_KEYWORD_CHARS = /[!@%^*=;~`<>?\\|{},]/u;

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function charCount(value: string): number {
  return Array.from(value).length;
}

// ─── Display URL and combinations ────────────────────────────────────────────

/** "palestrakinetik.it/prova/gratis" from the final URL and the two paths. */
export function googleDisplayUrl(finalUrl: string, assets: Pick<AdGoogleAssets, "path1" | "path2">): string | null {
  let host: string;
  try {
    host = new URL(finalUrl.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!host) return null;
  const paths = [assets.path1.trim(), assets.path1.trim() ? assets.path2.trim() : ""].filter(Boolean);
  return [host, ...paths].join("/");
}

export interface GoogleCombination {
  headlines: string[];
  descriptions: string[];
  longHeadline: string | null;
}

/**
 * The n-th combination shown in a preview: Google picks and orders the
 * assets on its own, here they simply rotate so the client sees each one.
 * Headlines never repeat inside one combination.
 */
export function googleCombination(
  assets: Pick<AdGoogleAssets, "headlines" | "descriptions" | "longHeadlines">,
  n: number,
  sizes: { headlines?: number; descriptions?: number } = {}
): GoogleCombination {
  const headlines = filled(assets.headlines);
  const descriptions = filled(assets.descriptions);
  const longs = filled(assets.longHeadlines);
  const step = Math.max(0, Math.floor(n));
  const pick = (list: string[], count: number) => {
    const take = Math.min(count, list.length);
    const start = list.length > 0 ? (step * take) % list.length : 0;
    return Array.from({ length: take }, (_, i) => list[(start + i) % list.length]);
  };
  return {
    headlines: pick(headlines, sizes.headlines ?? 3),
    descriptions: pick(descriptions, sizes.descriptions ?? 2),
    longHeadline: longs.length > 0 ? longs[step % longs.length] : null,
  };
}

/** How many distinct rotations are worth showing (at least 1). */
export function googleCombinationCount(assets: Pick<AdGoogleAssets, "headlines" | "descriptions">): number {
  const h = filled(assets.headlines).length;
  const d = filled(assets.descriptions).length;
  return Math.max(1, Math.ceil(h / 3), Math.ceil(d / 2));
}

// ─── Media classification (PMax) ─────────────────────────────────────────────

const TOLERANCE = 0.02;

function closeTo(actual: number, target: number): boolean {
  return actual > 0 && Math.abs(actual / target - 1) <= TOLERANCE;
}

function ratioOf(media: Pick<MediaItem, "width" | "height">): number | null {
  const { width, height } = media;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return null;
  return width / height;
}

/** Landscape 1.91:1, square 1:1 or portrait 4:5; null when the size is unknown or another ratio. */
export function pmaxImageKind(media: Pick<MediaItem, "width" | "height">): PmaxImageKind | null {
  const ratio = ratioOf(media);
  if (ratio === null) return null;
  for (const kind of ["landscape", "square", "portrait"] as const) {
    if (closeTo(ratio, PMAX_IMAGE_SPECS[kind].ratio)) return kind;
  }
  return null;
}

export function pmaxLogoKind(media: Pick<MediaItem, "width" | "height">): PmaxLogoKind | null {
  const ratio = ratioOf(media);
  if (ratio === null) return null;
  if (closeTo(ratio, 1)) return "square";
  if (closeTo(ratio, 4)) return "landscape";
  return null;
}

/** First image of each PMax format, for the previews. */
export function pmaxImages(media: readonly MediaItem[]): Partial<Record<PmaxImageKind, { item: MediaItem; index: number }>> {
  const found: Partial<Record<PmaxImageKind, { item: MediaItem; index: number }>> = {};
  media.forEach((item, index) => {
    if (item.type !== "image") return;
    const kind = pmaxImageKind(item);
    if (kind && !found[kind]) found[kind] = { item, index };
  });
  return found;
}

// ─── Spec checks ─────────────────────────────────────────────────────────────

type CheckInput = Omit<AdSpecCheck, "id" | "placement" | "platform" | "field" | "mediaIndex"> & {
  key: string;
  mediaIndex?: number | null;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Checks of one asset list: count, length of each item, duplicates, and the
 * recommended short item. `noun` is singular/plural ("titolo"/"titoli").
 */
function listChecks(
  list: readonly string[],
  spec: AssetListSpec,
  names: { one: string; many: string; label: string; key: string },
  push: (check: CheckInput) => void
) {
  const items = list.map((text, index) => ({ text: text.trim(), index })).filter((i) => i.text);
  const count = items.length;
  const { one, many, label, key } = names;

  if (count < spec.min) {
    push({
      key: `${key}:count`,
      status: "error",
      label,
      message:
        count === 0
          ? `${label}: servono almeno ${plural(spec.min, one, many)}.`
          : `${label}: servono almeno ${plural(spec.min, one, many)}, ne hai ${count}.`,
    });
  } else if (count > spec.max) {
    push({
      key: `${key}:count`,
      status: "error",
      label,
      message: `${label}: al massimo ${spec.max}, ne hai ${count}. Togline ${count - spec.max}.`,
    });
  } else {
    push({
      key: `${key}:count`,
      status: "ok",
      label,
      message: `${label}: ${count} su ${spec.max}.`,
    });
  }

  let over = 0;
  for (const item of items) {
    const length = charCount(item.text);
    if (length > spec.chars) {
      over++;
      push({
        key: `${key}:${item.index}:length`,
        status: "error",
        label,
        message: `${capitalize(one)} ${item.index + 1} «${item.text}»: ${length} caratteri, al massimo ${spec.chars}.`,
      });
    }
  }
  if (count > 0 && over === 0) {
    push({
      key: `${key}:length`,
      status: "ok",
      label,
      message: `${label}: tutti entro ${spec.chars} caratteri.`,
    });
  }

  const seen = new Map<string, number>();
  for (const item of items) {
    const norm = normalizeAssetText(item.text);
    const first = seen.get(norm);
    if (first !== undefined) {
      push({
        key: `${key}:${item.index}:duplicate`,
        status: "error",
        label,
        message: `${capitalize(one)} ${item.index + 1} è uguale a ${one} ${first + 1}: Google li vuole tutti diversi.`,
      });
    } else {
      seen.set(norm, item.index);
    }
  }

  if (spec.short && count > 0 && !items.some((i) => charCount(i.text) <= (spec.short ?? 0))) {
    push({
      key: `${key}:short`,
      status: "warning",
      label,
      message: `${label}: aggiungine almeno uno entro ${spec.short} caratteri, per gli spazi più piccoli.`,
    });
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("it-IT") + value.slice(1);
}

function pathChecks(assets: AdGoogleAssets, max: number, finalUrl: string, push: (check: CheckInput) => void) {
  const path1 = assets.path1.trim();
  const path2 = assets.path2.trim();
  let bad = false;
  for (const [n, value] of [
    [1, path1],
    [2, path2],
  ] as const) {
    if (charCount(value) > max) {
      bad = true;
      push({
        key: `paths:${n}`,
        status: "error",
        label: "Percorso URL",
        message: `Percorso ${n} «${value}»: ${charCount(value)} caratteri, al massimo ${max}.`,
      });
    } else if (/[\s/]/.test(value)) {
      bad = true;
      push({
        key: `paths:${n}:chars`,
        status: "error",
        label: "Percorso URL",
        message: `Percorso ${n} «${value}»: niente spazi né barre, usa una parola o le-parole-col-trattino.`,
      });
    }
  }
  if (path2 && !path1) {
    bad = true;
    push({
      key: "paths:order",
      status: "error",
      label: "Percorso URL",
      message: "Percorso URL: compila il percorso 1 prima del percorso 2.",
    });
  }
  if (!bad) {
    const shown = googleDisplayUrl(finalUrl, assets);
    push({
      key: "paths",
      status: "ok",
      label: "Percorso URL",
      message: shown
        ? `URL visualizzato: ${shown}.`
        : path1
          ? "Percorsi validi."
          : "Percorsi facoltativi non usati: si vede solo il dominio.",
    });
  }
}

function keywordChecks(assets: AdGoogleAssets, push: (check: CheckInput) => void) {
  const keywords = assets.keywords.filter((k) => k.text.trim());
  if (keywords.length === 0) {
    push({
      key: "keywords:count",
      status: "error",
      label: "Parole chiave",
      message: "Parole chiave: aggiungine almeno una, senza l'annuncio di ricerca non compare.",
    });
  } else {
    const byMatch = GOOGLE_MATCH_TYPES.map((m) => ({ m, n: keywords.filter((k) => k.match === m).length })).filter(
      (x) => x.n > 0
    );
    push({
      key: "keywords:count",
      status: "ok",
      label: "Parole chiave",
      message: `Parole chiave: ${keywords.length} (${byMatch.map((x) => `${x.n} ${GOOGLE_MATCH_LABELS[x.m]}`).join(", ")}).`,
    });
  }

  const seen = new Set<string>();
  keywords.forEach((keyword, index) => {
    const shown = formatKeyword(keyword);
    if (charCount(keyword.text) > GOOGLE_SPECS.keyword.chars) {
      push({
        key: `keywords:${index}:length`,
        status: "error",
        label: "Parole chiave",
        message: `Parola chiave ${shown}: ${charCount(keyword.text)} caratteri, al massimo ${GOOGLE_SPECS.keyword.chars}.`,
      });
    }
    if (wordCount(keyword.text) > GOOGLE_SPECS.keyword.words) {
      push({
        key: `keywords:${index}:words`,
        status: "error",
        label: "Parole chiave",
        message: `Parola chiave ${shown}: ${wordCount(keyword.text)} parole, al massimo ${GOOGLE_SPECS.keyword.words}.`,
      });
    }
    if (INVALID_KEYWORD_CHARS.test(keyword.text)) {
      push({
        key: `keywords:${index}:chars`,
        status: "error",
        label: "Parole chiave",
        message: `Parola chiave ${shown}: contiene simboli che Google non accetta (! @ % , * ? …).`,
      });
    }
    const id = `${keyword.match}:${normalizeAssetText(keyword.text)}`;
    if (seen.has(id)) {
      push({
        key: `keywords:${index}:duplicate`,
        status: "warning",
        label: "Parole chiave",
        message: `Parola chiave ${shown} (${GOOGLE_MATCH_LABELS[keyword.match]}) è ripetuta: Google la conta una volta sola.`,
      });
    }
    seen.add(id);
  });

  const negatives = assets.negativeKeywords.map((k) => parseKeywordLine(k)).filter((k): k is GoogleKeyword => k !== null);
  const negSeen = new Set<string>();
  const positive = new Set(keywords.map((k) => normalizeAssetText(k.text)));
  negatives.forEach((negative, index) => {
    const norm = normalizeAssetText(negative.text);
    if (negSeen.has(`${negative.match}:${norm}`)) {
      push({
        key: `negatives:${index}:duplicate`,
        status: "warning",
        label: "Parole escluse",
        message: `Parola esclusa ${formatKeyword(negative)} è ripetuta.`,
      });
    }
    negSeen.add(`${negative.match}:${norm}`);
    if (positive.has(norm)) {
      push({
        key: `negatives:${index}:conflict`,
        status: "warning",
        label: "Parole escluse",
        message: `«${negative.text}» è sia parola chiave sia esclusa: per quella ricerca l'annuncio non compare.`,
      });
    }
  });
}

function sizeOk(media: MediaItem, spec: SizedRatio): boolean {
  return (media.width ?? 0) >= spec.minWidth && (media.height ?? 0) >= spec.minHeight;
}

function pmaxMediaChecks(variant: Pick<AdVariant, "media">, assets: AdGoogleAssets, push: (check: CheckInput) => void) {
  const images = variant.media.map((item, index) => ({ item, index })).filter((m) => m.item.type === "image");
  const videos = variant.media.map((item, index) => ({ item, index })).filter((m) => m.item.type === "video");
  const total = variant.media.length;
  const name = (index: number, item: MediaItem) =>
    `${item.type === "video" ? "Video" : "Immagine"}${total > 1 ? ` ${index + 1}` : ""}`;

  const kinds = new Set<PmaxImageKind>();
  // Images of unknown size may be the missing format: then only "avviso".
  const unknown = images.some(({ item }) => ratioOf(item) === null);
  for (const { item, index } of images) {
    const kind = pmaxImageKind(item);
    if (kind === null) {
      // Unknown size or another ratio: the per-placement ratio check reports it.
      continue;
    }
    kinds.add(kind);
    const spec = PMAX_IMAGE_SPECS[kind];
    if (!sizeOk(item, spec)) {
      push({
        key: `pmax:image:${index}:size`,
        status: "error",
        label: "Risoluzione",
        message: `${name(index, item)} (${spec.name} ${spec.label}): ${item.width}×${item.height} px, Google chiede almeno ${spec.minWidth}×${spec.minHeight}.`,
        mediaIndex: index,
      });
    }
  }

  for (const kind of ["landscape", "square"] as const) {
    const spec = PMAX_IMAGE_SPECS[kind];
    push({
      key: `pmax:images:${kind}`,
      status: kinds.has(kind) ? "ok" : unknown ? "warning" : "error",
      label: "Immagini",
      message: kinds.has(kind)
        ? `Immagine ${spec.name} ${spec.label} presente.`
        : unknown
          ? `Immagini: verifica che ci sia un'immagine ${spec.name} ${spec.label}, alcune dimensioni non sono note.`
          : `Immagini: manca un'immagine ${spec.name} ${spec.label} (almeno ${spec.minWidth}×${spec.minHeight}), è obbligatoria.`,
    });
  }
  push({
    key: "pmax:images:portrait",
    status: kinds.has("portrait") ? "ok" : "warning",
    label: "Immagini",
    message: kinds.has("portrait")
      ? "Immagine verticale 4:5 presente."
      : "Immagini: un'immagine verticale 4:5 (almeno 480×600) è facoltativa ma consigliata, per mobile e Discover.",
  });

  if (videos.length === 0) {
    push({
      key: "pmax:video",
      status: "warning",
      label: "Video",
      message:
        "Video: non ce n'è nessuno, quindi Google ne crea uno da solo con immagini e testi. Meglio caricarne uno vostro (almeno 10 s).",
    });
  } else {
    for (const { item, index } of videos) {
      const seconds = item.durationSec;
      push({
        key: `pmax:video:${index}`,
        status: typeof seconds === "number" && seconds < GOOGLE_SPECS.pmax.minVideoSec ? "error" : "ok",
        label: "Video",
        message:
          typeof seconds === "number" && seconds < GOOGLE_SPECS.pmax.minVideoSec
            ? `${name(index, item)}: ${String(Math.round(seconds * 10) / 10).replace(".", ",")} s, Google chiede almeno 10 s.`
            : `${name(index, item)}: va caricato su YouTube e collegato al gruppo di asset.`,
        mediaIndex: index,
      });
    }
  }

  const logos = assets.logos;
  if (logos.length === 0) {
    push({
      key: "pmax:logo",
      status: "warning",
      label: "Logo",
      message:
        "Logo: non c'è. Aggiungi un logo quadrato 1:1 (almeno 128×128), oppure Google userà quello delle linee guida del brand.",
    });
  } else {
    if (logos.length > GOOGLE_SPECS.pmax.maxLogos) {
      push({
        key: "pmax:logo:count",
        status: "error",
        label: "Logo",
        message: `Logo: al massimo ${GOOGLE_SPECS.pmax.maxLogos}, ne hai ${logos.length}.`,
      });
    }
    let square = false;
    let unknownLogo = false;
    logos.forEach((logo, index) => {
      const kind = pmaxLogoKind(logo);
      const n = logos.length > 1 ? ` ${index + 1}` : "";
      if (logo.type !== "image") {
        push({ key: `pmax:logo:${index}:type`, status: "error", label: "Logo", message: `Logo${n}: deve essere un'immagine.` });
        return;
      }
      if (kind === null) {
        if (ratioOf(logo) === null) unknownLogo = true;
        push({
          key: `pmax:logo:${index}:ratio`,
          status: ratioOf(logo) === null ? "warning" : "error",
          label: "Logo",
          message:
            ratioOf(logo) === null
              ? `Logo${n}: dimensioni non note, verifica che sia 1:1 o 4:1.`
              : `Logo${n}: ${logo.width}×${logo.height} px, serve 1:1 (quadrato) o 4:1 (orizzontale).`,
        });
        return;
      }
      if (kind === "square") square = true;
      const spec = PMAX_LOGO_SPECS[kind];
      if (!sizeOk(logo, spec)) {
        push({
          key: `pmax:logo:${index}:size`,
          status: "error",
          label: "Logo",
          message: `Logo${n} ${spec.label}: ${logo.width}×${logo.height} px, almeno ${spec.minWidth}×${spec.minHeight}.`,
        });
      }
    });
    if (square || !unknownLogo) {
      push({
        key: "pmax:logo:square",
        status: square ? "ok" : "error",
        label: "Logo",
        message: square ? "Logo quadrato 1:1 presente." : "Logo: serve almeno un logo quadrato 1:1.",
      });
    }
  }
}

/**
 * Google asset checks of a variant for one placement (google_search or
 * google_pmax), as AdSpecCheck entries of that placement. Messages name
 * their topic: validateAdsForReview shows them without a label.
 */
export function googleAssetChecks(
  variant: Pick<AdVariant, "google" | "media" | "destinationUrl">,
  placement: Extract<AdPlacement, "google_search" | "google_pmax">
): AdSpecCheck[] {
  const assets = googleAssetsOf(variant);
  const checks: AdSpecCheck[] = [];
  const push = (check: CheckInput) => {
    const { key, mediaIndex, ...rest } = check;
    checks.push({
      id: `${placement}:g:${key}`,
      ...rest,
      placement,
      platform: "google",
      field: mediaIndex !== undefined && mediaIndex !== null ? "media" : "google",
      mediaIndex: mediaIndex ?? null,
    });
  };

  if (placement === "google_search") {
    const spec = GOOGLE_SPECS.search;
    listChecks(assets.headlines, spec.headlines, { one: "titolo", many: "titoli", label: "Titoli", key: "headlines" }, push);
    listChecks(
      assets.descriptions,
      spec.descriptions,
      { one: "descrizione", many: "descrizioni", label: "Descrizioni", key: "descriptions" },
      push
    );
    pathChecks(assets, spec.pathChars, variant.destinationUrl, push);
    keywordChecks(assets, push);
    if (variant.media.length > 0) {
      push({
        key: "media:unused",
        status: "warning",
        label: "Media",
        message: "Gli annunci della rete di ricerca sono solo testo: immagini e video qui non vengono usati.",
      });
    }
    return checks;
  }

  const spec = GOOGLE_SPECS.pmax;
  listChecks(assets.headlines, spec.headlines, { one: "titolo", many: "titoli", label: "Titoli", key: "headlines" }, push);
  listChecks(
    assets.longHeadlines,
    spec.longHeadlines,
    { one: "titolo lungo", many: "titoli lunghi", label: "Titoli lunghi", key: "longHeadlines" },
    push
  );
  listChecks(
    assets.descriptions,
    spec.descriptions,
    { one: "descrizione", many: "descrizioni", label: "Descrizioni", key: "descriptions" },
    push
  );
  const business = assets.businessName.trim();
  push({
    key: "businessName",
    status: !business || charCount(business) > spec.businessNameChars ? "error" : "ok",
    label: "Nome attività",
    message: !business
      ? "Nome dell'attività: scrivilo (al massimo 25 caratteri)."
      : charCount(business) > spec.businessNameChars
        ? `Nome dell'attività: ${charCount(business)} caratteri, al massimo ${spec.businessNameChars}.`
        : `Nome dell'attività: ${charCount(business)}/${spec.businessNameChars} caratteri.`,
  });
  if (assets.path1.trim() || assets.path2.trim()) pathChecks(assets, spec.pathChars, variant.destinationUrl, push);
  pmaxMediaChecks(variant, assets, push);
  return checks;
}

// ─── Export (Google Ads Editor CSV) ──────────────────────────────────────────

/**
 * One cell of a Google Ads Editor CSV (comma separated). No apostrophe in
 * front of "-", "+", "=": Ads Editor would import it as part of the text
 * ("-20% sull'abbonamento"). The files carry the agency's own copy and are
 * meant for Ads Editor, not for a spreadsheet.
 */
export function editorCsvCell(value: string): string {
  const cell = value.replace(/\r\n?|\n/g, " ");
  return /[",]|^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

const BOM = "﻿";

function editorCsv(rows: string[][]): string {
  return BOM + rows.map((row) => row.map(editorCsvCell).join(",")).join("\r\n") + "\r\n";
}

function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

function padded(list: readonly string[], count: number): string[] {
  const items = filled(list).slice(0, count);
  return [...items, ...Array.from({ length: count - items.length }, () => "")];
}

type ExportVariant = Pick<AdVariant, "id" | "name" | "placements" | "destinationUrl" | "google" | "cta">;

function adGroupName(variant: Pick<AdVariant, "id" | "name">): string {
  return variant.name.trim() || `Variante ${variant.id}`;
}

/** google-ads-rsa.csv: one responsive search ad per approved Search variant. Null when there is none. */
export function buildGoogleRsaCsv(campaignName: string, variants: readonly ExportVariant[]): string | null {
  const rows = variants.filter((v) => v.placements.includes("google_search"));
  if (rows.length === 0) return null;
  const header = [
    "Campaign",
    "Ad group",
    "Ad type",
    ...numbered("Headline", 15),
    ...numbered("Description", 4),
    "Path 1",
    "Path 2",
    "Final URL",
  ];
  return editorCsv([
    header,
    ...rows.map((v) => {
      const g = googleAssetsOf(v);
      return [
        campaignName,
        adGroupName(v),
        "Responsive search ad",
        ...padded(g.headlines, 15),
        ...padded(g.descriptions, 4),
        g.path1.trim(),
        g.path1.trim() ? g.path2.trim() : "",
        v.destinationUrl.trim(),
      ];
    }),
  ]);
}

/**
 * google-ads-keywords.csv: keywords of the approved Search variants, one row
 * each. "Criterion Type" is how Ads Editor names the match type; negatives
 * are "Negative Broad / Phrase / Exact" of the same ad group.
 */
export function buildGoogleKeywordsCsv(campaignName: string, variants: readonly ExportVariant[]): string | null {
  const rows: string[][] = [];
  for (const v of variants.filter((x) => x.placements.includes("google_search"))) {
    const g = googleAssetsOf(v);
    for (const k of g.keywords) {
      if (k.text.trim()) rows.push([campaignName, adGroupName(v), k.text.trim(), MATCH_EDITOR_LABELS[k.match]]);
    }
    for (const raw of g.negativeKeywords) {
      const k = parseKeywordLine(raw);
      if (k) rows.push([campaignName, adGroupName(v), k.text, `Negative ${MATCH_EDITOR_LABELS[k.match]}`]);
    }
  }
  if (rows.length === 0) return null;
  return editorCsv([["Campaign", "Ad group", "Keyword", "Criterion Type"], ...rows]);
}

/** google-ads-pmax-assets.csv: text assets of each approved Performance Max asset group. */
export function buildGooglePmaxAssetsCsv(campaignName: string, variants: readonly ExportVariant[]): string | null {
  const rows = variants.filter((v) => v.placements.includes("google_pmax"));
  if (rows.length === 0) return null;
  const header = [
    "Campaign",
    "Asset group",
    ...numbered("Headline", 15),
    ...numbered("Long headline", 5),
    ...numbered("Description", 5),
    "Business name",
    "Call to action",
    "Final URL",
    "Path 1",
    "Path 2",
  ];
  return editorCsv([
    header,
    ...rows.map((v) => {
      const g = googleAssetsOf(v);
      return [
        campaignName,
        adGroupName(v),
        ...padded(g.headlines, 15),
        ...padded(g.longHeadlines, 5),
        ...padded(g.descriptions, 5),
        g.businessName.trim(),
        v.cta.trim() || "Automated",
        v.destinationUrl.trim(),
        g.path1.trim(),
        g.path1.trim() ? g.path2.trim() : "",
      ];
    }),
  ]);
}

export interface GoogleExportFile {
  fileName: string;
  /** README line. */
  description: string;
  content: string;
}

/** The Google Ads Editor files of the approved variants (none for a set without Search / PMax). */
export function buildGoogleExportFiles(campaignName: string, variants: readonly ExportVariant[]): GoogleExportFile[] {
  const name = campaignName.trim() || "Campagna";
  const files: GoogleExportFile[] = [];
  const rsa = buildGoogleRsaCsv(name, variants);
  if (rsa) {
    files.push({
      fileName: "google-ads-rsa.csv",
      description: "annunci adattivi della rete di ricerca, da importare in Google Ads Editor",
      content: rsa,
    });
  }
  const keywords = buildGoogleKeywordsCsv(name, variants);
  if (keywords) {
    files.push({
      fileName: "google-ads-keywords.csv",
      description: "parole chiave ed escluse per gruppo di annunci, per Google Ads Editor",
      content: keywords,
    });
  }
  const pmax = buildGooglePmaxAssetsCsv(name, variants);
  if (pmax) {
    files.push({
      fileName: "google-ads-pmax-assets.csv",
      description: "testi dei gruppi di asset Performance Max, per Google Ads Editor",
      content: pmax,
    });
  }
  return files;
}

// ─── Comments on one asset ───────────────────────────────────────────────────

export type GoogleAssetKind = "headline" | "longHeadline" | "description" | "keyword" | "negativeKeyword" | "businessName" | "path";

export const GOOGLE_ASSET_LABELS: Record<GoogleAssetKind, { one: string; verb: string }> = {
  headline: { one: "Titolo", verb: "Commenta questo titolo" },
  longHeadline: { one: "Titolo lungo", verb: "Commenta questo titolo lungo" },
  description: { one: "Descrizione", verb: "Commenta questa descrizione" },
  keyword: { one: "Parola chiave", verb: "Commenta questa parola chiave" },
  negativeKeyword: { one: "Parola esclusa", verb: "Commenta questa parola esclusa" },
  businessName: { one: "Nome attività", verb: "Commenta il nome dell'attività" },
  path: { one: "Percorso URL", verb: "Commenta il percorso" },
};

/** The asset a client comment is about. */
export interface GoogleAssetRef {
  kind: GoogleAssetKind;
  /** 0-based position in its list (null for single fields). */
  index: number | null;
  text: string;
}

/** "Titolo 3", "Parola chiave 2", "Nome attività". */
export function googleAssetName(ref: Pick<GoogleAssetRef, "kind" | "index">): string {
  const label = GOOGLE_ASSET_LABELS[ref.kind].one;
  return ref.index === null ? label : `${label} ${ref.index + 1}`;
}

/**
 * Comment body quoting the asset, readable as plain text everywhere (agency
 * page, emails, assistant): `[Titolo 3] «Prova gratis 7 giorni»` on the
 * first line, the client's words below.
 */
export function formatAssetComment(ref: GoogleAssetRef, body: string): string {
  return `[${googleAssetName(ref)}] «${ref.text.replace(/\s+/g, " ").trim()}»\n${body.trim()}`;
}

const ASSET_COMMENT = /^\[([^\]\n]{1,40})\] «([^\n]*)»\n([\s\S]*)$/u;

/** The quoted asset of a comment written with formatAssetComment, or null. */
export function parseAssetComment(body: string): { name: string; quote: string; text: string } | null {
  const match = ASSET_COMMENT.exec(body);
  if (!match) return null;
  const name = match[1];
  const known = Object.values(GOOGLE_ASSET_LABELS).some((l) => name === l.one || name.startsWith(`${l.one} `));
  return known ? { name, quote: match[2], text: match[3] } : null;
}
