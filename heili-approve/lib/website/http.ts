/**
 * Plumbing of the public /api/site/v1 routes (the «Sul sito» iframe):
 * per-IP / per-session rate limits, Bearer sessions, CORS headers only for
 * registered origins (second line of defence: the iframe calls these routes
 * from Approve's own origin), Italian JSON errors without internal details.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { httpStatusForError, isDomainError, publicErrorMessage } from "@/lib/errors";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import { AssistantError, isAssistantEnabled } from "@/lib/review-assistant/provider";
import { originAllowed, originOf, siteCorsHeaders } from "./origins";
import { SiteAccessError, resolveSiteSession, type SiteSessionView } from "./sessions";

export const SITE_API_LIMITS = {
  /** GET site?key= per IP. */
  site: 60,
  /** Code exchanges per IP + key (docs: 10/min). */
  exchange: 10,
  /** Reads per session. */
  read: 120,
  /** Comments per session. */
  comment: 30,
  /** Heili messages per session (the assistant has its own daily budgets too). */
  assistant: 30,
} as const;

export function appOrigin(): string | null {
  try {
    return originOf(getBaseUrl());
  } catch {
    return null;
  }
}

/** Client IP as the reverse proxy reports it (Caddy sets X-Forwarded-For). */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

export function bearerOf(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{16,200})$/.exec(header.trim());
  return match ? match[1] : null;
}

export function json(body: unknown, init: { status?: number; origins?: readonly string[]; request?: NextRequest } = {}): NextResponse {
  const response = NextResponse.json(body, { status: init.status ?? 200 });
  const headers = siteCorsHeaders(init.request?.headers.get("origin") ?? null, init.origins ?? [], appOrigin());
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export function errorJson(error: unknown, request: NextRequest, origins: readonly string[] = []): NextResponse {
  if (error instanceof SiteAccessError) {
    return json({ success: false, error: error.message, code: error.code }, { status: error.status, origins, request });
  }
  if (error instanceof AssistantError) {
    return json({ success: false, error: error.message }, { status: error.status, origins, request });
  }
  if (isDomainError(error)) {
    return json({ success: false, error: publicErrorMessage(error) }, { status: httpStatusForError(error), origins, request });
  }
  console.error("[site-api] Route error:", error);
  return json({ success: false, error: "Si è verificato un errore imprevisto. Riprova tra poco." }, { status: 500, origins, request });
}

/** Throws SiteAccessError("rate") when over the per-minute limit. */
export function limit(key: string, perMinute: number): void {
  if (!checkRateLimit(`site:${key}`, perMinute).allowed) throw new SiteAccessError("rate");
}

/** The reviewer of a session that may talk with Heili, else SiteAccessError. */
export function assistantReviewer(view: SiteSessionView): { id: string; clientId: string; name: string } {
  if (!isAssistantEnabled()) throw new SiteAccessError("not_found", "Heili non è disponibile.");
  if (view.role !== "REVIEWER" || !view.reviewer) throw new SiteAccessError("forbidden");
  if (!view.canComment) throw new SiteAccessError("closed");
  return view.reviewer;
}

/** Session of the request + per-session limit; throws SiteAccessError. */
export async function sessionOf(request: NextRequest, bucket: keyof typeof SITE_API_LIMITS): Promise<SiteSessionView> {
  const bearer = bearerOf(request);
  if (bearer) limit(`${bucket}:${bearer.slice(0, 16)}`, SITE_API_LIMITS[bucket]);
  limit(`${bucket}:ip:${clientIp(request)}`, SITE_API_LIMITS[bucket] * 4);
  return resolveSiteSession(bearer);
}

/**
 * CORS preflight: 204 only for Approve's own origin or an exact origin of an
 * active registered site; 403 for anything else (`Origin: null` included).
 */
export async function preflight(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  const own = appOrigin();
  let allowed: string[] = [];
  if (origin && origin !== "null") {
    if (own && origin.toLowerCase() === own) {
      allowed = [own];
    } else if (originOf(origin) === origin.toLowerCase()) {
      const site = await prisma.websiteSite.findFirst({
        where: { revokedAt: null, origins: { has: origin.toLowerCase() } },
        select: { origins: true },
      });
      if (site) allowed = site.origins;
    }
  }
  if (!origin || !originAllowed(origin, [...allowed, ...(own ? [own] : [])])) {
    return new NextResponse(null, { status: 403, headers: { Vary: "Origin" } });
  }
  const response = new NextResponse(null, { status: 204 });
  for (const [key, value] of Object.entries(siteCorsHeaders(origin, allowed, own))) response.headers.set(key, value);
  return response;
}
