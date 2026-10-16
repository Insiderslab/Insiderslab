/**
 * Anti-SSRF rules for every request Approve makes to a client's site
 * (today: «Verifica installazione»; later the capture-worker). docs/SITO-WEB.md,
 * «Regole anti-SSRF».
 *
 * 1. URL: http/https only, no credentials, ports 80/443/8080/8443, no
 *    localhost / *.localhost / *.local / *.internal / dotless names /
 *    metadata hosts; exotic IP forms are normalised by `new URL` and then
 *    checked as IPs.
 * 2. DNS: every address of the name must be public (a public + private mix is
 *    refused); IPv4-mapped, NAT64 and 6to4 IPv6 addresses are checked on the
 *    embedded IPv4.
 * 3. No rebinding window: the connection uses the address validated here
 *    (custom `lookup`), so the name is resolved once, by us.
 * 4. Limits: redirects (each hop re-checked), time, bytes.
 *
 * WEBSITE_FETCH_ALLOW_LOCAL=1 lets tests reach 127.0.0.1 / localhost on any
 * port, and ONLY when Approve itself runs on a local address: in production
 * (approve.heili.cloud) the variable is ignored.
 */

import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { resolveBaseUrl } from "@/lib/env";
import { isLocalHostname } from "./origins";

export type SsrfCode =
  | "scheme"
  | "credentials"
  | "port"
  | "host"
  | "private"
  | "dns"
  | "redirects"
  | "timeout"
  | "too-large"
  | "tls"
  | "network"
  | "status";

export class SsrfError extends Error {
  constructor(readonly code: SsrfCode, message?: string) {
    super(message ?? code);
    this.name = "SsrfError";
  }
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
BLOCKED.addAddress("255.255.255.255", "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}
BLOCKED.addAddress("fd00:ec2::254", "ipv6");

/** The IPv4 inside an IPv4-mapped (::ffff:a.b.c.d), NAT64 (64:ff9b::/96) or 6to4 (2002::/16) address. */
export function embeddedIPv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase().replace(/^\[|\]$/g, "");
  const dotted = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1];
  const groups = expandIPv6(lower);
  if (!groups) return null;
  const toV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // ::ffff:0:0/96
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return toV4(groups[6], groups[7]);
  // 64:ff9b::/96
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return toV4(groups[6], groups[7]);
  // 2002::/16 carries the IPv4 in groups 1-2
  if (groups[0] === 0x2002) return toV4(groups[1], groups[2]);
  return null;
}

