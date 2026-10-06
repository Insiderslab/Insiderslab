import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import JSZip from "jszip";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSV_BOM,
  UNKNOWN_SIZE_MESSAGE,
  adExportZipName,
  adSpecChecks,
  buildAdsCopyCsv,
  buildAdsReadme,
  checkDestinationUrl,
  coerceAdContent,
  csvCell,
  duplicateVariant,
  emptyAdContent,
  evaluateRatio,
  extensionForMedia,
  formatAspectRatio,
  newVariant,
  nextVariantId,
  parseAdContent,
  placementsForMedia,
  planAdExportFiles,
  ratioMatches,
  sanitizeFileSegment,
  summarizeChecks,
  validateAdsForReview,
  variantLetter,
  type AdContent,
  type AdSpecCheck,
  type AdVariant,
} from "../lib/content/ads";
import { ValidationError } from "../lib/errors";
import type { MediaItem } from "../lib/domain";
import {
  displayDomain,
  markersForComments,
  moveVariant,
  numberAdComments,
  pinsForComments,
  switchPlatform,
  unionPlacements,
  withMediaDimensions,
  type AdReviewComment,
} from "../components/ads/helpers";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const image = (n: number, width?: number, height?: number): MediaItem => ({
  url: `https://cdn.example.com/${n}.jpg`,
  type: "image",
  mimeType: "image/jpeg",
  ...(width && height ? { width, height } : {}),
});

const clip = (n: number, durationSec?: number, width = 1080, height = 1920): MediaItem => ({
  url: `https://cdn.example.com/${n}.mp4`,
  type: "video",
  mimeType: "video/mp4",
  width,
  height,
  ...(durationSec ? { durationSec } : {}),
});

const variant = (over: Partial<AdVariant> = {}): AdVariant => ({
  id: "A",
  name: "Variante A — Prima/dopo",
  media: [image(1, 1080, 1080)],
  primaryText: "Prenota la tua consulenza gratuita",
  headline: "Extension naturali",
  description: "",
  cta: "Prenota ora",
  destinationUrl: "https://www.esempio.it/prenota",
  placements: ["meta_feed"],
  ...over,
});

const adSet = (over: Partial<AdContent> = {}): AdContent => ({
  campaign: { name: "Autunno", platform: "meta", objective: "Vendite", budgetNote: "", audienceNote: "" },
  variants: [
    variant(),
    variant({
      id: "B",
      name: "Variante B — Reel",
      media: [clip(2, 15)],
      placements: ["meta_stories_reels"],
    }),
  ],
  ...over,
});

const find = (checks: AdSpecCheck[], id: string) => checks.find((c) => c.id === id);

// ─── Schema ──────────────────────────────────────────────────────────────────

