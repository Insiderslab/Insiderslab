import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/active-workspace";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * POST /api/workspace/switch
 * Body: { workspaceId }. Validates the membership before setting the active
 * workspace cookie, so a forged request cannot land the user in someone
 * else's workspace.
 */
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const workspaceId =
    typeof body.workspaceId === "string" ? body.workspaceId : null;
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Missing workspaceId" },
      { status: 400 }
    );
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { workspace: { select: { name: true } } },
  });
  if (!membership) {
    return NextResponse.json(
      { success: false, error: "Not a member of this workspace" },
      { status: 403 }
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({
    success: true,
    data: { workspaceId, workspaceName: membership.workspace.name },
  });
}
