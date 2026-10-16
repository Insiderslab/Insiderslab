"use client";

/**
 * I tre passi «Guarda · Commenta · Concludi» della home: pieni solo alla prima
 * visita (ricordata nel browser per token), poi una riga compatta «Come
 * funziona?» che apre la Guida di Heili nel dock.
 */

import { useEffect, useState } from "react";
import { useHeili } from "@/components/portal/heili/context";

export interface HomeStep {
  title: string;
  text: string;
}

function storageKey(token: string): string {
  return `portal.howto.${token}`;
}

export default function HomeSteps({ token, steps }: { token: string; steps: readonly HomeStep[] }) {
  const heili = useHeili();
  const [firstVisit, setFirstVisit] = useState(false);

  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(storageKey(token)) !== null;
    } catch {
      seen = true;
    }
    if (seen) return;
    try {
      window.localStorage.setItem(storageKey(token), "1");
    } catch {
      // Senza storage i passi tornano: nessun errore.
    }
    const timer = window.setTimeout(() => setFirstVisit(true), 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  if (!firstVisit) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 pt-1 text-sm text-muted" data-testid="home-howto">
        <button
          type="button"
          onClick={() => heili.openDock("guide")}
          data-heili-open="guide"
          className="min-h-11 font-semibold text-accent underline underline-offset-2"
        >
          Come funziona?
        </button>
        <span>Te lo spiega Heili, senza inviare nulla.</span>
      </p>
    );
  }

  return (
    <ol className="grid gap-2 pt-1 text-sm text-muted sm:grid-cols-3" aria-label="Come funziona">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-2.5 py-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {index + 1}
          </span>
          <span>
            <span className="block font-semibold text-foreground">{step.title}</span>
            {step.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