describe("parseAdContent", () => {
  it("fills defaults for a half-written draft", () => {
    expect(parseAdContent({})).toEqual({
      campaign: { name: "", platform: "meta", objective: "", budgetNote: "", audienceNote: "" },
      variants: [],
    });
    const parsed = parseAdContent({ variants: [{ id: "A" }] });
    expect(parsed.variants[0]).toMatchObject({ id: "A", media: [], cta: "", placements: [] });
  });

  it("keeps the copy's line breaks, trims the rest, and orders/dedupes placements", () => {
    const parsed = parseAdContent({
      variants: [
        {
          id: "A",
          primaryText: "Riga 1\nRiga 2  \n",
          headline: "  Titolo  ",
          placements: ["meta_stories_reels", "meta_feed", "meta_feed"],
        },
      ],
    });
    expect(parsed.variants[0].primaryText).toBe("Riga 1\nRiga 2");
    expect(parsed.variants[0].headline).toBe("Titolo");
    expect(parsed.variants[0].placements).toEqual(["meta_feed", "meta_stories_reels"]);
  });

  it("rejects bad input with Italian ValidationErrors", () => {
    expect(() => parseAdContent({ campaign: { platform: "myspace" } })).toThrow(ValidationError);
    expect(() => parseAdContent({ variants: [{ id: "A" }, { id: "A" }] })).toThrow(/stesso identificativo/);
    expect(() => parseAdContent({ variants: [{ id: "../x" }] })).toThrow(/Identificativo/);
    expect(() => parseAdContent({ variants: [{ id: "A", placements: ["billboard"] }] })).toThrow(/Posizionamento/);
    expect(() =>
      parseAdContent({ variants: [{ id: "A", media: [{ url: "javascript:alert(1)", type: "image", mimeType: "image/png" }] }] })
    ).toThrow(ValidationError);
    expect(() => parseAdContent({ variants: Array.from({ length: 11 }, (_, i) => ({ id: variantLetter(i) })) })).toThrow(
      /Al massimo 10/
    );
  });

  it("drops undefined optional media fields", () => {
    const parsed = parseAdContent(adSet());
    expect(Object.keys(parsed.variants[0].media[0]).sort()).toEqual(["height", "mimeType", "type", "url", "width"]);
  });

  it("coerces unreadable stored content without throwing", () => {
    const coerced = coerceAdContent({
      campaign: { name: "X", platform: "nope" },
      variants: [{ id: "A" }, { id: "A" }, { id: "bad id!" }, { id: "B", cta: "Scopri di più" }],
    });
    expect(coerced.campaign.platform).toBe("meta");
    expect(coerced.variants.map((v) => v.id)).toEqual(["A", "B"]);
    expect(coerceAdContent(null).variants).toEqual([]);
  });
});

// ─── Factories ───────────────────────────────────────────────────────────────

describe("variants", () => {
  it("names variants A, B… and skips letters in use", () => {
    expect(variantLetter(0)).toBe("A");
    expect(variantLetter(25)).toBe("Z");
    expect(variantLetter(26)).toBe("AA");
    expect(nextVariantId(["A", "B"])).toBe("C");
    expect(nextVariantId(["A", "C"], 1)).toBe("B");
    const v = newVariant(1, { platform: "tiktok", existingIds: ["A", "B"] });
    expect(v).toMatchObject({ id: "C", name: "Variante C", placements: ["tiktok_in_feed"], media: [] });
    expect(emptyAdContent("linkedin").variants[0].placements).toEqual(["linkedin_feed"]);
  });

  it("duplicates with a new id and a copy name, without sharing arrays", () => {
    const source = variant();
    const copy = duplicateVariant(source, ["A", "B"]);
    expect(copy.id).toBe("C");
    expect(copy.name).toBe("Variante C — Prima/dopo (copia)");
    expect(copy.media).not.toBe(source.media);
    expect(duplicateVariant(variant({ name: "Lifestyle" }), ["A"]).name).toBe("Lifestyle (copia)");
  });
});

// ─── Geometry ────────────────────────────────────────────────────────────────

describe("aspect ratios", () => {
  it("matches within ±2%", () => {
    expect(ratioMatches(1080 / 1350, 4 / 5)).toBe(true);
    expect(ratioMatches(1080 / 1340, 4 / 5)).toBe(true); // 0.75% off
    expect(ratioMatches(1080 / 1380, 4 / 5)).toBe(false); // 2.2% off
    expect(ratioMatches(1200 / 628, 1.91)).toBe(true);
    expect(ratioMatches(0, 1)).toBe(false);
  });

  it("formats ratios with Italian decimals", () => {
    expect(formatAspectRatio(1080 / 1920)).toBe("9:16");
    expect(formatAspectRatio(1200 / 628)).toBe("1,91:1");
    expect(formatAspectRatio(1.5)).toBe("3:2");
    expect(formatAspectRatio(2.4)).toBe("2,40:1");
  });

  it("grades a ratio per placement: preferred ok, accepted avviso, else errore", () => {
    expect(evaluateRatio(9 / 16, "meta_stories_reels").status).toBe("ok");
    expect(evaluateRatio(4 / 5, "meta_stories_reels").status).toBe("warning");
    expect(evaluateRatio(16 / 9, "meta_stories_reels").status).toBe("error");
    expect(evaluateRatio(1, "meta_feed").status).toBe("ok");
    expect(evaluateRatio(1.91, "meta_feed").status).toBe("warning");
    expect(evaluateRatio(9 / 16, "meta_feed").status).toBe("warning");
    expect(evaluateRatio(3, "meta_feed").status).toBe("error");
    expect(evaluateRatio(1.91, "google_display").status).toBe("ok");
    expect(evaluateRatio(9 / 16, "google_display").status).toBe("error");
  });
});

