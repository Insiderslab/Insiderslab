import { cookies } from "next/headers";
import { prisma } from "@/lib/db/client";
import type { Workspace, WorkspaceRole } from "@/app/generated/prisma/client";
import { getWorkspaceMembership } from "@/lib/workspace";

/**
 * Active workspace selection ("profile switcher").
 *
 * A user can belong to many workspaces (e.g. the 3Runes team belongs to every
 * client workspace). The active one is stored in a plain (non-httpOnly) cookie
 * so both the server and the sidebar switcher can see it. Every read validates
 * the membership server-side: a forged cookie pointing at someone else's
 * workspace simply falls back to the user's primary workspace.
 */
export const ACTIVE_WORKSPACE_COOKIE = "heili-approve-active-workspace";

export type ActiveWorkspace = {
  workspace: Workspace;
  role: WorkspaceRole;
};

export async function listUserWorkspaces(userId: string) {
  return prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getActiveWorkspaceForUser(
  userId: string
): Promise<ActiveWorkspace | null> {
  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;

  if (activeId) {
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: activeId, userId },
      },
      include: { workspace: true },
    });
    if (membership) {
      return { workspace: membership.workspace, role: membership.role };
    }
    // Stale or forged cookie: fall through to the primary workspace.
  }

  return getWorkspaceMembership(userId);
}
