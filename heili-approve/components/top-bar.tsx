"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, Metricool connection status and the count of
 * posts that need the agency's attention.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const pageTitles: Array<[prefix: string, title: string]> = [
  ["/dashboard", "Dashboard"],
  ["/posts/new", "Nuovo post"],
  ["/posts", "Post"],
  ["/calendar", "Calendario"],
  ["/clients", "Clienti"],
  ["/settings", "Impostazioni"],
];

interface TopBarProps {
  onMenuClick: () => void;
  metricoolConnected: boolean;
  needsAttention: number;
}

export default function TopBar({
  onMenuClick,
  metricoolConnected,
  needsAttention,
}: TopBarProps) {
  const pathname = usePathname();
  const title =
    pageTitles.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"))?.[1] ??
    "Dashboard";

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
        <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
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
        {metricoolConnected ? (
          <span className="hidden sm:inline text-sm text-muted">Metricool collegato</span>
        ) : (
          <Link
            href="/settings"
            className="whitespace-nowrap text-sm font-medium px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-hover"
          >
            <span className="sm:hidden">Collega</span>
            <span className="hidden sm:inline">Collega Metricool</span>
          </Link>
        )}
      </div>
    </header>
  );
}
