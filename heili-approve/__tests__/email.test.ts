import { describe, expect, it } from "vitest";
import { escapeHtml, isRealResendKey, normalizeRecipients, renderEmail, safeHref } from "../lib/email";
import { formatActionItems } from "../lib/notifications";

describe("email templates", () => {
  it("escapes all user content", () => {
    const evil = `<img src=x onerror="alert(1)"> & 'ciao'`;
    const { html, text } = renderEmail({
      heading: evil,
      paragraphs: [evil],
      quote: evil,
      items: [{ title: evil, detail: evil }],
      cta: { label: evil, url: "https://example.com/review/abc?x=<b>" },
      footer: evil,
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;ciao&#39;");
    expect(text).toContain(evil);
  });

  it("drops non-http links", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    const { html } = renderEmail({ heading: "x", paragraphs: [], cta: { label: "Apri", url: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
  });

  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("email transport helpers", () => {
  it("ignores placeholder Resend keys", () => {
    expect(isRealResendKey(undefined)).toBe(false);
    expect(isRealResendKey("re_dev_placeholder")).toBe(false);
    expect(isRealResendKey("missing-resend-api-key")).toBe(false);
    expect(isRealResendKey("re_AbC123xyz_456")).toBe(true);
  });

  it("normalises and de-duplicates recipients", () => {
    expect(normalizeRecipients([" A@b.it", "a@b.it", "", "not-an-email", "x@y.it, z@w.it"])).toEqual(["a@b.it"]);
  });
});

describe("assistant action items", () => {
  it("formats valid items and skips junk", () => {
    expect(
      formatActionItems([
        { area: "immagine", mediaIndex: 1, request: "Schiarire lo sfondo", priority: "alta" },
        { area: "testo", request: "Togliere l'ultimo hashtag" },
        { request: "" },
        null,
        "x",
      ])
    ).toEqual(["[immagine, media 2] Schiarire lo sfondo (priorità: alta)", "[testo] Togliere l'ultimo hashtag"]);
    expect(formatActionItems("nope")).toEqual([]);
  });
});
