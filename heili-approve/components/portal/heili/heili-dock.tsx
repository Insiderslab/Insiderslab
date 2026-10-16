"use client";

/**
 * HeiliDock: il pulsante galleggiante e il pannello di Heili nel portale.
 *
 * Sotto 1280 px: bottom sheet modale (fino all'85% dell'altezza), con Esc,
 * focus intrappolato dal <dialog> nativo e focus restituito al pulsante.
 * Da 1280 px: pannello laterale destro di 400 px, non modale, sopra la barra
 * delle decisioni (z-50) e con la pagina che si restringe di 400 px mentre è
 * aperto (`html[data-heili-panel="side"]` in globals.css): né il contenuto né
 * «Approva» finiscono sotto il pannello (QA-05, QA-13). Sulle pagine con la
 * barra delle decisioni il pulsante resta sopra la barra (variabile CSS
 * `--decision-bar-h`); su telefono sta dentro il bordo destro della barra
 * (`--decision-bar-b`), così non copre mai immagini e frecce del carosello (QA-12).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import HeiliAssistantIcon from "@/components/heili-assistant-icon";
import AssistantPanel from "@/components/review/assistant-panel";
import { useHeili } from "./context";
import HeiliGuide from "./heili-guide";
import { DOCK_SIDE_MIN_WIDTH, dockTabs, introStorageKey } from "./rules";

const INTRO_MS = 6000;

export default function HeiliDock() {
  const heili = useHeili();
  const { token, context, open, tab } = heili;
  const review = context?.review ?? null;
  const tabs = dockTabs(context);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [desktop, setDesktop] = useState(false);
  const [showIntro, setShowIntro] = useState(false);

  // Desktop largo: pannello laterale non modale, la pagina gli lascia lo spazio.
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${DOCK_SIDE_MIN_WIDTH}px)`);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const dismissIntro = useCallback(() => {
    setShowIntro(false);
    try {
      window.localStorage.setItem(introStorageKey(token), "1");
    } catch {
      // Storage non disponibile: il suggerimento si ripresenta, senza errori.
    }
  }, [token]);

  // Prima visita: nuvoletta discreta, ricordata per token. La decisione
  // avviene dopo il primo paint (niente flash di annuncio a ogni pagina).
  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(introStorageKey(token)) !== null;
    } catch {
      seen = true;
    }
    if (seen) return;
    const timer = window.setTimeout(() => {
      setShowIntro(true);
      // Shown once per link: remembered as soon as it appears, so moving to
      // another page before it fades does not show it again.
      try {
        window.localStorage.setItem(introStorageKey(token), "1");
      } catch {
        // Storage non disponibile: il suggerimento si ripresenta, senza errori.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [token]);

  useEffect(() => {
    if (!showIntro || open) return;
    const timer = window.setTimeout(dismissIntro, INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [dismissIntro, open, showIntro]);

  // Apertura: modale sotto 1280 px, laterale non modale da lì in su; Esc chiude sempre.
  // Se la finestra cambia disposizione mentre è aperto il <dialog> si riapre nell'altra.
  const openedAs = useRef<boolean | null>(null);
  const ignoreClose = useRef(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && dialog.open && openedAs.current !== desktop) {
      ignoreClose.current = true;
      dialog.close();
    }
    if (open && !dialog.open) {
      if (desktop) dialog.show();
      else if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.show();
      openedAs.current = desktop;
    }
    if (!open && dialog.open) dialog.close();
    if (!open) openedAs.current = null;
  }, [desktop, open]);

  // La pagina riserva lo spazio del pannello laterale (CSS in globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (open && desktop) root.dataset.heiliPanel = "side";
    else delete root.dataset.heiliPanel;
    return () => {
      delete root.dataset.heiliPanel;
    };
  }, [desktop, open]);

  useEffect(() => {
    if (!open || !desktop) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") heili.closeDock();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [desktop, heili, open]);

  // Focus: entra nel pannello all'apertura, torna al pulsante alla chiusura.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    }
    if (!open && wasOpen.current) {
      buttonRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  const buttonLabel = review ? "Parla con Heili" : "Apri la Guida di Heili";

  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            dismissIntro();
            heili.openDock();
          }}
          aria-label={buttonLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="heili-dock-button"
          // Position: .heili-launcher in globals.css (above the bar; on phones inside its right edge).
          className="heili-launcher fixed right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-accent/40 bg-background text-foreground shadow-[var(--shadow-overlay)] hover:bg-accent-soft sm:right-4 sm:h-14 sm:w-14"
        >
          <HeiliAssistantIcon className="h-8 w-8 sm:h-9 sm:w-9" />
        </button>
      )}

      {showIntro && !open && (
        <button
          type="button"
          onClick={() => {
            dismissIntro();
            heili.openDock();
          }}
          data-testid="heili-intro"
          className="fixed right-4 z-40 max-w-[15rem] rounded-xl border border-border bg-surface p-3 text-left text-sm shadow-[var(--shadow-overlay)]"
          style={{ bottom: "calc(var(--decision-bar-h, 0px) + max(0.75rem, env(safe-area-inset-bottom)) + 4rem)" }}
        >
          Ciao, sono Heili: ti accompagno nella revisione.
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-label="Heili"
        data-testid="heili-dock"
        onClose={() => {
          if (ignoreClose.current) {
            ignoreClose.current = false;
            return;
          }
          if (heili.open) heili.closeDock();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) heili.closeDock();
        }}
        className="m-0 mt-auto max-h-[85dvh] w-full max-w-full overflow-hidden rounded-t-2xl border border-border bg-background p-0 text-foreground backdrop:bg-black/50 sm:mx-auto sm:max-w-[640px] xl:fixed xl:inset-auto xl:right-0 xl:top-0 xl:z-50 xl:m-0 xl:h-dvh xl:max-h-none xl:w-[400px] xl:max-w-[400px] xl:rounded-none xl:border-l"
      >
        <div className="flex h-full max-h-[85dvh] flex-col xl:max-h-none">
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <HeiliAssistantIcon className="h-7 w-7" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight">Heili</h2>
                <p className="truncate text-xs text-muted" data-testid="heili-dock-context">
                  {review ? review.heading : context?.title ?? ""}
                </p>
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={heili.closeDock}
              aria-label="Chiudi Heili"
              className="btn btn-quiet h-11 w-11 shrink-0 !min-h-11 !p-0"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          {tabs.length > 1 && (
            <div role="tablist" aria-label="Modalità di Heili" className="flex gap-1 border-b border-border px-3 pt-2">
              {(
                [
                  ["feedback", "Feedback"],
                  ["guide", "Guida"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => heili.setTab(value)}
                  className={`min-h-11 rounded-t-lg px-3 text-sm font-semibold ${
                    tab === value ? "border-b-2 border-accent text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            {review && heili.panelMounted && (
              <div hidden={tab !== "feedback"} aria-live="polite">
                <AssistantPanel
                  key={`${review.postId}-${review.versionNumber}-${review.sessionKey}`}
                  controlRef={heili.control}
                  onPendingFeedbackChange={heili.setPendingFeedback}
                  token={token}
                  postId={review.postId}
                  versionNumber={review.versionNumber}
                  mode={review.mode}
                  kind={review.kind}
                  showHeader={false}
                  // The sheet covers the decision bar: the panel asks to close Heili first.
                  onBackToPage={desktop ? undefined : heili.closeDock}
                  onSubmitChanges={review.onSubmitChanges}
                  onApprove={review.onApprove}
                  onRequestSavedChanges={review.onRequestSavedChanges}
                  getVideoTime={review.getVideoTime}
                  getSelection={review.getSelection}
                  getContext={review.getContext}
                  variantNames={review.variantNames}
                  getPointContext={review.getPointContext}
                  onPickPoint={review.canPickPoint ? () => heili.beginPick("point") : undefined}
                  onPickMoment={review.canPickMoment ? () => heili.beginPick("moment") : undefined}
                />
              </div>
            )}
            {context && (!review || tab === "guide") && (
              <HeiliGuide context={context} onNavigate={heili.closeDock} />
            )}
            {!context && <p className="text-sm text-muted">Un momento…</p>}
          </div>
        </div>
      </dialog>
    </>
  );
}
