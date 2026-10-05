import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sweepApprovedPosts } from "@/lib/scheduling";

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

/** Every 5 minutes: schedule approved posts left behind, requeue lost jobs. */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await sweepApprovedPosts();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Cron sweep] Failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "Sweep failed" }, { status: 500 });
  }
}
