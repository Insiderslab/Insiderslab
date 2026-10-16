/**
 * Heili inside the site iframe (Bearer session, reviewer only): the same
 * service as /api/review/[token]/assistant, bound to the session's post and
 * version (whatever the body says). Talking only: the session cannot
 * approve or send changes; the conversation is resumed in the portal.
 *
 * GET  ?postId=&versionNumber= → AssistantStateResponse
 * POST { message?, inputMode, retry? } → AssistantTurnResponse
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAssistantState, sendAssistantMessage } from "@/lib/review-assistant/service";
import { MAX_CLIENT_MESSAGE_LENGTH } from "@/lib/review-assistant/shared";
import { assistantReviewer, errorJson, json, preflight, sessionOf } from "@/lib/website/http";

const messageSchema = z
  .object({
    postId: z.string().max(64).optional(),
    versionNumber: z.number().int().optional(),
    message: z.string().trim().max(MAX_CLIENT_MESSAGE_LENGTH).optional(),
    inputMode: z.enum(["TEXT", "VOICE"]).default("TEXT"),
    retry: z.boolean().optional(),
  })
  .refine((body) => Boolean(body.message) || body.retry === true, { message: "Scrivi un messaggio per l'assistente." });

export async function GET(request: NextRequest) {
  let origins: string[] = [];
  try {
    const view = await sessionOf(request, "read");
    origins = view.origins;
    const state = await getAssistantState(assistantReviewer(view), view.postId, view.versionNumber);
    return json({ success: true, data: state }, { request, origins });
  } catch (error) {
    return errorJson(error, request, origins);
  }
}

export async function POST(request: NextRequest) {
  let origins: string[] = [];
  try {
    const view = await sessionOf(request, "assistant");
    origins = view.origins;
    const reviewer = assistantReviewer(view);
    const body = messageSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return json({ success: false, error: body.error.issues[0]?.message || "Richiesta non valida" }, { status: 400, request, origins });
    }
    const turn = await sendAssistantMessage(reviewer, {
      postId: view.postId,
      versionNumber: view.versionNumber,
      message: body.data.message,
      inputMode: body.data.inputMode,
      retry: body.data.retry,
    });
    return json({ success: true, data: turn }, { request, origins });
  } catch (error) {
    return errorJson(error, request, origins);
  }
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
