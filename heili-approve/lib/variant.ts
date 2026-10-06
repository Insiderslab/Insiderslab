/**
 * Product variants: one codebase, one Docker image, several products.
 *
 * APP_VARIANT picks which content kinds an instance handles:
 *   social (default) → SOCIAL_POST (Metricool)
 *   blog             → BLOG_ARTICLE (internal: export + "Segna come pubblicato")
 *   ads              → AD_CREATIVE (internal: ZIP of the approved variants)
 *   all              → every kind in one app
 *
 * Pages never show a kind that is not enabled, services refuse to create one,
 * and Metricool UI only appears when SOCIAL_POST is enabled.
 *
 * Production runs ONE instance with APP_VARIANT=all (approve.heili.cloud):
 * what each client gets is decided per client by its services
 * (Client.services, lib/clients.ts). Single-kind variants remain possible
 * for separate instances (optional, see README "Servizi per cliente").
 *
 * Everything here except getAppVariant() is pure and safe to import from
 * client components: the server reads the variant once per render and passes
 * it down as a prop (process.env.APP_VARIANT does not exist in the browser).
 */

import type { ContentKind } from "@/app/generated/prisma/client";
import { ValidationError } from "@/lib/errors";

export const APP_VARIANTS = ["social", "blog", "ads", "all"] as const;
export type AppVariant = (typeof APP_VARIANTS)[number];

export const DEFAULT_APP_VARIANT: AppVariant = "social";

export class InvalidAppVariantError extends Error {
  constructor(value: string) {
    super(
      `APP_VARIANT="${value}" non è valido: usa uno tra ${APP_VARIANTS.join(", ")} ` +
        `(vuoto = ${DEFAULT_APP_VARIANT}).`
    );
    this.name = "InvalidAppVariantError";
  }
}

export function isAppVariant(value: unknown): value is AppVariant {
  return typeof value === "string" && (APP_VARIANTS as readonly string[]).includes(value);
}

/** Case- and space-insensitive; empty/absent = social; anything else throws. */
export function parseAppVariant(value: string | null | undefined): AppVariant {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_APP_VARIANT;
  if (isAppVariant(normalized)) return normalized;
  throw new InvalidAppVariantError(value ?? "");
}

let cached: { raw: string | undefined; variant: AppVariant } | null = null;

/**
 * The variant of this instance (server only). Throws InvalidAppVariantError
 * on a bad value, so a misconfigured deploy fails on its first render instead
 * of silently running as the wrong product.
 */
export function getAppVariant(): AppVariant {
  const raw = process.env.APP_VARIANT;
  if (cached && cached.raw === raw) return cached.variant;
  const variant = parseAppVariant(raw);
  cached = { raw, variant };
  return variant;
}

// ─── Kinds ───────────────────────────────────────────────────────────────────

const VARIANT_KINDS: Record<AppVariant, readonly ContentKind[]> = {
  social: ["SOCIAL_POST"],
  blog: ["BLOG_ARTICLE"],
  ads: ["AD_CREATIVE"],
  all: ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"],
};

/** Content kinds this instance handles, in menu order. */
export function enabledKinds(variant: AppVariant = getAppVariant()): ContentKind[] {
  return [...VARIANT_KINDS[variant]];
}

export function isKindEnabled(kind: ContentKind, variant: AppVariant = getAppVariant()): boolean {
  return VARIANT_KINDS[variant].includes(kind);
}

/** Services call this before creating content of `kind`. */
export function assertKindEnabled(kind: ContentKind, variant: AppVariant = getAppVariant()): void {
  if (!isKindEnabled(kind, variant)) {
    throw new ValidationError(`${KIND_UI[kind].pluralTitle} non sono disponibili in ${productName(variant)}`);
  }
}

/** Metricool (settings, "Collega Metricool", brand per client) only with social posts. */
export function isMetricoolEnabled(variant: AppVariant = getAppVariant()): boolean {
  return isKindEnabled("SOCIAL_POST", variant);
}

/** Kind preselected when the user does not choose one (the first enabled). */
export function defaultKind(variant: AppVariant = getAppVariant()): ContentKind {
  return VARIANT_KINDS[variant][0];
}

// ─── Product name ────────────────────────────────────────────────────────────

const PRODUCT_NAMES: Record<AppVariant, string> = {
  social: "Approve by Heili",
  blog: "Approve by Heili — Blog",
  ads: "Approve by Heili — Ads",
  all: "Approve by Heili",
};

const SHORT_NAMES: Record<AppVariant, string> = {
  social: "Approve",
  blog: "Approve Blog",
  ads: "Approve Ads",
  all: "Approve",
};

const DESCRIPTIONS: Record<AppVariant, string> = {
  social:
    "Revisione e approvazione dei post social dei clienti, con programmazione automatica su Metricool.",
  blog: "Revisione e approvazione degli articoli di blog dei clienti: commenti sulle frasi, SEO ed export.",
  ads: "Revisione e approvazione delle creatività ads dei clienti: decisione per variante e pacchetto finale.",
  all: "Revisione e approvazione di post social, articoli di blog e creatività ads dei clienti.",
};

/** "Approve by Heili", "Approve by Heili — Blog", "Approve by Heili — Ads". */
export function productName(variant: AppVariant = getAppVariant()): string {
  return PRODUCT_NAMES[variant];
}

/** Home-screen name (PWA short_name). */
export function productShortName(variant: AppVariant = getAppVariant()): string {
  return SHORT_NAMES[variant];
}

export function productDescription(variant: AppVariant = getAppVariant()): string {
  return DESCRIPTIONS[variant];
}

// ─── URLs and navigation ─────────────────────────────────────────────────────

