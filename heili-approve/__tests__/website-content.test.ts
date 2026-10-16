import { describe, expect, it } from "vitest";
import {
  anchorChip,
  coerceWebsiteContent,
  emptyWebsiteContent,
  liveAnchorSchema,
  newPage,
  normalizePageUrl,
  parseLiveAnchorForSite,
  parseWebsiteAnchor,
  parseWebsiteContent,
  sanitizePageUrl,
  validateWebsiteForReview,
  websiteContentChanges,
  type WebsiteContent,
} from "../lib/content/website";
import { summarizeContentChanges, summarizeVersionForList } from "../lib/posts";

const SITE = "https://prova.esempio.it";

function content(overrides: Partial<WebsiteContent> = {}): WebsiteContent {
  return {
    ...emptyWebsiteContent(),
    siteUrl: `${SITE}/`,
    pages: [
      { id: "p1", title: "Home", url: `${SITE}/`, note: "" },
      { id: "p2", title: "Chi siamo", url: `${SITE}/chi-siamo`, note: "Controlla le foto" },
    ],
    ...overrides,
  };
}

const anchor = {
  pageUrl: `${SITE}/chi-siamo`,
  device: "desktop",
  viewport: { w: 390, h: 844 },
  selector: "main > h1:nth-of-type(1)",
  textSnippet: "Scopri la collezione",
  tag: "h1",
  offsetX: 0.4,
  offsetY: 0.5,
  scrollY: 120,
};

describe("website content", () => {
  it("parses with defaults and keeps a clean draft", () => {
    const parsed = parseWebsiteContent({});
    expect(parsed).toMatchObject({ mode: "live", siteUrl: "", siteId: null, round: 1, devices: ["desktop", "phone"], pages: [] });
    expect(parseWebsiteContent(content())).toEqual(content());
  });

  it("refuses «Istantanee» until the capture-worker exists", () => {
    expect(() => parseWebsiteContent({ ...content(), mode: "snapshot" })).toThrow(/Istantanee/);
    expect(validateWebsiteForReview({ ...content(), mode: "snapshot" }).map((i) => i.field)).toContain("mode");
  });

  it("keeps pages on the site's own origin", () => {
    expect(() =>
      parseWebsiteContent(content({ pages: [{ id: "p1", title: "Altro", url: "https://altro.esempio.it/", note: "" }] }))
    ).toThrow(/stesso sito/);
    // A look-alike host is another origin.
    expect(() =>
      parseWebsiteContent(content({ pages: [{ id: "p1", title: "X", url: `${SITE}.evil.com/`, note: "" }] }))
    ).toThrow(/stesso sito/);
  });

  it("refuses credentials, other schemes and duplicate ids", () => {
    expect(() => parseWebsiteContent({ siteUrl: "https://user:pass@prova.esempio.it/" })).toThrow(/nome utente/);
    expect(() => parseWebsiteContent({ siteUrl: "javascript:alert(1)" })).toThrow();
    expect(() => parseWebsiteContent({ siteUrl: "ftp://prova.esempio.it/" })).toThrow();
    expect(() =>
      parseWebsiteContent(
        content({
          pages: [
            { id: "p1", title: "A", url: `${SITE}/a`, note: "" },
            { id: "p1", title: "B", url: `${SITE}/b`, note: "" },
          ],
        })
      )
    ).toThrow(/duplicate/);
  });

  it("drops the hash, tracking and credential-like parameters from addresses", () => {
    expect(sanitizePageUrl(`${SITE}/p?utm_source=x&fbclid=1&gclid=2&colore=blu#heili-review=abc`)).toBe(`${SITE}/p?colore=blu`);
    expect(sanitizePageUrl(`${SITE}/p?token=1&apiKey=2&session_id=3&auth=4&password=5&q=ok`)).toBe(`${SITE}/p?q=ok`);
    expect(sanitizePageUrl("not a url")).toBeNull();
    expect(parseWebsiteContent({ siteUrl: `${SITE}/#heili-review=abc` }).siteUrl).toBe(`${SITE}/`);
  });

  it("resolves a path on the site", () => {
    expect(normalizePageUrl("/chi-siamo", `${SITE}/`)).toBe(`${SITE}/chi-siamo`);
    expect(normalizePageUrl("", `${SITE}/`)).toBe("");
    expect(() => normalizePageUrl("chi siamo", `${SITE}/`)).toThrow(/non valido/);
  });

  it("numbers new pages after the existing ones", () => {
    expect(newPage([{ id: "p1" }, { id: "p3" }]).id).toBe("p4");
    expect(newPage([{ id: "p2" }]).id).toBe("p3");
  });

  it("reads anything stored without throwing", () => {
    expect(coerceWebsiteContent("rotto")).toEqual(emptyWebsiteContent());
    expect(coerceWebsiteContent(content()).pages).toHaveLength(2);
  });
});

