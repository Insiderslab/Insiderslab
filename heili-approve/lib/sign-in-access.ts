import { prisma } from "@/lib/db/client";
import { isEmailAllowedToSignIn } from "@/lib/env";

/**
 * Who may sign in to the agency side. ALLOWED_EMAILS keeps strangers from
 * creating workspaces, but a teammate invited from Impostazioni › Team (or
 * already a member of a workspace) must get in without editing the server's
 * environment: an invitation is created by a member, so it is the agency's
 * own decision.
 */
export async function canEmailSignIn(
  email: string | null | undefined,
  options: { allowPendingInvitation?: boolean } = {}
): Promise<boolean> {
  if (isEmailAllowedToSignIn(email)) return true;
  if (!email) return false;
  const address = email.trim();
  if (!address) return false;

  const member = await prisma.workspaceMember.findFirst({
    where: { user: { email: { equals: address, mode: "insensitive" } } },
    select: { id: true },
  });
  if (member) return true;
  if (options.allowPendingInvitation === false) return false;

  const invitation = await prisma.workspaceInvitation.findFirst({
    where: { email: { equals: address, mode: "insensitive" }, status: "PENDING", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(invitation);
}
