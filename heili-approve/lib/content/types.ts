/**
 * Kind-specific content stored in PostVersion.content (JSON).
 *
 * Shared contract between the blog module (lib/content/blog.ts, components/blog),
 * the ads module (lib/content/ads.ts, components/ads), the core services and the
 * UIs. Validation (zod) lives in the per-kind modules; this file only holds the
 * shapes so every module agrees on them. Keep it pure: no I/O.
 */

import type { MediaItem } from "@/lib/domain";

// ─── Blog ────────────────────────────────────────────────────────────────────

export interface BlogContent {
  /** Article headline (H1). Post.title stays the internal/portal title. */
  headline: string;
  /** URL slug, lowercase-with-dashes. */
  slug: string;
  /** Article body in Markdown (headings, lists, links, images, quotes). */
  bodyMarkdown: string;
  /** Short summary shown in lists / social shares. */
  excerpt: string;
  /** SEO */
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  /** Featured image (MediaItem from /api/uploads), optional. */
  featuredImage: MediaItem | null;
  categories: string[];
  tags: string[];
  /** Author byline shown in the preview, optional. */
  author: string;
}

/**
 * Where a client comment points inside the article. Text-quote anchoring
 * (like the W3C Web Annotation TextQuoteSelector) survives small edits between
 * versions: re-anchor by searching quote with prefix/suffix context.
 */
export interface BlogAnchor {
  /** The exact selected text. */
  quote: string;
  /** Up to ~32 chars before / after the quote, for disambiguation. */
  prefix: string;
  suffix: string;
  /** Index of the rendered top-level block (paragraph, heading…) — a hint only. */
  blockIndex: number | null;
}

// ─── Ads ─────────────────────────────────────────────────────────────────────

