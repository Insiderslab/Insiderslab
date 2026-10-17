"use client";

/**
 * «Come funziona» for a client whose link opens straight on a post, a plan or
 * a month (the agency often shares the post's own link). The home has the
 * same steps in HomeSteps; both share one «already seen» flag per link
 * (lib/help/portal-intro.ts), so the client reads them once.
 *
 * One compact row (K-10), placed by the page: under the preview on a social
 * post, so the content stays the first thing in view; under the header on a
 * plan or month; above a long content (article, ads, website). Never fixed,
 * so it cannot sit on the decision bar or on Heili's button. «Ho capito»
 * closes it; leaving the page closes it too (the component unmounts).
 */

import { useEffect, useState } from "react";
import { PORTAL_INTRO_STEPS, markPortalIntroSeen, portalIntroSeen } from "@/lib/help/portal-intro";

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function PortalIntro({ token, className = "" }: { token: string; className?: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const storage = localStorageOrNull();
    if (portalIntroSeen(storage, token)) return;
    markPortalIntroSeen(storage, token);
    const timer = window.setTimeout(() => setShown(true), 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  if (!shown) return null;

  return (
    <section
      aria-labelledby="portal-intro-title"
      className={`flex items-center gap-3 rounded-xl border border-border bg-surface py-1 pl-3 pr-2 text-sm leading-snug ${className}`}
      data-testid="portal-intro"
    >
      {/* One sentence that wraps like text: «Come funziona: Guarda… · Approva… · Fatto…». */}
      <div className="min-w-0 flex-1 py-1.5">
        <h2 id="portal-intro-title" className="inline font-semibold">
          Come funziona:{" "}
        </h2>
        <ol className="inline text-muted">
          {PORTAL_INTRO_STEPS.map((step, index) => (
            <li key={step.title} title={step.text} className="inline">
              {index > 0 && (
                <span aria-hidden="true" className="px-1">
                  ·
                </span>
              )}
              {step.title}
            </li>
          ))}
        </ol>
      </div>
      <button
        type="button"
        onClick={() => setShown(false)}
        className="inline-flex min-h-11 shrink-0 items-center font-semibold text-accent underline underline-offset-2"
      >
        Ho capito
      </button>
    </section>
  );
}
