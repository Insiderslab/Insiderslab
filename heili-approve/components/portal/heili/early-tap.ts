/**
 * Tocchi su Heili prima che la pagina sia pronta.
 *
 * Il pulsante galleggiante arriva già nell'HTML del server, ma finché React non
 * ha idratato la pagina (su un telefono lento e in rete mobile possono passare
 * diversi secondi) un tocco non fa nulla: era il «non si attivava niente».
 *
 * Il layout del portale inserisce `HEILI_EARLY_TAP_SCRIPT` in linea, prima del
 * contenuto: un ascoltatore di click in fase di cattura annota il tocco su un
 * elemento con `data-heili-open` («auto», «feedback» o «guide») e lo segna
 * subito come in attesa (`data-heili-pending`, `aria-busy`: lo stile in
 * globals.css). Quando il dock è montato chiama `takeEarlyHeiliTap`, che
 * restituisce la scheda chiesta, pulisce i segni e da lì in poi lascia fare a
 * React (`window.__heiliReady`).
 */

import type { HeiliDockTab } from "./rules";

export const HEILI_OPEN_ATTRIBUTE = "data-heili-open";
export const HEILI_PENDING_ATTRIBUTE = "data-heili-pending";

export type HeiliOpenRequest = "auto" | HeiliDockTab;

/** Globals shared by the inline script and the dock (window.__heili*). */
export interface HeiliEarlyWindow {
  __heiliEarly?: { pending: string | null };
  __heiliReady?: boolean;
}

// Plain ES5, no dependencies: it runs before any bundle is loaded.
export const HEILI_EARLY_TAP_SCRIPT = `(function(){var w=window;if(w.__heiliEarly)return;w.__heiliEarly={pending:null};document.addEventListener("click",function(e){if(w.__heiliReady)return;var t=e.target;var el=t&&t.closest?t.closest("[${HEILI_OPEN_ATTRIBUTE}]"):null;if(!el)return;w.__heiliEarly.pending=el.getAttribute("${HEILI_OPEN_ATTRIBUTE}")||"auto";el.setAttribute("${HEILI_PENDING_ATTRIBUTE}","");el.setAttribute("aria-busy","true");},true);})();`;

/** The tab an early tap asked for (null for «auto» or anything unknown). */
export function earlyTapTab(value: string | null | undefined): HeiliDockTab | null {
  return value === "feedback" || value === "guide" ? value : null;
}

/**
 * Called once by the mounted dock: marks the page as ready (React handles the
 * next taps), clears the «waiting» marks and returns the pending request, if any.
 */
export function takeEarlyHeiliTap(win: HeiliEarlyWindow, doc: Pick<Document, "querySelectorAll">): HeiliOpenRequest | null {
  win.__heiliReady = true;
  const pending = win.__heiliEarly?.pending ?? null;
  if (win.__heiliEarly) win.__heiliEarly.pending = null;
  doc.querySelectorAll(`[${HEILI_PENDING_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(HEILI_PENDING_ATTRIBUTE);
    element.removeAttribute("aria-busy");
  });
  if (pending === null) return null;
  return earlyTapTab(pending) ?? "auto";
}

/** When the dock unmounts, taps are recorded again until the next one is ready. */
export function releaseEarlyHeiliTap(win: HeiliEarlyWindow): void {
  win.__heiliReady = false;
}
