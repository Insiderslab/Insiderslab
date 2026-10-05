/**
 * Metricool REST client.
 *
 * Auth is the agency's API token in the `X-Mc-Auth` header plus `userId` (and
 * `blogId` for brand-scoped calls) in the query string. The token lives
 * encrypted on the Workspace, is decrypted only here, and never appears in an
 * error message or a log line.
 *
 * METRICOOL_FAKE=1 swaps every call for an in-memory fake (fixed brands,
 * generated post ids) so the whole approve → schedule flow runs without
 * network access, e.g. in end-to-end tests.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";
import { getMetricoolApiBase } from "@/lib/env";
import { NETWORKS, type Network } from "@/lib/domain";
import type { MetricoolSchedulerPayload } from "@/lib/metricool/payload";

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Errors ──────────────────────────────────────────────────────────────────

export type MetricoolErrorCode =
  | "not_configured"
  | "unauthorized"
  | "rejected"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "network"
  | "invalid_response";

/**
 * Every failure of a Metricool call. `retryable` tells the worker whether a
 * later attempt can succeed (rate limit, outage, network) or whether the post
 * must fail right away (bad credentials, rejected content). `message` is in
 * Italian and safe to store in Post.lastError.
 */
export class MetricoolError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public retryable: boolean,
    public code: MetricoolErrorCode
  ) {
    super(message);
    this.name = "MetricoolError";
  }
}

/** 429 and 5xx can clear up by themselves; any other 4xx will not. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function errorDetail(body: unknown): string | null {
  if (typeof body === "string") return body.trim().slice(0, 300) || null;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "errorMessage", "description"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
    }
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      return JSON.stringify(record.errors).slice(0, 300);
    }
  }
  return null;
}

/** Map an HTTP failure to a typed error with an actionable Italian message. */
export function metricoolErrorFromResponse(status: number, body: unknown): MetricoolError {
  const detail = errorDetail(body);
  const suffix = detail ? ` Dettaglio: ${detail}` : "";

  if (status === 401 || status === 403) {
    return new MetricoolError(
      `Metricool ha rifiutato le credenziali (${status}). Controlla userId e token API in Impostazioni.`,
      status,
      false,
      "unauthorized"
    );
  }
  if (status === 404) {
    return new MetricoolError(
      `Metricool non trova il brand richiesto (404): verifica il brand collegato al cliente.${suffix}`,
      status,
      false,
      "not_found"
    );
  }
  if (status === 429) {
    return new MetricoolError(
      "Troppe richieste a Metricool (429).",
      status,
      true,
      "rate_limited"
    );
  }
  if (isRetryableStatus(status)) {
    return new MetricoolError(
      `Metricool non è raggiungibile in questo momento (${status}).`,
      status,
      true,
      "unavailable"
    );
  }
  return new MetricoolError(
    `Metricool ha rifiutato il post (${status}).${suffix}`,
    status,
    false,
    "rejected"
  );
}

// ─── Response parsing (defensive: field names are undocumented) ──────────────

export interface MetricoolBrand {
  blogId: string;
  label: string;
  timezone: string | null;
  avatarUrl: string | null;
  /** Networks with a connected account, when the profile says so. */
  networks: Network[];
}

/** Profile fields that, when non-empty, mean the network is connected. */
const NETWORK_PROFILE_FIELDS: Record<Network, string[]> = {
  instagram: ["instagram", "instagramConnectionType", "instagramBusiness"],
  facebook: ["facebook", "facebookPageId", "facebookPage"],
  linkedin: ["linkedin", "linkedinCompany", "linkedInCompany"],
  tiktok: ["tiktok", "tiktokAccount", "tiktokBusiness"],
  twitter: ["twitter", "x"],
  threads: ["threads", "threadsAccount"],
  pinterest: ["pinterest", "pinterestBusiness"],
  youtube: ["youtube", "youtubeChannelName", "youtubeChannel"],
  gmb: ["gmb", "gmbBusiness", "googleBusiness", "gmbAccount"],
  bluesky: ["bluesky", "blueskyHandle"],
};

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function isConnectedValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && value !== null;
}

