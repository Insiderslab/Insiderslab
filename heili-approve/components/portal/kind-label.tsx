/**
 * What kind of content a portal item is — "Post social", "Articolo",
 * "Creatività ads" — as a small line icon and the kind's name, so a client
 * with mixed content always knows what they are looking at. Plain markup:
 * safe in server and client components.
 */

import type { ContentKind } from "@/app/generated/prisma/client";
import { KIND_CONFIG } from "@/lib/domain";

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

/** Icon + "Post social" / "Articolo" / "Creatività ads". */
export default function KindLabel({ kind, className = "" }: { kind: ContentKind; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium text-muted ${className}`}>
      <KindIcon kind={kind} className="h-3.5 w-3.5" />
      {KIND_CONFIG[kind].label}
    </span>
  );
}
