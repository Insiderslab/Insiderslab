"use client";

/**
 * Sidebar Navigation
 *
 * Text-only nav with active state and workspace section. Entries follow the
 * product variant: one per enabled content kind ("Post", "Articoli",
 * "Creatività"), which share /posts and differ by ?kind= when there are
 * several.
 */

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ContentKind } from "@/app/generated/prisma/client";
import WorkspaceSwitcher from "@/components/workspace-switcher";
import { enabledKinds, navItems, parseKindParam, productName, type AppVariant, type NavItem } from "@/lib/variant";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
  variant: AppVariant;
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
            className={`
              block px-3 py-2.5 rounded text-sm
              ${
                isActive
                  ? "bg-surface-hover text-foreground font-medium"
                  : "text-muted hover:text-foreground hover:bg-surface-hover"
              }
            `}
          >
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

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
  variant,
}: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-surface border-r border-border flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Same reason as the top bar: the drawer is full height, so the
            wordmark would otherwise land under the status bar. */}
        <div
          className="px-6 py-5 border-b border-border"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
        >
          <Link href="/dashboard" className="text-base font-semibold">
            {productName(variant)}
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <Suspense fallback={<NavList variant={variant} activeKind={null} onClose={onClose} />}>
            <NavListWithKind variant={variant} onClose={onClose} />
          </Suspense>
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <WorkspaceSwitcher fallbackName={workspaceName} />
          <p className="text-xs text-muted mt-1">by 3Runes</p>
        </div>
      </aside>
    </>
  );
}
