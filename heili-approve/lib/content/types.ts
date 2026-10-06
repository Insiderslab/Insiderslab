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
