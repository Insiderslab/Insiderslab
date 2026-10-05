import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/cron-auth";
import { sendReviewReminders } from "@/lib/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hourly: remind reviewers about posts waiting too long (max 1 per 24 h). */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await sendReviewReminders();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Cron reminders] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Reminders failed" }, { status: 500 });
  }
}
