/**
 * La Guida di Heili nel dock: deterministica, senza modello. Frase di stato
 * dal contesto della pagina, prossimo passo in evidenza, scorciatoie verso le
 * altre destinazioni e domande frequenti dal catalogo client (quelle di
 * «Guida e aiuto»), filtrate per pagina quando ha senso.
 */

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { helpTopics, suggestedHelpTopics } from "@/lib/help/catalog";
import { guideStatusSentence, nextStepDestination, shortcutDestinations } from "./rules";
import type { HeiliPageContext } from "./types";

export default function HeiliGuide({
  context,
  onNavigate,
}: {
  context: HeiliPageContext;
  /** Chiude il dock quando si segue una destinazione. */
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const services = context.services;
  const topics = useMemo(() => helpTopics({ audience: "client", services }), [services]);
  const suggested = useMemo(() => suggestedHelpTopics(topics, pathname), [topics, pathname]);

  const nextStep = nextStepDestination(context.destinations);
  const shortcuts = shortcutDestinations(context.destinations, nextStep);

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground" data-testid="heili-guide-status">
        {guideStatusSentence(context)}
      </p>

      {nextStep && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Prossimo passo</p>
          <Link
            href={nextStep.href}
            onClick={onNavigate}
            className="flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-white hover:bg-accent-hover"
            data-testid="heili-guide-next"
          >
            {nextStep.label}
          </Link>
        </div>
      )}

      {shortcuts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Scorciatoie</p>
          <div className="flex flex-wrap gap-2">
            {shortcuts.map((destination) => (
              <Link
                key={destination.id}
                href={destination.href}
                onClick={onNavigate}
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-3 text-sm hover:border-border-hover"
                data-testid={`heili-shortcut-${destination.id}`}
              >
                {destination.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Domande frequenti</p>
        <ul className="space-y-2">
          {suggested.map((topic) => (
            <li key={topic.id}>
              <details className="rounded-lg border border-border bg-background">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
                  {topic.title}
                </summary>
                <div className="space-y-3 border-t border-border px-3 py-3">
                  <p className="text-sm text-muted">{topic.summary}</p>
                  <ol className="space-y-3">
                    {topic.steps.map((step, index) => (
                      <li key={step.title} className="flex gap-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{step.title}</span>
                          <span className="block text-sm leading-6 text-muted">{step.body}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted">
        La Guida non invia e non approva nulla: ti spiega solo dove sei e dove puoi andare.
      </p>
    </div>
  );
}
