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
import { getBaseUrl, getMetricoolApiBase } from "@/lib/env";
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
  /** The request may have reached Metricool but no answer came back (timeout, reset). */
  | "no_response"
  /** A create call whose outcome is unknown: retrying could publish twice. */
  | "uncertain"
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

/** Connection errors raised before any byte of the request was sent. */
const PRE_SEND_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

/** True only when the fetch failed before the request could reach Metricool. */
export function failedBeforeSending(error: unknown): boolean {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" && PRE_SEND_ERROR_CODES.has(code);
}

/** A failed create call that Metricool may nevertheless have carried out. */
export function isUncertainCreateFailure(error: MetricoolError): boolean {
  if (error.code === "no_response") return true;
  return error.status !== null && error.status >= 500;
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
  /** Trimmed; "Brand <id>" when Metricool sends none. */
  label: string;
  timezone: string | null;
  /** Brand logo (Metricool's `image`, also `picture` / `avatar` / `logo`). */
  avatarUrl: string | null;
  /** Publishing networks with a connected account (ads accounts are not publishing networks). */
  networks: Network[];
  /** Account name / handle per connected network, when Metricool tells it (e.g. instagram: "pharmera"). */
  accounts: Partial<Record<Network, string>>;
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

/**
 * Keys of the `networksData` object of a brand, one per publishing network.
 * The ads accounts (`facebookAdsData`, `googleAdsData`, `tiktokAdsData`) are
 * deliberately absent: they cannot receive scheduled posts.
 */
const NETWORKS_DATA_KEYS: Record<Network, string> = {
  instagram: "instagramData",
  facebook: "facebookData",
  linkedin: "linkedinData",
  tiktok: "tiktokData",
  twitter: "twitterData",
  threads: "threadsData",
  pinterest: "pinterestData",
  youtube: "youtubeData",
  gmb: "gbpData",
  bluesky: "blueskyData",
};

/** Keys of a network's data object that hold its account name, most telling first. */
const ACCOUNT_NAME_KEYS = ["username", "handle", "screenName", "name", "title", "displayName", "account"];

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

/** A `<network>Data` value that describes a connected account (not null, not an empty shell). */
function isNetworkDataConnected(value: unknown): boolean {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).some(
      (entry) => entry !== null && entry !== undefined && entry !== "" && entry !== false
    );
  }
  return isConnectedValue(value);
}

