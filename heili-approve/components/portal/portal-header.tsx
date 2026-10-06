/* eslint-disable @next/next/no-img-element -- client logos are arbitrary public URLs, not next/image sources */

/**
 * Header of the client portal: the client's logo and name first (it is their
 * space), the product name ("Approve by Heili — Blog"…) small on the side.
 * No agency navigation.
 */

import Link from "next/link";
import { initials } from "@/components/post-preview/helpers";

export default function PortalHeader({
  clientName,
  logoUrl,
  homeHref,
  productName = "Approve by Heili",
}: {
  clientName: string;
  logoUrl: string | null;
  homeHref: string;
  productName?: string;
}) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <Link href={homeHref} className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-muted"
            >
              {initials(clientName)}
            </span>
          )}
          <span className="truncate text-base font-semibold">{clientName}</span>
        </Link>
        <span className="shrink-0 text-[11px] text-muted">{productName}</span>
      </div>
    </header>
  );
}
