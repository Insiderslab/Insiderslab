/**
 * Segmented control of the unified client portal: "Tutti · Post social ·
 * Articoli · Creatività" (only what the client gets), each with the number
 * of items waiting for the client's action. Plain links (works without
 * JavaScript, back button friendly). On phones the count sits under the
 * label so four tabs fit at 390 px; anything wider scrolls sideways instead
 * of widening the page.
 */

import Link from "next/link";
import type { PortalKindTab } from "./helpers";
import { KindIcon } from "./kind-label";

export default function KindTabs({ tabs }: { tabs: PortalKindTab[] }) {
  return (
    <nav aria-label="Tipo di contenuto" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex w-max min-w-full gap-1 rounded-lg border border-border bg-surface-hover p-1">
        {tabs.map((tab) => (
          <li key={tab.kind ?? "all"} className="min-w-0 flex-1">
            <Link
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              aria-label={`${tab.label}: ${tab.toAct === 1 ? "1 da approvare" : `${tab.toAct} da approvare`}`}
              data-kind={tab.kind ?? "all"}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1.5 text-[13px] font-medium transition-colors sm:min-h-11 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm ${
                tab.active ? "bg-surface text-foreground ring-1 ring-border" : "text-muted hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {tab.kind && <KindIcon kind={tab.kind} className="hidden h-4 w-4 sm:block" />}
                {tab.label}
              </span>
              <span
                aria-hidden="true"
                data-testid="tab-count"
                className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold leading-none ${
                  tab.toAct > 0 ? "bg-accent text-white" : "bg-border text-muted"
                }`}
              >
                {tab.toAct}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