// ─── Spec checks ─────────────────────────────────────────────────────────────

describe("adSpecChecks", () => {
  it("passes a well-built feed variant", () => {
    const checks = adSpecChecks(variant(), { platform: "meta" });
    expect(summarizeChecks(checks)).toMatchObject({ errors: 0, warnings: 0, worst: "ok" });
    expect(find(checks, "meta_feed:0:ratio")?.message).toContain("1:1");
  });

  it("warns when the media size is unknown instead of guessing", () => {
    const checks = adSpecChecks(variant({ media: [image(1)] }));
    const ratio = find(checks, "meta_feed:0:ratio");
    expect(ratio?.status).toBe("warning");
    expect(ratio?.message).toContain(UNKNOWN_SIZE_MESSAGE);
  });

  it("checks format, resolution and media type per placement", () => {
    const checks = adSpecChecks(
      variant({
        media: [image(1, 400, 400), clip(2, 20, 1920, 1080)],
        placements: ["meta_feed", "meta_stories_reels"],
      })
    );
    expect(find(checks, "meta_feed:0:size")?.status).toBe("warning");
    expect(find(checks, "meta_stories_reels:0:type")?.message).toContain("nei Reels serve un video");
    expect(find(checks, "meta_stories_reels:1:ratio")?.status).toBe("error");
    expect(find(checks, "meta_feed:1:ratio")?.status).toBe("warning");
  });

  it("checks video durations: Reels ≤ 90 s, TikTok 5–60 s", () => {
    const reel = (sec?: number) =>
      find(adSpecChecks(variant({ media: [clip(1, sec)], placements: ["meta_stories_reels"] })), "meta_stories_reels:0:duration");
    expect(reel(45)?.status).toBe("ok");
    expect(reel(120)?.status).toBe("warning");
    expect(reel(undefined)?.message).toContain("durata non nota");

    const tiktok = (sec: number) =>
      find(
        adSpecChecks(variant({ media: [clip(1, sec)], placements: ["tiktok_in_feed"], primaryText: "Ciao" }), {
          platform: "tiktok",
        }),
        "tiktok_in_feed:0:duration"
      );
    expect(tiktok(3)?.status).toBe("warning");
    expect(tiktok(30)?.status).toBe("ok");
    expect(tiktok(61)?.status).toBe("warning");
    expect(tiktok(700)?.status).toBe("error");
  });

  it("requires a video on TikTok and warns about extra media", () => {
    const checks = adSpecChecks(
      variant({ media: [image(1, 1080, 1920), clip(2, 20)], placements: ["tiktok_in_feed"] }),
      { platform: "tiktok" }
    );
    expect(find(checks, "tiktok_in_feed:0:type")?.status).toBe("error");
    expect(find(checks, "tiktok_in_feed:count")?.status).toBe("warning");
  });

  it("applies each platform's text limits", () => {
    const long = (n: number) => "x".repeat(n);
    const meta = adSpecChecks(variant({ primaryText: long(126), headline: long(41), description: long(31) }));
    expect(find(meta, "meta:primaryText")?.status).toBe("warning");
    expect(find(meta, "meta:headline")?.status).toBe("warning");
    expect(find(meta, "meta:description")?.status).toBe("warning");

    const google = adSpecChecks(
      variant({ placements: ["google_display"], media: [image(1, 1200, 628)], headline: long(31), description: "" }),
      { platform: "google" }
    );
    expect(find(google, "google:headline")?.status).toBe("error");
    expect(find(google, "google:description")?.status).toBe("error");

    const linkedin = adSpecChecks(
      variant({ placements: ["linkedin_feed"], media: [image(1, 1200, 628)], primaryText: long(151), headline: long(71) }),
      { platform: "linkedin" }
    );
    expect(find(linkedin, "linkedin:primaryText")?.status).toBe("warning");
    expect(find(linkedin, "linkedin:headline")?.status).toBe("warning");
    expect(find(adSpecChecks(variant({ placements: ["linkedin_feed"], primaryText: long(601) })), "linkedin:primaryText")?.status).toBe(
      "error"
    );

    // Emoji count as one character.
    expect(find(adSpecChecks(variant({ headline: "🎉".repeat(40) })), "meta:headline")?.status).toBe("ok");
  });

  it("checks CTA and URL", () => {
    expect(find(adSpecChecks(variant({ cta: "" })), "meta:cta")?.status).toBe("error");
    expect(find(adSpecChecks(variant({ cta: "scopri di più" })), "meta:cta")?.status).toBe("ok");
    expect(find(adSpecChecks(variant({ cta: "Vieni!" })), "meta:cta")?.status).toBe("warning");
    expect(checkDestinationUrl("").status).toBe("error");
    expect(checkDestinationUrl("esempio.it").status).toBe("error");
    expect(checkDestinationUrl("http://esempio.it").message).toContain("https://");
    expect(checkDestinationUrl("https://localhost/x").status).toBe("error");
    expect(checkDestinationUrl("https://www.esempio.it/a?b=1")).toEqual({ status: "ok", message: "Porta a www.esempio.it." });
  });

  it("flags missing placements, missing media and placements of another platform", () => {
    const checks = adSpecChecks(variant({ placements: [], media: [] }), { platform: "meta" });
    expect(find(checks, "placements")?.status).toBe("error");
    expect(find(checks, "media:none")?.status).toBe("error");
    const wrong = adSpecChecks(variant({ placements: ["tiktok_in_feed"] }), { platform: "meta" });
    expect(find(wrong, "tiktok_in_feed:platform")?.status).toBe("error");
  });
});

