import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/cron-auth";
import { sweepPlanCompletionNotifications } from "@/lib/plans";
import { sweepApprovedPosts } from "@/lib/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every 5 minutes: schedule approved posts left behind, requeue lost jobs. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [data, planNotifications] = await Promise.all([
      sweepApprovedPosts(),
      sweepPlanCompletionNotifications(),
    ]);
    return NextResponse.json({ success: true, data, planNotifications });
  } catch (error) {
    console.error("[Cron sweep] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Sweep failed" }, { status: 500 });
  }
}
