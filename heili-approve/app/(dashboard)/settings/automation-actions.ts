"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { hashAutomationToken, newAutomationToken } from "@/lib/automation/auth";

const inputSchema = z.object({ name: z.string().trim().min(1).max(80), days: z.number().int().min(1).max(90) });

export async function createAutomationToken(input: { name: string; days: number }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false as const, error: "Accedi per creare una chiave" };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Inserisci un nome e una durata da 1 a 90 giorni" };
  const token = newAutomationToken();
  const expiresAt = new Date(Date.now() + parsed.data.days * 86400000);
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-keys:${context.workspaceId}:${context.userId}`}, 0))`;
    const count = await tx.automationToken.count({ where: { workspaceId: context.workspaceId, userId: context.userId, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (count >= 10) return { ok: false as const, error: "Hai già 10 chiavi attive: revocane una prima di crearne un'altra" };
    const created = await tx.automationToken.create({ data: {
      workspaceId: context.workspaceId, userId: context.userId, name: parsed.data.name,
      tokenHash: hashAutomationToken(token), expiresAt,
    }, select: { id: true } });
    return { ok: true as const, id: created.id, token, expiresAt: expiresAt.toISOString() };
  });
  revalidatePath("/settings");
  return result;
}

export async function revokeAutomationToken(id: string) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false as const, error: "Accedi per revocare la chiave" };
  if (typeof id !== "string" || id.length > 64) return { ok: false as const, error: "Chiave non valida" };
  // Every member manages their own keys. Workspace administrators can remove
  // a member to invalidate all that member's keys immediately at API auth.
  await prisma.automationToken.updateMany({
    where: { id, workspaceId: context.workspaceId, userId: context.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}
