import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendReviewReminders } from "@/lib/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same secret scheme as heili-dm's crons, but an unset secret never matches
// (heili-dm would accept the literal "Bearer undefined").
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Hourly: remind reviewers about posts waiting too long (max 1 per 24 h). */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
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
