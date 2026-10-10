import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { createFakeDb } from "./helpers/mcp-fake-db";

const db = vi.hoisted(() => ({ current: null as unknown as ReturnType<typeof createFakeDb> }));
vi.mock("@/lib/db/client", async () => {
  const { createFakeDb } = await import("./helpers/mcp-fake-db");
  db.current = createFakeDb();
  return { prisma: db.current };
});

import { hashAutomationToken } from "@/lib/automation/auth";
import { getMcpConfig } from "@/lib/mcp/config";
import { manifestResponse, protectedResourceResponse } from "@/lib/mcp/discovery-routes";
import { handleMcpPost, methodNotAllowed } from "@/lib/mcp/server";
import { resetRateLimitsForTests } from "@/lib/mcp/rate-limit";

const ISSUER = "https://tenant.eu.auth0.com/";
const BASE = "https://approve.example.com";
const oauthEnv = { PUBLIC_BASE_URL: BASE, MCP_JWT_ISSUER: ISSUER, MCP_JWT_JWKS_URL: `${ISSUER}.well-known/jwks.json` } as unknown as NodeJS.ProcessEnv;
const config = getMcpConfig(oauthEnv);
const plainConfig = getMcpConfig({ PUBLIC_BASE_URL: BASE } as unknown as NodeJS.ProcessEnv);

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  resolver = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256" } as JWK] });
});

const sign = (claims: Record<string, unknown> = {}) =>
  new SignJWT({ scope: "approve:read approve:draft", email: "anna@agency.it", email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject("auth0|1").setIssuer(ISSUER).setAudience(`${BASE}/mcp`)
    .setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) });

beforeEach(() => {
  vi.restoreAllMocks();
  resetRateLimitsForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  db.current.user.reset([{ id: "user-anna", email: "anna@agency.it" }]);
  db.current.workspaceMember.reset([{ id: "m1", workspaceId: "ws-1", userId: "user-anna", role: "OWNER", createdAt: new Date(1), workspace: { id: "ws-1", name: "Agenzia" } }]);
  db.current.client.reset([]);
  db.current.automationToken.reset();
});

