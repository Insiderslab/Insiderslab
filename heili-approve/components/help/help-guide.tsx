"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ContentKind } from "@/app/generated/prisma/client";
import { helpTopics, suggestedHelpTopics, type HelpAudience, type HelpTopic } from "@/lib/help/catalog";

export interface HelpGuideProps {
  audience: HelpAudience;
  services: readonly ContentKind[];
  className?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function HelpGuide({ audience, services, className = "" }: HelpGuideProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const availableTopics = useMemo(() => helpTopics({ audience, services }), [audience, services]);
  const shownTopics = useMemo(() => helpTopics({ audience, services, query }), [audience, query, services]);
  const suggested = useMemo(() => suggestedHelpTopics(availableTopics, pathname), [availableTopics, pathname]);
  const selected = availableTopics.find((topic) => topic.id === selectedId) ?? null;

  const close = useCallback(() => {
    setOpen(false);
    setSelectedId(null);
    setStepIndex(0);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const selector = selectedId ? "[data-help-step-heading]" : "input";
      dialogRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selectedId, stepIndex]);

  function openTopic(topic: HelpTopic) {
    setSelectedId(topic.id);
    setStepIndex(0);
  }

  const step = selected?.steps[stepIndex] ?? null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={`btn !min-h-11 gap-2 ${className}`}
        aria-haspopup="dialog"
      >
        <QuestionIcon />
        Guida e aiuto
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-[var(--shadow-overlay)] sm:max-h-[min(760px,calc(100dvh-2rem))] sm:max-w-2xl sm:rounded-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="label-caps mb-1">Guida passo passo</p>
                <h2 id={titleId} className="text-xl font-semibold sm:text-2xl">
                  {selected ? selected.title : "Come possiamo aiutarti?"}
                </h2>
                <p id={descriptionId} className="mt-1 text-sm text-muted">
                  {selected ? selected.summary : "Cerca una funzione oppure scegli un argomento."}
                </p>
              </div>
              <button type="button" onClick={close} className="btn btn-quiet h-11 w-11 shrink-0 !min-h-11 !p-0" aria-label="Chiudi la guida">
                <CloseIcon />
              </button>
            </div>

            {selected && step ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                  <div className="mb-5 flex items-center gap-3" aria-label={`Passaggio ${stepIndex + 1} di ${selected.steps.length}`}>
                    {selected.steps.map((item, index) => (
                      <span key={item.title} className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? "bg-accent" : "bg-border"}`} />
                    ))}
                  </div>
                  <p className="text-sm font-semibold text-accent" aria-live="polite">Passaggio {stepIndex + 1} di {selected.steps.length}</p>
                  <div>
                    <h3 tabIndex={-1} data-help-step-heading className="mt-2 text-xl font-semibold">{step.title}</h3>
                    <p className="mt-3 text-base leading-7 text-foreground">{step.body}</p>
                  </div>
                  <div className="mt-6 rounded-lg bg-accent-soft p-4 text-sm text-accent">
                    Puoi chiudere la guida in qualsiasi momento: ciò che stavi compilando resta nella pagina.
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-between sm:px-6">
                  <button
                    type="button"
                    className="btn !min-h-11"
                    onClick={() => {
                      if (stepIndex === 0) setSelectedId(null);
                      else setStepIndex((index) => index - 1);
                    }}
                  >
                    {stepIndex === 0 ? "Tutti gli argomenti" : "Indietro"}
                  </button>
                  {stepIndex < selected.steps.length - 1 ? (
                    <button type="button" className="btn btn-primary !min-h-11" onClick={() => setStepIndex((index) => index + 1)}>
                      Avanti
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary !min-h-11" onClick={close}>Chiudi</button>
                  )}
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <label htmlFor={`${titleId}-search`} className="mb-1.5 block text-sm font-semibold">Cerca nella guida</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted"><SearchIcon /></span>
                  <input
                    id={`${titleId}-search`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="field !min-h-11 !pl-10 !text-base"
                    placeholder={audience === "agency" ? "Es. come importo un Excel?" : "Es. come chiedo una modifica?"}
                    autoComplete="off"
                  />
                </div>

                {!query.trim() && suggested.length > 0 && (
                  <section className="mt-6" aria-labelledby={`${titleId}-suggested`}>
                    <h3 id={`${titleId}-suggested`} className="text-base font-semibold">Utile in questa pagina</h3>
                    <TopicList topics={suggested} onOpen={openTopic} />
                  </section>
                )}

                <section className="mt-6" aria-labelledby={`${titleId}-all`}>
                  <h3 id={`${titleId}-all`} className="text-base font-semibold">{query.trim() ? "Risultati" : "Tutti gli argomenti"}</h3>
                  {shownTopics.length > 0 ? (
                    <TopicList topics={shownTopics} onOpen={openTopic} excludeIds={!query.trim() ? new Set(suggested.map((topic) => topic.id)) : undefined} />
                  ) : (
                    <div className="mt-3 rounded-lg border border-border bg-background p-4">
                      <p className="font-semibold">Nessun risultato</p>
                      <p className="mt-1 text-sm text-muted">Prova con parole più semplici, per esempio «commento», «approvare», «link» o «Excel».</p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function TopicList({ topics, onOpen, excludeIds }: { topics: readonly HelpTopic[]; onOpen: (topic: HelpTopic) => void; excludeIds?: ReadonlySet<string> }) {
  const visible = topics.filter((topic) => !excludeIds?.has(topic.id));
  if (visible.length === 0) return null;
  return (
    <ul className="mt-3 grid gap-2">
      {visible.map((topic) => (
        <li key={topic.id}>
          <button
            type="button"
            onClick={() => onOpen(topic)}
            className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:border-line-strong hover:bg-surface-sunken"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{topic.title}</span>
              <span className="mt-0.5 block text-sm leading-5 text-muted">{topic.summary}</span>
            </span>
            <ChevronIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}

function QuestionIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 1.8-2.3 2-2.3 3.7M12 17h.01" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>;
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
}
