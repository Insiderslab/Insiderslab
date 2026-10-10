/**
 * Minimal MCP JSON-RPC adapter (stateless Streamable HTTP, JSON responses).
 *
 * Same approach as Heili's server/src/mcp/adapter.ts: no SDK, a handful of
 * methods (initialize, ping, tools/list, tools/call), protocol versions
 * 2025-11-25 and 2025-06-18. Tool failures are results with `isError: true`
 * (so the model can read the message and retry); only protocol problems are
 * JSON-RPC errors. This module knows nothing about HTTP, Prisma or Next.
 */

import { z } from "zod";
import { InvalidTransitionError } from "@/lib/domain";
import { isDomainError, publicErrorMessage } from "@/lib/errors";
import { AutomationError } from "@/lib/automation/auth";
import { UploadError } from "@/lib/storage";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, type McpScope } from "./config";
import { hasScope, type McpPrincipal } from "./access";

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INSUFFICIENT_SCOPE = -32003;

/** The model sent arguments the tool cannot use: reported as a tool error, in Italian. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** What a tool did, for the audit line (ids only, never content). */
export interface ToolTouched {
  workspaceIds?: string[];
  /** The one record a read tool opened (get_post). */
  resourceId?: string;
  /** Records the call created (replays of existing ones are not listed). */
  created?: { postIds?: string[]; mediaIds?: string[]; planIds?: string[] };
}

export interface ToolResult {
  /** Short summary for the model (and the person reading the transcript). */
  text: string;
  /** Machine-readable result, returned as structuredContent. */
  data: Record<string, unknown>;
  /** The call ran but did not do what was asked (e.g. every post of a batch was refused). */
  isError?: boolean;
  touched?: ToolTouched;
}

export interface ToolContext {
  principal: McpPrincipal;
  now: Date;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  schema: z.ZodType;
  run(input: never, context: ToolContext): Promise<ToolResult>;
}

/** Shapes `defineTool` so `run` receives the parsed input of its own schema. */
export function defineTool<S extends z.ZodType>(
  tool: Omit<McpTool, "schema" | "run"> & { schema: S; run(input: z.output<S>, context: ToolContext): Promise<ToolResult> }
): McpTool {
  return tool as unknown as McpTool;
}

export interface ToolCallAudit {
  tool: string;
  outcome: "ok" | "error" | "denied";
  errorCode?: string;
  durationMs: number;
  touched: ToolTouched;
}

export interface AdapterContext {
  principal: McpPrincipal;
  tools: readonly McpTool[];
  instructions: string;
  now?: () => Date;
}

export interface AdapterResult {
  response: JsonRpcResponse | null;
  /** Set for every tools/call that reached a known tool. */
  audit?: ToolCallAudit;
}

function success(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function negotiateProtocolVersion(requested: unknown): (typeof MCP_PROTOCOL_VERSIONS)[number] {
  return MCP_PROTOCOL_VERSIONS.find((version) => version === requested) ?? MCP_PROTOCOL_VERSIONS[0];
}

export function toolDescriptor(tool: McpTool) {
  const { $schema: _schema, ...inputSchema } = z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>;
  void _schema;
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema,
    annotations: { title: tool.title, ...tool.annotations },
    // ChatGPT reads the per-tool auth requirements from here (same as Heili).
    securitySchemes: [{ type: "oauth2", scopes: [tool.scope] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [tool.scope] }] },
  };
}

function issuesMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
    .join("; ");
}

export async function handleJsonRpc(body: unknown, context: AdapterContext): Promise<AdapterResult> {
  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return { response: failure(null, RPC_INVALID_REQUEST, "Richiesta JSON-RPC non valida") };
  }
  const request = body as unknown as JsonRpcRequest;
  const hasId = Object.prototype.hasOwnProperty.call(request, "id");
  if (hasId && request.id !== null && typeof request.id !== "string" && typeof request.id !== "number") {
    return { response: failure(null, RPC_INVALID_REQUEST, "L'id della richiesta deve essere una stringa o un numero") };
  }
  if (hasId && request.id === null) {
    return { response: failure(null, RPC_INVALID_REQUEST, "L'id della richiesta non può essere null") };
  }
  const id = request.id ?? null;
  const isNotification = !hasId;
  const params = isRecord(request.params) ? request.params : undefined;

  // Notifications get no body back (202 at the HTTP layer).
  if (isNotification) return { response: null };

  switch (request.method) {
    case "initialize":
      return {
        response: success(id, {
          protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          instructions: context.instructions,
        }),
      };
    case "ping":
      return { response: success(id, {}) };
    case "tools/list":
      return {
        response: success(id, {
          tools: context.tools.filter((tool) => hasScope(context.principal, tool.scope)).map(toolDescriptor),
        }),
      };
    case "tools/call":
      return callTool(id, params, context);
    default:
      return { response: failure(id, RPC_METHOD_NOT_FOUND, "Metodo non supportato") };
  }
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  context: AdapterContext
): Promise<AdapterResult> {
  const name = typeof params?.name === "string" ? params.name : "";
  if (!params || !name) return { response: failure(id, RPC_INVALID_PARAMS, "Parametri non validi: manca il nome dello strumento") };
  if (params.arguments !== undefined && !isRecord(params.arguments)) {
    return { response: failure(id, RPC_INVALID_PARAMS, "Parametri non validi: arguments deve essere un oggetto") };
  }
  const tool = context.tools.find((candidate) => candidate.name === name);
  if (!tool) return { response: failure(id, RPC_INVALID_PARAMS, `Strumento sconosciuto: ${name.slice(0, 80)}`) };

  const started = Date.now();
  // Defense in depth: the HTTP layer already refuses a missing scope with a 403.
  if (!hasScope(context.principal, tool.scope)) {
    return {
      response: failure(id, RPC_INSUFFICIENT_SCOPE, `Scope mancante: ${tool.scope}`),
      audit: { tool: name, outcome: "denied", errorCode: "insufficient_scope", durationMs: 0, touched: {} },
    };
  }

  try {
    const parsed = tool.schema.safeParse(params.arguments ?? {});
    if (!parsed.success) throw new ToolInputError(`Argomenti non validi: ${issuesMessage(parsed.error)}`);
    const result = await tool.run(parsed.data as never, { principal: context.principal, now: context.now?.() ?? new Date() });
    return {
      response: success(id, {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.data,
        isError: result.isError === true,
      }),
      audit: { tool: name, outcome: result.isError ? "error" : "ok", ...(result.isError ? { errorCode: "all_items_failed" } : {}), durationMs: Date.now() - started, touched: result.touched ?? {} },
    };
  } catch (error) {
    const { message, code } = describeToolError(error);
    return {
      response: success(id, { content: [{ type: "text", text: message }], isError: true }),
      audit: { tool: name, outcome: "error", errorCode: code, durationMs: Date.now() - started, touched: {} },
    };
  }
}

/** Italian, user-safe message + a stable code for the audit line. Unknown errors are never echoed. */
export function describeToolError(error: unknown): { message: string; code: string } {
  if (error instanceof ToolInputError) return { message: error.message, code: "invalid_input" };
  if (error instanceof AutomationError) return { message: error.message, code: error.code.toLowerCase() };
  if (error instanceof UploadError) return { message: error.message, code: "upload_failed" };
  if (error instanceof InvalidTransitionError || isDomainError(error)) {
    return { message: publicErrorMessage(error), code: (error as Error).name };
  }
  console.error("[mcp] Tool failed:", error instanceof Error ? error.name : "unknown");
  return { message: "Si è verificato un errore imprevisto. Riprova tra poco.", code: "internal_error" };
}
