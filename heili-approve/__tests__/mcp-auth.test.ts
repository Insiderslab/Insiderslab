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
import { authenticateMcp, McpAuthError, scopesOf, verifiedEmailOf } from "@/lib/mcp/auth";
import { getMcpConfig } from "@/lib/mcp/config";

const ISSUER = "https://tenant.eu.auth0.com/";
const AUDIENCE = "https://approve.example.com/mcp";
const env = {
  PUBLIC_BASE_URL: "https://approve.example.com",
  MCP_JWT_ISSUER: ISSUER,
  MCP_JWT_JWKS_URL: "https://tenant.eu.auth0.com/.well-known/jwks.json",
} as unknown as NodeJS.ProcessEnv;
const config = getMcpConfig(env);

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  otherKeys = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  resolver = createLocalJWKSet({ keys: [jwk] });
});

async function sign(
  claims: Record<string, unknown> = {},
  options: { issuer?: string; audience?: string; expiresIn?: string; key?: CryptoKey; kid?: string } = {}
) {
  return new SignJWT({ scope: "approve:read approve:draft", email: "Anna@Agency.it", email_verified: true, azp: "claude-app", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "k1" })
    .setSubject("auth0|abc")
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(options.key ?? keys.privateKey);
}

const request = (token?: string) =>
  new Request("https://approve.example.com/mcp", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

async function rejection(token: string | undefined, cfg = config) {
  try {
    await authenticateMcp(request(token), { config: cfg, keyResolver: resolver });
  } catch (error) {
    expect(error).toBeInstanceOf(McpAuthError);
    return error as McpAuthError;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  const d = db.current;
  d.user.reset([{ id: "user-anna", email: "anna@agency.it" }, { id: "user-loner", email: "loner@agency.it" }]);
  d.workspaceMember.reset([
    { id: "m1", workspaceId: "ws-1", userId: "user-anna", role: "ADMIN", createdAt: new Date(1), workspace: { id: "ws-1", name: "Agenzia" } },
    { id: "m2", workspaceId: "ws-2", userId: "user-anna", role: "MEMBER", createdAt: new Date(2), workspace: { id: "ws-2", name: "Altro" } },
  ]);
  d.automationToken.reset();
});

describe("MCP bearer authentication", () => {
  it("401 for a missing token (and never reads the database)", async () => {
    const error = await rejection(undefined);
    expect(error).toMatchObject({ status: 401, code: "missing_token" });
    expect(db.current.user.findFirst).not.toHaveBeenCalled();
  });

  it("accepts a valid OAuth token and maps the verified email to the existing user's workspaces", async () => {
    const principal = await authenticateMcp(request(await sign()), { config, keyResolver: resolver });
    expect(principal).toMatchObject({
      kind: "oauth",
      userId: "user-anna",
      email: "anna@agency.it",
      oauthClientId: "claude-app",
      scopes: ["approve:read", "approve:draft"],
      rateKey: "user:user-anna",
    });
    expect(principal.workspaces.map((w) => w.id)).toEqual(["ws-1", "ws-2"]);
  });

  it("refuses garbage, expired tokens, a foreign signature, wrong issuer and wrong audience", async () => {
    expect(await rejection("not-a-token")).toMatchObject({ status: 401 });
    expect(await rejection("a.b.c")).toMatchObject({ status: 401 });
    expect(await rejection(await sign({}, { expiresIn: "-1m" }))).toMatchObject({ status: 401, code: "invalid_token" });
    expect(await rejection(await sign({}, { key: otherKeys.privateKey }))).toMatchObject({ status: 401 });
    expect(await rejection(await sign({}, { issuer: "https://evil.example.com/" }))).toMatchObject({ status: 401 });
    expect(await rejection(await sign({}, { audience: "https://api.heili.cloud/mcp" }))).toMatchObject({ status: 401 });
  });

  it("accepts the issuer written with or without the trailing slash", async () => {
    const noSlash = getMcpConfig({ ...env, MCP_JWT_ISSUER: "https://tenant.eu.auth0.com" } as NodeJS.ProcessEnv);
    await expect(authenticateMcp(request(await sign()), { config: noSlash, keyResolver: resolver })).resolves.toMatchObject({ userId: "user-anna" });
  });

  it("403 when the token carries none of the scopes", async () => {
    const error = await rejection(await sign({ scope: "openid profile" }));
    expect(error).toMatchObject({ status: 403, code: "insufficient_scope" });
  });

  it("reads scopes from scope, scp and Auth0 RBAC permissions", async () => {
    expect(scopesOf({ scope: "approve:read" })).toEqual(["approve:read"]);
    expect(scopesOf({ permissions: ["approve:draft", "other:thing"] })).toEqual(["approve:draft"]);
    expect(scopesOf({ scp: ["approve:read", "approve:draft"] })).toEqual(["approve:read", "approve:draft"]);
    expect(scopesOf({ scope: "approve:admin" })).toEqual([]);
  });

  it("refuses an unverified or missing email", async () => {
    expect(await rejection(await sign({ email_verified: false }))).toMatchObject({ status: 403, code: "no_access" });
    expect(await rejection(await sign({ email: undefined }))).toMatchObject({ status: 403 });
    expect(verifiedEmailOf({ email: "a@b.it" }, ["email"])).toBe("a@b.it");
    expect(verifiedEmailOf({ email: "a@b.it", email_verified: "true" }, ["email"])).toBeNull();
  });

  it("reads the namespaced email claim Auth0 Actions add", async () => {
    const token = await sign({ email: undefined, email_verified: undefined, "https://approve.example.com/email": "anna@agency.it" });
    await expect(authenticateMcp(request(token), { config, keyResolver: resolver })).resolves.toMatchObject({ userId: "user-anna" });
    const custom = getMcpConfig({ ...env, MCP_JWT_EMAIL_CLAIM: "https://claims.example/mail" } as NodeJS.ProcessEnv);
    const t2 = await sign({ email: undefined, email_verified: undefined, "https://claims.example/mail": "anna@agency.it" });
    await expect(authenticateMcp(request(t2), { config: custom, keyResolver: resolver })).resolves.toMatchObject({ userId: "user-anna" });
  });

  it("refuses a verified email that is not an Approve member, and never provisions anything", async () => {
    expect(await rejection(await sign({ email: "stranger@elsewhere.it" }))).toMatchObject({ status: 403, code: "no_access" });
    // A user without any workspace membership is refused too.
    expect(await rejection(await sign({ email: "loner@agency.it" }))).toMatchObject({ status: 403, code: "no_access" });
    expect(db.current.user.create).not.toHaveBeenCalled();
    expect(db.current.workspaceMember.create).not.toHaveBeenCalled();
  });

  it("honours the panel login allowlist (ALLOWED_EMAILS)", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "boss@agency.it");
    expect(await rejection(await sign())).toMatchObject({ status: 403, code: "no_access" });
  });

  it("with OAuth not configured a JWT is just an invalid token", async () => {
    const off = getMcpConfig({ PUBLIC_BASE_URL: "https://approve.example.com" } as unknown as NodeJS.ProcessEnv);
    expect(off.oauth).toBeNull();
    expect(await rejection(await sign(), off)).toMatchObject({ status: 401, code: "invalid_token" });
  });

  describe("personal automation key", () => {
    const plain = `approve_auto_${"b".repeat(64)}`;
    const key = (overrides: Record<string, unknown> = {}) => ({
      id: "tok-1", workspaceId: "ws-1", userId: "user-anna", tokenHash: hashAutomationToken(plain),
      revokedAt: null, expiresAt: new Date(Date.now() + 60_000), ...overrides,
    });

    it("is accepted, counts as both scopes and stays in its own workspace", async () => {
      db.current.automationToken.reset([key()]);
      const principal = await authenticateMcp(request(plain), { config, keyResolver: resolver });
      expect(principal).toMatchObject({ kind: "automation", userId: "user-anna", tokenId: "tok-1", rateKey: "key:tok-1", scopes: ["approve:read", "approve:draft"] });
      expect(principal.workspaces).toEqual([{ id: "ws-1", name: "Agenzia", role: "ADMIN" }]);
    });

    it("works even when OAuth is not configured", async () => {
      db.current.automationToken.reset([key()]);
      const off = getMcpConfig({ PUBLIC_BASE_URL: "https://approve.example.com" } as unknown as NodeJS.ProcessEnv);
      await expect(authenticateMcp(request(plain), { config: off })).resolves.toMatchObject({ kind: "automation" });
    });

    it("is refused when revoked, expired or its owner left the workspace", async () => {
      db.current.automationToken.reset([key({ revokedAt: new Date() })]);
      expect(await rejection(plain)).toMatchObject({ status: 401 });
      db.current.automationToken.reset([key({ expiresAt: new Date(Date.now() - 1) })]);
      expect(await rejection(plain)).toMatchObject({ status: 401 });
      db.current.automationToken.reset([key({ workspaceId: "ws-gone" })]);
      expect(await rejection(plain)).toMatchObject({ status: 401 });
    });
  });
});

