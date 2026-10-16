/**
 * GET /api/site/v1/context (Authorization: Bearer <session>) → the session's
 * post, pages, markers and, for «Apri nel punto», the comment to focus.
 * Renews the sliding expiry. "stale" (409) after a new version.
 */

import type { NextRequest } from "next/server";
import { embedContext } from "@/lib/website/embed";
import { errorJson, json, preflight, sessionOf } from "@/lib/website/http";

export async function GET(request: NextRequest) {
  try {
    const view = await sessionOf(request, "read");
    return json({ success: true, data: await embedContext(view) }, { request, origins: view.origins });
  } catch (error) {
    return errorJson(error, request);
  }
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
