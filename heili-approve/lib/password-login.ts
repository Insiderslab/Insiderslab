/**
 * Email + password sign-in, next to the magic link (lib/auth.ts).
 *
 * - Sign-in: same access rule as the magic link (canEmailSignIn), one generic
 *   error for unknown email / wrong password / no password set, and the same
 *   hashing work in every case so timing does not reveal accounts.
 * - Invitation: whoever opens a pending invitation link may create the account
 *   with a password, but only when no account exists for that email yet. An
 *   existing account is never taken over through an invitation link: its owner
 *   signs in (link via email) and sets a password in Impostazioni.
 * - Rate limits are in memory per minute (lib/mcp/rate-limit.ts: one web process).
 */

import { prisma } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { canEmailSignIn } from "@/lib/sign-in-access";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import { normalizeInvitationEmail } from "@/lib/workspace-invitations";

export type PasswordResult = { ok: true; userId: string } | { ok: false; error: string };

export const WRONG_CREDENTIALS = "Email o password non corretti.";
export const TOO_MANY_ATTEMPTS = "Troppi tentativi: aspetta un minuto e riprova.";
export const ACCOUNT_EXISTS =
  "Esiste già un account con questa email. Accedi (anche con il link via email) e poi riapri questo invito.";

const PER_EMAIL_PER_MINUTE = 5;
const PER_CLIENT_PER_MINUTE = 20;
const PER_INVITATION_PER_MINUTE = 10;
const PER_USER_PER_MINUTE = 5;

function findUserByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, passwordHash: true },
  });
}

export async function signInWithPassword(rawEmail: string, password: string, clientKey: string): Promise<PasswordResult> {
  const email = normalizeInvitationEmail(rawEmail);
  if (!email || !password) return { ok: false, error: "Inserisci email e password." };
  if (
    !checkRateLimit(`password:email:${email}`, PER_EMAIL_PER_MINUTE).allowed ||
    !checkRateLimit(`password:client:${clientKey}`, PER_CLIENT_PER_MINUTE).allowed
  ) {
    return { ok: false, error: TOO_MANY_ATTEMPTS };
  }

  const user = await findUserByEmail(email);
  if (!user?.passwordHash) {
    await burnPasswordCheck(password);
    return { ok: false, error: WRONG_CREDENTIALS };
  }
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false, error: WRONG_CREDENTIALS };
  // Told only after a correct password, so it reveals nothing to a guesser.
  if (!(await canEmailSignIn(email))) return { ok: false, error: "Questo account non ha più accesso ad Approve." };
  return { ok: true, userId: user.id };
}

export async function createAccountFromInvitation(
  token: string,
  password: string,
  confirmation: string
): Promise<PasswordResult> {
  if (!checkRateLimit(`password:invite:${token}`, PER_INVITATION_PER_MINUTE).allowed) {
    return { ok: false, error: TOO_MANY_ATTEMPTS };
  }
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  if (password !== confirmation) return { ok: false, error: "Le due password non coincidono." };

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    select: { email: true, status: true, expiresAt: true },
  });
  if (!invitation || invitation.status !== "PENDING") return { ok: false, error: "Questo invito non è più disponibile." };
  if (invitation.expiresAt <= new Date()) {
    return { ok: false, error: "L'invito è scaduto: chiedi di riceverne uno nuovo." };
  }

  const email = normalizeInvitationEmail(invitation.email);
  if (await findUserByEmail(email)) return { ok: false, error: ACCOUNT_EXISTS };

  const passwordHash = await hashPassword(password);
  let userId: string;
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash, passwordUpdatedAt: new Date() },
      select: { id: true },
    });
    userId = user.id;
  } catch (error) {
    // Unique email: the account was created in the meantime (double click, magic link).
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: ACCOUNT_EXISTS };
    throw error;
  }
  // Accepts this (and any other) pending invitation for the email.
  await ensureWorkspaceForUser(userId, email);
  return { ok: true, userId };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  confirmation: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!checkRateLimit(`password:user:${userId}`, PER_USER_PER_MINUTE).allowed) return { ok: false, error: TOO_MANY_ATTEMPTS };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) return { ok: false, error: "Sessione scaduta: accedi di nuovo." };
  if (user.passwordHash && !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, error: "La password attuale non è corretta." };
  }
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };
  if (newPassword !== confirmation) return { ok: false, error: "Le due password non coincidono." };

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), passwordUpdatedAt: new Date() },
  });
  return { ok: true };
}
