/* eslint-disable @next/next/no-img-element -- client logos are arbitrary public URLs, not next/image sources */

/**
 * Header of the client portal: the client's logo and name first (it is their
 * space) with a short line on what they find here ("I tuoi contenuti da
 * approvare: post social, articoli e creatività"), the product name small on
 * the side. No agency navigation.
 */

import Link from "next/link";
import { HeiliSymbol } from "@/components/brand";
import { initials } from "@/components/post-preview/helpers";

export default function PortalHeader({
  clientName,
  logoUrl,
  homeHref,
  productName = "Approve by Heili",
  tagline,
}: {
  clientName: string;
  logoUrl: string | null;
  homeHref: string;
  productName?: string;
  /** What the client finds here, from their services (portalTagline). */
  tagline?: string;
}) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href={homeHref} className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent"
            >
              {initials(clientName)}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate font-display text-base font-semibold">{clientName}</span>
            {tagline && <span className="block text-xs leading-snug text-muted">{tagline}</span>}
          </span>
        </Link>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted" title={productName}>
          <HeiliSymbol className="h-5 w-5" />
          <span className="hidden sm:inline">{productName}</span>
        </span>
      </div>
    </header>
  );
}