describe("POST /mcp", () => {
  it("401 without a token, with the OAuth discovery challenge", async () => {
    const response = await handleMcpPost(post(rpc("ping")), { config, keyResolver: resolver });
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain('scope="approve:read approve:draft"');
    expect(challenge).not.toContain("error=");
    expect(await response.json()).toMatchObject({ error: "missing_token" });
  });

  it("401 with error=invalid_token for a bad JWT", async () => {
    const response = await handleMcpPost(post(rpc("ping"), { authorization: "Bearer aaa.bbb.ccc" }), { config, keyResolver: resolver });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("without OAuth configured the 401 has no resource_metadata (the document does not exist)", async () => {
    const response = await handleMcpPost(post(rpc("ping")), { config: plainConfig });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toContain("resource_metadata");
  });

  it("403 for a token without our scopes; 403 for a write tool without approve:draft", async () => {
    const none = await handleMcpPost(post(rpc("ping"), { authorization: `Bearer ${await sign({ scope: "openid" })}` }), { config, keyResolver: resolver });
    expect(none.status).toBe(403);
    expect(await none.json()).toMatchObject({ error: "insufficient_scope" });

    const readOnly = await handleMcpPost(
      post(rpc("tools/call", { name: "create_draft_posts", arguments: { posts: [] } }), { authorization: `Bearer ${await sign({ scope: "approve:read" })}` }),
      { config, keyResolver: resolver }
    );
    expect(readOnly.status).toBe(403);
    expect(readOnly.headers.get("www-authenticate")).toContain('scope="approve:draft"');
    // A read tool still works with the read scope.
    const ok = await handleMcpPost(
      post(rpc("tools/call", { name: "list_clients", arguments: {} }), { authorization: `Bearer ${await sign({ scope: "approve:read" })}` }),
      { config, keyResolver: resolver }
    );
    expect(ok.status).toBe(200);
  });

  it("403 for a verified email with no Approve account", async () => {
    const response = await handleMcpPost(post(rpc("ping"), { authorization: `Bearer ${await sign({ email: "nobody@x.it" })}` }), { config, keyResolver: resolver });
    expect(response.status).toBe(403);
  });

  it("initialize → tools/list → tools/call over HTTP with an OAuth token", async () => {
    const headers = { authorization: `Bearer ${await sign()}`, "mcp-protocol-version": "2025-06-18" };
    const init = await handleMcpPost(post(rpc("initialize", { protocolVersion: "2025-06-18" }), headers), { config, keyResolver: resolver });
    expect(init.status).toBe(200);
    expect(init.headers.get("content-type")).toContain("application/json");
    expect((await init.json()).result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "Approve by Heili" } });

    const list = await handleMcpPost(post(rpc("tools/list"), headers), { config, keyResolver: resolver });
    expect(((await list.json()).result.tools as unknown[]).length).toBe(8);

    db.current.client.reset([{ id: "c1", workspaceId: "ws-1", name: "Aurora", services: ["SOCIAL_POST"], networks: ["instagram"], timezone: "Europe/Rome", archivedAt: null }]);
    const called = await handleMcpPost(post(rpc("tools/call", { name: "list_clients", arguments: {} }), headers), { config, keyResolver: resolver });
    const result = (await called.json()).result;
    expect(result.isError).toBe(false);
    expect(result.structuredContent.clients).toHaveLength(1);
  });

  it("accepts a personal automation key", async () => {
    const plain = `approve_auto_${"c".repeat(64)}`;
    db.current.automationToken.reset([{ id: "t1", workspaceId: "ws-1", userId: "user-anna", tokenHash: hashAutomationToken(plain), revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }]);
    const response = await handleMcpPost(post(rpc("ping"), { authorization: `Bearer ${plain}` }), { config: plainConfig });
    expect(response.status).toBe(200);
  });

  it("202 and no body for a notification; 400 for batches, bad JSON, unsupported protocol version", async () => {
    const plain = `approve_auto_${"c".repeat(64)}`;
    db.current.automationToken.reset([{ id: "t1", workspaceId: "ws-1", userId: "user-anna", tokenHash: hashAutomationToken(plain), revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }]);
    const auth = { authorization: `Bearer ${plain}` };
    const note = await handleMcpPost(post(rpc("notifications/initialized", undefined, null), auth), { config: plainConfig });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
    expect((await handleMcpPost(post([rpc("ping")], auth), { config: plainConfig })).status).toBe(400);
    const bad = await handleMcpPost(post("{nope", auth), { config: plainConfig });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
    const proto = await handleMcpPost(post(rpc("ping"), { ...auth, "mcp-protocol-version": "2020-01-01" }), { config: plainConfig });
    expect(proto.status).toBe(400);
    expect(await proto.json()).toMatchObject({ error: "unsupported_protocol_version" });
    const wrongType = await handleMcpPost(new Request(`${BASE}/mcp`, { method: "POST", headers: { ...auth, "content-type": "text/plain" }, body: "x" }), { config: plainConfig });
    expect(wrongType.status).toBe(415);
  });

  it("per-identity rate limit: 429 with Retry-After once the budget is spent", async () => {
    const plain = `approve_auto_${"c".repeat(64)}`;
    db.current.automationToken.reset([{ id: "t1", workspaceId: "ws-1", userId: "user-anna", tokenHash: hashAutomationToken(plain), revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }]);
    const tight = { ...plainConfig, rateLimitPerMinute: 3 };
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 5; i += 1) {
      last = await handleMcpPost(post(rpc("ping"), { authorization: `Bearer ${plain}` }), { config: tight });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses a foreign browser Origin, accepts claude.ai and none", async () => {
    const plain = `approve_auto_${"c".repeat(64)}`;
    db.current.automationToken.reset([{ id: "t1", workspaceId: "ws-1", userId: "user-anna", tokenHash: hashAutomationToken(plain), revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }]);
    const auth = { authorization: `Bearer ${plain}` };
    expect((await handleMcpPost(post(rpc("ping"), { ...auth, origin: "https://evil.example" }), { config: plainConfig })).status).toBe(403);
    expect((await handleMcpPost(post(rpc("ping"), { ...auth, origin: "https://claude.ai" }), { config: plainConfig })).status).toBe(200);
  });

  it("MCP_ENABLED=false → 404 everywhere", async () => {
    const off = { ...plainConfig, enabled: false };
    expect((await handleMcpPost(post(rpc("ping")), { config: off })).status).toBe(404);
    expect(methodNotAllowed(off).status).toBe(404);
    expect(protectedResourceResponse(off).status).toBe(404);
    expect(manifestResponse(off).status).toBe(404);
  });

  it("logs one audit line per tools/call without arguments or tokens", async () => {
    const plain = `approve_auto_${"c".repeat(64)}`;
    db.current.automationToken.reset([{ id: "t1", workspaceId: "ws-1", userId: "user-anna", tokenHash: hashAutomationToken(plain), revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }]);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await handleMcpPost(post(rpc("tools/call", { name: "list_clients", arguments: {} }), { authorization: `Bearer ${plain}` }), { config: plainConfig });
    const lines = info.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "mcp.tools_call", auth: "automation", user_id: "user-anna", token_id: "t1", tool: "list_clients", outcome: "ok" });
    expect(typeof lines[0].duration_ms).toBe("number");
    expect(JSON.stringify(lines)).not.toContain(plain);
  });
});

describe("GET / DELETE /mcp and discovery", () => {
  it("GET and DELETE answer 405 with Allow: POST", async () => {
    const response = methodNotAllowed(plainConfig);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("protected-resource metadata names the resource, the issuer and the scopes", async () => {
    const response = protectedResourceResponse(config);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: `${BASE}/mcp`,
      authorization_servers: ["https://tenant.eu.auth0.com"],
      scopes_supported: ["approve:read", "approve:draft"],
      bearer_methods_supported: ["header"],
      resource_name: "Approve by Heili",
    });
  });

  it("without OAuth variables the protected-resource document is 404 with an explanation, and mcp.json says bearer-only", async () => {
    const response = protectedResourceResponse(plainConfig);
    expect(response.status).toBe(404);
    expect((await response.json()).message).toMatch(/OAuth non è configurato/);
    const manifest = await manifestResponse(plainConfig).json();
    expect(manifest.authentication).toMatchObject({ type: "bearer", oauth: false });
    expect(manifest.transport).toEqual({ type: "streamable-http", url: `${BASE}/mcp` });
  });

  it("mcp.json with OAuth points at the resource and the metadata", async () => {
    const manifest = await manifestResponse(config).json();
    expect(manifest.authentication).toMatchObject({ type: "oauth2-bearer", oauth: true, resource: `${BASE}/mcp` });
    expect(manifest.capabilities).toMatchObject({ writes: "drafts-only" });
  });
});
