/**
 * POST /mcp — remote MCP server (stateless Streamable HTTP, JSON responses).
 * Bearer auth is handled in lib/mcp (OAuth access token or personal key), so
 * proxy.ts must not — and does not — touch this path. GET / DELETE: 405.
 */

import { methodNotAllowed, handleMcpPost } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpPost(request);
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