describe("validateAdsForReview", () => {
  it("accepts a complete set; warnings never block", () => {
    const set = adSet();
    set.variants[0].media = [image(1)]; // unknown size → avviso only
    expect(validateAdsForReview(set)).toEqual([]);
  });

  it("lists blocking errors in Italian with the variant name", () => {
    const issues = validateAdsForReview(
      adSet({
        campaign: { name: " ", platform: "meta", objective: "", budgetNote: "", audienceNote: "" },
        variants: [variant({ cta: "", destinationUrl: "http://esempio.it" })],
      })
    );
    const messages = issues.map((i) => i.message);
    expect(messages).toContain("Inserisci il nome della campagna.");
    expect(messages.some((m) => m.startsWith("Variante A — Prima/dopo: CTA:"))).toBe(true);
    expect(messages.some((m) => m.includes("https://"))).toBe(true);
    expect(validateAdsForReview(adSet({ variants: [] })).map((i) => i.message)).toContain("Aggiungi almeno una variante.");
  });
});

// ─── Export builders ─────────────────────────────────────────────────────────

describe("export package", () => {
  it("sanitizes file name segments", () => {
    expect(sanitizeFileSegment("Pasticceria Rossi & Figli", "cliente")).toBe("pasticceria-rossi-figli");
    expect(sanitizeFileSegment("Caffè Perché", "x")).toBe("caffe-perche");
    expect(sanitizeFileSegment("../../etc/passwd", "x")).toBe("etc-passwd");
    expect(sanitizeFileSegment("…", "campagna")).toBe("campagna");
    expect(sanitizeFileSegment("", "")).toBe("file");
    expect(sanitizeFileSegment("a".repeat(80), "x", 10)).toBe("aaaaaaaaaa");
  });

  it("picks extensions from the MIME type, never from odd URLs", () => {
    expect(extensionForMedia({ mimeType: "video/quicktime", url: "https://x/y", type: "video" })).toBe("mov");
    expect(extensionForMedia({ mimeType: "application/octet-stream", url: "https://x/y.PNG?v=1", type: "image" })).toBe("png");
    expect(extensionForMedia({ mimeType: "text/html", url: "https://x/evil.html", type: "image" })).toBe("jpg");
  });

  it("names files <cliente>_<campagna>_<variante>_<posizionamento>.<ext>", () => {
    const files = planAdExportFiles({
      clientName: "Rossi Srl",
      campaignName: "Saldi d'autunno",
      variants: [
        variant({ media: [image(1, 1080, 1080), clip(2, 15)], placements: ["meta_feed", "meta_stories_reels"] }),
        variant({ id: "B", media: [image(3)], placements: ["meta_feed", "meta_stories_reels"] }),
      ],
    });
    expect(files.map((f) => f.fileName)).toEqual([
      "rossi-srl_saldi-d-autunno_a_feed_1.jpg",
      "rossi-srl_saldi-d-autunno_a_storie-reels_2.mp4",
      "rossi-srl_saldi-d-autunno_b_feed-storie-reels.jpg",
    ]);
    expect(placementsForMedia(variant({ placements: ["meta_feed"] }), image(1, 1920, 1080))).toEqual(["meta_feed"]);
  });

  it("never repeats a file name", () => {
    const files = planAdExportFiles({
      clientName: "R",
      campaignName: "C",
      variants: [variant({ id: "a" }), variant({ id: "A" })],
    });
    expect(new Set(files.map((f) => f.fileName.toLowerCase())).size).toBe(2);
    expect(files[1].fileName).toBe("r_c_a_feed-2.jpg");
  });

  it("escapes CSV cells and neutralises formulas", () => {
    expect(csvCell("semplice")).toBe("semplice");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('Il "migliore"')).toBe('"Il ""migliore"""');
    expect(csvCell("riga 1\r\nriga 2")).toBe('"riga 1\nriga 2"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("-20% su tutto")).toBe("'-20% su tutto");
    expect(csvCell(" spazio")).toBe('" spazio"');
  });

  it("builds copy.csv with BOM, ; separators and CRLF rows", () => {
    const variants = [variant({ primaryText: "Ciao; mondo\nseconda riga" })];
    const files = planAdExportFiles({ clientName: "R", campaignName: "C", variants });
    const csv = buildAdsCopyCsv(variants, files);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Variante;Nome;Testo principale;Titolo;Descrizione;CTA;URL;Posizionamenti;File");
    expect(lines[1]).toBe(
      'A;Variante A — Prima/dopo;"Ciao; mondo\nseconda riga";Extension naturali;;Prenota ora;https://www.esempio.it/prenota;Feed Facebook e Instagram;r_c_a_feed.jpg'
    );
    expect(lines[2]).toBe("");
  });

  it("writes README.txt with every decision, the notes and external links", () => {
    const set = adSet();
    const readme = buildAdsReadme({
      clientName: "Rossi Srl",
      campaign: set.campaign,
      versionNumber: 2,
      approvedAt: new Date("2026-10-06T10:00:00Z"),
      generatedAt: new Date("2026-10-07T08:30:00Z"),
      timeZone: "Europe/Rome",
      variants: set.variants,
      decisions: [
        { variantId: "A", verdict: "APPROVED", note: null, reviewerName: "Giulia" },
        { variantId: "B", verdict: "REJECTED", note: "Troppo veloce\nnei primi secondi", reviewerName: "Giulia" },
      ],
      files: [{ variantId: "A", fileName: "rossi_autunno_a_feed.jpg" }],
      externalMedia: [{ variantId: "A", mediaIndex: 0, url: "https://cdn.example.com/1.jpg" }],
      missingMedia: [],
    });
    expect(readme).toContain("Cliente: Rossi Srl");
    expect(readme).toContain("Versione: 2");
    expect(readme).toContain("Approvata il: 6 ottobre 2026");
    expect(readme).toContain("- Variante A — Prima/dopo: APPROVATA da Giulia");
    expect(readme).toContain("- Variante B — Reel: SCARTATA da Giulia");
    expect(readme).toContain("  Nota del cliente: Troppo veloce\r\n  nei primi secondi");
    expect(readme).toContain("https://cdn.example.com/1.jpg");
    expect(readme).toContain("== Variante A — Prima/dopo ==");
    expect(readme).not.toContain("== Variante B");
  });

  it("names the package", () => {
    expect(adExportZipName("Rossi Srl", "Saldi d'autunno")).toBe("rossi-srl_saldi-d-autunno_creativita-approvate.zip");
  });
});

