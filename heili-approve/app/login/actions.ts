"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EMAIL_PROVIDER_ID, signIn } from "@/lib/auth";
import { requestPasswordReset, signInWithPassword } from "@/lib/password-login";
import { startDatabaseSession } from "@/lib/password-session";
import { safeCallbackUrl } from "./callback-url";

export type LoginFormState = { error: string | null; email: string };
export type ResetRequestState = { error: string | null; sentTo: string | null };

async function clientKey(): Promise<string> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
}

export async function passwordSignInAction(_previous: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "").slice(0, 320);
  const password = String(formData.get("password") ?? "").slice(0, 1000);
  const result = await signInWithPassword(email, password, await clientKey());
  if (!result.ok) return { error: result.error, email };
  await startDatabaseSession(result.userId);
  redirect(safeCallbackUrl(String(formData.get("callbackUrl") ?? "")));
}

export async function magicLinkAction(formData: FormData): Promise<void> {
  await signIn(EMAIL_PROVIDER_ID, {
    email: String(formData.get("email") ?? ""),
    redirectTo: safeCallbackUrl(String(formData.get("callbackUrl") ?? "")),
  });
}

export async function requestPasswordResetAction(_previous: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "").trim().slice(0, 320);
  const result = await requestPasswordReset(email, await clientKey());
  if (!result.ok) return { error: result.error, sentTo: null };
  return { error: null, sentTo: email };
}