export const AD_PLATFORMS = ["meta", "google", "tiktok", "linkedin"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

/** Placements the previews and spec checks support. */
export const AD_PLACEMENTS = [
  "meta_feed", //        Facebook/Instagram feed, 1:1 or 4:5
  "meta_stories_reels", // Stories / Reels, 9:16 with safe zones
  "tiktok_in_feed", //   9:16
  "google_display", //   responsive display, 1.91:1 and 1:1
  "google_search", //    responsive search ad (RSA): text only, keywords
  "google_pmax", //      Performance Max asset group: text + images + logo (+ video)
  "linkedin_feed", //    1.91:1 or 1:1
] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export interface AdCampaign {
  name: string;
  platform: AdPlatform;
  /** e.g. "Conversioni", "Traffico", "Notorietà" — free text, Italian. */
  objective: string;
  /** Optional planning info, free text ("€30/giorno per 14 giorni"). */
  budgetNote: string;
  /** Audience notes for the client, free text. */
  audienceNote: string;
}

/** Google Ads keyword match types: broad `parola`, phrase `"parola"`, exact `[parola]`. */
export const GOOGLE_MATCH_TYPES = ["broad", "phrase", "exact"] as const;
export type GoogleMatchType = (typeof GOOGLE_MATCH_TYPES)[number];

export interface GoogleKeyword {
  /** The keyword without match-type syntax. */
  text: string;
  match: GoogleMatchType;
}

/**
 * Google Ads text assets of a variant (Search RSA and Performance Max share
 * them). Optional on AdVariant: sets saved before Google Ads had none.
 */
export interface AdGoogleAssets {
  /** Titoli: RSA and PMax, ≤ 30 characters each. */
  headlines: string[];
  /** Titoli lunghi: PMax only, ≤ 90 characters. */
  longHeadlines: string[];
  /** Descrizioni: RSA (2–4) and PMax (2–5), ≤ 90 characters. */
  descriptions: string[];
  /** Nome dell'attività: PMax, ≤ 25 characters. */
  businessName: string;
  /** Display URL paths: example.com/path1/path2, ≤ 15 characters each. */
  path1: string;
  path2: string;
  /** Search keywords of the ad group. */
  keywords: GoogleKeyword[];
  /** Negative keywords, as written (may carry "…" / […] syntax). */
  negativeKeywords: string[];
  /** PMax logos (1:1 required, 4:1 optional); the client logo is shown when empty. */
  logos: MediaItem[];
}

export interface AdVariant {
  /** Stable id within the post (e.g. "A", "B", "C" or a short random id). */
  id: string;
  /** Display name, e.g. "Variante A — Prima/dopo". */
  name: string;
  /** Images or videos of this creative (carousel when more than one). */
  media: MediaItem[];
  primaryText: string;
  headline: string;
  description: string;
  /** Call to action label as shown on the platform, e.g. "Prenota ora". */
  cta: string;
  destinationUrl: string;
  placements: AdPlacement[];
  /** Google Ads assets (google_search / google_pmax); absent on older sets. */
  google?: AdGoogleAssets;
}

export interface AdContent {
  campaign: AdCampaign;
  variants: AdVariant[];
}

/** One client decision on one variant (mirrors the CreativeDecision model). */
export interface VariantDecision {
  variantId: string;
  verdict: "APPROVED" | "REJECTED";
  note: string | null;
}

// ─── Website («Sito web», docs/SITO-WEB.md) ──────────────────────────────────

/**
 * How the client reviews the site: «Sul sito» (live: the review script is
 * installed on the agency's own site) or «Istantanee» (snapshot: server-side
 * photos of someone else's site). Only "live" is accepted for now: the
 * snapshot pipeline (capture-worker, Chromium) is postponed until the VPS
 * memory is checked; the shapes below keep room for it.
 */
export const WEBSITE_MODES = ["live", "snapshot"] as const;
export type WebsiteMode = (typeof WEBSITE_MODES)[number];

export const WEBSITE_DEVICES = ["desktop", "phone"] as const;
export type WebsiteDevice = (typeof WEBSITE_DEVICES)[number];

export const WEBSITE_VIEWPORTS: Record<WebsiteDevice, { w: number; h: number }> = {
  desktop: { w: 1440, h: 900 },
  phone: { w: 390, h: 844 },
};

/** Reserved for «Istantanee»: one full-page photo of a page on a device, in strips. */
export interface WebsiteCaptureRef {
  captureId: string;
  capturedAt: string;
  finalUrl: string;
  pageTitle: string;
  width: number;
  fullHeight: number;
  truncated: boolean;
  strips: Array<{ assetId: string; url: string; y: number; h: number }>;
}

/** One page the client should look at in this round. */
export interface WebsitePage {
  /** "p1", "p2"… stable within the post. */
  id: string;
  /** «Home», «Chi siamo». */
  title: string;
  /** Absolute URL on the same origin as siteUrl ("" while drafting). */
  url: string;
  /** What to look at on this page (optional, shown to the client). */
  note: string;
  /** «Istantanee» only (postponed). */
  captures?: Partial<Record<WebsiteDevice, WebsiteCaptureRef>>;
}

export interface WebsiteContent {
  mode: WebsiteMode;
  /** The test site's address: origin + path, no credentials ("" while drafting). */
  siteUrl: string;
  /** WebsiteSite.id (review key and allowed origins), set by the server. */
  siteId: string | null;
  /** Review round (1, 2…): a new round is new content, hence a new version. */
  round: number;
  /** What to look at / what changed in this round (≤ 1000). */
  roundNote: string;
  /** Devices to check («Istantanee» photographs these; «Sul sito» shows them as a hint). */
  devices: WebsiteDevice[];
  /** 0..20 while drafting, 1..20 to send to the client. */
  pages: WebsitePage[];
}

/**
 * «Sul sito»: the element the client pointed at on the real site. The
 * selector, the element's text and the scroll position are the truth; a
 * zone photo (captureRef) may be added by the postponed capture-worker.
 * Never carries values typed in form fields.
 */
export interface LiveAnchor {
  /** Registered origin + path; no hash, no tracking or sensitive parameters. */
  pageUrl: string;
  /** From the viewport width (< 768 = phone). */
  device: WebsiteDevice;
  viewport: { w: number; h: number };
  /** CSS selector, ≤ 300. */
  selector: string;
  /** Text of the element, ≤ 160, never form values. */
  textSnippet: string;
  /** Lower-case tag name of the element ("h1", "a", "section"…). */
  tag?: string;
  /** Nearest heading above the element, ≤ 120 (helps the agency). */
  sectionHeading?: string;
  /** Point tapped inside the element, 0..1. */
  offsetX: number;
  offsetY: number;
  /** Page scroll in px, integer ≥ 0. */
  scrollY: number;
  /** Reserved: WebsiteCapture id of the zone photo (capture-worker). */
  captureRef?: string;
}
