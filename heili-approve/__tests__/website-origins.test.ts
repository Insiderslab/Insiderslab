import { describe, expect, it } from "vitest";
import { needsTestMark, normalizeOrigin, originAllowed, originOf, siteCorsHeaders } from "../lib/website/origins";
import { normalizeOriginEntries } from "../lib/website/service";

const SITE = "https://prova.esempio.it";

describe("normalizeOrigin", () => {
  it("keeps the exact origin (scheme, host, port), dropping a path", () => {
    expect(normalizeOrigin("https://Prova.Esempio.it/chi-siamo?x=1")).toEqual({ ok: true, origin: SITE });
    expect(normalizeOrigin("https://prova.esempio.it:8443")).toEqual({ ok: true, origin: "https://prova.esempio.it:8443" });
    expect(normalizeOrigin("https://prova.esempio.it.")).toEqual({ ok: true, origin: SITE });
  });

  it("refuses wildcards, credentials, missing scheme and dotless hosts", () => {
    expect(normalizeOrigin("https://*.esempio.it").ok).toBe(false);
    expect(normalizeOrigin("*").ok).toBe(false);
    expect(normalizeOrigin("https://user:pw@prova.esempio.it").ok).toBe(false);
    expect(normalizeOrigin("prova.esempio.it").ok).toBe(false);
    expect(normalizeOrigin("https://intranet").ok).toBe(false);
    expect(normalizeOrigin("ftp://prova.esempio.it").ok).toBe(false);
    expect(normalizeOrigin("").ok).toBe(false);
  });

  it("accepts http:// only for localhost or an address marked as a test site", () => {
    expect(normalizeOrigin("http://localhost:4180")).toEqual({ ok: true, origin: "http://localhost:4180" });
    expect(normalizeOrigin("http://127.0.0.1:8080").ok).toBe(true);
    expect(normalizeOrigin("http://prova.esempio.it").ok).toBe(false);
    expect(normalizeOrigin("http://prova.esempio.it", { testOrigin: true })).toEqual({ ok: true, origin: "http://prova.esempio.it" });
    expect(needsTestMark("http://prova.esempio.it")).toBe(true);
    expect(needsTestMark("http://localhost:3000")).toBe(false);
    expect(needsTestMark(SITE)).toBe(false);
  });

  it("normalises the agency's list and records the test marks", () => {
    expect(
      normalizeOriginEntries([
        { origin: `${SITE}/`, test: false },
        { origin: SITE, test: false },
        { origin: "http://staging.esempio.it", test: true },
      ])
    ).toEqual({ origins: [SITE, "http://staging.esempio.it"], testOrigins: ["http://staging.esempio.it"] });
    expect(() => normalizeOriginEntries([{ origin: "http://staging.esempio.it", test: false }])).toThrow(/sito di prova/);
    expect(() => normalizeOriginEntries(Array.from({ length: 11 }, (_, i) => ({ origin: `https://s${i}.esempio.it`, test: false })))).toThrow(
      /10/
    );
  });
});

describe("originAllowed: exact comparison only", () => {
  const origins = [SITE];
  it("matches the same origin", () => {
    expect(originAllowed(SITE, origins)).toBe(true);
  });
  it.each([
    ["look-alike suffix", "https://prova.esempio.it.evil.com"],
    ["userinfo trick", "https://prova.esempio.it@evil.com"],
    ["other port", "https://prova.esempio.it:8443"],
    ["other scheme", "http://prova.esempio.it"],
    ["subdomain", "https://www.prova.esempio.it"],
    ["null origin", "null"],
    ["trailing slash", "https://prova.esempio.it/"],
    ["with a path", "https://prova.esempio.it/x"],
    ["empty", ""],
  ])("refuses %s", (_name, candidate) => {
    expect(originAllowed(candidate, origins)).toBe(false);
  });
  it("reads origins of URLs", () => {
    expect(originOf(`${SITE}/a?b#c`)).toBe(SITE);
    expect(originOf("javascript:alert(1)")).toBeNull();
  });
});

describe("CORS headers of /api/site/v1", () => {
  it("allow only a registered origin or Approve's own, never * and never credentials", () => {
    const allowed = siteCorsHeaders(SITE, [SITE], "https://approve.heili.cloud");
    expect(allowed["Access-Control-Allow-Origin"]).toBe(SITE);
    expect(allowed.Vary).toBe("Origin");
    expect(allowed["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(siteCorsHeaders("https://approve.heili.cloud", [], "https://approve.heili.cloud")["Access-Control-Allow-Origin"]).toBe(
      "https://approve.heili.cloud"
    );
    for (const origin of ["https://evil.com", "null", `${SITE}.evil.com`, null]) {
      const headers = siteCorsHeaders(origin, [SITE], "https://approve.heili.cloud");
      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(headers.Vary).toBe("Origin");
    }
  });
});
