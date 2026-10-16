/**
 * POST /api/site/v1/exchange { siteKey, code, hostOrigin, v: 1 }
 *
 * The iframe trades the one-time launch code (from the `#heili-review=`
 * fragment, 10 minutes) for a session: 32 random bytes, sliding 2 h,
 * absolute 8 h, stored as a hash. Atomic and one-time; the page's origin must
 * be an exact registered origin of the site; 10 exchanges per minute per
 * IP + key (lib/website/sessions.ts).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { embedContext } from "@/lib/website/embed";
import { SITE_API_LIMITS, appOrigin, clientIp, errorJson, json, limit, preflight } from "@/lib/website/http";
import { exchangeLaunch } from "@/lib/website/sessions";

const exchangeSchema = z
  .object({
    siteKey: z.string().min(1).max(80),
    code: z.string().min(1).max(200),
    hostOrigin: z.string().min(1).max(300),
    v: z.literal(1),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    // Only the iframe (Approve's own origin) exchanges codes: a page of the site
    // calling this route directly is refused even if its origin is registered.
    const callerOrigin = request.headers.get("origin");
    if (callerOrigin && callerOrigin.toLowerCase() !== appOrigin()) {
      return json({ success: false, error: "Richiesta non consentita" }, { status: 403, request });
    }
    const body = exchangeSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ success: false, error: "Richiesta non valida" }, { status: 400, request });
    limit(`exchange:${clientIp(request)}:${body.data.siteKey}`, SITE_API_LIMITS.exchange);
    const { session, view } = await exchangeLaunch(body.data);
    const context = await embedContext(view);
    return json({ success: true, data: { session, ...context } }, { request, origins: view.origins });
  } catch (error) {
    return errorJson(error, request);
  }
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
