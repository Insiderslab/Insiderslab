"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { changePassword } from "@/lib/password-login";
import { sessionCookieName } from "@/lib/password-session";

export type PasswordSettingsState = { error: string | null; saved: boolean };

export async function savePasswordAction(
  _previous: PasswordSettingsState,
  formData: FormData
): Promise<PasswordSettingsState> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: "Sessione scaduta: accedi di nuovo.", saved: false };

  const result = await changePassword(
    userId,
    String(formData.get("currentPassword") ?? "").slice(0, 1000),
    String(formData.get("password") ?? "").slice(0, 1000),
    String(formData.get("confirmation") ?? "").slice(0, 1000)
  );
  if (!result.ok) return { error: result.error, saved: false };

  // A new password signs out every other device; this one stays signed in.
  const jar = await cookies();
  const current = jar.get(sessionCookieName(true))?.value ?? jar.get(sessionCookieName(false))?.value;
  if (current) {
    await prisma.session.deleteMany({ where: { userId, sessionToken: { not: current } } });
  }
  revalidatePath("/settings");
  return { error: null, saved: true };
}
