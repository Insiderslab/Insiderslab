/**
 * The client's three steps, shown once on the first visit to the portal
 * (components/portal/home-steps.tsx on the home, portal-intro.tsx on any other
 * page the link opens first) and repeated on the agency's «Guida». Client
 * words only (glossary): never «ads» or «creatività».
 *
 * «Already seen» lives in this browser, per link (localStorage). Reads and
 * writes never throw: a blocked storage counts as «seen», so nobody gets the
 * explanation on every page.
 */

export interface PortalIntroStep {
  title: string;
  text: string;
}

export const PORTAL_INTRO_STEPS: readonly PortalIntroStep[] = [
  { title: "Guarda i contenuti", text: "Ognuno si apre come apparirà davvero: foto, video e testo." },
  { title: "Approva o scrivi cosa cambiare", text: "Se va bene, approvi. Se no, tocca il punto da cambiare e scrivilo, o dettalo." },
  { title: "Fatto, ci pensiamo noi", text: "La tua risposta arriva subito all'agenzia. Se chiedi modifiche, la nuova versione torna qui." },
];

export function portalIntroStorageKey(token: string): string {
  return `portal.howto.${token}`;
}

export function portalIntroSeen(storage: Pick<Storage, "getItem"> | null | undefined, token: string): boolean {
  try {
    if (!storage) return true;
    return storage.getItem(portalIntroStorageKey(token)) !== null;
  } catch {
    return true;
  }
}

/** False when the browser does not keep it (the steps may come back next time). */
export function markPortalIntroSeen(storage: Pick<Storage, "setItem"> | null | undefined, token: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(portalIntroStorageKey(token), "1");
    return true;
  } catch {
    return false;
  }
}
