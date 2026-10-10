/**
 * Bearer authentication of /mcp. Two kinds of token, both ending in the same
 * McpPrincipal:
 *
 * a. OAuth access token (JWT) issued by the SAME Auth0 tenant as Heili:
 *    verified with the issuer's JWKS (signature, `iss`, `aud`, expiry, https
 *    JWKS only). The user is found by the VERIFIED EMAIL in the token (`email`
 *    or the namespaced claim a tenant Action adds, MCP_JWT_EMAIL_CLAIM) and must
 *    already be a member of a workspace: nothing is ever created here, no
 *    invitation is accepted, no workspace is provisioned. The panel's login
 *    allowlist (ALLOWED_EMAILS) applies too. Scopes come from `scope`/`scp`/
 *    `permissions`: approve:read and approve:draft.
 * b. Personal automation key (`approve_auto_…`, lib/automation/auth.ts): the
 *    same hash lookup, expiry, revocation and membership re-check as the
 *    automation API; it counts as both scopes and stays in its workspace.
 *
 * Heili maps (issuer, sub) → user through a table; Approve has no such table,
 * so email is the link between the two tenants' identities (documented trade-off:
 * the tenant must only issue tokens with a verified email).
 */

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { prisma } from "@/lib/db/client";
import { AutomationError, authenticateAutomation } from "@/lib/automation/auth";
import { isEmailAllowedToSignIn } from "@/lib/env";
import { MCP_SCOPES, getMcpConfig, type McpConfig, type McpOAuthConfig, type McpScope } from "./config";
import type { McpPrincipal } from "./access";

export class McpAuthError extends Error {
  constructor(
    public status: 401 | 403,
    public code: "missing_token" | "invalid_token" | "insufficient_scope" | "no_access",
    message: string,
    /** Stable, non-sensitive reason for the server log. */
    public reason: string = code
  ) {
    super(message);
    this.name = "McpAuthError";
  }
}

const AUTOMATION_TOKEN = /^approve_auto_[a-f0-9]{64}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer +(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwks(url: string): JWTVerifyGetKey {
  let resolver = jwksCache.get(url);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
    jwksCache.set(url, resolver);
  }
  return resolver;
}

export interface McpAuthDeps {
  config?: McpConfig;
  /** Tests inject a local key set; production uses the issuer's JWKS URL. */
  keyResolver?: JWTVerifyGetKey;
}

export async function authenticateMcp(request: Request, deps: McpAuthDeps = {}): Promise<McpPrincipal> {
  const config = deps.config ?? getMcpConfig();
  const token = readBearer(request);
  if (!token) throw new McpAuthError(401, "missing_token", "Serve un token Bearer", "missing_token");

  if (AUTOMATION_TOKEN.test(token)) return authenticateKey(request);
  if (config.oauth && JWT_SHAPE.test(token)) {
    return authenticateJwt(token, config.oauth, deps.keyResolver ?? remoteJwks(config.oauth.jwksUrl));
  }
  throw new McpAuthError(401, "invalid_token", "Token non valido", config.oauth ? "unknown_token_format" : "oauth_disabled");
}

// ─── Personal automation key ─────────────────────────────────────────────────

async function authenticateKey(request: Request): Promise<McpPrincipal> {
  let context;
  try {
    context = await authenticateAutomation(request);
  } catch (error) {
    if (error instanceof AutomationError) throw new McpAuthError(401, "invalid_token", error.message, "key_rejected");
    throw error;
  }
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } },
    include: { workspace: { select: { id: true, name: true } } },
  });
  if (!membership) throw new McpAuthError(401, "invalid_token", "Accesso al workspace revocato", "key_member_gone");
  return {
    kind: "automation",
    userId: context.userId,
    scopes: [...MCP_SCOPES],
    workspaces: [{ id: membership.workspace.id, name: membership.workspace.name, role: membership.role }],
    tokenId: context.tokenId,
    rateKey: `key:${context.tokenId}`,
  };
}

// ─── OAuth access token ──────────────────────────────────────────────────────

/** Scopes granted by the token: `scope` (string), `scp` (array/string) and Auth0 RBAC `permissions`. */
export function scopesOf(payload: JWTPayload): McpScope[] {
  const raw: unknown[] = [];
  for (const claim of [payload.scope, payload.scp]) {
    if (typeof claim === "string") raw.push(...claim.split(/\s+/));
    else if (Array.isArray(claim)) raw.push(...claim);
  }
  if (Array.isArray(payload.permissions)) raw.push(...payload.permissions);
  return MCP_SCOPES.filter((scope) => raw.includes(scope));
}

/** The user's email from a verified token, or null (never from the request). */
export function verifiedEmailOf(payload: JWTPayload, claims: readonly string[]): string | null {
  for (const claim of claims) {
    const value = payload[claim];
    if (typeof value !== "string" || !value.includes("@")) continue;
    // "Require email_verified if present": an explicit non-true value is a refusal.
    for (const flag of ["email_verified", `${claim}_verified`]) {
      if (flag in payload && payload[flag] !== true) return null;
    }
    return value.trim().toLowerCase();
  }
  return null;
}

async function authenticateJwt(token: string, oauth: McpOAuthConfig, keys: JWTVerifyGetKey): Promise<McpPrincipal> {
  let payload: JWTPayload;
  try {
    const issuer = oauth.issuer.replace(/\/$/, "");
    ({ payload } = await jwtVerify(token, keys, {
      // Auth0 issuers end with "/": accept the issuer written either way.
      issuer: [issuer, `${issuer}/`],
      audience: oauth.audience,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["iss", "sub", "aud", "exp"],
      clockTolerance: 30,
    }));
  } catch (error) {
    const reason = error instanceof joseErrors.JOSEError ? error.code : "verify_failed";
    throw new McpAuthError(401, "invalid_token", "Token non valido o scaduto", `jwt_${reason}`);
  }

  const scopes = scopesOf(payload);
  if (scopes.length === 0) {
    throw new McpAuthError(403, "insufficient_scope", "Al token mancano gli scope approve:read / approve:draft", "no_scope");
  }
  const email = verifiedEmailOf(payload, oauth.emailClaims);
  if (!email) {
    throw new McpAuthError(403, "no_access", "Il token non contiene un'email verificata", "email_missing_or_unverified");
  }
  if (!isEmailAllowedToSignIn(email)) {
    throw new McpAuthError(403, "no_access", "Questo account non ha accesso ad Approve", "email_not_allowed");
  }
  // Existing users only. No ensureWorkspaceForUser, no pending invitation accepted.
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  const memberships = user
    ? await prisma.workspaceMember.findMany({
        where: { userId: user.id },
        include: { workspace: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  if (!user || memberships.length === 0) {
    throw new McpAuthError(403, "no_access", "Nessun account Approve collegato a questa email", user ? "no_membership" : "no_user");
  }
  const azp = typeof payload.azp === "string" ? payload.azp : typeof payload.client_id === "string" ? payload.client_id : undefined;
  return {
    kind: "oauth",
    userId: user.id,
    email,
    scopes,
    workspaces: memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
    ...(azp ? { oauthClientId: azp.slice(0, 100) } : {}),
    rateKey: `user:${user.id}`,
  };
}
