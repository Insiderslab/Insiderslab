/**
 * HTTP layer of the MCP endpoint (POST /mcp), independent of Next so it can be
 * tested with plain Request objects: Origin check, bearer auth, scope gate,
 * per-identity rate limit, protocol version, bounded JSON body, the JSON-RPC
 * adapter and the audit line. Stateless Streamable HTTP: every POST is
 * answered with a JSON response; there is no session, no SSE, no GET stream.
 *
 *   no / bad token   → 401 + WWW-Authenticate: Bearer resource_metadata="…", scope="…"
 *   token w/o scope  → 403 (insufficient_scope), also for a write tool without approve:draft
 *   notification     → 202, empty body
 */

import { randomUUID } from "node:crypto";
import type { JWTVerifyGetKey } from "jose";
import { AutomationError } from "@/lib/automation/auth";
import { readAutomationJson } from "@/lib/automation/http";
import { hasScope, type McpPrincipal } from "./access";
import { logAuthRejected, logRateLimited, logToolCall } from "./audit";
import { authenticateMcp, McpAuthError } from "./auth";
import { MCP_SCOPES, getMcpConfig, protectedResourceMetadataUrl, type McpConfig } from "./config";
import { MCP_INSTRUCTIONS, MCP_TOOLS } from "./tools";
import { MCP_PROTOCOL_VERSIONS, RPC_INVALID_REQUEST, handleJsonRpc, type JsonRpcResponse, type McpTool } from "./protocol";
import { checkRateLimit } from "./rate-limit";

const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export interface McpHttpDeps {
  config?: McpConfig;
  keyResolver?: JWTVerifyGetKey;
  tools?: readonly McpTool[];
  now?: () => Date;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...BASE_HEADERS, ...extra },
  });
}

function rpcError(status: number, code: number, message: string, extra: Record<string, string> = {}): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id: null, error: { code, message } };
  return json(body, status, extra);
}

function challenge(config: McpConfig, error?: McpAuthError): string {
  const parts: string[] = [];
  if (error?.code === "invalid_token") parts.push('error="invalid_token"');
  if (error?.code === "insufficient_scope") parts.push('error="insufficient_scope"');
  if (config.oauth) {
    parts.push(`resource_metadata="${protectedResourceMetadataUrl(config)}"`, `scope="${MCP_SCOPES.join(" ")}"`);
  } else {
    parts.push('realm="Approve MCP"');
  }
  return `Bearer ${parts.join(", ")}`;
}

function authFailure(config: McpConfig, error: McpAuthError, requestId: string): Response {
  logAuthRejected(requestId, error.status, error.reason);
  const message =
    error.code === "missing_token"
      ? "Serve un token Bearer"
      : error.status === 401
        ? "Token non valido o scaduto"
        : error.message;
  return json({ error: error.code, message }, error.status, { "WWW-Authenticate": challenge(config, error) });
}

/** GET / DELETE / anything but POST: no SSE stream, no sessions. */
export function methodNotAllowed(config: McpConfig = getMcpConfig()): Response {
  if (!config.enabled) return json({ error: "not_found" }, 404);
  return json(
    { error: "method_not_allowed", message: "Questo endpoint MCP usa Streamable HTTP senza stato, solo POST: nessun flusso SSE né sessione." },
    405,
    { Allow: "POST" }
  );
}

function originAllowed(request: Request, config: McpConfig): boolean {
  const origin = request.headers.get("origin");
  return origin === null || config.allowedOrigins.includes(origin.replace(/\/$/, ""));
}

/** The tool a tools/call request targets, before the adapter runs (for the 403 scope gate). */
function targetedTool(body: unknown, tools: readonly McpTool[]): McpTool | null {
  if (typeof body !== "object" || body === null || (body as { method?: unknown }).method !== "tools/call") return null;
  const params = (body as { params?: unknown }).params;
  const name = typeof params === "object" && params !== null ? (params as { name?: unknown }).name : undefined;
  return typeof name === "string" ? (tools.find((tool) => tool.name === name) ?? null) : null;
}

export async function handleMcpPost(request: Request, deps: McpHttpDeps = {}): Promise<Response> {
  const config = deps.config ?? getMcpConfig();
  const tools = deps.tools ?? MCP_TOOLS;
  if (!config.enabled) return json({ error: "not_found" }, 404);
  const requestId = randomUUID();

  if (!originAllowed(request, config)) {
    logAuthRejected(requestId, 403, "origin_not_allowed");
    return json({ error: "forbidden", message: "Origin non consentita" }, 403);
  }

  let principal: McpPrincipal;
  try {
    principal = await authenticateMcp(request, { config, keyResolver: deps.keyResolver });
  } catch (error) {
    if (error instanceof McpAuthError) return authFailure(config, error, requestId);
    console.error("[mcp] Authentication failed unexpectedly:", error instanceof Error ? error.name : "unknown");
    return json({ error: "server_error", message: "Errore imprevisto" }, 500);
  }

  const limited = checkRateLimit(principal.rateKey, config.rateLimitPerMinute);
  if (!limited.allowed) {
    logRateLimited(principal, requestId);
    return rpcError(429, -32029, "Troppe richieste: riprova tra poco", { "Retry-After": String(limited.retryAfterSec) });
  }

  const requestedProtocol = request.headers.get("mcp-protocol-version");
  if (requestedProtocol && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requestedProtocol)) {
    return json({ error: "unsupported_protocol_version", supported: MCP_PROTOCOL_VERSIONS }, 400);
  }

  let body: unknown;
  try {
    body = await readAutomationJson(request, Math.ceil((config.maxUploadBytes * 4) / 3) + 256 * 1024);
  } catch (error) {
    if (error instanceof AutomationError) {
      return rpcError(error.status, error.code === "INVALID_JSON" ? -32700 : RPC_INVALID_REQUEST, error.message);
    }
    throw error;
  }
  if (Array.isArray(body)) {
    return rpcError(400, RPC_INVALID_REQUEST, "Le richieste in batch non sono supportate: invia un messaggio per volta");
  }

  // Scope gate (403): the token must carry a scope of this API, and the one of the tool it calls.
  const tool = targetedTool(body, tools);
  const missing = principal.scopes.length === 0 ? MCP_SCOPES[0] : tool && !hasScope(principal, tool.scope) ? tool.scope : null;
  if (missing) {
    logAuthRejected(requestId, 403, "insufficient_scope");
    return json({ error: "insufficient_scope", message: `Scope mancante: ${missing}` }, 403, {
      "WWW-Authenticate": challenge(config, new McpAuthError(403, "insufficient_scope", "scope")).replace(/scope="[^"]*"/, `scope="${missing}"`),
    });
  }

  const { response, audit } = await handleJsonRpc(body, { principal, tools, instructions: MCP_INSTRUCTIONS, now: deps.now });
  if (audit) logToolCall(principal, requestId, audit);
  if (response === null) return new Response(null, { status: 202, headers: BASE_HEADERS });
  return json(response);
}