// ─── Component helpers ───────────────────────────────────────────────────────

describe("ads component helpers", () => {
  const comment = (over: Partial<AdReviewComment>): AdReviewComment => ({
    id: "c",
    authorType: "CLIENT",
    authorName: "Giulia",
    body: "x",
    mediaIndex: null,
    pinX: null,
    pinY: null,
    timeSec: null,
    timeEndSec: null,
    createdLabel: "",
    ...over,
  });

  it("numbers located comments by media and time, general ones by date", () => {
    const { located, general } = numberAdComments([
      comment({ id: "g2", createdAt: "2026-10-06T10:00:00Z" }),
      comment({ id: "late", mediaIndex: 0, timeSec: 9 }),
      comment({ id: "pin", mediaIndex: 1, pinX: 0.5, pinY: 0.5 }),
      comment({ id: "early", mediaIndex: 0, timeSec: 2, timeEndSec: 4, pinX: 0.1, pinY: 0.2 }),
      comment({ id: "g1", createdAt: "2026-10-05T10:00:00Z" }),
    ]);
    expect(located.map((c) => [c.id, c.number])).toEqual([
      ["early", 1],
      ["late", 2],
      ["pin", 3],
    ]);
    expect(general.map((c) => c.id)).toEqual(["g1", "g2"]);
    expect(pinsForComments(located).map((p) => [p.id, p.label, p.timeSec])).toEqual([
      ["early", "1", 2],
      ["pin", "3", null],
    ]);
    expect(markersForComments(located).map((m) => [m.id, m.label, m.timeEndSec])).toEqual([
      ["early", "1", 4],
      ["late", "2", null],
    ]);
  });

  it("reads the domain shown in the mockups", () => {
    expect(displayDomain("https://www.esempio.it/offerta")).toBe("esempio.it");
    expect(displayDomain("non un url")).toBeNull();
  });

  it("reorders, switches platform and records measured sizes", () => {
    expect(moveVariant(["A", "B", "C"], 0, 2)).toEqual(["B", "C", "A"]);
    expect(moveVariant(["A", "B"], 1, 5)).toEqual(["A", "B"]);

    const set = adSet();
    const tiktok = switchPlatform(set, "tiktok");
    expect(tiktok.campaign.platform).toBe("tiktok");
    expect(tiktok.variants.every((v) => v.placements.join() === "tiktok_in_feed")).toBe(true);
    expect(switchPlatform(set, "meta")).toBe(set);
    expect(unionPlacements(set.variants)).toEqual(["meta_feed", "meta_stories_reels"]);

    const unsized = adSet({ variants: [variant({ media: [image(7)] })] });
    const sized = withMediaDimensions(unsized, image(7).url, 1080, 1350);
    expect(sized.variants[0].media[0]).toMatchObject({ width: 1080, height: 1350 });
    expect(withMediaDimensions(sized, image(7).url, 10, 10)).toBe(sized);
  });
});

