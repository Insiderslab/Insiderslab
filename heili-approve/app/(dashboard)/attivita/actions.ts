"use server";

/**
 * Server actions for the Attività page.
 *
 * Like the clients actions, each one re-reads the workspace from the session
 * and passes it to lib/activity, which matches every id against it. Input is
 * untrusted: ids are checked with zod here.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/clients/action-result";
import { assign, markAllNotificationsRead, markDone, reopen } from "@/lib/activity";
import { isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import { getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

const idSchema = z.string().trim().min(1).max(64);

const SESSION_EXPIRED = "Sessione scaduta: accedi di nuovo.";

async function withWorkspace<T>(
  fn: (context: WorkspaceContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: SESSION_EXPIRED };
  try {
    return await fn(context);
  } catch (error) {
    if (!isDomainError(error)) console.error("[attivita] Action failed:", error);
    return { ok: false, error: publicErrorMessage(error) };
  }
}

function revalidateActivity() {
  revalidatePath("/attivita");
}

/** "Fatto": closes an open task, recording who did it. */
export async function markDoneAction(id: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const activityId = parseOrThrow(idSchema, id);
    await markDone(workspaceId, activityId, userId);
    revalidateActivity();
    return { ok: true, data: undefined };
  });
}

/** "Riapri": reopens a completed task. */
export async function reopenAction(id: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const activityId = parseOrThrow(idSchema, id);
    await reopen(workspaceId, activityId);
    revalidateActivity();
    return { ok: true, data: undefined };
  });
}

/** "Assegna a…": assigns the task to a member, or unassigns with null. */
export async function assignAction(id: string, assigneeUserId: string | null): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const activityId = parseOrThrow(idSchema, id);
    const target = assigneeUserId === null ? null : parseOrThrow(idSchema, assigneeUserId);
    await assign(workspaceId, activityId, target);
    revalidateActivity();
    return { ok: true, data: undefined };
  });
}

/** "Segna tutte come lette": marks the user's unread notifications as read. */
export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    await markAllNotificationsRead(workspaceId, userId);
    revalidateActivity();
    return { ok: true, data: undefined };
  });
}
