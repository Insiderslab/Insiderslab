/**
 * Who is calling and what they may touch.
 *
 * A principal is either an OAuth user (verified email → existing Approve user)
 * or a personal automation key. Both are scoped exactly like the panel: the
 * workspaces the user is a member of (lib/workspace-access.ts). The MCP has no
 * "active workspace" cookie, so a caller that belongs to several workspaces
 * reaches all of them, and every record is looked up WITH the workspace filter:
 * an id from another workspace is "not found", never "forbidden".
 */

import type { Client, WorkspaceRole } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { McpScope } from "./config";

export interface McpWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface McpPrincipal {
  kind: "oauth" | "automation";
  userId: string;
  email?: string;
  scopes: McpScope[];
  workspaces: McpWorkspace[];
  /** AutomationToken.id, for keys. */
  tokenId?: string;
  /** OAuth client (`azp`), which AI app is calling. */
  oauthClientId?: string;
  /** Rate-limit bucket: one per identity (user, or key). */
  rateKey: string;
}

export function hasScope(principal: McpPrincipal, scope: McpScope): boolean {
  return principal.scopes.includes(scope);
}

export function workspaceIdsOf(principal: McpPrincipal): string[] {
  return principal.workspaces.map((workspace) => workspace.id);
}

/** A client of one of the caller's workspaces (archived ones too only when asked). */
export async function requireClient(
  principal: McpPrincipal,
  clientId: string,
  options: { allowArchived?: boolean } = {}
): Promise<Client> {
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      workspaceId: { in: workspaceIdsOf(principal) },
      ...(options.allowArchived ? {} : { archivedAt: null }),
    },
  });
  if (!client) throw new NotFoundError("Cliente non trovato");
  return client;
}

/**
 * The workspace a workspace-level action (an upload) belongs to: the client's,
 * or the only one the caller has. Several workspaces and no client → ask.
 */
export async function resolveWorkspaceId(principal: McpPrincipal, clientId?: string): Promise<string> {
  if (clientId) return (await requireClient(principal, clientId)).workspaceId;
  if (principal.workspaces.length === 1) return principal.workspaces[0].id;
  throw new ValidationError("Indica client_id: puoi lavorare su più workspace");
}

export function workspaceName(principal: McpPrincipal, workspaceId: string): string {
  return principal.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? "";
}
