"use server";

import { redirect } from "next/navigation";
import { resetPasswordWithToken } from "@/lib/password-login";
import { startDatabaseSession } from "@/lib/password-session";

export type NewPasswordState = { error: string | null };

export async function setNewPasswordAction(_previous: NewPasswordState, formData: FormData): Promise<NewPasswordState> {
  const result = await resetPasswordWithToken(
    String(formData.get("token") ?? "").slice(0, 200),
    String(formData.get("password") ?? "").slice(0, 1000),
    String(formData.get("confirmation") ?? "").slice(0, 1000)
  );
  if (!result.ok) return { error: result.error };
  await startDatabaseSession(result.userId);
  redirect("/dashboard");
}