describe("MCP configuration", () => {
  it("defaults: enabled, audience = ${APP_URL}/mcp, OAuth off without variables", () => {
    const c = getMcpConfig({ PUBLIC_BASE_URL: "https://approve.example.com/" } as unknown as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ enabled: true, resource: "https://approve.example.com/mcp", oauth: null, oauthProblem: null });
    expect(getMcpConfig({ ...env, MCP_JWT_AUDIENCE: "" } as NodeJS.ProcessEnv).oauth?.audience).toBe(AUDIENCE);
  });

  it("MCP_ENABLED=false turns it off", () => {
    expect(getMcpConfig({ MCP_ENABLED: "false" } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(getMcpConfig({ MCP_ENABLED: "0" } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it("accepts only https issuer and JWKS, and needs both", () => {
    const http = getMcpConfig({ MCP_JWT_ISSUER: "http://t.example/", MCP_JWT_JWKS_URL: "https://t.example/jwks" } as unknown as NodeJS.ProcessEnv);
    expect(http.oauth).toBeNull();
    expect(http.oauthProblem).toMatch(/https/);
    const half = getMcpConfig({ MCP_JWT_ISSUER: "https://t.example/" } as unknown as NodeJS.ProcessEnv);
    expect(half.oauth).toBeNull();
    expect(half.oauthProblem).toBeTruthy();
  });
});
