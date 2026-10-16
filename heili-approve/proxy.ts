import { NextResponse, type NextRequest } from "next/server";

// Agency-only areas. The client portal (/review/...) and public media
// (/media/...) are deliberately not listed: they authenticate by token. So are
// the MCP endpoint (/mcp) and its /.well-known discovery documents: they use
// bearer tokens (OAuth or a personal key, lib/mcp) and must never get a login redirect.
const PROTECTED_PREFIXES = ["/dashboard", "/posts", "/calendar", "/plans", "/clients", "/settings", "/guida"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

/**
 * The Auth.js routes this app actually uses (email sign-in). Bots probe
 * /api/auth/login, /api/auth/wp-admin and the like: answering 404 here keeps
 * Auth.js from logging UnknownAction / InvalidProvider errors for them.
 */
const AUTH_ACTIONS = ["signin", "signout", "session", "csrf", "providers", "verify-request", "error"];

export function isAllowedAuthPath(pathname: string): boolean {
  const rest = pathname.replace(/\/$/, "");
  return AUTH_ACTIONS.some((action) => rest === `/api/auth/${action}`) || rest.startsWith("/api/auth/callback/");
}

/**
 * The «Sul sito» iframe (/embed/site?k=hs_…) may be framed only by the exact
 * origins registered for that site key (docs/SITO-WEB.md). proxy.ts runs on
 * Node.js in Next 16, so the list is read from the database (cached 60 s in
 * lib/website/sites.ts). Unknown key, revoked site or a database error →
 * frame-ancestors 'none'. The code exchange checks the origin again anyway.
 */
export async function embedFramePolicy(siteKey: string | null): Promise<string> {
  let ancestors = "'none'";
  try {
    const { frameAncestorsFor } = await import("@/lib/website/sites");
    ancestors = await frameAncestorsFor(siteKey);
  } catch (error) {
    console.error("[proxy] frame-ancestors lookup failed:", error instanceof Error ? error.message : error);
  }
  return `frame-ancestors ${ancestors}; base-uri 'self'; object-src 'none'`;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/embed" || pathname.startsWith("/embed/")) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", await embedFramePolicy(request.nextUrl.searchParams.get("k")));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (pathname.startsWith("/api/auth/") && !isAllowedAuthPath(pathname)) {
    return new NextResponse(null, { status: 404 });
  }
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  // Only a cheap pre-check: a cookie may belong to a session that no longer
  // exists. /login is therefore never redirected here (that would loop with
  // the dashboard's own redirect to /login): the login page checks the real
  // session and sends signed-in users on.
  if (isProtected && !hasSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/posts/:path*",
    "/calendar/:path*",
    "/plans/:path*",
    "/clients/:path*",
    "/settings/:path*",
    "/guida/:path*",
    "/api/auth/:path*",
    "/embed/:path*",
  ],
};