describe("validateWebsiteForReview", () => {
  it("asks for the address, pages and names", () => {
    const messages = validateWebsiteForReview({ ...emptyWebsiteContent() }).map((i) => i.message);
    expect(messages.join(" ")).toMatch(/indirizzo del sito/);
    expect(messages.join(" ")).toMatch(/almeno una pagina/);
    expect(validateWebsiteForReview(content({ pages: [{ id: "p1", title: "", url: `${SITE}/`, note: "" }] }))[0].message).toMatch(
      /nome/
    );
    expect(validateWebsiteForReview(content())).toEqual([]);
  });

  it("checks the registered site when it is given", () => {
    const ready = { origins: [SITE], revokedAt: null, verifiedAt: new Date() };
    expect(validateWebsiteForReview(content({ siteId: "s1" }), ready)).toEqual([]);
    expect(validateWebsiteForReview(content({ siteId: null }), null)[0].field).toBe("site");
    expect(validateWebsiteForReview(content({ siteId: "s1" }), { ...ready, revokedAt: new Date() })[0].message).toMatch(/revocata/);
    expect(validateWebsiteForReview(content({ siteId: "s1" }), { ...ready, origins: ["https://altro.it"] })[0].message).toMatch(
      /Aggiungi https:\/\/prova\.esempio\.it/
    );
    expect(validateWebsiteForReview(content({ siteId: "s1" }), { ...ready, verifiedAt: null })[0].message).toMatch(/Verifica/);
    // Verification impossible (site behind a password): the explicit waiver is enough.
    expect(validateWebsiteForReview(content({ siteId: "s1" }), { ...ready, verifiedAt: null, verifyWaivedAt: new Date() })).toEqual([]);
  });
});

describe("live anchors", () => {
  it("accepts the iframe's anchor and derives the device from the width", () => {
    const parsed = liveAnchorSchema.parse(anchor);
    expect(parsed.device).toBe("phone");
    expect(liveAnchorSchema.parse({ ...anchor, viewport: { w: 1440, h: 900 }, device: "phone" }).device).toBe("desktop");
  });

  it("is strict: unknown fields, snapshot shapes and bad numbers are refused", () => {
    expect(liveAnchorSchema.safeParse({ ...anchor, value: "SEGRETO-123" }).success).toBe(false);
    expect(liveAnchorSchema.safeParse({ pageId: "p1", device: "phone", x: 0.1, y: 0.2 }).success).toBe(false);
    expect(liveAnchorSchema.safeParse({ ...anchor, offsetX: 2 }).success).toBe(false);
    expect(liveAnchorSchema.safeParse({ ...anchor, scrollY: Number.NaN }).success).toBe(false);
    expect(liveAnchorSchema.safeParse({ ...anchor, viewport: { w: 50, h: 844 } }).success).toBe(false);
    expect(liveAnchorSchema.safeParse({ ...anchor, selector: "x".repeat(301) }).success).toBe(false);
  });

  it("clips the element text to 160 characters on one line", () => {
    const parsed = liveAnchorSchema.parse({ ...anchor, textSnippet: `  riga\n\n${"a".repeat(300)}` });
    expect(Array.from(parsed.textSnippet).length).toBeLessThanOrEqual(160);
    expect(parsed.textSnippet.startsWith("riga a")).toBe(true);
  });

  it("refuses a page outside the allowed origins and cleans the address", () => {
    expect(() => parseLiveAnchorForSite({ ...anchor, pageUrl: "http://169.254.169.254/latest" }, [SITE])).toThrow(/indirizzi del sito/);
    expect(() => parseLiveAnchorForSite({ ...anchor, pageUrl: `${SITE}.evil.com/` }, [SITE])).toThrow();
    const ok = parseLiveAnchorForSite({ ...anchor, pageUrl: `${SITE}/chi-siamo?utm_medium=x&session=1#top` }, [SITE]);
    expect(ok.pageUrl).toBe(`${SITE}/chi-siamo`);
  });

  it("reads stored anchors leniently and shows a chip", () => {
    expect(parseWebsiteAnchor(null)).toBeNull();
    expect(parseWebsiteAnchor({ quote: "blog" })).toBeNull();
    const parsed = parseWebsiteAnchor(anchor)!;
    expect(anchorChip(parsed, content().pages)).toBe("Chi siamo · Telefono · «Scopri la collezione»");
  });
});

describe("changes between rounds", () => {
  it("describes the new round and the pages", () => {
    const before = content();
    const after = content({
      round: 2,
      roundNote: "Menu rifatto",
      pages: [
        { id: "p1", title: "Home", url: `${SITE}/`, note: "Guarda il menu" },
        { id: "p3", title: "Contatti", url: `${SITE}/contatti`, note: "" },
      ],
    });
    expect(websiteContentChanges(before, after)).toEqual([
      "Giro 2",
      "Nota del giro aggiornata",
      "Pagina aggiunta: Contatti",
      "Pagina tolta: Chi siamo",
      "Pagina Home modificata: nota",
    ]);
    expect(summarizeContentChanges("WEBSITE", before, after)[0]).toBe("Giro 2");
    expect(summarizeContentChanges("WEBSITE", before, before)).toEqual([]);
  });

  it("summarises a round for the portal list", () => {
    expect(summarizeVersionForList("WEBSITE", { text: "", media: [], content: content() })).toMatchObject({
      cover: null,
      excerpt: "prova.esempio.it · 2 pagine da rivedere",
    });
  });
});
