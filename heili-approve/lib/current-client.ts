/**
 * Current client ("Cliente attivo").
 *
 * The agency picks the client it is working on from the selector in the main
 * menu; dashboard, content lists, calendar and "Nuovo contenuto" then default
 * to that client (an explicit ?clientId= in the URL still wins). Kept in a
 * cookie as "<workspaceId>:<clientId>", so switching workspace drops it, and
 * always re-checked against the database: a client of another workspace, a
 * deleted or an archived one reads as "all clients".
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/db/client";

export const CURRENT_CLIENT_COOKIE = "approve_client";

/** 180 days: a per-person preference, not a secret. */
export const CURRENT_CLIENT_MAX_AGE = 60 * 60 * 24 * 180;

export function encodeCurrentClient(workspaceId: string, clientId: string): string {
  return `${workspaceId}:${clientId}`;
}

/** The client id stored for this workspace, unchecked; null when none or for another workspace. */
export function decodeCurrentClient(value: string | undefined, workspaceId: string): string | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  if (value.slice(0, separator) !== workspaceId) return null;
  const clientId = value.slice(separator + 1);
  return /^[A-Za-z0-9_-]{1,64}$/.test(clientId) ? clientId : null;
}

/** The current client's id when it still exists, belongs to the workspace and is not archived. */
export async function getCurrentClientId(workspaceId: string): Promise<string | null> {
  const store = await cookies();
  const clientId = decodeCurrentClient(store.get(CURRENT_CLIENT_COOKIE)?.value, workspaceId);
  if (!clientId) return null;
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId, archivedAt: null },
    select: { id: true },
  });
  return client?.id ?? null;
}

/**
 * The client a page should show: the one in the URL when it is valid
 * (`requested`, already checked against the workspace by the caller), else
 * the current client from the menu.
 */
export function resolveClientScope(
  requested: string,
  validIds: readonly string[],
  currentClientId: string | null
): string {
  if (requested && validIds.includes(requested)) return requested;
  if (currentClientId && validIds.includes(currentClientId)) return currentClientId;
  return "";
}
