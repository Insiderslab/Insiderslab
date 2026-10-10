import { protectedResourceResponse } from "@/lib/mcp/discovery-routes";

export const runtime = "nodejs";
// Reads the environment at request time (not at build time).
export const dynamic = "force-dynamic";

export function GET() {
  return protectedResourceResponse();
}
