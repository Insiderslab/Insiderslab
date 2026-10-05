import { NextResponse, type NextRequest } from "next/server";

// Agency-only areas. The client portal (/review/...) and public media
// (/media/...) are deliberately not listed: they authenticate by token.
const PROTECTED_PREFIXES = ["/dashboard", "/posts", "/calendar", "/clients", "/settings"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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
    "/clients/:path*",
    "/settings/:path*",
  ],
};
