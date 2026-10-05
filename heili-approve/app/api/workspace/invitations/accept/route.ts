import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { normalizeInvitationEmail } from "@/lib/workspace-invitations";
import { hasWorkspaceRole } from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json(
      { success: false, error: "Accedi prima con l'indirizzo email invitato" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : null;
  if (!token) {
    return NextResponse.json(
      { success: false, error: "Invito non valido" },
      { status: 400 }
    );
  }

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: { workspace: { select: { name: true } } },
  });
  if (!invitation || invitation.status !== "PENDING") {
    return NextResponse.json(
      { success: false, error: "Questo invito non è più disponibile" },
      { status: 404 }
    );
  }

  if (invitation.expiresAt <= new Date()) {
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    return NextResponse.json(
      { success: false, error: "L'invito è scaduto: chiedi di riceverne uno nuovo" },
      { status: 410 }
    );
  }

  if (normalizeInvitationEmail(session.user.email) !== invitation.email) {
    return NextResponse.json(
      { success: false, error: "Questo invito è per un altro indirizzo email" },
      { status: 403 }
    );
  }

  const userId = session.user.id;
  await prisma.$transaction(async (tx) => {
    const membershipKey = {
      workspaceId_userId: {
        workspaceId: invitation.workspaceId,
        userId,
      },
    };
    const existing = await tx.workspaceMember.findUnique({
      where: membershipKey,
      select: { id: true, role: true },
    });
    if (!existing) {
      await tx.workspaceMember.upsert({
        where: membershipKey,
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
        update: {},
      });
    } else if (!hasWorkspaceRole(existing.role, invitation.role)) {
      // Accepting an invitation can only raise a role, never lower it
      // (in particular it can never demote the OWNER).
      await tx.workspaceMember.updateMany({
        where: { id: existing.id, role: { not: "OWNER" } },
        data: { role: invitation.role },
      });
    }
    await tx.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
  });

  return NextResponse.json({
    success: true,
    data: {
      workspaceName: invitation.workspace.name,
    },
  });
}

