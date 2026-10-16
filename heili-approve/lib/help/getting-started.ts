/**
 * «Per iniziare»: the four basic steps an agency goes through the first time
 * (a client, a first post, a first send, a first approval), worked out from
 * the workspace's real data. No table of its own: every step is a fact the
 * database already holds. Pure, safe to import from client components; the
 * query lives in getting-started-data.ts.
 *
 * The list leaves the dashboard by itself once every step is done. Before that
 * the agency can close it: the choice is remembered in this browser only
 * (localStorage, per workspace), and a blocked storage simply shows it again.
 */

import type { ContentKind } from "@/app/generated/prisma/client";

/** What the workspace has done so far (counts, any client, archived included). */
export interface GettingStartedFacts {
  clients: number;
  posts: number;
  /** Contents sent to the client at least once. */
  submitted: number;
  /** Contents the client approved (approval still standing, or already scheduled / delivered). */
  approved: number;
}

export type GettingStartedStepId = "client" | "post" | "submit" | "approval";

export interface GettingStartedLink {
  label: string;
  href: string;
}

export interface GettingStartedStep {
  id: GettingStartedStepId;
  title: string;
  text: string;
  done: boolean;
  /** Where to do it. */
  action: GettingStartedLink;
  /** A second way, e.g. «Importa da un foglio». */
  secondary?: GettingStartedLink;
}

/**
 * The steps, in order, for the content kinds of this instance. Social posts
 * get the import from a sheet; other kinds speak of «contenuto».
 */
export function gettingStartedSteps(facts: GettingStartedFacts, kinds: readonly ContentKind[]): GettingStartedStep[] {
  const social = kinds.includes("SOCIAL_POST");
  const single = kinds.length === 1 ? kinds[0] : null;
  const noun = single === "SOCIAL_POST" ? "post" : single === "BLOG_ARTICLE" ? "articolo" : "contenuto";
  const theFirst = single === "AD_CREATIVE" ? "il primo set di creatività" : `il primo ${noun}`;

  return [
    {
      id: "client",
      title: "Aggiungi il primo cliente",
      text: "Nome, servizi e, per i social, il brand Metricool. Poi aggiungi la persona che approva.",
      done: facts.clients > 0,
      action: { label: "Aggiungi il cliente", href: "/clients/new" },
    },
    {
      id: "post",
      title: `Crea o importa ${theFirst}`,
      text: social
        ? "Scrivi un post con foto o video, oppure carica un foglio con tutti i post del mese."
        : "Prepara il contenuto con l'anteprima: resta una bozza finché non lo invii.",
      done: facts.posts > 0,
      action: { label: single === "SOCIAL_POST" ? "Nuovo post" : "Nuovo contenuto", href: "/posts/new" },
      ...(social ? { secondary: { label: "Importa da un foglio", href: "/posts/import" } } : {}),
    },
    {
      id: "submit",
      title: "Invialo in revisione",
      text: "Apri la bozza, tocca «Invia in revisione» e manda il link al cliente, anche su WhatsApp.",
      done: facts.submitted > 0,
      action: { label: "Apri le bozze", href: "/posts?status=DRAFT" },
    },
    {
      id: "approval",
      title: "Ricevi la prima approvazione",
      text: "Il cliente apre il link dal telefono e approva o chiede modifiche. Questo passo si spunta da solo.",
      done: facts.approved > 0,
      action: { label: "Vedi cosa è in revisione", href: "/posts?status=IN_REVIEW" },
    },
  ];
}

/** The first step still to do, or null when all are done. */
export function nextGettingStartedStep(steps: readonly GettingStartedStep[]): GettingStartedStep | null {
  return steps.find((step) => !step.done) ?? null;
}

export function gettingStartedProgress(steps: readonly GettingStartedStep[]): { done: number; total: number } {
  return { done: steps.filter((step) => step.done).length, total: steps.length };
}

/** The list shows until every step is done, unless the agency closed it here. */
export function showGettingStarted(steps: readonly GettingStartedStep[], dismissed: boolean): boolean {
  return !dismissed && nextGettingStartedStep(steps) !== null;
}

// ─── Closing it (this browser only) ──────────────────────────────────────────

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function gettingStartedStorageKey(workspaceId: string): string {
  return `approve.per-iniziare.chiuso.${workspaceId}`;
}

/** True when closed in this browser; a missing or blocked storage counts as «not closed». */
export function readGettingStartedDismissed(storage: ReadableStorage | null | undefined, workspaceId: string): boolean {
  try {
    return storage?.getItem(gettingStartedStorageKey(workspaceId)) === "1";
  } catch {
    return false;
  }
}

/** Remembers the choice; false when the browser does not let us (the list comes back next time). */
export function writeGettingStartedDismissed(storage: WritableStorage | null | undefined, workspaceId: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(gettingStartedStorageKey(workspaceId), "1");
    return true;
  } catch {
    return false;
  }
}
