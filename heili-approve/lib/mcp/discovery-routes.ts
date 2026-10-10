/** Response builders of the /.well-known discovery routes (kept out of app/ so tests can call them). */

import { getMcpConfig } from "./config";
import { mcpManifest, protectedResourceDocument } from "./discovery";

// Public metadata, readable by browser-based MCP clients too (no credentials involved).
const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300",
  "Access-Control-Allow-Origin": "*",
};

function notFound(message?: string): Response {
  return new Response(JSON.stringify({ error: "not_found", ...(message ? { message } : {}) }), {
    status: 404,
    headers: { ...HEADERS, "Cache-Control": "no-store" },
  });
}

export function protectedResourceResponse(config = getMcpConfig()): Response {
  if (!config.enabled) return notFound();
  const document = protectedResourceDocument(config);
  if (!document) {
    return notFound("OAuth non è configurato su questa installazione: usa una chiave personale come Bearer.");
  }
  return new Response(JSON.stringify(document), { status: 200, headers: HEADERS });
}

export function manifestResponse(config = getMcpConfig()): Response {
  if (!config.enabled) return notFound();
  return new Response(JSON.stringify(mcpManifest(config)), { status: 200, headers: HEADERS });
}
