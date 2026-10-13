import { z } from "zod";

const HEX_32_BYTE = /^[a-f0-9]{64}$/i;

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function requireEnv(name: string): string {
  return readEnv(name);
}

/**
 * Public origin of the app, used for magic links, review links and media URLs.
 * The first non-empty of PUBLIC_BASE_URL / NEXTAUTH_URL wins — a variable set
 * but EMPTY (a common docker-compose slip) no longer produces relative URLs.
 * There is no APP_URL variable; use PUBLIC_BASE_URL.
 */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    (env.PUBLIC_BASE_URL ?? "").trim() || (env.NEXTAUTH_URL ?? "").trim() || "http://localhost:3000";
  const base = raw.replace(/\/$/, "");
  if (!/^https?:\/\/.+/.test(base)) {
    throw new Error(`PUBLIC_BASE_URL/NEXTAUTH_URL must be an absolute http(s) URL, got "${raw}"`);
  }
  return base;
}

export function getBaseUrl(): string {
  return resolveBaseUrl();
}

export function getEncryptionKeyHex(): string {
  const value = readEnv("ENCRYPTION_KEY");
  if (!HEX_32_BYTE.test(value)) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex string");
  }
  return value;
}

/** Directory where uploaded media is stored on disk (a Docker volume in prod). */
export function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? `${process.cwd()}/uploads`;
}

export function getMetricoolApiBase(): string {
  return (process.env.METRICOOL_API_BASE ?? "https://app.metricool.com/api").replace(/\/$/, "");
}

/**
 * Optional sign-in allowlist (agency staff only — clients never sign in, they
 * use their personal review link). Same behaviour as heili-dm.
 */
export function isEmailAllowedToSignIn(email: string | null | undefined): boolean {
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return true;
  if (!email) return false;
  return allowed.includes(email.toLowerCase());
}

export const serverEnvSchema = z.object({
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().regex(HEX_32_BYTE),
});

export function validateCoreEnv() {
  return serverEnvSchema.parse(process.env);
}
