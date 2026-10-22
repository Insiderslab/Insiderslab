import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db/client";

/** Auth.js default session lifetime (lib/auth.ts does not change it). */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Same rule Auth.js uses to pick the cookie name (@auth/core createActionURL):
 * AUTH_URL / NEXTAUTH_URL when set, otherwise the forwarded protocol.
 */
export function usesSecureCookies(
  env: { AUTH_URL?: string; NEXTAUTH_URL?: string },
  forwardedProto: string | null
): boolean {
  const envUrl = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (envUrl) return envUrl.startsWith("https:");
  return (forwardedProto ?? "https").replace(/:$/, "") === "https";
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/**
 * Signs the user in after a password check: the same database session and
 * cookie Auth.js creates after a magic link, so auth(), the proxy check and
 * sign-out work unchanged. Call only from a server action or route handler.
 */
export async function startDatabaseSession(userId: string): Promise<void> {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.session.create({ data: { sessionToken, userId, expires } });

  const secure = usesSecureCookies(
    { AUTH_URL: process.env.AUTH_URL, NEXTAUTH_URL: process.env.NEXTAUTH_URL },
    (await headers()).get("x-forwarded-proto")
  );
  (await cookies()).set(sessionCookieName(secure), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires,
  });
}
