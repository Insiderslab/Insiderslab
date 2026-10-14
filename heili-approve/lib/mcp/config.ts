/**
 * MCP server configuration, read from the environment (docs/COLLEGARE-AI-MCP.md).
 *
 * `getMcpConfig` is pure (takes the env as an argument) so tests and the
 * settings page use the very same rules as the route. OAuth is optional: with
 * no `MCP_JWT_*` variables (or invalid ones) it is simply off and personal
 * automation keys still work. Nothing here ever returns a secret.
 */

import { resolveBaseUrl } from "@/lib/env";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

export const MCP_SCOPE_READ = "approve:read";
export const MCP_SCOPE_DRAFT = "approve:draft";
export const MCP_SCOPES = [MCP_SCOPE_READ, MCP_SCOPE_DRAFT] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_SERVER_NAME = "Approve by Heili";
export const MCP_SERVER_VERSION = "1.0.0";

export interface McpOAuthConfig {
  /** Exactly as in the token's `iss` (Auth0: with a trailing slash). */
  issuer: string;
  /** `aud` the tokens must carry: the Auth0 API identifier. */
  audience: string;
  jwksUrl: string;
  /** Claims tried, in order, for the user's email. */
  emailClaims: string[];
}

export interface McpConfig {
  enabled: boolean;
  /** Public origin of the app, no trailing slash. */
  baseUrl: string;
  /** Canonical MCP endpoint (= the OAuth resource): `${baseUrl}/mcp`. */
  resource: string;
  oauth: McpOAuthConfig | null;
  /** Why OAuth is off, when some MCP_JWT_* variables are set but unusable. */
  oauthProblem: string | null;
  rateLimitPerMinute: number;
  maxUploadBytes: number;
  allowedOrigins: string[];
}

const DEFAULT_RATE_LIMIT = 120;
/** Inline (base64) uploads: a JSON-RPC body, not a stream — kept well below the 300 MB panel limit. */
const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = ["https://claude.ai", "https://chatgpt.com", "https://chat.openai.com"];

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function getMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  // Same rule as the rest of the app: empty counts as unset (lib/env).
  const baseUrl = resolveBaseUrl(env);
  const resource = `${baseUrl}/mcp`;
  const enabled = !["0", "false", "off", "no"].includes((env.MCP_ENABLED ?? "").trim().toLowerCase());

  const issuer = env.MCP_JWT_ISSUER?.trim() ?? "";
  const jwksUrl = env.MCP_JWT_JWKS_URL?.trim() ?? "";
  const audience = env.MCP_JWT_AUDIENCE?.trim() || resource;
  let oauth: McpOAuthConfig | null = null;
  let oauthProblem: string | null = null;
  if (issuer || jwksUrl) {
    if (!issuer || !jwksUrl) {
      oauthProblem = "Servono sia MCP_JWT_ISSUER sia MCP_JWT_JWKS_URL";
    } else if (!isHttpsUrl(issuer) || !isHttpsUrl(jwksUrl)) {
      oauthProblem = "MCP_JWT_ISSUER e MCP_JWT_JWKS_URL devono usare https";
    } else {
      const custom = env.MCP_JWT_EMAIL_CLAIM?.trim();
      oauth = {
        issuer,
        audience,
        jwksUrl,
        // Auth0 only puts custom claims in access tokens under a namespace: the
        // tenant Action adds `${PUBLIC_BASE_URL}/email` (see the docs).
        emailClaims: [...new Set([...(custom ? [custom] : []), "email", `${baseUrl}/email`])],
      };
    }
  }

  const origins = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return {
    enabled,
    baseUrl,
    resource,
    oauth,
    oauthProblem,
    rateLimitPerMinute: positiveInt(env.MCP_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT, 10_000),
    maxUploadBytes: positiveInt(env.MCP_MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES),
    allowedOrigins: [baseUrl, ...DEFAULT_ALLOWED_ORIGINS, ...origins],
  };
}

/** `https://app/.well-known/oauth-protected-resource/mcp` (RFC 9728 path-suffixed form). */
export function protectedResourceMetadataUrl(config: McpConfig): string {
  return `${config.baseUrl}/.well-known/oauth-protected-resource/mcp`;
}
