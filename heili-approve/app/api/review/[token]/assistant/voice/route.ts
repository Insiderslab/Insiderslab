import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  closeLiveCall,
  startLiveCall,
  updateLiveContext,
} from "@/lib/review-assistant/live-service";
import {
  assistantErrorResponse,
  authenticateAssistantRequest,
  notFound,
} from "@/lib/review-assistant/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ token: string }> };

const callIdSchema = z.string().cuid();
const startSchema = z.object({
  postId: z.string().min(1).max(64),
  versionNumber: z.number().int().min(1),
  sdp: z.string().min(10).max(200_000).refine((value) => value.trimStart().startsWith("v=0"), "Offerta audio non valida"),
  contextMarker: z.string().trim().max(500).optional(),
});
const updateSchema = z.object({
  callId: callIdSchema,
  contextMarker: z.string().trim().max(500),
});
const closeSchema = z.object({ callId: callIdSchema });

async function reviewerFor(params: RouteParams["params"]) {
  const { token } = await params;
  return authenticateAssistantRequest(token);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const reviewer = await reviewerFor(params);
  if (!reviewer) return notFound();
  const body = startSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { success: false, error: body.error.issues[0]?.message || "Richiesta non valida" },
      { status: 400 }
    );
  }
  try {
    const data = await startLiveCall(reviewer, body.data);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const reviewer = await reviewerFor(params);
  if (!reviewer) return notFound();
  const body = updateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { success: false, error: body.error.issues[0]?.message || "Richiesta non valida" },
      { status: 400 }
    );
  }
  try {
    const data = await updateLiveContext(reviewer, body.data.callId, body.data.contextMarker);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const reviewer = await reviewerFor(params);
  if (!reviewer) return notFound();
  const body = closeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ success: false, error: "Richiesta non valida" }, { status: 400 });
  }
  try {
    const data = await closeLiveCall(reviewer, body.data.callId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
