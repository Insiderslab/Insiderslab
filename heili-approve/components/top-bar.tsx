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
    <h1 className="truncate text-base font-semibold sm:text-lg">
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
}

export default function TopBar({
  onMenuClick,
  metricoolConnected,
  needsAttention,
  variant,
}: TopBarProps) {
  const showMetricool = isMetricoolEnabled(variant);

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 lg:px-8 border-b border-border bg-background"
      style={{
        height: "calc(4rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden shrink-0 px-2.5 py-1.5 rounded border border-border text-sm text-muted hover:text-foreground"
          aria-label="Apri menu"
        >
          Menu
        </button>
        <Suspense fallback={<PageTitle variant={variant} requestedKind={null} />}>
          <PageTitleWithKind variant={variant} />
        </Suspense>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {needsAttention > 0 && (
          <Link
            href="/posts?status=attention"
            className="whitespace-nowrap text-sm text-warning hover:underline"
          >
            {needsAttention} da gestire
          </Link>
        )}
        {showMetricool &&
          (metricoolConnected ? (
            <span className="hidden sm:inline text-sm text-muted">Metricool collegato</span>
          ) : (
            <Link
              href="/settings"
              className="whitespace-nowrap text-sm font-medium px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-hover"
            >
              <span className="sm:hidden">Collega</span>
              <span className="hidden sm:inline">Collega Metricool</span>
            </Link>
          ))}
      </div>
    </header>
  );
}
