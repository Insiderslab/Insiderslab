/**
 * Regole pure del dock di Heili nel portale: filtro delle destinazioni,
 * scelta del prossimo passo, scheda del dock, frase di stato della Guida.
 * Niente React e niente I/O: testate in __tests__/heili-dock.test.ts.
 */

import { pointMarker, videoMomentMarker } from "@/lib/review-assistant/shared";
import type { HeiliDestination, HeiliPageContext } from "./types";

// ─── Destinazioni ────────────────────────────────────────────────────────────

/**
 * Un href è valido solo dentro il portale del cliente: esattamente
 * `/review/<token>` o un suo discendente. Heili non porta mai fuori, e i
 * segmenti `..` non possono scappare dal prefisso.
 */
export function isPortalHref(token: string, href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/, 1)[0];
  const base = `/review/${encodeURIComponent(token)}`;
  if (!(path === base || path.startsWith(`${base}/`))) return false;
  return !path
    .split("/")
    .some((segment) => segment === "." || segment === ".." || segment.includes("\\"));
}

/** Tiene solo le destinazioni dentro il portale di questo token. */
export function filterDestinations(token: string, destinations: readonly HeiliDestination[]): HeiliDestination[] {
  return destinations.filter((destination) => isPortalHref(token, destination.href));
}

/** Il prossimo passo in evidenza: la prima "next", altrimenti la prima "post". */
export function nextStepDestination(destinations: readonly HeiliDestination[]): HeiliDestination | null {
  return destinations.find((d) => d.kind === "next") ?? destinations.find((d) => d.kind === "post") ?? null;
}

/** Le altre destinazioni, per le scorciatoie della Guida. */
export function shortcutDestinations(
  destinations: readonly HeiliDestination[],
  nextStep: HeiliDestination | null
): HeiliDestination[] {
  return destinations.filter((destination) => destination !== nextStep);
}

// ─── Schede del dock ─────────────────────────────────────────────────────────

export type HeiliDockTab = "feedback" | "guide";

/** Nelle pagine contenuto ci sono due schede (Feedback · Guida); altrove solo la Guida. */
export function dockTabs(context: Pick<HeiliPageContext, "review"> | null): HeiliDockTab[] {
  return context?.review ? ["feedback", "guide"] : ["guide"];
}

/** Scheda mostrata: quella chiesta se esiste ancora, altrimenti la prima. */
export function resolveDockTab(tabs: readonly HeiliDockTab[], requested: HeiliDockTab | null): HeiliDockTab {
  return requested && tabs.includes(requested) ? requested : (tabs[0] ?? "guide");
}

// ─── Frase di stato della Guida ──────────────────────────────────────────────

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * "Sei nel piano social di novembre: 12 post, 3 da rivedere." — costruita dal
 * contesto della pagina, mai dal modello.
 */
export function guideStatusSentence(context: Pick<HeiliPageContext, "page" | "title" | "summary">): string {
  const title = context.title.trim().replace(/\.$/, "");
  const summary = context.summary?.trim().replace(/\.$/, "");
  const base = (() => {
    switch (context.page) {
      case "home":
        return title;
      case "plan":
        return `Sei nel ${lowerFirst(title)}`;
      case "plan-grid":
        return `Sei nella griglia del ${lowerFirst(title)}`;
      case "browse":
        return `Stai sfogliando ${lowerFirst(title)}`;
      case "month":
      case "post":
      case "article":
      case "ads":
        return `Stai rivedendo ${lowerFirst(title)}`;
    }
  })();
  return summary ? `${base}: ${summary}.` : `${base}.`;
}

// ─── Prima visita ────────────────────────────────────────────────────────────

export function introStorageKey(token: string): string {
  return `heili.intro.${token}`;
}

// ─── «Indica un punto»: dal tocco al marcatore ───────────────────────────────

export type HeiliDraftPick =
  | { kind: "pin"; mediaIndex: number; x: number; y: number; variantId?: string | null }
  | { kind: "moment"; mediaIndex: number; timeSec: number; x?: number; y?: number; variantId?: string | null };

/** Il marcatore da inserire nel messaggio dopo un tocco sull'immagine o sul video. */
export function draftMarker(pick: HeiliDraftPick): string {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  if (pick.kind === "pin") {
    return pointMarker({ mediaIndex: pick.mediaIndex, x: clamp(pick.x), y: clamp(pick.y), variantId: pick.variantId });
  }
  if (typeof pick.x === "number" && typeof pick.y === "number") {
    return pointMarker({
      mediaIndex: pick.mediaIndex,
      x: clamp(pick.x),
      y: clamp(pick.y),
      variantId: pick.variantId,
      timeSec: pick.timeSec,
    });
  }
  return videoMomentMarker(pick.timeSec);
}

// ─── Registrazione della pagina (navigazione) ────────────────────────────────

export interface HeiliRegistration {
  id: number;
  /** Cambia quando cambia ciò che il dock deve mostrare. */
  key: string;
  read: () => HeiliPageContext;
}

export interface HeiliRegistrationState {
  current: HeiliRegistration | null;
  lastId: number;
}

export type HeiliRegistrationAction =
  | { type: "register"; registration: HeiliRegistration }
  | { type: "clear"; id: number };

/**
 * L'ultima pagina registrata vince; una pulizia in ritardo non cancella la
 * registrazione di una pagina più nuova (navigazione tra pagine del portale).
 */
export function registrationReducer(
  state: HeiliRegistrationState,
  action: HeiliRegistrationAction
): HeiliRegistrationState {
  switch (action.type) {
    case "register":
      return { current: action.registration, lastId: Math.max(state.lastId, action.registration.id) };
    case "clear":
      return state.current?.id === action.id ? { ...state, current: null } : state;
  }
}

/** Chiave stabile di una registrazione: cambia solo quando cambia qualcosa di visibile. */
export function registrationKey(context: HeiliPageContext): string {
  const destinations = context.destinations.map((d) => `${d.id}|${d.kind}|${d.href}`).join(";");
  const review = context.review
    ? `${context.review.postId}|${context.review.versionNumber}|${context.review.mode}|${context.review.kind}|${context.review.sessionKey}`
    : "";
  return [context.page, context.title, context.summary ?? "", destinations, review].join("~");
}
