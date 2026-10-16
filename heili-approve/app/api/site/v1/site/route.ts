/**
 * GET /api/site/v1/site?key=hs_… → { origins } of an active site.
 *
 * The «Sul sito» iframe asks it before answering a page: it replies to
 * `hello` (and exchanges the launch code) only when the page's origin, as
 * the browser reports it in event.origin, is one of these exact origins.
 * Public data (the key is in the site's HTML); rate limited per IP.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { SITE_API_LIMITS, clientIp, errorJson, json, limit, preflight } from "@/lib/website/http";
import { SiteAccessError, isSiteKey } from "@/lib/website/sessions";

export async function GET(request: NextRequest) {
  try {
    limit(`site:ip:${clientIp(request)}`, SITE_API_LIMITS.site);
    const key = request.nextUrl.searchParams.get("key");
    if (!isSiteKey(key)) throw new SiteAccessError("not_found");
    const site = await prisma.websiteSite.findUnique({ where: { siteKey: key }, select: { origins: true, revokedAt: true } });
    if (!site || site.revokedAt) throw new SiteAccessError("not_found");
    return json({ success: true, data: { origins: site.origins } }, { request, origins: site.origins });
  } catch (error) {
    return errorJson(error, request);
  }
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
