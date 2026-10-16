/**
 * Origins of a website under review «Sul sito» (docs/SITO-WEB.md).
 *
 * An origin is the exact `scheme://host[:port]` the review script may run on:
 * the iframe answers, the code exchange succeeds and the /api/site/v1 CORS
 * headers are sent only for an origin registered on the site. Rules decided
 * on 16/10:
 * - exact origins only: no wildcards, no "any subdomain";
 * - https; http:// only for localhost or for an address the agency explicitly
 *   marks as a test site («sito di prova senza https»);
 * - no credentials in the address.
 *
 * Pure and isomorphic (the agency editor validates while typing).
 */

export const MAX_SITE_ORIGINS = 10;

export type OriginResult = { ok: true; origin: string } | { ok: false; error: string };

/** localhost, *.localhost, 127.0.0.1 and [::1]: the agency's own machine. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

/**
 * Canonical origin of what the agency typed ("https://prova.cliente.it",
 * also accepted with a path: the path is dropped). `testOrigin` = the agency
 * marked it as a test site, the only way to register a non-local http origin.
 */
export function normalizeOrigin(input: string, opts: { testOrigin?: boolean } = {}): OriginResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Scrivi l'indirizzo del sito." };
  if (raw.length > 2048) return { ok: false, error: "Indirizzo troppo lungo." };
  if (raw.includes("*")) {
    return { ok: false, error: "Niente caratteri jolly: scrivi l'indirizzo esatto (es. https://prova.cliente.it)." };
  }
  if (!/^https?:\/\//i.test(raw)) {
    return { ok: false, error: "Scrivi l'indirizzo completo, che inizia con https://" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Indirizzo non valido." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Togli nome utente e password dall'indirizzo." };
  }
  const hostname = url.hostname.replace(/\.$/, "");
  if (!hostname) return { ok: false, error: "Indirizzo non valido." };
  const local = isLocalHostname(hostname);
  if (!local && !hostname.includes(".")) {
    return { ok: false, error: "Indirizzo non valido: manca il dominio (es. prova.cliente.it)." };
  }
  if (url.protocol === "http:" && !local && !opts.testOrigin) {
    return {
      ok: false,
      error: "Gli indirizzi http:// sono ammessi solo per i siti di prova: segnalo come sito di prova, oppure usa https://",
    };
  }
  const origin = `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`.toLowerCase();
  return { ok: true, origin };
}

/** Origin of an absolute http(s) URL, or null. */
export function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True only when `candidate` is exactly one of the registered origins.
 * `candidate` comes from the browser (event.origin, the Origin header): it
 * must already be canonical ("null", a path or a trailing slash never match).
 */
export function originAllowed(candidate: string | null | undefined, origins: readonly string[]): boolean {
  if (!candidate || candidate === "null") return false;
  const canonical = originOf(candidate);
  if (canonical === null || canonical !== candidate.toLowerCase() || /\/$/.test(candidate)) return false;
  return origins.some((origin) => origin === canonical);
}

/** True for an http:// origin that is not local (it needs the test-site mark). */
export function needsTestMark(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The CORS headers of a /api/site/v1 response: Access-Control-Allow-Origin
 * only for a registered origin (or Approve's own), never "*", never with
 * credentials; Vary: Origin always.
 */
export function siteCorsHeaders(
  requestOrigin: string | null,
  allowedOrigins: readonly string[],
  appOrigin: string | null
): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const allowed = [...allowedOrigins, ...(appOrigin ? [appOrigin] : [])];
  if (requestOrigin && originAllowed(requestOrigin, allowed)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin.toLowerCase();
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}
