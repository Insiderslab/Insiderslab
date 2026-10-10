"use server";

/**
 * Server actions of the agency's monthly plans ("Piani del mese"): open a
 * plan for a client's month, edit title / intro / due date, add the month's
 * other posts, and "Invia il piano al cliente".
 *
 * Every action re-reads the workspace from the session and hands it to
 * lib/plans, which matches each id against it; shapes are checked with zod.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/posts/types";
import { nobodyEmailed, submitFollowUp } from "@/components/share/messages";
import { userActor } from "@/lib/actor";
import { isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import { addPostsToPlan, createPlan, makePlanAvailable, sendPlan, updatePlan } from "@/lib/plans";
import { getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

const idSchema = z.string().trim().min(1).max(64);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Scegli il mese");
const dueSchema = z.iso.datetime({ error: "Scadenza non valida" }).nullable().optional();

const createSchema = z.object({ clientId: idSchema, month: monthSchema });
const updateSchema = z.object({
  title: z.string().max(200).optional(),
  intro: z.string().max(10_000).nullable().optional(),
  reviewDueAt: dueSchema,
});

const SESSION_EXPIRED = "Sessione scaduta: accedi di nuovo.";

export async function makePlanAvailableAction(planId: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, planId);
    await makePlanAvailable(id, workspaceId);
    revalidatePlans(id);
    return { ok: true, data: undefined, message: "Piano disponibile. Puoi copiare il link: nessun post reinviato e nessuna email di invito inviata." };
  });
}

async function withWorkspace<T>(fn: (context: WorkspaceContext) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: SESSION_EXPIRED };
  try {
    return await fn(context);
  } catch (error) {
    if (!isDomainError(error)) console.error("[plans] Action failed:", error);
    return { ok: false, error: publicErrorMessage(error) };
  }
}

function revalidatePlans(planId?: string) {
  revalidatePath("/plans");
  if (planId) revalidatePath(`/plans/${planId}`);
  revalidatePath("/posts");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

/** Opens (creates or finds) the plan of a client's month. */
export async function createPlanAction(input: { clientId: string; month: string }): Promise<ActionResult<{ id: string }>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const data = parseOrThrow(createSchema, input);
    const { plan, created } = await createPlan(workspaceId, data, userActor(userId));
    revalidatePlans(plan.id);
    return { ok: true, data: { id: plan.id }, message: created ? "Piano creato." : "Il piano di questo mese esiste già." };
  });
}

export async function updatePlanAction(
  planId: string,
  input: { title?: string; intro?: string | null; reviewDueAt?: string | null }
): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, planId);
    const data = parseOrThrow(updateSchema, input);
    await updatePlan(id, workspaceId, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.intro !== undefined ? { intro: data.intro } : {}),
      ...(data.reviewDueAt !== undefined ? { reviewDueAt: data.reviewDueAt ? new Date(data.reviewDueAt) : null } : {}),
    });
    revalidatePlans(id);
    return { ok: true, data: undefined, message: "Piano salvato." };
  });
}

export async function addPostsToPlanAction(planId: string, postIds: string[]): Promise<ActionResult<{ added: number }>> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, planId);
    const ids = parseOrThrow(z.array(idSchema).min(1, "Scegli almeno un post").max(200), postIds);
    const added = await addPostsToPlan(id, workspaceId, ids);
    revalidatePlans(id);
    return { ok: true, data: { added }, message: added === 1 ? "Post aggiunto al piano." : `${added} post aggiunti al piano.` };
  });
}

/**
 * "Invia il piano al cliente": saves title / intro / due date first, then
 * sends every draft and changes-requested post of the plan in one go, with
 * one email per reviewer for the whole plan.
 */
export async function sendPlanAction(
  planId: string,
  input: { title?: string; intro?: string | null; reviewDueAt?: string | null }
): Promise<ActionResult<{ submitted: number }>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const id = parseOrThrow(idSchema, planId);
    const data = parseOrThrow(updateSchema, input);
    const reviewDueAt = data.reviewDueAt ? new Date(data.reviewDueAt) : null;
    if (reviewDueAt && reviewDueAt.getTime() <= Date.now()) {
      return { ok: false, error: "La scadenza per la risposta è già passata." };
    }
    await updatePlan(id, workspaceId, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.intro !== undefined ? { intro: data.intro } : {}),
    });
    const result = await sendPlan(id, workspaceId, userActor(userId), { reviewDueAt });
    revalidatePlans(id);
    for (const postId of result.submitted) revalidatePath(`/posts/${postId}`);

    const count = result.submitted.length;
    const recipients = {
      clientCount: 1,
      clientsWithoutReviewers: result.clientsWithoutReviewers,
      clientsWithoutEmail: result.clientsWithoutEmail,
    };
    const linkOnly = result.clientsWithoutReviewers.length === 0 && nobodyEmailed(recipients);
    const posts = count === 1 ? "1 post" : `${count} post`;
    const head = linkOnly
      ? `Piano pronto per il cliente: ${posts} da rivedere. Manda il link qui sotto.`
      : `Piano inviato: ${posts} da rivedere${result.emailed > 0 ? `, ${result.emailed === 1 ? "1 email" : `${result.emailed} email`} al cliente` : ""}.`;
    const followUp = linkOnly ? "" : submitFollowUp(recipients).replace("«Condividi con il cliente»", "«Link del piano»");
    return { ok: true, data: { submitted: count }, message: `${head}${followUp ? ` ${followUp}` : ""}` };
  });
}
