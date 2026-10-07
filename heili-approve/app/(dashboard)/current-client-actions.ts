"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import {
  CURRENT_CLIENT_COOKIE,
  CURRENT_CLIENT_MAX_AGE,
  encodeCurrentClient,
} from "@/lib/current-client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

/**
 * Sets the client the agency works on (selector in the main menu), or clears
 * it with null ("Tutti i clienti"). Only clients of the current workspace.
 */
export async function setCurrentClientAction(
  clientId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: "Sessione scaduta: accedi di nuovo." };

  const store = await cookies();
  if (!clientId) {
    store.delete(CURRENT_CLIENT_COOKIE);
  } else {
    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId: context.workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!client) return { ok: false, error: "Cliente non trovato." };
    store.set(CURRENT_CLIENT_COOKIE, encodeCurrentClient(context.workspaceId, client.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CURRENT_CLIENT_MAX_AGE,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