export type KindSlug = "social" | "blog" | "ads";

/** UI words per kind (KIND_CONFIG in lib/domain.ts holds the domain labels). */
export const KIND_UI: Record<
  ContentKind,
  {
    slug: KindSlug;
    navLabel: string;
    newTitle: string;
    pluralTitle: string;
    /** Name of the service a client buys: "Post social", "Articoli", "Creatività". */
    serviceLabel: string;
  }
> = {
  SOCIAL_POST: {
    slug: "social",
    navLabel: "Post",
    newTitle: "Nuovo post",
    pluralTitle: "I post social",
    serviceLabel: "Post social",
  },
  BLOG_ARTICLE: {
    slug: "blog",
    navLabel: "Articoli",
    newTitle: "Nuovo articolo",
    pluralTitle: "Gli articoli di blog",
    serviceLabel: "Articoli",
  },
  AD_CREATIVE: {
    slug: "ads",
    navLabel: "Creatività",
    newTitle: "Nuova creatività",
    pluralTitle: "Le creatività ads",
    serviceLabel: "Creatività",
  },
};

// ─── Services (per client) ───────────────────────────────────────────────────

/** Every kind, in menu order (also the order services are listed in). */
const KIND_ORDER: readonly ContentKind[] = VARIANT_KINDS.all;

/** Deduplicated, in menu order (social, blog, ads); unknown values dropped. */
export function sortKinds(kinds: Iterable<ContentKind>): ContentKind[] {
  const set = new Set(kinds);
  return KIND_ORDER.filter((kind) => set.has(kind));
}

/** "Post social", "Articoli", "Creatività". */
export function serviceLabel(kind: ContentKind): string {
  return KIND_UI[kind].serviceLabel;
}

/** Italian list: "a", "a e b", "a, b e c". */
export function joinItalian(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** "post social, articoli e creatività" (lower case, menu order). */
export function servicesSentence(kinds: readonly ContentKind[]): string {
  return joinItalian(sortKinds(kinds).map((kind) => KIND_UI[kind].serviceLabel.toLowerCase()));
}

/** Value of the `?kind=` query parameter for a kind ("social" | "blog" | "ads"). */
export function kindParam(kind: ContentKind): KindSlug {
  return KIND_UI[kind].slug;
}

/**
 * Reads `?kind=` (slug or enum name, any case). Returns null when absent or
 * unknown; does not check that the kind is enabled (use isKindEnabled).
 */
export function parseKindParam(value: string | string[] | null | undefined): ContentKind | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  for (const kind of Object.keys(KIND_UI) as ContentKind[]) {
    if (normalized === KIND_UI[kind].slug || normalized === kind.toLowerCase()) return kind;
  }
  return null;
}

/**
 * Kind a list page should show for `?kind=`: the requested one if enabled,
 * null for "all kinds" (absent/unknown/disabled with several kinds enabled),
 * the only kind when the instance has just one.
 */
export function resolveKindFilter(
  value: string | string[] | null | undefined,
  variant: AppVariant = getAppVariant()
): ContentKind | null {
  const kinds = VARIANT_KINDS[variant];
  if (kinds.length === 1) return kinds[0];
  const requested = parseKindParam(value);
  return requested && kinds.includes(requested) ? requested : null;
}

/** /posts when the instance has a single kind, /posts?kind=… otherwise. */
export function postsHref(kind: ContentKind, variant: AppVariant = getAppVariant()): string {
  return VARIANT_KINDS[variant].length > 1 ? `/posts?kind=${kindParam(kind)}` : "/posts";
}

/** /posts/new, with ?kind=… when the instance has several kinds. */
export function newPostHref(kind: ContentKind, variant: AppVariant = getAppVariant()): string {
  return VARIANT_KINDS[variant].length > 1 ? `/posts/new?kind=${kindParam(kind)}` : "/posts/new";
}

export interface NavItem {
  label: string;
  href: string;
  /** Set on the per-kind entries (they share the /posts path). */
  kind: ContentKind | null;
}

/** Sidebar entries: Dashboard, one per enabled kind, Calendario, Clienti, Impostazioni. */
export function navItems(variant: AppVariant = getAppVariant()): NavItem[] {
  return [
    { label: "Dashboard", href: "/dashboard", kind: null },
    ...VARIANT_KINDS[variant].map((kind) => ({ label: KIND_UI[kind].navLabel, href: postsHref(kind, variant), kind })),
    { label: "Calendario", href: "/calendar", kind: null },
    { label: "Clienti", href: "/clients", kind: null },
    { label: "Impostazioni", href: "/settings", kind: null },
  ];
}

// ─── Counting mixed content ──────────────────────────────────────────────────

const COUNT_WORDS: Record<ContentKind, [one: string, many: string]> = {
  SOCIAL_POST: ["post social", "post social"],
  BLOG_ARTICLE: ["articolo", "articoli"],
  AD_CREATIVE: ["creatività", "creatività"],
};

/**
 * "2 post social e 1 articolo", "1 articolo e 3 creatività" (menu order,
 * zero counts skipped). Ads count variants ("3 creatività") unless
 * `adSets` is set: then they count sets ("1 set di creatività").
 */
export function kindCountPhrase(
  counts: Partial<Record<ContentKind, number>>,
  { adSets = false }: { adSets?: boolean } = {}
): string {
  return joinItalian(
    KIND_ORDER.filter((kind) => (counts[kind] ?? 0) > 0).map((kind) => {
      const n = counts[kind]!;
      if (kind === "AD_CREATIVE" && adSets) return `${n} set di creatività`;
      return `${n} ${COUNT_WORDS[kind][n === 1 ? 0 : 1]}`;
    })
  );
}