function unwrapList(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    for (const key of ["data", "profiles", "brands", "items"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

/** Parse `GET /admin/simpleProfiles` into brands, skipping entries without an id. */
export function parseBrands(json: unknown): MetricoolBrand[] {
  const brands: MetricoolBrand[] = [];
  for (const entry of unwrapList(json)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const blogId = firstString(record, ["blogId", "id", "blog_id"]);
    if (!blogId) continue;

    const networks = NETWORKS.filter((network) =>
      NETWORK_PROFILE_FIELDS[network].some((key) => isConnectedValue(record[key]))
    );

    brands.push({
      blogId,
      label: firstString(record, ["label", "name", "title", "brandName"]) ?? `Brand ${blogId}`,
      timezone: firstString(record, ["timezone", "timeZone", "tz"]),
      avatarUrl: firstString(record, ["picture", "avatar", "image", "logo"]),
      networks,
    });
  }
  return brands;
}

/** Id of the created post: `data.id`, `id`, `data.uuid` or `uuid`, as a string. */
export function extractMetricoolPostId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : null;
  return (data && firstString(data, ["id", "uuid"])) ?? firstString(record, ["id", "uuid"]);
}

// ─── Client ──────────────────────────────────────────────────────────────────

export function isMetricoolFake(): boolean {
  return process.env.METRICOOL_FAKE === "1";
}

/** Fake-mode marker: a post whose text contains it fails as rejected (422). */
export const FAKE_FAILURE_MARKER = "[metricool:fail]";

const FAKE_BRANDS: MetricoolBrand[] = [
  {
    blogId: "fake-1001",
    label: "Brand demo (Metricool finto)",
    timezone: "Europe/Rome",
    avatarUrl: null,
    networks: ["instagram", "facebook", "linkedin", "tiktok"],
  },
  {
    blogId: "fake-1002",
    label: "Secondo brand demo (Metricool finto)",
    timezone: "Europe/Madrid",
    avatarUrl: null,
    networks: ["instagram", "facebook", "youtube", "pinterest", "gmb"],
  },
];

export interface MetricoolClientOptions {
  userId: string;
  token: string;
  /** Overrides getMetricoolApiBase() (tests). */
  baseUrl?: string;
  /** Overrides METRICOOL_FAKE (tests). */
  fake?: boolean;
  fetchImpl?: typeof fetch;
}

export type MetricoolConnectionResult =
  | { ok: true; brandCount: number }
  | { ok: false; error: string };

export class MetricoolClient {
  private readonly userId: string;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fake: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetricoolClientOptions) {
    this.userId = options.userId;
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? getMetricoolApiBase()).replace(/\/$/, "");
    this.fake = options.fake ?? isMetricoolFake();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get isFake(): boolean {
    return this.fake;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string>,
    body?: unknown
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "X-Mc-Auth": this.token,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Only the error name: some fetch errors echo request options.
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "errore di rete";
      throw new MetricoolError(
        `Impossibile contattare Metricool (${reason}).`,
        null,
        true,
        "network"
      );
    }

    const raw = await response.text().catch(() => "");
    let json: unknown = raw;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = raw;
      }
    }

    if (!response.ok) throw metricoolErrorFromResponse(response.status, json);
    return json;
  }

  /** Brands (Metricool "profiles") the account can publish to. */
  async listBrands(): Promise<MetricoolBrand[]> {
    if (this.fake) return FAKE_BRANDS.map((brand) => ({ ...brand, networks: [...brand.networks] }));
    const json = await this.request("GET", "/admin/simpleProfiles", { userId: this.userId });
    return parseBrands(json);
  }

  /** Create a scheduled post. Returns Metricool's id for it. */
  async schedulePost(
    blogId: string,
    payload: MetricoolSchedulerPayload
  ): Promise<{ metricoolPostId: string }> {
    if (this.fake) {
      if (payload.text.includes(FAKE_FAILURE_MARKER)) {
        throw metricoolErrorFromResponse(422, { message: "Errore simulato (METRICOOL_FAKE)." });
      }
      const metricoolPostId = `fake-${randomUUID()}`;
      console.log(
        `[Metricool fake] scheduled ${metricoolPostId} on blog ${blogId} at ${payload.publicationDate.dateTime} ${payload.publicationDate.timezone} (${payload.providers.map((p) => p.network).join(", ")})`
      );
      return { metricoolPostId };
    }

    const json = await this.request(
      "POST",
      "/v2/scheduler/posts",
      { blogId, userId: this.userId },
      payload
    );
    const metricoolPostId = extractMetricoolPostId(json);
    if (!metricoolPostId) {
      // The post most likely exists on Metricool: never retry this blindly.
      throw new MetricoolError(
        "Metricool ha accettato il post ma non ha restituito un id: verifica su Metricool prima di riprovare.",
        null,
        false,
        "invalid_response"
      );
    }
    return { metricoolPostId };
  }

  /** Cheap credential check for the settings page. Never throws. */
  async testConnection(): Promise<MetricoolConnectionResult> {
    try {
      const brands = await this.listBrands();
      return { ok: true, brandCount: brands.length };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof MetricoolError ? error.message : "Errore imprevisto durante la verifica di Metricool.",
      };
    }
  }
}

/**
 * Client for a workspace's stored credentials. Throws a non-retryable
 * MetricoolError when Metricool is not connected (fake mode needs no
 * credentials).
 */
export async function getWorkspaceMetricoolClient(workspaceId: string): Promise<MetricoolClient> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { metricoolUserId: true, metricoolTokenEncrypted: true },
  });

  if (isMetricoolFake()) {
    return new MetricoolClient({ userId: workspace?.metricoolUserId ?? "fake-user", token: "fake", fake: true });
  }

  if (!workspace?.metricoolUserId || !workspace.metricoolTokenEncrypted) {
    throw new MetricoolError(
      "Metricool non è collegato: inserisci userId e token API in Impostazioni.",
      null,
      false,
      "not_configured"
    );
  }

  let token: string;
  try {
    token = decryptSecret(workspace.metricoolTokenEncrypted);
  } catch {
    throw new MetricoolError(
      "Il token Metricool salvato non è leggibile: inseriscilo di nuovo in Impostazioni.",
      null,
      false,
      "not_configured"
    );
  }

  return new MetricoolClient({ userId: workspace.metricoolUserId, token });
}
