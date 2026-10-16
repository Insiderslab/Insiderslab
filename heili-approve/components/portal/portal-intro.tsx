"use client";

/**
 * «Come funziona, in tre passi» for a client whose link opens straight on a
 * post, a plan or a month (the agency often shares the post's own link). The
 * home has the same steps in HomeSteps; both share one «already seen» flag
 * per link (lib/help/portal-intro.ts), so the client reads them once.
 *
 * A card in the page's flow, above the content: never fixed, so it cannot sit
 * on the decision bar or on Heili's button. «Ho capito» closes it; leaving
 * the page closes it too.
 */

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PORTAL_INTRO_STEPS, markPortalIntroSeen, portalIntroSeen } from "@/lib/help/portal-intro";

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function PortalIntro({ token, homeHref }: { token: string; homeHref: string }) {
  const pathname = usePathname();
  const isHome = pathname === homeHref || pathname === `${homeHref}/`;
  // The page it appeared on; null = not shown.
  const [shownOn, setShownOn] = useState<string | null>(null);

  useEffect(() => {
    if (isHome) return; // The home shows its own steps (HomeSteps).
    const storage = localStorageOrNull();
    if (portalIntroSeen(storage, token)) return;
    markPortalIntroSeen(storage, token);
    const timer = window.setTimeout(() => setShownOn(pathname), 0);
    return () => window.clearTimeout(timer);
  }, [isHome, pathname, token]);

  if (shownOn === null || shownOn !== pathname) return null;

  return (
    <section aria-labelledby="portal-intro-title" className="panel mb-5 p-4 sm:p-5" data-testid="portal-intro">
      <h2 id="portal-intro-title" className="text-base font-semibold">
        Come funziona, in tre passi
      </h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {PORTAL_INTRO_STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-2.5 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-foreground">{step.title}</span>
              <span className="text-muted">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-muted">Dubbi? Il pulsante di Heili in basso ti spiega dove sei.</p>
        <button type="button" onClick={() => setShownOn(null)} className="btn !min-h-11 w-full sm:w-auto">
          Ho capito
        </button>
      </div>
    </section>
  );
}
