import { manifestResponse } from "@/lib/mcp/discovery-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return manifestResponse();
}
