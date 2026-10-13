import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import type { McpPrincipal } from "@/lib/mcp/access";
import { MCP_INSTRUCTIONS, MCP_TOOLS } from "@/lib/mcp/tools";
import { MCP_PROTOCOL_VERSIONS, defineTool, handleJsonRpc, type McpTool } from "@/lib/mcp/protocol";

const principal = (scopes: McpPrincipal["scopes"] = ["approve:read", "approve:draft"]): McpPrincipal => ({
  kind: "automation", userId: "u1", scopes, workspaces: [{ id: "ws-1", name: "A", role: "OWNER" }], rateKey: "key:t",
});

const echo = defineTool({
  name: "echo",
  title: "Echo",
  description: "test",
  scope: "approve:read",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  schema: z.strictObject({ value: z.string().max(5) }),
  async run(input) {
    return { text: `echo ${input.value}`, data: { value: input.value }, touched: { workspaceIds: ["ws-1"] } };
  },
});
const boom = defineTool({
  name: "boom", title: "Boom", description: "x", scope: "approve:read",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  schema: z.strictObject({}),
  async run() { throw new Error("secret internal detail"); },
});
const call = (body: unknown, tools: readonly McpTool[] = [echo, boom], p = principal()) =>
  handleJsonRpc(body, { principal: p, tools, instructions: "istruzioni" });

describe("MCP JSON-RPC adapter", () => {
  it("initialize negotiates the protocol version and returns instructions", async () => {
    for (const version of MCP_PROTOCOL_VERSIONS) {
      const { response } = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version } });
      expect(response?.result).toMatchObject({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, instructions: "istruzioni" });
    }
    const unknown = await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect((unknown.response?.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
    const none = await call({ jsonrpc: "2.0", id: 3, method: "initialize" });
    expect((none.response?.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
  });

  it("notifications get no response; ping answers", async () => {
    expect((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).response).toBeNull();
    expect((await call({ jsonrpc: "2.0", id: 9, method: "ping" })).response).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  });

  it("tools/list returns descriptors with JSON Schema and annotations, only for tools the scope allows", async () => {
    const { response } = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (response?.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.map((t) => t.name)).toEqual(["echo", "boom"]);
    expect(tools[0]).toMatchObject({
      inputSchema: { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string", maxLength: 5 } } },
      annotations: { readOnlyHint: true },
    });
    expect(tools[0].inputSchema).not.toHaveProperty("$schema");
    const draftOnly = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, MCP_TOOLS, principal(["approve:draft"]));
    expect((draftOnly.response?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort()).toEqual(
      ["create_draft_posts", "create_month_plan", "upload_media"]
    );
  });

  it("unknown method → -32601; invalid envelope → -32600; bad params → -32602", async () => {
    expect((await call({ jsonrpc: "2.0", id: 1, method: "resources/list" })).response?.error?.code).toBe(-32601);
    expect((await call({ id: 1, method: "ping" })).response?.error?.code).toBe(-32600);
    expect((await call("hello")).response?.error?.code).toBe(-32600);
    expect((await call({ jsonrpc: "2.0", id: null, method: "ping" })).response?.error?.code).toBe(-32600);
    expect((await call({ jsonrpc: "2.0", id: {}, method: "ping" })).response?.error?.code).toBe(-32600);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/call" })).response?.error?.code).toBe(-32602);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 5 } })).response?.error?.code).toBe(-32602);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } })).response?.error?.code).toBe(-32602);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: [] } })).response?.error?.code).toBe(-32602);
  });

  it("tools/call returns content + structuredContent and an audit record", async () => {
    const { response, audit } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { value: "ciao" } } });
    expect(response?.result).toEqual({ content: [{ type: "text", text: "echo ciao" }], structuredContent: { value: "ciao" }, isError: false });
    expect(audit).toMatchObject({ tool: "echo", outcome: "ok", touched: { workspaceIds: ["ws-1"] } });
  });

  it("invalid tool arguments are a tool error the model can read (not a protocol error)", async () => {
    const { response, audit } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { value: "troppo lungo", extra: 1 } } });
    expect(response?.error).toBeUndefined();
    expect(response?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(response?.result)).toMatch(/Argomenti non validi/);
    // And the validation detail is in Italian too, not zod's default English.
    const text = (response?.result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("Troppo grande");
    expect(text).not.toMatch(/Too big|Invalid input|Invalid option/);
    expect(audit).toMatchObject({ outcome: "error", errorCode: "invalid_input" });
  });

  it("never echoes unexpected error details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { response, audit } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boom", arguments: {} } });
    expect(JSON.stringify(response)).not.toContain("secret internal detail");
    expect(response?.result).toMatchObject({ isError: true });
    expect(audit?.errorCode).toBe("internal_error");
    spy.mockRestore();
  });

  it("refuses a tool whose scope the principal lacks", async () => {
    const { response, audit } = await call(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { value: "x" } } },
      [echo], principal(["approve:draft"])
    );
    expect(response?.error?.code).toBe(-32003);
    expect(audit).toMatchObject({ outcome: "denied" });
  });
});

describe("the real tool catalogue", () => {
  it("exposes exactly the intended tools, with the right scopes and annotations", () => {
    expect(Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.scope]))).toEqual({
      list_clients: "approve:read",
      list_posts: "approve:read",
      get_post: "approve:read",
      get_month_overview: "approve:read",
      list_open_feedback: "approve:read",
      create_draft_posts: "approve:draft",
      upload_media: "approve:draft",
      create_month_plan: "approve:draft",
    });
    for (const tool of MCP_TOOLS) {
      expect(tool.description).toMatch(/[a-zà-ù]/);
      if (tool.scope === "approve:read") expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      else expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(tool.annotations.openWorldHint).toBe(false);
    }
    expect(MCP_TOOLS.find((t) => t.name === "create_draft_posts")?.annotations.idempotentHint).toBe(true);
  });

  it("the instructions say what is NOT possible", () => {
    for (const word of ["approvare", "programmare", "pubblicare", "Metricool", "non attendibili", "Bozza"]) {
      expect(MCP_INSTRUCTIONS).toContain(word);
    }
  });

  it("no tool schema or description mentions a remote URL fetch", () => {
    const upload = MCP_TOOLS.find((t) => t.name === "upload_media")!;
    expect(JSON.stringify(z.toJSONSchema(upload.schema))).not.toMatch(/"(url|file_url|source_url)"/);
  });

  it("the MCP code cannot change a post's status: no approve / submit / schedule / cancel / publish code is reachable", () => {
    const forbidden = /\b(approvePost|submitForReview|requestChanges|requestScheduling|processSchedulePost|cancelPost|deliverPost|updatePost|sendPlan|makePlanAvailable|approvePlan|assertTransition|nextStatus|schedulePost|MetricoolClient|getWorkspaceMetricoolClient|addComment|resolveComment|rotateReviewerLink|createReviewer)\b/;
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const file = path.join(dir, name);
        return statSync(file).isDirectory() ? walk(file) : file.endsWith(".ts") ? [file] : [];
      });
    for (const file of walk(path.resolve(__dirname, "../lib/mcp"))) {
      // Comments may name them to say "never call"; code may not.
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, "");
      expect(code, file).not.toMatch(forbidden);
    }
  });
});
