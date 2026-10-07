"use server";

/**
 * Server actions for clients and their reviewers.
 *
 * Every action re-reads the workspace from the session (actions are plain
 * POST endpoints, reachable without the UI) and passes it to the lib/
 * services, which match every id against it. Input is untrusted: ids are
 * checked with zod here, payloads by the services' own zod schemas.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/components/clients/action-result";
import {
  archiveClient,
  createClient,
  restoreClient,
  updateClient,
  type ClientInput,
} from "@/lib/clients";
import { isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import {
  NO_EMAIL_MESSAGE,
  createReviewer,
  deactivateReviewer,
  reactivateReviewer,
  rotateReviewerLink,
  sendReviewerLink,
} from "@/lib/reviewers";
import { getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

const idSchema = z.string().trim().min(1).max(64);

const addReviewerSchema = z.object({
  name: z.string(),
  /** Optional: without it the agency shares the link itself. */
  email: z.string().nullish(),
  sendInvite: z.boolean().default(false),
});

const SESSION_EXPIRED = "Sessione scaduta: accedi di nuovo.";
const EMAIL_FAILED =
  "Non è stato possibile inviare l'email: copia il link e mandalo tu al referente.";

/** Runs `fn` for the signed-in workspace, mapping domain errors to messages. */
async function withWorkspace<T>(
  fn: (context: WorkspaceContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: SESSION_EXPIRED };
  try {
    return await fn(context);
  } catch (error) {
    if (!isDomainError(error)) console.error("[clients] Action failed:", error);
    return { ok: false, error: publicErrorMessage(error) };
  }
}

function revalidateClient(clientId?: string) {
  revalidatePath("/clients");
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

// ─── Clients ─────────────────────────────────────────────────────────────────

/** Creates the client and opens its page (where reviewers are added). */
export async function createClientAction(input: ClientInput): Promise<ActionResult> {
  const result = await withWorkspace(async ({ workspaceId }) => {
    const client = await createClient(workspaceId, input);
    return { ok: true, data: { id: client.id } };
  });
  if (!result.ok) return result;

  revalidateClient();
  // Outside withWorkspace's try: redirect() works by throwing.
  redirect(`/clients/${result.data.id}?nuovo=1`);
}

export async function updateClientAction(
  clientId: string,
  input: ClientInput
): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, clientId);
    await updateClient(id, workspaceId, input);
    revalidateClient(id);
    return { ok: true, data: undefined, message: "Modifiche salvate." };
  });
}

export async function archiveClientAction(clientId: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, clientId);
    await archiveClient(id, workspaceId);
    revalidateClient(id);
    return {
      ok: true,
      data: undefined,
      message: "Cliente archiviato: i link dei referenti non funzionano più.",
    };
  });
}

export async function restoreClientAction(clientId: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, clientId);
    await restoreClient(id, workspaceId);
    revalidateClient(id);
    return { ok: true, data: undefined, message: "Cliente ripristinato." };
  });
}

// ─── Reviewers ───────────────────────────────────────────────────────────────

/**
 * Adds a reviewer (or reactivates one with the same email, with a new link)
 * and optionally emails them the link right away. The email is optional:
 * without it the link is shown to copy or send on WhatsApp.
 */
export async function addReviewerAction(
  clientId: string,
  input: { name: string; email?: string | null; sendInvite?: boolean }
): Promise<
  ActionResult<{ reviewerId: string; reviewerName: string; reviewUrl: string; emailSent: boolean | null }>
> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, clientId);
    const data = parseOrThrow(addReviewerSchema, input);
    const { reviewer, reviewUrl } = await createReviewer(id, workspaceId, {
      name: data.name,
      email: data.email,
    });

    let emailSent: boolean | null = null;
    if (data.sendInvite && reviewer.email) {
      emailSent = await sendReviewerLink(reviewer.id, workspaceId).catch((error) => {
        console.error("[clients] Failed to send reviewer link:", error instanceof Error ? error.name : "unknown");
        return false;
      });
    }

    revalidateClient(id);
    return {
      ok: true,
      data: { reviewerId: reviewer.id, reviewerName: reviewer.name, reviewUrl, emailSent },
      message:
        emailSent === null
          ? `Link creato per ${reviewer.name}: copialo o mandalo su WhatsApp.`
          : emailSent
            ? `Referente aggiunto (${reviewer.name}): il link è stato inviato via email.`
            : `Referente aggiunto (${reviewer.name}). ${EMAIL_FAILED}`,
    };
  });
}

/** Turns a deactivated reviewer back on: same name and email, brand new link. */
export async function reactivateReviewerAction(
  reviewerId: string
): Promise<ActionResult<{ reviewerId: string; reviewUrl: string }>> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, reviewerId);
    const { reviewer, reviewUrl } = await reactivateReviewer(id, workspaceId);
    revalidateClient(reviewer.clientId);
    return {
      ok: true,
      data: { reviewerId: reviewer.id, reviewUrl },
      message: `${reviewer.name} è di nuovo attivo, con un nuovo link: copialo o mandalo su WhatsApp.`,
    };
  });
}

/** New link for the reviewer; the old one stops working immediately. */
export async function rotateReviewerLinkAction(
  reviewerId: string,
  options: { sendEmail?: boolean } = {}
): Promise<ActionResult<{ reviewUrl: string; emailSent: boolean | null }>> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, reviewerId);
    const sendEmail = parseOrThrow(z.boolean().default(false), options?.sendEmail);
    const { reviewer, reviewUrl } = await rotateReviewerLink(id, workspaceId);

    let emailSent: boolean | null = null;
    if (sendEmail && reviewer.active && reviewer.email) {
      emailSent = await sendReviewerLink(reviewer.id, workspaceId).catch(() => false);
    }

    revalidateClient(reviewer.clientId);
    return {
      ok: true,
      data: { reviewUrl, emailSent },
      message:
        emailSent === false
          ? `Nuovo link creato: il vecchio non funziona più. ${EMAIL_FAILED}`
          : emailSent
            ? "Nuovo link creato e inviato via email: il vecchio non funziona più."
            : sendEmail && !reviewer.email
              ? `Nuovo link creato: il vecchio non funziona più. ${NO_EMAIL_MESSAGE}`
              : "Nuovo link creato: il vecchio non funziona più.",
    };
  });
}

export async function deactivateReviewerAction(reviewerId: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, reviewerId);
    const reviewer = await deactivateReviewer(id, workspaceId);
    revalidateClient(reviewer.clientId);
    return {
      ok: true,
      data: undefined,
      message: `Referente disattivato (${reviewer.name}): il link non funziona più e non riceverà email.`,
    };
  });
}

/** Emails the reviewer their current link ("Reinvia link"). */
export async function resendReviewerLinkAction(reviewerId: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, reviewerId);
    const sent = await sendReviewerLink(id, workspaceId);
    if (!sent) return { ok: false, error: EMAIL_FAILED };
    return { ok: true, data: undefined, message: "Link inviato via email." };
  });
}
