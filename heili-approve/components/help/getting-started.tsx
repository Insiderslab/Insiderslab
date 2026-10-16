"use client";

/**
 * «Per iniziare» on the dashboard: the agency's first four steps, ticked from
 * real data (lib/help/getting-started.ts). The next step carries the button;
 * the done ones say «Fatto». Hidden for good once all are done; before that
 * «Chiudi» hides it in this browser (localStorage, read with try/catch).
 *
 * The server renders it open (it cannot read localStorage); a tiny inline
 * script right after it hides it before the first paint when this browser
 * closed it, so the dashboard neither flashes nor jumps on load.
 */

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  gettingStartedProgress,
  gettingStartedStorageKey,
  nextGettingStartedStep,
  readGettingStartedDismissed,
  showGettingStarted,
  writeGettingStartedDismissed,
  type GettingStartedStep,
} from "@/lib/help/getting-started";

const SECTION_ID = "per-iniziare";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function GettingStarted({
  workspaceId,
  steps,
  dismissible = true,
}: {
  workspaceId: string;
  steps: readonly GettingStartedStep[];
  /** False on the empty dashboard: with no client yet there is nothing else to do. */
  dismissible?: boolean;
}) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => dismissible && readGettingStartedDismissed(localStorageOrNull(), workspaceId),
    () => false
  );
  if (!showGettingStarted(steps, dismissed)) return null;

  const next = nextGettingStartedStep(steps);
  const { done, total } = gettingStartedProgress(steps);

  function close() {
    writeGettingStartedDismissed(localStorageOrNull(), workspaceId);
    // Hidden at once, even when the browser refused to remember it.
    const section = document.getElementById(SECTION_ID);
    if (section) section.hidden = true;
    listeners.forEach((listener) => listener());
  }

  return (
    <>
      <section id={SECTION_ID} aria-labelledby={`${SECTION_ID}-title`} className="panel p-4 sm:p-5" data-testid="getting-started">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${SECTION_ID}-title`} className="text-lg font-semibold">
              Per iniziare
            </h2>
            <p className="text-sm text-muted" data-testid="getting-started-progress">
              {done} di {total} passi fatti ·{" "}
              <Link href="/guida" className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2 sm:min-h-0">
                Guida completa
              </Link>
            </p>
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={close}
              className="btn btn-quiet h-11 w-11 shrink-0 !min-h-11 !p-0"
              aria-label="Chiudi «Per iniziare»"
              title="Chiudi: torna solo se svuoti i dati del browser"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {steps.map((step) => (
            <span key={step.id} className={`h-1.5 flex-1 rounded-full ${step.done ? "bg-success" : "bg-border"}`} />
          ))}
        </div>

        <ol className="mt-2 divide-y divide-border">
          {steps.map((step, index) => {
            const isNext = step.id === next?.id;
            return (
              <li key={step.id} className="flex gap-3 py-3" data-testid={`getting-started-${step.id}`} data-done={step.done ? "true" : "false"}>
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    step.done ? "bg-success-soft text-success" : isNext ? "bg-accent text-white" : "bg-surface-sunken text-muted"
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className={`font-semibold ${step.done ? "text-muted" : "text-foreground"}`}>{step.title}</p>
                    {step.done ? (
                      <span className="chip chip-fresh">Fatto</span>
                    ) : isNext ? (
                      <span className="chip chip-brand">Adesso</span>
                    ) : (
                      <span className="chip">Dopo</span>
                    )}
                  </div>
                  {!step.done && <p className="mt-0.5 text-sm text-muted">{step.text}</p>}
                  {isNext && (
                    <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Link href={step.action.href} className="btn btn-primary !min-h-11">
                        {step.action.label}
                      </Link>
                      {step.secondary && (
                        <Link href={step.secondary.href} className="btn !min-h-11">
                          {step.secondary.label}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {dismissible && (
        <script
          // Runs while the HTML streams in, before React: hides a list closed in this browser.
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem(${JSON.stringify(gettingStartedStorageKey(workspaceId))})==="1"){var s=document.getElementById(${JSON.stringify(SECTION_ID)});if(s)s.hidden=true}}catch(e){}`,
          }}
        />
      )}
    </>
  );
}
