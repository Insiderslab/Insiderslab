/**
 * POST /api/site/v1/assistant/finalize (Bearer, reviewer only): prepares
 * Heili's summary of the conversation held on the site. Nothing is sent: the
 * client checks it and decides in the portal.
 */

import type { NextRequest } from "next/server";
import { finalizeSession } from "@/lib/review-assistant/service";
import { assistantReviewer, errorJson, json, preflight, sessionOf } from "@/lib/website/http";

export async function POST(request: NextRequest) {
  let origins: string[] = [];
  try {
    const view = await sessionOf(request, "assistant");
    origins = view.origins;
    const result = await finalizeSession(assistantReviewer(view), { postId: view.postId, versionNumber: view.versionNumber });
    return json({ success: true, data: result }, { request, origins });
  } catch (error) {
    return errorJson(error, request, origins);
  }
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
