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
 * - Reset: «Password dimenticata?» emails a one-hour link (VerificationToken,
 *   identifier "password-reset:<email>", token stored hashed). Opening it sets a
 *   new password (or a first one), signs out every device and signs in. The
 *   request always answers the same, so it never reveals which emails exist.
 * - Rate limits are in memory per minute (lib/mcp/rate-limit.ts: one web process).
 */

import { generateToken, hashToken } from "@/lib/crypto";
import { prisma } from "@/lib/db/client";
import { renderEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/env";
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
const RESET_REQUESTS_PER_EMAIL_PER_MINUTE = 2;
const RESET_REQUESTS_PER_CLIENT_PER_MINUTE = 10;
const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_PREFIX = "password-reset:";
export const RESET_LINK_INVALID = "Questo link non è più valido: chiedine uno nuovo dalla pagina di accesso.";

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

/** Sends the reset link when the email has an account that may sign in. Never tells which. */
export async function requestPasswordReset(rawEmail: string, clientKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeInvitationEmail(rawEmail);
  if (!email || !email.includes("@")) return { ok: false, error: "Scrivi la tua email." };
  if (
    !checkRateLimit(`reset:email:${email}`, RESET_REQUESTS_PER_EMAIL_PER_MINUTE).allowed ||
    !checkRateLimit(`reset:client:${clientKey}`, RESET_REQUESTS_PER_CLIENT_PER_MINUTE).allowed
  ) {
    return { ok: false, error: TOO_MANY_ATTEMPTS };
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, passwordHash: true },
  });
  if (!user || !(await canEmailSignIn(email))) return { ok: true };

  const identifier = `${RESET_PREFIX}${email}`;
  const token = generateToken(32);
  // One live link per email: a new request replaces the previous one.
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  await prisma.verificationToken.create({
    data: { identifier, token: hashToken(token), expires: new Date(Date.now() + RESET_TTL_MS) },
  });

  const url = `${getBaseUrl().replace(/\/$/, "")}/nuova-password/${token}`;
  const action = user.passwordHash ? "scegliere una nuova password" : "scegliere la tua password";
  const { html, text } = renderEmail({
    heading: user.passwordHash ? "Nuova password" : "La tua password",
    paragraphs: [
      `Hai chiesto di ${action} per Approve by Heili. Tocca il pulsante: il link vale un'ora e si usa una volta sola.`,
      "Se non sei stato tu, ignora questa email: la password attuale resta valida.",
    ],
    cta: { label: user.passwordHash ? "Scegli una nuova password" : "Scegli la password", url },
  });
  const sent = await sendEmail({ to: email, subject: "La tua password di Approve by Heili", html, text });
  if (!sent.ok) console.error("[password-reset] email not sent:", sent.error ?? "unknown error");
  return { ok: true };
}

/** Whether a reset link can still be used (for the page, before the form). */
export async function isResetTokenUsable(token: string): Promise<boolean> {
  if (!token) return false;
  const row = await prisma.verificationToken.findFirst({
    where: { token: hashToken(token), identifier: { startsWith: RESET_PREFIX } },
    select: { expires: true },
  });
  return Boolean(row && row.expires > new Date());
}

export async function resetPasswordWithToken(token: string, password: string, confirmation: string): Promise<PasswordResult> {
  if (!checkRateLimit(`reset:token:${hashToken(token)}`, PER_INVITATION_PER_MINUTE).allowed) {
    return { ok: false, error: TOO_MANY_ATTEMPTS };
  }
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  if (password !== confirmation) return { ok: false, error: "Le due password non coincidono." };

  const row = await prisma.verificationToken.findFirst({
    where: { token: hashToken(token), identifier: { startsWith: RESET_PREFIX } },
  });
  if (!row) return { ok: false, error: RESET_LINK_INVALID };
  // Single use, whatever happens next.
  await prisma.verificationToken.deleteMany({ where: { identifier: row.identifier } });
  if (row.expires <= new Date()) return { ok: false, error: RESET_LINK_INVALID };

  const email = row.identifier.slice(RESET_PREFIX.length);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user || !(await canEmailSignIn(email))) return { ok: false, error: RESET_LINK_INVALID };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), passwordUpdatedAt: new Date() },
  });
  // A reset may follow a stolen password: every device signs in again.
  await prisma.session.deleteMany({ where: { userId: user.id } });
  return { ok: true, userId: user.id };
}
