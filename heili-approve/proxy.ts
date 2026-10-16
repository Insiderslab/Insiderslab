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

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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
  ],
};
