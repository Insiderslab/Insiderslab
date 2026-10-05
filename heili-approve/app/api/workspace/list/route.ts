import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUserId } from "@/lib/auth";
import { listUserWorkspaces, ACTIVE_WORKSPACE_COOKIE } from "@/lib/active-workspace";

/**
 * GET /api/workspace/list
 * Every workspace the signed-in user belongs to, plus the currently active one.
 * Drives the sidebar profile switcher.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const memberships = await listUserWorkspaces(userId);
  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;

  return NextResponse.json({
    success: true,
    data: {
      activeWorkspaceId:
        activeId && memberships.some((m) => m.workspaceId === activeId)
          ? activeId
          : (memberships[0]?.workspaceId ?? null),
      workspaces: memberships.map((m) => ({
        id: m.workspaceId,
        name: m.workspace.name,
        role: m.role,
      })),
    },
  });
}
