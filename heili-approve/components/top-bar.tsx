"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, Metricool connection status (only when the
 * instance handles social posts) and the count of items that need the
 * agency's attention.
 */

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ContentKind } from "@/app/generated/prisma/client";
import { KIND_UI, enabledKinds, isMetricoolEnabled, parseKindParam, type AppVariant } from "@/lib/variant";

const pageTitles: Array<[prefix: string, title: string]> = [
  ["/dashboard", "Dashboard"],
  ["/calendar", "Calendario"],
  ["/plans", "Piani del mese"],
  ["/clients", "Clienti"],
  ["/settings", "Impostazioni"],
];

/**
 * Title for the current page. Content pages (/posts…) are named after the
 * kind: the only one of the instance, or the one in ?kind= when several.
 */
export function pageTitleFor(pathname: string, kinds: readonly ContentKind[], requestedKind: ContentKind | null): string {
  const matches = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");
  if (matches("/posts")) {
    const kind = kinds.length === 1 ? kinds[0] : requestedKind && kinds.includes(requestedKind) ? requestedKind : null;
    if (matches("/posts/new")) return kind ? KIND_UI[kind].newTitle : "Nuovo contenuto";
    return kind ? KIND_UI[kind].navLabel : "Contenuti";
  }
  return pageTitles.find(([prefix]) => matches(prefix))?.[1] ?? "Dashboard";
}

function PageTitle({ variant, requestedKind }: { variant: AppVariant; requestedKind: ContentKind | null }) {
  const pathname = usePathname();
  return (
    <h1 className="truncate text-lg font-semibold tracking-[-0.02em] sm:text-xl">
      {pageTitleFor(pathname, enabledKinds(variant), requestedKind)}
    </h1>
  );
}

function PageTitleWithKind({ variant }: { variant: AppVariant }) {
  const searchParams = useSearchParams();
  return <PageTitle variant={variant} requestedKind={parseKindParam(searchParams.get("kind"))} />;
}

interface TopBarProps {
  onMenuClick: () => void;
  metricoolConnected: boolean;
  needsAttention: number;
  variant: AppVariant;
  /** Client picked in the menu; on phones it shows next to the title and opens the menu. */
  currentClientName: string | null;
}

export default function TopBar({
  onMenuClick,
  metricoolConnected,
  needsAttention,
  variant,
  currentClientName,
}: TopBarProps) {
  const showMetricool = isMetricoolEnabled(variant);

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur-md sm:px-6 lg:px-10"
      style={{
        height: "calc(4rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-surface-sunken lg:hidden"
          aria-label="Apri menu"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div className="min-w-0">
          <Suspense fallback={<PageTitle variant={variant} requestedKind={null} />}>
            <PageTitleWithKind variant={variant} />
          </Suspense>
          {currentClientName && (
            <button
              type="button"
              onClick={onMenuClick}
              className="block max-w-full truncate text-left text-xs font-semibold text-accent lg:hidden"
            >
              {currentClientName} · cambia
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {needsAttention > 0 && (
          <Link href="/posts?status=attention" className="chip chip-stale hover:underline">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M12 8v5M12 16.5v.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            {needsAttention} da gestire
          </Link>
        )}
        {showMetricool &&
          (metricoolConnected ? (
            <span className="chip chip-fresh hidden sm:inline-flex">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              Metricool collegato
            </span>
          ) : (
            <Link
              href="/settings"
              className="btn btn-sm"
            >
              <span className="sm:hidden">Collega</span>
              <span className="hidden sm:inline">Collega Metricool</span>
            </Link>
          ))}
      </div>
    </header>
  );
}
