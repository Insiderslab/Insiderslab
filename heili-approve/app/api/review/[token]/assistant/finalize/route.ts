/**
 * Review assistant summary — public, authenticated by the reviewer's link token.
 *
 * POST { postId, versionNumber } → AssistantFinalizeResponse: closes the
 * conversation with the structured summary the agency will read, plus the
 * ready-made change request text. It does not approve or send anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finalizeSession } from "@/lib/review-assistant/service";
import {
  assistantErrorResponse,
  authenticateAssistantRequest,
  notFound,
} from "@/lib/review-assistant/http";

type RouteParams = { params: Promise<{ token: string }> };

const finalizeSchema = z.object({
  postId: z.string().min(1).max(64),
  versionNumber: z.number().int().min(1),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const reviewer = await authenticateAssistantRequest(token);
  if (!reviewer) return notFound();

  const body = finalizeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ success: false, error: "Richiesta non valida" }, { status: 400 });
  }

  try {
    const result = await finalizeSession(reviewer, body.data);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
