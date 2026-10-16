import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SsrfError,
  checkUrl,
  embeddedIPv4,
  isBlockedAddress,
  localFetchAllowed,
  resolvePublicAddress,
  safeFetchText,
  type LookupAll,
} from "../lib/website/ssrf";
import { findReviewTags, verifyInstallation } from "../lib/website/verify";

const KEY = "hs_abcdefghijklmnopqrstuv";

describe("blocked addresses", () => {
  it.each([
    "0.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "169.254.170.2",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.5",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:a9fe:a9fe::1",
    "100::1",
    "2001:db8::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "fd00:ec2::254",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::6810:84e5", "::ffff:8.8.8.8"])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("reads the IPv4 inside mapped, NAT64 and 6to4 addresses", () => {
    expect(embeddedIPv4("::ffff:169.254.169.254")).toBe("169.254.169.254");
    expect(embeddedIPv4("64:ff9b::7f00:1")).toBe("127.0.0.1");
    expect(embeddedIPv4("2002:0a00:0001::")).toBe("10.0.0.1");
    expect(embeddedIPv4("2606:4700::1")).toBeNull();
  });
});

describe("URL rules", () => {
  it.each([
    ["file:///etc/passwd", "scheme"],
    ["gopher://example.com", "scheme"],
    ["data:text/html,hi", "scheme"],
    ["ftp://example.com", "scheme"],
    ["https://user:pass@example.com", "credentials"],
    ["https://example.com:22", "port"],
    ["http://localhost/", "host"],
    ["http://app.localhost/", "host"],
    ["http://printer.local/", "host"],
    ["http://db.internal/", "host"],
    ["http://intranet/", "host"],
    ["http://metadata.google.internal/", "host"],
    ["http://2130706433/", "private"],
    ["http://0x7f.1/", "private"],
    ["http://0177.0.0.1/", "private"],
    ["http://[::1]/", "private"],
    ["http://169.254.169.254/latest/meta-data", "private"],
  ])("refuses %s (%s)", (url, code) => {
    expect(() => checkUrl(url)).toThrow(SsrfError);
    try {
      checkUrl(url);
    } catch (error) {
      expect((error as SsrfError).code).toBe(code);
    }
  });

  it("accepts public URLs on the allowed ports, case-insensitive, with a final dot", () => {
    expect(checkUrl("https://EXAMPLE.com./a").hostname).toBe("example.com.");
    expect(checkUrl("http://example.com:8080/").port).toBe("8080");
    expect(checkUrl("https://bücher.example/").hostname).toBe("xn--bcher-kva.example");
  });
});

describe("DNS rules", () => {
  const fake =
    (answers: Record<string, string[]>): LookupAll =>
    async (host) =>
      (answers[host] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("needs every address to be public", async () => {
    await expect(resolvePublicAddress("ok.example", fake({ "ok.example": ["93.184.216.34"] }))).resolves.toMatchObject({ address: "93.184.216.34" });
    await expect(resolvePublicAddress("mix.example", fake({ "mix.example": ["93.184.216.34", "10.0.0.1"] }))).rejects.toMatchObject({ code: "private" });
    await expect(resolvePublicAddress("meta.example", fake({ "meta.example": ["169.254.169.254"] }))).rejects.toMatchObject({ code: "private" });
    await expect(resolvePublicAddress("v6.example", fake({ "v6.example": ["::ffff:127.0.0.1"] }))).rejects.toMatchObject({ code: "private" });
    await expect(resolvePublicAddress("none.example", fake({}))).rejects.toMatchObject({ code: "dns" });
  });

  it("local test mode opens loopback only, never other private networks", async () => {
    await expect(resolvePublicAddress("lo.example", fake({ "lo.example": ["127.0.0.1"] }), { allowLocal: true })).resolves.toBeTruthy();
    await expect(resolvePublicAddress("lan.example", fake({ "lan.example": ["10.0.0.1"] }), { allowLocal: true })).rejects.toMatchObject({ code: "private" });
  });

  it("WEBSITE_FETCH_ALLOW_LOCAL is not enough in production", () => {
    expect(localFetchAllowed({ WEBSITE_FETCH_ALLOW_LOCAL: "1", PUBLIC_BASE_URL: "http://localhost:3301" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(
      localFetchAllowed({ WEBSITE_FETCH_ALLOW_LOCAL: "1", PUBLIC_BASE_URL: "https://approve.heili.cloud", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(localFetchAllowed({ PUBLIC_BASE_URL: "http://localhost:3301" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("fetch and «Verifica installazione»", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect-meta") {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { Location: "/loop" });
        res.end();
      } else if (req.url === "/big") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("x".repeat(3 * 1024 * 1024));
      } else if (req.url === "/locked") {
        res.writeHead(401);
        res.end();
      } else if (req.url === "/other-key") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end('<script src="https://approve.heili.cloud/heili-review.js" data-site="hs_zzzzzzzzzzzzzzzzzzzzzz" defer></script>');
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Prova</h1><script src="https://approve.heili.cloud/heili-review.js" data-site="${KEY}" defer></script></body></html>`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("refuses the local server without the test mode", async () => {
    await expect(safeFetchText(`${base}/`)).rejects.toMatchObject({ code: "port" });
  });

  it("re-checks every redirect hop and caps hops and bytes", async () => {
    await expect(safeFetchText(`${base}/redirect-meta`, { allowLocal: true })).rejects.toMatchObject({ code: "private" });
    await expect(safeFetchText(`${base}/loop`, { allowLocal: true })).rejects.toMatchObject({ code: "redirects" });
    await expect(safeFetchText(`${base}/big`, { allowLocal: true })).rejects.toMatchObject({ code: "too-large" });
  });

  it("finds the tag with this site's key", async () => {
    expect(await verifyInstallation(`${base}/`, KEY, { allowLocal: true })).toEqual({ found: true, message: "Script trovato sul sito" });
    expect((await verifyInstallation(`${base}/other-key`, KEY, { allowLocal: true })).message).toMatch(/altra chiave/);
    expect((await verifyInstallation(`${base}/locked`, KEY, { allowLocal: true })).message).toMatch(/password/);
    expect((await verifyInstallation(`${base}/`, KEY)).found).toBe(false);
    expect((await verifyInstallation("http://169.254.169.254/", KEY)).message).toMatch(/non consentito/);
  });

  it("reads only real review tags", () => {
    expect(findReviewTags(`<script data-site="${KEY}" src="/heili-review.v1.js"></script><script src="/other.js" data-site="x"></script>`)).toEqual([KEY]);
    expect(findReviewTags(`<!-- heili-review.js data-site="${KEY}" -->`)).toEqual([]);
  });
});
