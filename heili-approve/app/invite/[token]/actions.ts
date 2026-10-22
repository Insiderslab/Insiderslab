"use server";

import { redirect } from "next/navigation";
import { createAccountFromInvitation } from "@/lib/password-login";
import { startDatabaseSession } from "@/lib/password-session";

export type InvitePasswordState = { error: string | null };

export async function createPasswordFromInvitationAction(
  _previous: InvitePasswordState,
  formData: FormData
): Promise<InvitePasswordState> {
  const token = String(formData.get("token") ?? "").slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 1000);
  const confirmation = String(formData.get("confirmation") ?? "").slice(0, 1000);
  const result = await createAccountFromInvitation(token, password, confirmation);
  if (!result.ok) return { error: result.error };
  await startDatabaseSession(result.userId);
  redirect("/dashboard");
}
