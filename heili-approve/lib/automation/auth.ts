import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { toZonedDateTimeString, zonedDateTimeToUtc } from "@/lib/metricool/payload";

export class AutomationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export type AutomationContext = { workspaceId: string; userId: string; tokenId: string };
export const hashAutomationToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newAutomationToken = () => `approve_auto_${randomBytes(32).toString("hex")}`;

const KEY_ZONE = "Europe/Rome";

/**
 * Expiry of a personal key: the end (23:59:59) of the Rome calendar day
 * `days` after today. Calendar days, not 24-hour chunks, so the date the
 * settings page shows ("Scade il …") is the one the user counted — also
 * across the DST change, where 30 × 24 h lands a day early.
 */
export function automationTokenExpiry(now: Date, days: number): Date {
  const [year, month, day] = toZonedDateTimeString(now, KEY_ZONE).slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  const expiry = zonedDateTimeToUtc(`${target}T23:59:59`, KEY_ZONE);
  // Unreachable with a fixed valid zone; keeps the signature total.
  return expiry ?? new Date(now.getTime() + days * 86400000);
}

/** Cookie sessions are deliberately not accepted on the automation API. */
export async function authenticateAutomation(request: Request): Promise<AutomationContext> {
  const match = /^Bearer (approve_auto_[a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new AutomationError("UNAUTHORIZED", "Chiave automazione mancante o non valida", 401);
  const token = await prisma.automationToken.findUnique({ where: { tokenHash: hashAutomationToken(match[1]) } });
  if (!token || token.revokedAt || token.expiresAt <= new Date()) {
    throw new AutomationError("UNAUTHORIZED", "Chiave automazione scaduta, revocata o non valida", 401);
  }
  // Removing a member invalidates every key they issued, even without explicit revocation.
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: token.workspaceId, userId: token.userId } },
    select: { id: true },
  });
  if (!member) throw new AutomationError("UNAUTHORIZED", "Accesso al workspace revocato", 401);
  return { workspaceId: token.workspaceId, userId: token.userId, tokenId: token.id };
}