function expandIPv6(value: string): number[] | null {
  if (isIP(value) !== 6) return null;
  let text = value;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    const parts = v4[1].split(".").map(Number);
    text = text.slice(0, -v4[1].length) + `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const parse = (s: string) => (s ? s.split(":").map((g) => parseInt(g, 16)) : []);
  const a = parse(head);
  const b = tail === undefined ? [] : parse(tail);
  if (tail === undefined) return a.length === 8 ? a : null;
  const missing = 8 - a.length - b.length;
  if (missing < 0) return null;
  return [...a, ...new Array(missing).fill(0), ...b];
}

/** True for any loopback, private, link-local, metadata, documentation, multicast… address. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  if (family === 4) return BLOCKED.check(ip, "ipv4");
  if (family === 6) {
    const v4 = embeddedIPv4(ip);
    if (v4 !== null) return BLOCKED.check(v4, "ipv4");
    if (/^::ffff:/i.test(ip)) return true;
    return BLOCKED.check(ip, "ipv6");
  }
  return true;
}

/** 127.0.0.0/8 and ::1: the only extra addresses the local test mode opens. */
export function isLoopbackAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  return (isIP(ip) === 4 && ip.startsWith("127.")) || ip === "::1" || embeddedIPv4(ip)?.startsWith("127.") === true;
}

/** WEBSITE_FETCH_ALLOW_LOCAL counts only when Approve itself runs on a local address (tests). */
export function localFetchAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WEBSITE_FETCH_ALLOW_LOCAL !== "1") return false;
  try {
    const base = new URL(resolveBaseUrl(env));
    if (isLocalHostname(base.hostname)) return true;
  } catch {
    // no base URL: refuse
  }
  console.error("[website] WEBSITE_FETCH_ALLOW_LOCAL ignorata: l'app non gira su un indirizzo locale");
  return false;
}

/** Rule 1: shape of the URL. Returns the parsed URL or throws SsrfError. */
export function checkUrl(raw: string, opts: { allowLocal?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("scheme", "Indirizzo non valido");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("scheme");
  if (url.username || url.password) throw new SsrfError("credentials");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (opts.allowLocal && (isLocalHostname(host) || host === "127.0.0.1")) return url;
  if (!ALLOWED_PORTS.has(url.port)) throw new SsrfError("port");
  if (isIP(host.replace(/^\[|\]$/g, ""))) {
    if (isBlockedAddress(host)) throw new SsrfError("private");
    return url;
  }
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "metadata"
  ) {
    throw new SsrfError("host");
  }
  return url;
}

export type LookupAll = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const systemLookup: LookupAll = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)));
  });

/** Rule 2: every address of the name must be public. Returns the first one (to pin). */
export async function resolvePublicAddress(
  hostname: string,
  lookupAll: LookupAll = systemLookup,
  opts: { allowLocal?: boolean } = {}
): Promise<{ address: string; family: number }> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const blocked = (address: string) => isBlockedAddress(address) && !(opts.allowLocal && isLoopbackAddress(address));
  if (isIP(bare)) {
    if (blocked(bare)) throw new SsrfError("private");
    return { address: bare, family: isIP(bare) };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupAll(bare);
  } catch {
    throw new SsrfError("dns");
  }
  if (addresses.length === 0) throw new SsrfError("dns");
  if (addresses.some((a) => blocked(a.address))) throw new SsrfError("private");
  return addresses[0];
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  lookupAll?: LookupAll;
  allowLocal?: boolean;
  userAgent?: string;
}

export interface SafeFetchResult {
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
}

/**
 * GET with every rule applied at every hop. The socket connects to the
 * address validated by resolvePublicAddress (pinning: no second DNS answer).
 */
export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const deadline = Date.now() + timeoutMs;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = checkUrl(current, { allowLocal: opts.allowLocal });
    const pinned = await resolvePublicAddress(url.hostname, opts.lookupAll, { allowLocal: opts.allowLocal });
    const response = await requestOnce(url, pinned, { maxBytes, deadline, userAgent: opts.userAgent });
    if (response.status >= 300 && response.status < 400 && response.location) {
      current = new URL(response.location, url).toString();
      continue;
    }
    return { status: response.status, finalUrl: url.toString(), contentType: response.contentType, body: response.body };
  }
  throw new SsrfError("redirects");
}

function requestOnce(
  url: URL,
  pinned: { address: string; family: number },
  opts: { maxBytes: number; deadline: number; userAgent?: string }
): Promise<{ status: number; location: string | null; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const remaining = opts.deadline - Date.now();
    if (remaining <= 0) {
      reject(new SsrfError("timeout"));
      return;
    }
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": opts.userAgent ?? "HeiliApproveVerify/1.0 (+https://approve.heili.cloud/bot)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
        // Pinning: whatever the name, connect to the address checked above.
        lookup: (_hostname: string, options: unknown, callback: unknown) => {
          const cb = (typeof options === "function" ? options : callback) as (...args: unknown[]) => void;
          const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
          if (all) cb(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
        },
        timeout: remaining,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : null;
        const contentType = String(response.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, contentType, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            request.destroy(new SsrfError("too-large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", (error) => reject(error));
      }
    );
    request.on("timeout", () => request.destroy(new SsrfError("timeout")));
    request.on("error", (error: Error & { code?: string }) => {
      if (error instanceof SsrfError) reject(error);
      else if (/CERT|SSL|TLS/i.test(error.code ?? "") || /certificate/i.test(error.message)) reject(new SsrfError("tls"));
      else reject(new SsrfError("network"));
    });
    request.end();
  });
}
