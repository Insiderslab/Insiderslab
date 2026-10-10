import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prepareLiveCall } from "@/lib/review-assistant/live-service";
import { assistantErrorResponse, authenticateAssistantRequest, notFound } from "@/lib/review-assistant/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ postId: z.string().min(1).max(64), versionNumber: z.number().int().min(1) });

/** No microphone or paid voice session until the authorized visual context is ready. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reviewer = await authenticateAssistantRequest(token);
  if (!reviewer) return notFound();
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Richiesta non valida" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await prepareLiveCall(reviewer, body.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return assistantErrorResponse(error); }
}