/** Account name from a `<network>Data` value or a legacy profile string, if any. */
function accountHint(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return firstString(value as Record<string, unknown>, ACCOUNT_NAME_KEYS);
  }
  return null;
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

    const networksData =
      record.networksData && typeof record.networksData === "object" && !Array.isArray(record.networksData)
        ? (record.networksData as Record<string, unknown>)
        : {};

    const networks: Network[] = [];
    const accounts: Partial<Record<Network, string>> = {};
    for (const network of NETWORKS) {
      const data = networksData[NETWORKS_DATA_KEYS[network]];
      const legacyKey = NETWORK_PROFILE_FIELDS[network].find((key) => isConnectedValue(record[key]));
      if (!isNetworkDataConnected(data) && !legacyKey) continue;
      networks.push(network);
      const hint = accountHint(data) ?? (legacyKey ? accountHint(record[legacyKey]) : null);
      if (hint) accounts[network] = hint;
    }

    brands.push({
      blogId,
      label: firstString(record, ["label", "name", "title", "brandName"]) ?? `Brand ${blogId}`,
      timezone: firstString(record, ["timezone", "timeZone", "tz"]),
      avatarUrl: firstString(record, ["image", "picture", "avatar", "logo"]),
      networks,
      accounts,
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

/** One connected account in the shape of Metricool's `networksData` entries. */
const fakeAccount = (username: string) => ({ username, connected: true });

/** Raw entries shaped like `GET /admin/simpleProfiles` (also exercises parseBrands). */
function fakeBrandEntries(): Record<string, unknown>[] {
  const logo = (n: number) => `${getBaseUrl()}/fake-brands/brand-${n}.svg`;
  const base = { userId: 1234567 };
  return [
    {
      ...base, id: "fake-1001", label: "Pharmera ", image: logo(1), timezone: "Europe/Rome",
      networksData: {
        facebookData: fakeAccount("Pharmera"), instagramData: fakeAccount("pharmera.it"),
        linkedinData: fakeAccount("pharmera-srl"), twitterData: null, facebookAdsData: fakeAccount("act_1001"),
      },
    },
    {
      ...base, id: "fake-1002", label: "Osteria del Borgo", image: logo(2), timezone: "Europe/Rome",
      networksData: {
        facebookData: fakeAccount("Osteria del Borgo"), instagramData: fakeAccount("osteriadelborgo"),
        tiktokData: fakeAccount("osteriadelborgo"), googleAdsData: fakeAccount("123-456-7890"),
      },
    },
    {
      ...base, id: "fake-1003", label: "Atelier Lumen", image: logo(3), timezone: "Europe/Rome",
      networksData: {
        instagramData: fakeAccount("atelier.lumen"), pinterestData: fakeAccount("atelierlumen"),
        youtubeData: fakeAccount("Atelier Lumen"),
      },
    },
    {
      ...base, id: "fake-1004", label: "Casa Mediterranea", image: logo(4), timezone: "Europe/Madrid",
      networksData: {
        facebookData: fakeAccount("Casa Mediterranea"), instagramData: fakeAccount("casamediterranea"),
        gbpData: fakeAccount("Casa Mediterranea - Valencia"),
      },
    },
    {
      // No label: the app falls back to "Brand <id>".
      ...base, id: "fake-1005", image: logo(5), timezone: "Europe/Rome",
      networksData: { instagramData: fakeAccount("brand1005"), tiktokAdsData: fakeAccount("7000000000") },
    },
    {
      ...base, id: "fake-1006", label: "Studio Dentistico Bianchi", image: logo(6), timezone: "Europe/Rome",
      networksData: {
        facebookData: fakeAccount("Studio Dentistico Bianchi"), gbpData: fakeAccount("Studio Dentistico Bianchi"),
        linkedinData: fakeAccount("studio-bianchi"),
      },
    },
    {
      ...base, id: "fake-1007", label: "Gelateria Nuvola", image: logo(7), timezone: "Europe/Rome",
      networksData: {
        instagramData: fakeAccount("gelateria.nuvola"), tiktokData: fakeAccount("gelateria.nuvola"),
        threadsData: fakeAccount("gelateria.nuvola"),
      },
    },
    {
      ...base, id: "fake-1008", label: "Tech4Kids Academy", image: logo(8), timezone: "Europe/London",
      networksData: {
        youtubeData: fakeAccount("Tech4Kids Academy"), linkedinData: fakeAccount("tech4kids"),
        twitterData: fakeAccount("tech4kids"), blueskyData: fakeAccount("tech4kids.bsky.social"),
      },
    },
    {
      ...base, id: "fake-1009", label: "Villa Serena Resort", image: logo(9), timezone: "Europe/Lisbon",
      networksData: {
        facebookData: fakeAccount("Villa Serena Resort"), instagramData: fakeAccount("villaserenaresort"),
        gbpData: fakeAccount("Villa Serena Resort"), facebookAdsData: fakeAccount("act_1009"),
      },
    },
    {
      ...base, id: "fake-1010", label: "Officina Verde", image: logo(10), timezone: "America/Bogota",
      networksData: {
        instagramData: fakeAccount("officinaverde"), facebookData: fakeAccount("Officina Verde"),
        tiktokData: fakeAccount("officinaverde"),
      },
    },
  ];
}

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
        failedBeforeSending(error) ? "network" : "no_response"
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
    if (this.fake) return parseBrands(fakeBrandEntries());
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
      // The full body (no credentials in it) so e2e tests and developers can
      // check exactly what would have been sent to Metricool.
      console.log(`[Metricool fake] payload ${JSON.stringify({ metricoolPostId, blogId, payload })}`);
      return { metricoolPostId };
    }

    let json: unknown;
    try {
      json = await this.request("POST", "/v2/scheduler/posts", { blogId, userId: this.userId }, payload);
    } catch (error) {
      // A timeout, a dropped connection or a 5xx from a gateway does not say
      // whether Metricool created the post. Retrying blindly could schedule it
      // twice, so the outcome is "uncertain" and a human checks first. Only
      // failures before the request left (DNS, connection refused) and 408/429
      // stay retryable.
      if (error instanceof MetricoolError && isUncertainCreateFailure(error)) {
        throw new MetricoolError(
          `Esito incerto: ${error.message} Il post potrebbe essere già stato programmato: controlla su Metricool prima di usare "Riprova".`,
          error.status,
          false,
          "uncertain"
        );
      }
      throw error;
    }
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

  /** Credential check that also returns the brands (settings page). Never throws. */
  async checkConnection(): Promise<{ ok: true; brands: MetricoolBrand[] } | { ok: false; error: string }> {
    try {
      return { ok: true, brands: await this.listBrands() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof MetricoolError ? error.message : "Errore imprevisto durante la verifica di Metricool.",
      };
    }
  }

  /** Cheap credential check for the settings page. Never throws. */
  async testConnection(): Promise<MetricoolConnectionResult> {
    const result = await this.checkConnection();
    return result.ok ? { ok: true, brandCount: result.brands.length } : result;
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
