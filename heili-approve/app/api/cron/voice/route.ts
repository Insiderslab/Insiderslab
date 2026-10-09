import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/cron-auth";
import { sweepLiveCalls } from "@/lib/review-assistant/live-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every 30 seconds: close expired, revoked or invalidated GPT-Live sessions. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await sweepLiveCalls();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Cron voice] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Voice sweep failed" }, { status: 500 });
  }
}
