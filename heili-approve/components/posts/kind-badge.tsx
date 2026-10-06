/**
 * Content kind markers for the agency lists and calendar: a small line icon
 * per kind (social post, blog article, ad creatives), the kind's name next
 * to it, and a status label worded for the kind ("Pubblicato" for an
 * article that has been delivered). Plain markup, no hooks: safe in server
 * and client components.
 */

import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import { KIND_CONFIG, STATUS_TONES, statusLabelFor } from "@/lib/domain";
import { TONE_TEXT } from "./helpers";

/** Short names for badges (KIND_CONFIG.label is "Creatività ads", too long in a cell). */
export const KIND_SHORT_LABELS: Record<ContentKind, string> = {
  SOCIAL_POST: "Social",
  BLOG_ARTICLE: "Articolo",
  AD_CREATIVE: "Ads",
};

const ICON_PATHS: Record<ContentKind, string[]> = {
  // A square post with an image line: the social feed.
  SOCIAL_POST: ["M4 4h16v16H4z", "M4 15l4.5-4.5 4 4 2.5-2.5L20 17", "M15.5 8.5h.01"],
  // A page with text lines: the article.
  BLOG_ARTICLE: ["M6 3h9l3 3v15H6z", "M9 9h6", "M9 13h6", "M9 17h4"],
  // A megaphone: the ad campaign.
  AD_CREATIVE: ["M4 10v4h3l7 4V6L7 10H4z", "M17.5 9.5a3.5 3.5 0 0 1 0 5", "M8 14l1 5h2.5l-1-4.4"],
};

export function KindIcon({ kind, className = "h-4 w-4" }: { kind: ContentKind; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Icon + short name ("Articolo"); `iconOnly` keeps the name for screen readers. */
export function KindBadge({
  kind,
  iconOnly = false,
  className = "",
}: {
  kind: ContentKind;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-xs text-muted ${className}`}
      title={KIND_CONFIG[kind].label}
    >
      <KindIcon kind={kind} className="h-3.5 w-3.5" />
      {iconOnly ? <span className="sr-only">{KIND_CONFIG[kind].label}</span> : KIND_SHORT_LABELS[kind]}
    </span>
  );
}

/** Like StatusBadge, worded for the kind (DELIVERED = "Pubblicato" for blog). */
export function KindStatusBadge({ kind, status }: { kind: ContentKind; status: PostStatus }) {
  return (
    <span className={`shrink-0 whitespace-nowrap text-sm font-medium ${TONE_TEXT[STATUS_TONES[status]]}`}>
      {statusLabelFor(kind, status)}
    </span>
  );
}
