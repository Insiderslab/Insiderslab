/**
 * Review assistant chat — public, authenticated by the reviewer's link token.
 *
 * GET  ?postId=&versionNumber=  → AssistantStateResponse (session to resume)
 * POST { postId, versionNumber, message?, inputMode, retry? } → AssistantTurnResponse
 *
 * 404 when the assistant is disabled or the link is invalid. The assistant
 * only talks: approving and sending changes stay with the client's buttons.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAssistantState, sendAssistantMessage } from "@/lib/review-assistant/service";
import {
  assistantErrorResponse,
  authenticateAssistantRequest,
  notFound,
} from "@/lib/review-assistant/http";
import { MAX_CLIENT_MESSAGE_LENGTH } from "@/lib/review-assistant/shared";

type RouteParams = { params: Promise<{ token: string }> };

const stateQuerySchema = z.object({
  postId: z.string().min(1).max(64),
  versionNumber: z.coerce.number().int().min(1),
});

const messageSchema = z
  .object({
    postId: z.string().min(1).max(64),
    versionNumber: z.number().int().min(1),
    message: z
      .string()
      .trim()
      .max(MAX_CLIENT_MESSAGE_LENGTH, `Il messaggio può contenere al massimo ${MAX_CLIENT_MESSAGE_LENGTH} caratteri`)
      .optional(),
    inputMode: z.enum(["TEXT", "VOICE"]).default("TEXT"),
    retry: z.boolean().optional(),
  })
  .refine((body) => Boolean(body.message) || body.retry === true, {
    message: "Scrivi un messaggio per l'assistente.",
  });

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const reviewer = await authenticateAssistantRequest(token);
  if (!reviewer) return notFound();

  const query = stateQuerySchema.safeParse({
    postId: request.nextUrl.searchParams.get("postId"),
    versionNumber: request.nextUrl.searchParams.get("versionNumber"),
  });
  if (!query.success) {
    return NextResponse.json({ success: false, error: "Richiesta non valida" }, { status: 400 });
  }

  try {
    const state = await getAssistantState(reviewer, query.data.postId, query.data.versionNumber);
    return NextResponse.json({ success: true, data: state });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const reviewer = await authenticateAssistantRequest(token);
  if (!reviewer) return notFound();

  const body = messageSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { success: false, error: body.error.issues[0]?.message || "Richiesta non valida" },
      { status: 400 }
    );
  }

  try {
    const turn = await sendAssistantMessage(reviewer, body.data);
    return NextResponse.json({ success: true, data: turn });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
