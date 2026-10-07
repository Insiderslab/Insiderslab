"use client";

/**
 * Sidebar Navigation
 *
 * Heili layout: surface-sunken rail, symbol + product name at the top, the
 * client selector ("Cliente attivo") right below it, then the menu with line
 * icons. Entries follow the product variant: one per enabled content kind
 * ("Post", "Articoli", "Creatività"), which share /posts and differ by ?kind=
 * when there are several. Workspace and "Heili by 3Runes" sit in the footer.
 */

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ContentKind } from "@/app/generated/prisma/client";
import { ApproveLockup } from "@/components/brand";
import ClientSwitcher, { type SwitcherClient } from "@/components/client-switcher";
import { KindIcon } from "@/components/posts/kind-badge";
import WorkspaceSwitcher from "@/components/workspace-switcher";
import { enabledKinds, navItems, parseKindParam, productName, type AppVariant, type NavItem } from "@/lib/variant";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
  variant: AppVariant;
  clients: SwitcherClient[];
  currentClientId: string | null;
}

/** Line icons (24 grid, 1.75 stroke) for the fixed menu entries. */
const NAV_ICONS: Record<string, string[]> = {
  "/dashboard": ["M4 4h7v9H4z", "M13 4h7v5h-7z", "M13 11h7v9h-7z", "M4 15h7v5H4z"],
  "/calendar": ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4", "M8 14h3"],
  // Monthly plan: a calendar page with a 3×2 grid of posts.
  "/plans": ["M4 4h16v16H4z", "M4 9h16", "M9.5 9v11", "M14.5 9v11", "M4 14.5h16"],
  "/clients": ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5", "M15.5 4.5a3.5 3.5 0 0 1 0 6.5", "M17.5 14.8c1.9.7 3.1 2.5 3.5 5.2"],
  "/settings": [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ],
};

function NavIcon({ item }: { item: NavItem }) {
  if (item.kind) return <KindIcon kind={item.kind} className="h-5 w-5" />;
  const paths = NAV_ICONS[item.href] ?? NAV_ICONS["/dashboard"];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function isPostsPath(pathname: string): boolean {
  return pathname === "/posts" || pathname.startsWith("/posts/");
}

function isItemActive(item: NavItem, pathname: string, activeKind: ContentKind | null, singleKind: boolean): boolean {
  if (item.kind) return isPostsPath(pathname) && (singleKind || activeKind === item.kind);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

interface NavListProps {
  variant: AppVariant;
  activeKind: ContentKind | null;
  onClose: () => void;
}

function NavList({ variant, activeKind, onClose }: NavListProps) {
  const pathname = usePathname();
  const singleKind = enabledKinds(variant).length === 1;

  return (
    <>
      {navItems(variant).map((item) => {
        const isActive = isItemActive(item, pathname, activeKind, singleKind);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors ${
              isActive
                ? "bg-accent-soft font-semibold text-accent"
                : "text-muted hover:bg-surface hover:text-foreground"
            }`}
          >
            <NavIcon item={item} />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/** Reads ?kind= to highlight the right content entry. */
function NavListWithKind(props: Omit<NavListProps, "activeKind">) {
  const searchParams = useSearchParams();
  return <NavList {...props} activeKind={parseKindParam(searchParams.get("kind"))} />;
}

/** Static stand-in while the selector reads the URL (no search params on the server). */
function ClientSwitcherFallback({ clients, currentClientId }: { clients: SwitcherClient[]; currentClientId: string | null }) {
  const current = clients.find((c) => c.id === currentClientId);
  return (
    <div>
      <p className="label-caps mb-1.5 px-1">Cliente</p>
      <div className="flex min-h-[50px] items-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold">
        <span className="truncate">{current?.name ?? "Tutti i clienti"}</span>
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose, workspaceName, variant, clients, currentClientId }: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />}

      <aside
        className={`
          fixed top-0 left-0 z-50 flex h-dvh w-72 max-w-[85vw] shrink-0 flex-col border-r border-border bg-surface-sunken
          transition-transform duration-200 ease-out
          lg:static lg:z-auto lg:h-full lg:w-64 lg:translate-x-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* The drawer is full height: keep the brand clear of the status bar. */}
        <div className="px-5 pb-4" style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}>
          <Link href="/dashboard" onClick={onClose} aria-label="Approve by Heili, vai alla dashboard">
            <ApproveLockup subtitle={variant === "all" ? "by Heili" : productName(variant)} />
          </Link>
        </div>

        <div className="px-3 pb-3">
          <Suspense fallback={<ClientSwitcherFallback clients={clients} currentClientId={currentClientId} />}>
            <ClientSwitcher clients={clients} currentClientId={currentClientId} onNavigate={onClose} />
          </Suspense>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Menu principale">
          <Suspense fallback={<NavList variant={variant} activeKind={null} onClose={onClose} />}>
            <NavListWithKind variant={variant} onClose={onClose} />
          </Suspense>
        </nav>

        <div className="space-y-1 border-t border-border px-4 py-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <WorkspaceSwitcher fallbackName={workspaceName} />
          <p className="text-xs text-muted">Heili by 3Runes</p>
        </div>
      </aside>
    </>
  );
}