// ─── Components (server render smoke test) ──────────────────────────────────

describe("ads components render", () => {
  it("renders every placement mockup with neutral sponsored labels", async () => {
    const { default: AdPreview } = await import("../components/ads/ad-preview");
    const v = variant({ media: [clip(1, 20)], primaryText: "Ciao #autunno", cta: "" });
    const html = (placement: Parameters<typeof AdPreview>[0]["placement"]) =>
      renderToStaticMarkup(createElement(AdPreview, { placement, variant: v, accountName: "Rossi Srl" }));
    expect(html("meta_feed")).toContain("Sponsorizzato");
    expect(html("meta_feed")).toContain("Call to action"); // placeholder while the CTA is empty
    expect(html("meta_stories_reels")).toContain("Zone di sicurezza");
    expect(html("tiktok_in_feed")).toContain("@rossisrl");
    expect(html("google_display")).toContain("Annuncio");
    expect(html("linkedin_feed")).toContain("Promosso");
    expect(html("meta_stories_reels")).not.toContain("Coperto dall");
    const withZones = renderToStaticMarkup(
      createElement(AdPreview, { placement: "tiktok_in_feed", variant: v, accountName: "R", defaultSafeZones: true })
    );
    expect(withZones).toContain("Coperto dall");
    expect(withZones).toContain("Pulsanti");
  });

  it("renders the review card, the comparison and the editor", async () => {
    const { default: AdVariantReview } = await import("../components/ads/ad-variant-review");
    const { default: AdVariantCompare } = await import("../components/ads/ad-variant-compare");
    const { default: AdSetEditor } = await import("../components/ads/ad-set-editor");
    const set = adSet();

    const review = renderToStaticMarkup(
      createElement(AdVariantReview, {
        variant: set.variants[1],
        accountName: "Rossi Srl",
        comments: [
          {
            id: "c1",
            authorType: "CLIENT",
            authorName: "Giulia",
            body: "Troppo veloce",
            mediaIndex: 0,
            pinX: null,
            pinY: null,
            timeSec: 7,
            timeEndSec: null,
            createdLabel: "6 ott",
          },
        ],
        decision: null,
        canDecide: true,
        onDecide: () => {},
        onRequestComment: () => {},
        position: { index: 1, total: 2 },
      })
    );
    expect(review).toContain("Variante 2 di 2");
    expect(review).toContain("Approva variante");
    expect(review).toContain("Scarta");
    expect(review).toContain("0:07");
    expect(review).toContain("Commenta a 0:00");

    const decided = renderToStaticMarkup(
      createElement(AdVariantReview, {
        variant: set.variants[0],
        accountName: "R",
        comments: [],
        decision: { verdict: "REJECTED", note: "Foto scura" },
        canDecide: false,
        onDecide: () => {},
      })
    );
    expect(decided).toContain("Scartata");
    expect(decided).toContain("Foto scura");
    expect(decided).not.toContain("Approva variante");

    const compare = renderToStaticMarkup(
      createElement(AdVariantCompare, {
        variants: set.variants,
        decisions: { A: { verdict: "APPROVED", note: null }, B: { verdict: "REJECTED", note: "No" } },
        accountName: "R",
      })
    );
    expect(compare).toContain("Approvata");
    expect(compare).toContain("Nota del cliente: </span>No");
    expect(compare).toContain("snap-x");

    const editor = renderToStaticMarkup(
      createElement(AdSetEditor, { value: set, onChange: () => {}, accountName: "Rossi Srl" })
    );
    expect(editor).toContain("Nome della campagna");
    expect(editor).toContain("Controlli delle specifiche");
    expect(editor).toContain("Pronto per il cliente");
  });
});

