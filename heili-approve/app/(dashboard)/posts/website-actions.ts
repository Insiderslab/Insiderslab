"use server";

/**
 * Agency actions of «Sul sito» (docs/SITO-WEB.md): allowed origins,
 * «Verifica installazione», the waiver for protected sites, revoke / new key,
 * «Apri nel punto». Every action re-reads the workspace from the session;
 * lib/website/service.ts scopes each id to it. None changes a post's status.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/posts/types";
import { isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import { isKindEnabled } from "@/lib/variant";
import {
  openOnSite,
  registerOrigins,
  renewSiteKey,
  revokeSite,
  setVerificationWaived,
  verifySite,
  type AgencySiteView,
} from "@/lib/website/service";
import { getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

const idSchema = z.string().trim().min(1).max(64);
const originsSchema = z
  .array(z.object({ origin: z.string().trim().max(2048), test: z.boolean() }).strict())
  .max(10, "Al massimo 10 indirizzi per sito.");

async function withWorkspace<T>(fn: (context: WorkspaceContext) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: "Sessione scaduta: accedi di nuovo." };
  if (!isKindEnabled("WEBSITE")) return { ok: false, error: "I siti web non sono disponibili in questa istanza." };
  try {
    return await fn(context);
  } catch (error) {
    if (!isDomainError(error)) console.error("[website] Action failed:", error);
    return { ok: false, error: publicErrorMessage(error) };
  }
}

function done(postId: string, site: AgencySiteView, message: string): ActionResult<AgencySiteView> {
  revalidatePath(`/posts/${postId}`);
  return { ok: true, data: site, message };
}

export async function saveOriginsAction(postId: string, origins: Array<{ origin: string; test: boolean }>) {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, postId);
    const site = await registerOrigins(id, workspaceId, parseOrThrow(originsSchema, origins));
    return done(id, site, "Indirizzi salvati.");
  });
}

export async function verifySiteAction(postId: string) {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, postId);
    const site = await verifySite(id, workspaceId);
    return done(id, site, site.verifyMessage ?? "Verifica eseguita.");
  });
}

export async function waiveVerificationAction(postId: string, waived: boolean) {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, postId);
    const site = await setVerificationWaived(id, workspaceId, parseOrThrow(z.boolean(), waived));
    return done(id, site, waived ? "Registrato: invierai senza verifica." : "Verifica di nuovo richiesta.");
  });
}

export async function revokeSiteAction(postId: string) {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, postId);
    const site = await revokeSite(id, workspaceId);
    return done(id, site, "Chiave revocata: lo script non fa più nulla. Toglilo dal sito.");
  });
}

export async function renewSiteKeyAction(postId: string) {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, postId);
    const site = await renewSiteKey(id, workspaceId);
    return done(id, site, "Nuova chiave creata: aggiorna la riga di codice sul sito e verifica di nuovo.");
  });
}

export async function openOnSiteAction(commentId: string) {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const id = parseOrThrow(idSchema, commentId);
    const opened = await openOnSite(id, workspaceId, userId);
    return { ok: true as const, data: opened };
  });
}
