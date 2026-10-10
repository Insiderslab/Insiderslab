/**
 * Audit of MCP calls.
 *
 * Every tools/call writes one structured JSON log line (who, workspace, tool,
 * outcome, duration, created ids) — never arguments, texts or tokens. What the
 * calls CHANGE is audited where Approve already audits changes: a draft created
 * through MCP gets the usual CREATED PostEvent with metadata.source = "mcp"
 * (plus tokenId for a personal key, via = the OAuth app), see lib/posts.ts
 * createPost. Uploads and plans have no event table, so their ids live in the
 * log line only. No dedicated table: the log plus PostEvent cover the questions
 * "who created this" and "what did this identity call".
 */

import type { McpPrincipal } from "./access";
import type { ToolCallAudit } from "./protocol";

export interface AuditLine {
  event: "mcp.tools_call" | "mcp.auth_rejected" | "mcp.rate_limited";
  [key: string]: unknown;
}

function emit(line: AuditLine): void {
  try {
    console.info(JSON.stringify({ ts: new Date().toISOString(), ...line }));
  } catch {
    // Logging must never break a request.
  }
}

export function logToolCall(principal: McpPrincipal, requestId: string, audit: ToolCallAudit): void {
  emit({
    event: "mcp.tools_call",
    request_id: requestId,
    auth: principal.kind,
    user_id: principal.userId,
    ...(principal.tokenId ? { token_id: principal.tokenId } : {}),
    ...(principal.oauthClientId ? { oauth_client: principal.oauthClientId } : {}),
    workspace_ids: audit.touched.workspaceIds ?? [],
    tool: audit.tool,
    outcome: audit.outcome,
    ...(audit.errorCode ? { error_code: audit.errorCode } : {}),
    duration_ms: audit.durationMs,
    ...(audit.touched.resourceId ? { resource_id: audit.touched.resourceId } : {}),
    created_post_ids: audit.touched.created?.postIds ?? [],
    created_media_ids: audit.touched.created?.mediaIds ?? [],
    created_plan_ids: audit.touched.created?.planIds ?? [],
  });
}

export function logAuthRejected(requestId: string, status: number, reason: string): void {
  emit({ event: "mcp.auth_rejected", request_id: requestId, status, reason });
}

export function logRateLimited(principal: McpPrincipal, requestId: string): void {
  emit({ event: "mcp.rate_limited", request_id: requestId, auth: principal.kind, user_id: principal.userId, ...(principal.tokenId ? { token_id: principal.tokenId } : {}) });
}