// ─── Export route ────────────────────────────────────────────────────────────

const routeState = vi.hoisted(() => ({
  context: { workspaceId: "ws1" } as { workspaceId: string } | null,
  post: null as Record<string, unknown> | null,
  version: null as Record<string, unknown> | null,
  decisions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: async () => routeState.context,
}));
vi.mock("@/lib/creative-decisions", () => ({
  listDecisions: async () => routeState.decisions,
}));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    post: {
      findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) =>
        routeState.post && routeState.post.id === where.id && where.workspaceId === "ws1" ? routeState.post : null,
    },
    postEvent: { findFirst: async () => ({ versionNumber: 2 }) },
    postVersion: { findUnique: async () => routeState.version },
  },
}));

describe("GET /api/export/ads/[postId]", () => {
  let uploadDir: string;
  const base = "https://approve.example.com";
  const key = "ws1/abcdefghijklmnopqrstuvwx.jpg";
  const otherKey = "ws2/abcdefghijklmnopqrstuvwx.jpg";

  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(tmpdir(), "ads-export-"));
    await mkdir(path.join(uploadDir, "ws1"), { recursive: true });
    await mkdir(path.join(uploadDir, "ws2"), { recursive: true });
    await writeFile(path.join(uploadDir, key), Buffer.from("immagine-a"));
    await writeFile(path.join(uploadDir, otherKey), Buffer.from("altro-workspace"));
  });

  afterAll(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.stubEnv("PUBLIC_BASE_URL", base);
    vi.stubEnv("UPLOAD_DIR", uploadDir);
    routeState.context = { workspaceId: "ws1" };
    routeState.post = {
      id: "post1",
      kind: "AD_CREATIVE",
      status: "APPROVED",
      approvedAt: new Date("2026-10-06T10:00:00Z"),
      currentVersionNumber: 2,
      client: { name: "Rossi Srl", timezone: "Europe/Rome" },
    };
    routeState.version = {
      number: 2,
      content: adSet({
        variants: [
          variant({ media: [{ ...image(1, 1080, 1080), url: `${base}/media/${key}` }, image(9)] }),
          variant({ id: "B", name: "Variante B", media: [{ ...image(2), url: `${base}/media/${otherKey}` }] }),
          variant({ id: "C", name: "Variante C", media: [{ ...image(3), url: `${base}/media/ws1/zzzzzzzzzzzzzzzzzzzzzzzz.jpg` }] }),
        ],
      }),
    };
    routeState.decisions = [
      { variantId: "A", verdict: "APPROVED", note: null, updatedAt: new Date(), reviewer: { id: "r", name: "Giulia" } },
      { variantId: "B", verdict: "APPROVED", note: null, updatedAt: new Date(), reviewer: null },
      { variantId: "C", verdict: "REJECTED", note: "Non mi piace", updatedAt: new Date(), reviewer: null },
    ];
  });

  async function call(postId = "post1") {
    const { GET } = await import("../app/api/export/ads/[postId]/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest(`${base}/api/export/ads/${postId}`), { params: Promise.resolve({ postId }) });
  }

  it("requires an agency session and a post of this workspace", async () => {
    routeState.context = null;
    expect((await call()).status).toBe(401);
    routeState.context = { workspaceId: "ws1" };
    expect((await call("missing")).status).toBe(404);
    expect((await call("../etc")).status).toBe(404);
  });

  it("refuses sets that are not approved or have no approved variant", async () => {
    routeState.post = { ...routeState.post!, status: "IN_REVIEW" };
    const notApproved = await call();
    expect(notApproved.status).toBe(409);
    expect((await notApproved.json()).error).toContain("non ha ancora approvato");

    routeState.post = { ...routeState.post!, status: "APPROVED" };
    routeState.decisions = routeState.decisions.map((d) => ({ ...d, verdict: "REJECTED" }));
    const none = await call();
    expect(none.status).toBe(409);
    expect((await none.json()).error).toContain("Nessuna variante approvata");

    routeState.post = { ...routeState.post!, kind: "BLOG_ARTICLE" };
    expect((await call()).status).toBe(400);
  });

  it("zips the approved variants' local files, copy.csv and README.txt", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="rossi-srl_autunno_creativita-approvate.zip"'
    );
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["README.txt", "copy.csv", "rossi-srl_autunno_a_feed_1.jpg"]);
    expect(await zip.file("rossi-srl_autunno_a_feed_1.jpg")!.async("string")).toBe("immagine-a");

    const readme = await zip.file("README.txt")!.async("string");
    // External media are links, another workspace's key is never read.
    expect(readme).toContain("https://cdn.example.com/9.jpg");
    expect(readme).toContain("MEDIA NON TROVATI");
    expect(readme).toContain("Nota del cliente: Non mi piace");
    expect(readme).not.toContain("altro-workspace");

    const csv = await zip.file("copy.csv")!.async("string");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3); // header + A + B
  });
});
