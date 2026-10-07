import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AD_PLATFORM_LABELS,
  adSpecChecks,
  buildAdsCopyCsv,
  buildAdsReadme,
  buildGoogleExportFiles,
  buildGoogleKeywordsCsv,
  buildGooglePmaxAssetsCsv,
  buildGoogleRsaCsv,
  coerceAdContent,
  editorCsvCell,
  emptyAdContent,
  formatAssetComment,
  formatKeyword,
  googleCombination,
  googleCombinationCount,
  googleDisplayUrl,
  mergeKeywords,
  newVariant,
  parseAdContent,
  parseAssetComment,
  parseKeywordLine,
  parseKeywordList,
  placementsForMedia,
  pmaxImageKind,
  summarizeChecks,
  validateAdsForReview,
  type AdContent,
  type AdGoogleAssets,
  type AdSpecCheck,
  type AdVariant,
} from "../lib/content/ads";
import type { MediaItem } from "../lib/domain";
import { switchPlatform } from "../components/ads/helpers";
import AdPreview from "../components/ads/ad-preview";
import GoogleAssetsList from "../components/ads/google-assets-list";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const image = (n: number, width: number, height: number): MediaItem => ({
  url: `https://cdn.example.com/${n}.png`,
  type: "image",
  mimeType: "image/png",
  width,
  height,
});

const URL_OK = "https://www.palestrakinetik.it/prova-gratuita";

function assets(overrides: Partial<AdGoogleAssets> = {}): AdGoogleAssets {
  return {
    headlines: [
      "Palestra Kinetik a Milano",
      "Prova gratis per 7 giorni",
      "Istruttore sempre con te",
      "Corsi di functional training",
      "Aperti dalle 6 alle 23",
      "Sala pesi rinnovata",
      "Prenota la prova online",
      "Nessun vincolo di iscrizione",
    ],
    longHeadlines: [],
    descriptions: [
      "Sala pesi, corsi e un istruttore che ti segue. La prima settimana è gratis.",
      "Prenota online la tua prova gratuita: scegli giorno e orario in un minuto.",
      "Parcheggio interno, spogliatoi nuovi e corsi tutti i giorni. Ti aspettiamo.",
    ],
    businessName: "",
    path1: "prova",
    path2: "gratis",
    keywords: [
      { text: "palestra milano", match: "broad" },
      { text: "prova gratuita palestra", match: "phrase" },
      { text: "palestra kinetik", match: "exact" },
    ],
    negativeKeywords: ["lavoro", '"corso istruttore"'],
    logos: [],
    ...overrides,
  };
}

function searchVariant(overrides: Partial<AdVariant> = {}, google: Partial<AdGoogleAssets> = {}): AdVariant {
  return {
    id: "A",
    name: "Variante A — Ricerca",
    media: [],
    primaryText: "",
    headline: "",
    description: "",
    cta: "",
    destinationUrl: URL_OK,
    placements: ["google_search"],
    google: assets(google),
    ...overrides,
  };
}

function pmaxVariant(overrides: Partial<AdVariant> = {}, google: Partial<AdGoogleAssets> = {}): AdVariant {
  return {
    id: "B",
    name: "Variante B — Performance Max",
    media: [image(1, 1200, 628), image(2, 1200, 1200), image(3, 960, 1200)],
    primaryText: "",
    headline: "",
    description: "",
    cta: "Iscriviti",
    destinationUrl: URL_OK,
    placements: ["google_pmax"],
    google: assets({
      headlines: ["Kinetik Milano", "Prova gratis 7 giorni", "Istruttore dedicato"],
      longHeadlines: ["Allenati con un istruttore che ti segue: la prima settimana è gratis"],
      descriptions: ["La prima settimana è gratis, senza vincoli.", "Sala pesi rinnovata e corsi tutti i giorni."],
      businessName: "Palestra Kinetik",
      path1: "",
      path2: "",
      keywords: [],
      negativeKeywords: [],
      logos: [image(9, 512, 512)],
      ...google,
    }),
    ...overrides,
  };
}

function googleSet(variants: AdVariant[]): AdContent {
  return {
    campaign: { name: "Prenotazioni d'autunno", platform: "google", objective: "", budgetNote: "", audienceNote: "" },
    variants,
  };
}

const find = (checks: AdSpecCheck[], suffix: string) => checks.find((c) => c.id.endsWith(suffix));
const errors = (checks: AdSpecCheck[]) => checks.filter((c) => c.status === "error");

// ─── Model ───────────────────────────────────────────────────────────────────

describe("Google Ads content model", () => {
  it("labels the platform Google Ads", () => {
    expect(AD_PLATFORM_LABELS.google).toBe("Google Ads");
  });

  it("reads sets saved before Google Ads exactly as before (no google key)", () => {
    const old = {
      campaign: { name: "Autunno", platform: "google", objective: "", budgetNote: "", audienceNote: "" },
      variants: [
        {
          id: "A",
          name: "Variante A",
          media: [image(1, 1200, 628)],
          primaryText: "Titolo lungo",
          headline: "Titolo breve",
          description: "Descrizione",
          cta: "Scopri di più",
          destinationUrl: URL_OK,
          placements: ["google_display"],
        },
      ],
    };
    const parsed = parseAdContent(old);
    expect("google" in parsed.variants[0]).toBe(false);
    expect(parsed).toEqual(old);
    expect(coerceAdContent(old)).toEqual(old);
  });

  it("fills missing Google fields with defaults and trims items", () => {
    const parsed = parseAdContent(
      googleSet([
        { ...searchVariant(), google: { headlines: ["  Uno  ", ""], keywords: ['"due parole"', "[esatta]", "  "] } as never },
      ])
    );
    const g = parsed.variants[0].google!;
    expect(g.headlines).toEqual(["Uno", ""]);
    expect(g.descriptions).toEqual([]);
    expect(g.businessName).toBe("");
    expect(g.keywords).toEqual([
      { text: "due parole", match: "phrase" },
      { text: "esatta", match: "exact" },
    ]);
    expect(g.logos).toEqual([]);
  });

  it("rejects an unknown match type", () => {
    expect(() =>
      parseAdContent(googleSet([searchVariant({}, { keywords: [{ text: "x", match: "modified" as never }] })]))
    ).toThrow("Corrispondenza non valida");
  });

  it("starts Google variants on Search with empty assets", () => {
    const v = newVariant(0, { platform: "google" });
    expect(v.placements).toEqual(["google_search"]);
    expect(v.google?.headlines).toEqual([]);
    expect(emptyAdContent("google").variants[0].placements).toEqual(["google_search"]);
    expect(newVariant(0, { platform: "meta" }).google).toBeUndefined();
  });

  it("gives Google assets to variants when the set switches to Google Ads", () => {
    const meta = emptyAdContent("meta");
    const google = switchPlatform(meta, "google");
    expect(google.variants[0].placements).toEqual(["google_search"]);
    expect(google.variants[0].google).toBeDefined();
  });
});

// ─── Keywords ────────────────────────────────────────────────────────────────

describe("keyword syntax", () => {
  it("detects the match type from the syntax", () => {
    expect(parseKeywordLine("palestra milano")).toEqual({ text: "palestra milano", match: "broad" });
    expect(parseKeywordLine('"prova gratuita"')).toEqual({ text: "prova gratuita", match: "phrase" });
    expect(parseKeywordLine("“prova gratuita”")).toEqual({ text: "prova gratuita", match: "phrase" });
    expect(parseKeywordLine("[palestra kinetik]")).toEqual({ text: "palestra kinetik", match: "exact" });
    expect(parseKeywordLine("  +palestra   +milano ")).toEqual({ text: "palestra milano", match: "broad" });
    expect(parseKeywordLine("   ")).toBeNull();
    expect(parseKeywordLine("[]")).toBeNull();
  });

  it("parses a pasted list, one per line", () => {
    expect(parseKeywordList('palestra\r\n"corsi yoga"\n\n[kinetik], pilates')).toEqual([
      { text: "palestra", match: "broad" },
      { text: "corsi yoga", match: "phrase" },
      { text: "kinetik", match: "exact" },
      { text: "pilates", match: "broad" },
    ]);
  });

  it("formats keywords with Google's syntax and merges without duplicates", () => {
    expect(formatKeyword({ text: "a b", match: "broad" })).toBe("a b");
    expect(formatKeyword({ text: "a b", match: "phrase" })).toBe('"a b"');
    expect(formatKeyword({ text: "a b", match: "exact" })).toBe("[a b]");
    const merged = mergeKeywords(
      [{ text: "Palestra", match: "broad" }],
      [
        { text: "palestra", match: "broad" },
        { text: "palestra", match: "exact" },
      ]
    );
    expect(merged).toEqual([
      { text: "Palestra", match: "broad" },
      { text: "palestra", match: "exact" },
    ]);
  });
});

// ─── Spec checks: Search ─────────────────────────────────────────────────────

describe("Search (RSA) checks", () => {
  it("accepts a complete responsive search ad without media or CTA", () => {
    const checks = adSpecChecks(searchVariant(), { platform: "google" });
    expect(errors(checks)).toEqual([]);
    expect(checks.some((c) => c.id === "media:none")).toBe(false);
    expect(checks.some((c) => c.field === "cta")).toBe(false);
    // The Display fields are not required for Search.
    expect(checks.some((c) => c.id === "google:headline")).toBe(false);
    expect(find(checks, ":g:paths")?.message).toBe("URL visualizzato: palestrakinetik.it/prova/gratis.");
    expect(find(checks, ":g:keywords:count")?.message).toBe("Parole chiave: 3 (1 generica, 1 a frase, 1 esatta).");
  });

  it("counts headlines and descriptions", () => {
    const few = adSpecChecks(searchVariant({}, { headlines: ["Uno", "Due", ""], descriptions: ["Solo una"] }), {
      platform: "google",
    });
    expect(find(few, ":g:headlines:count")).toMatchObject({ status: "error", message: "Titoli: servono almeno 3 titoli, ne hai 2." });
    expect(find(few, ":g:descriptions:count")?.status).toBe("error");

    const many = adSpecChecks(
      searchVariant({}, {
        headlines: Array.from({ length: 16 }, (_, i) => `Titolo numero ${i + 1}`),
        descriptions: ["a", "b", "c", "d", "e"],
      }),
      { platform: "google" }
    );
    expect(find(many, ":g:headlines:count")?.message).toBe("Titoli: al massimo 15, ne hai 16. Togline 1.");
    expect(find(many, ":g:descriptions:count")?.status).toBe("error");
  });

  it("flags items over the limit, duplicates and bad paths", () => {
    const checks = adSpecChecks(
      searchVariant({}, {
        headlines: ["Uno", "Questo titolo è decisamente troppo lungo", "uno ", "Tre"],
        path1: "",
        path2: "una-parola-troppo-lunga",
      }),
      { platform: "google" }
    );
    expect(find(checks, ":g:headlines:1:length")?.message).toBe(
      "Titolo 2 «Questo titolo è decisamente troppo lungo»: 40 caratteri, al massimo 30."
    );
    expect(find(checks, ":g:headlines:2:duplicate")?.message).toBe("Titolo 3 è uguale a titolo 1: Google li vuole tutti diversi.");
    expect(find(checks, ":g:paths:2")?.status).toBe("error");
    expect(find(checks, ":g:paths:order")?.status).toBe("error");
  });

  it("requires keywords and checks each one", () => {
    const none = adSpecChecks(searchVariant({}, { keywords: [] }), { platform: "google" });
    expect(find(none, ":g:keywords:count")?.status).toBe("error");

    const bad = adSpecChecks(
      searchVariant({}, {
        keywords: [
          { text: "palestra milano", match: "broad" },
          { text: "Palestra  Milano", match: "broad" },
          { text: "uno due tre quattro cinque sei sette otto nove dieci undici", match: "phrase" },
          { text: "sconti!", match: "exact" },
        ],
        negativeKeywords: ["palestra milano", "lavoro", "lavoro"],
      }),
      { platform: "google" }
    );
    expect(find(bad, ":g:keywords:1:duplicate")?.status).toBe("warning");
    expect(find(bad, ":g:keywords:2:words")?.status).toBe("error");
    expect(find(bad, ":g:keywords:3:chars")?.status).toBe("error");
    expect(find(bad, ":g:negatives:0:conflict")?.status).toBe("warning");
    expect(find(bad, ":g:negatives:2:duplicate")?.status).toBe("warning");
  });

  it("warns that Search ignores media", () => {
    const checks = adSpecChecks(searchVariant({ media: [image(1, 1200, 628)] }), { platform: "google" });
    expect(find(checks, ":g:media:unused")?.status).toBe("warning");
    expect(checks.some((c) => c.id.startsWith("google_search:0:"))).toBe(false);
  });

  it("blocks sending to the client with readable messages", () => {
    const issues = validateAdsForReview(googleSet([searchVariant({}, { headlines: ["Uno"], keywords: [] })]));
    expect(issues.map((i) => i.message)).toEqual([
      "Variante A — Ricerca · Google Ricerca (annuncio adattivo): Titoli: servono almeno 3 titoli, ne hai 1.",
      "Variante A — Ricerca · Google Ricerca (annuncio adattivo): Parole chiave: aggiungine almeno una, senza l'annuncio di ricerca non compare.",
    ]);
    expect(validateAdsForReview(googleSet([searchVariant(), pmaxVariant()]))).toEqual([]);
  });
});

// ─── Spec checks: Performance Max ────────────────────────────────────────────

describe("Performance Max checks", () => {
  it("accepts a complete asset group, warning only about the missing video", () => {
    const checks = adSpecChecks(pmaxVariant(), { platform: "google" });
    expect(errors(checks)).toEqual([]);
    expect(checks.filter((c) => c.status === "warning").map((c) => c.id)).toEqual(["google_pmax:g:pmax:video"]);
    expect(find(checks, ":g:pmax:video")?.message).toContain("Google ne crea uno da solo");
  });

  it("requires landscape and square images, business name and long headlines", () => {
    const checks = adSpecChecks(
      pmaxVariant({ media: [image(3, 960, 1200)] }, { businessName: "", longHeadlines: [] }),
      { platform: "google" }
    );
    expect(find(checks, ":g:pmax:images:landscape")?.status).toBe("error");
    expect(find(checks, ":g:pmax:images:square")?.status).toBe("error");
    expect(find(checks, ":g:businessName")?.status).toBe("error");
    expect(find(checks, ":g:longHeadlines:count")?.status).toBe("error");
  });

  it("checks image and logo sizes per format", () => {
    const checks = adSpecChecks(
      pmaxVariant({ media: [image(1, 573, 300), image(2, 1200, 1200)] }, { logos: [image(9, 100, 100)] }),
      { platform: "google" }
    );
    expect(find(checks, ":g:pmax:image:0:size")?.message).toBe(
      "Immagine 1 (orizzontale 1,91:1): 573×300 px, Google chiede almeno 600×314."
    );
    expect(find(checks, ":g:pmax:logo:0:size")?.status).toBe("error");
    // The generic "Risoluzione" warning is replaced by the per-format check.
    expect(checks.some((c) => c.id === "google_pmax:0:size")).toBe(false);
  });

  it("recommends a short headline and a short description", () => {
    const checks = adSpecChecks(
      pmaxVariant({}, {
        headlines: ["Un titolo di oltre quindici", "Un altro titolo lunghetto", "Il terzo titolo lunghetto"],
        descriptions: [
          "Una descrizione che supera di parecchio i sessanta caratteri ammessi",
          "Anche questa descrizione supera ampiamente i sessanta caratteri",
        ],
      }),
      { platform: "google" }
    );
    expect(find(checks, ":g:headlines:short")?.status).toBe("warning");
    expect(find(checks, ":g:descriptions:short")?.status).toBe("warning");
  });

  it("lets Google pick the button when the CTA is empty", () => {
    const checks = adSpecChecks(pmaxVariant({ cta: "" }), { platform: "google" });
    expect(find(checks, "google:cta")).toMatchObject({ status: "ok" });
  });

  it("classifies images by format", () => {
    expect(pmaxImageKind({ width: 1200, height: 628 })).toBe("landscape");
    expect(pmaxImageKind({ width: 1080, height: 1080 })).toBe("square");
    expect(pmaxImageKind({ width: 960, height: 1200 })).toBe("portrait");
    expect(pmaxImageKind({ width: 1920, height: 1080 })).toBeNull();
    expect(pmaxImageKind({})).toBeNull();
  });

  it("keeps the Display checks for Display variants", () => {
    const checks = adSpecChecks(
      { ...searchVariant(), placements: ["google_display"], media: [image(1, 1200, 628)], headline: "", description: "" },
      { platform: "google" }
    );
    expect(find(checks, "google:headline")?.status).toBe("error");
    expect(find(checks, "google:cta")?.status).toBe("error");
  });
});

// ─── Previews ────────────────────────────────────────────────────────────────

describe("combinations and display URL", () => {
  it("rotates headlines without repeating them inside a combination", () => {
    const g = assets();
    const first = googleCombination(g, 0);
    const second = googleCombination(g, 1);
    expect(first.headlines).toEqual(g.headlines.slice(0, 3));
    expect(second.headlines).toEqual(g.headlines.slice(3, 6));
    expect(new Set(googleCombination(g, 2).headlines).size).toBe(3);
    expect(googleCombination({ headlines: ["a"], descriptions: [], longHeadlines: [] }, 5).headlines).toEqual(["a"]);
    expect(googleCombinationCount(g)).toBe(3);
  });

  it("builds the display URL from the domain and the paths", () => {
    expect(googleDisplayUrl(URL_OK, { path1: "prova", path2: "gratis" })).toBe("palestrakinetik.it/prova/gratis");
    expect(googleDisplayUrl(URL_OK, { path1: "", path2: "gratis" })).toBe("palestrakinetik.it");
    expect(googleDisplayUrl("non un url", { path1: "a", path2: "" })).toBeNull();
  });

  it("renders the search result and the PMax surfaces", () => {
    const props = { variant: searchVariant(), accountName: "Palestra Kinetik" };
    const search = renderToStaticMarkup(createElement(AdPreview, { placement: "google_search", ...props }));
    expect(search).toContain("Sponsorizzato");
    expect(search).toContain("Palestra Kinetik a Milano | Prova gratis per 7 giorni | Istruttore sempre con te");
    expect(search).toContain("Mostra un&#x27;altra combinazione");

    const pmax = renderToStaticMarkup(
      createElement(AdPreview, { placement: "google_pmax", variant: pmaxVariant(), accountName: "Palestra Kinetik" })
    );
    for (const surface of ["Display", "YouTube", "Gmail", "Discover", "Ricerca"]) expect(pmax).toContain(surface);
    expect(pmax).toContain("Allenati con un istruttore");
  });

  it("lists the assets for the client with match types in words", () => {
    const html = renderToStaticMarkup(createElement(GoogleAssetsList, { variant: searchVariant(), onCommentAsset: () => {} }));
    expect(html).toContain("Titoli");
    expect(html).toContain("generica");
    expect(html).toContain("a frase");
    expect(html).toContain("esatta");
    expect(html).toContain("palestrakinetik.it/prova/gratis");
    expect(html).toContain("Tocca un testo per commentarlo");
  });
});

// ─── Asset comments ──────────────────────────────────────────────────────────

describe("comments on one asset", () => {
  it("quotes the asset in the body and reads it back", () => {
    const body = formatAssetComment({ kind: "headline", index: 2, text: "Istruttore  sempre con te" }, "  Troppo generico. ");
    expect(body).toBe("[Titolo 3] «Istruttore sempre con te»\nTroppo generico.");
    expect(parseAssetComment(body)).toEqual({ name: "Titolo 3", quote: "Istruttore sempre con te", text: "Troppo generico." });
    expect(parseAssetComment("[nota] «x»\ny")).toBeNull();
    expect(parseAssetComment("Un commento qualsiasi")).toBeNull();
    expect(
      parseAssetComment(formatAssetComment({ kind: "keyword", index: 0, text: '"prova gratuita"' }, "Toglierei"))?.name
    ).toBe("Parola chiave 1");
  });
});

// ─── Export ──────────────────────────────────────────────────────────────────

describe("Google export", () => {
  const variants = [searchVariant(), pmaxVariant()];

  it("builds the Google Ads Editor RSA file", () => {
    const csv = buildGoogleRsaCsv("Prenotazioni d'autunno", variants)!;
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, row] = csv.slice(1).split("\r\n");
    const cols = header.split(",");
    expect(cols.slice(0, 4)).toEqual(["Campaign", "Ad group", "Ad type", "Headline 1"]);
    expect(cols).toContain("Headline 15");
    expect(cols).toContain("Description 4");
    expect(cols.slice(-3)).toEqual(["Path 1", "Path 2", "Final URL"]);
    const cells = row.split(",");
    expect(cells[0]).toBe("Prenotazioni d'autunno");
    expect(cells[1]).toBe("Variante A — Ricerca");
    expect(cells[2]).toBe("Responsive search ad");
    expect(cells[3]).toBe("Palestra Kinetik a Milano");
    expect(row.endsWith(`prova,gratis,${URL_OK}`)).toBe(true);
    expect(buildGoogleRsaCsv("X", [pmaxVariant()])).toBeNull();
  });

  it("builds the keywords file with negatives", () => {
    const csv = buildGoogleKeywordsCsv("Autunno", variants)!;
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Campaign,Ad group,Keyword,Criterion Type");
    expect(lines).toContain("Autunno,Variante A — Ricerca,palestra milano,Broad");
    expect(lines).toContain("Autunno,Variante A — Ricerca,prova gratuita palestra,Phrase");
    expect(lines).toContain("Autunno,Variante A — Ricerca,palestra kinetik,Exact");
    expect(lines).toContain("Autunno,Variante A — Ricerca,corso istruttore,Negative Phrase");
    expect(lines).toContain("Autunno,Variante A — Ricerca,lavoro,Negative Broad");
  });

  it("builds the PMax assets file", () => {
    const csv = buildGooglePmaxAssetsCsv("Autunno", variants)!;
    const [header, row] = csv.slice(1).split("\r\n");
    expect(header).toContain("Asset group,Headline 1");
    expect(header).toContain("Long headline 5");
    expect(header).toContain("Business name,Call to action,Final URL");
    expect(row).toContain("Palestra Kinetik,Iscriviti");
    expect(row).toContain("Allenati con un istruttore che ti segue: la prima settimana è gratis");
  });

  it("does not guard cells meant for Ads Editor, but quotes commas and quotes", () => {
    expect(editorCsvCell("-20% sull'abbonamento")).toBe("-20% sull'abbonamento");
    expect(editorCsvCell('Prova "gratis", subito')).toBe('"Prova ""gratis"", subito"');
  });

  it("lists only the files that apply", () => {
    expect(buildGoogleExportFiles("A", variants).map((f) => f.fileName)).toEqual([
      "google-ads-rsa.csv",
      "google-ads-keywords.csv",
      "google-ads-pmax-assets.csv",
    ]);
    expect(buildGoogleExportFiles("A", [pmaxVariant()]).map((f) => f.fileName)).toEqual(["google-ads-pmax-assets.csv"]);
    expect(buildGoogleExportFiles("A", [{ ...searchVariant(), placements: ["google_display"] }])).toEqual([]);
  });

  it("adds Google columns to copy.csv only for Google sets", () => {
    const csv = buildAdsCopyCsv(variants);
    const header = csv.slice(1).split("\r\n")[0];
    expect(header.endsWith(";Titoli Google;Titoli lunghi;Descrizioni Google;Nome attività;URL visualizzato;Parole chiave;Parole chiave escluse")).toBe(true);
    expect(csv).toContain('palestra milano | ""prova gratuita palestra"" | [palestra kinetik]');
    const plain = buildAdsCopyCsv([{ ...searchVariant(), google: undefined, placements: ["google_display"] }]);
    expect(plain.slice(1).split("\r\n")[0]).toBe("Variante;Nome;Testo principale;Titolo;Descrizione;CTA;URL;Posizionamenti;File");
  });

  it("puts the Google assets and files in README.txt", () => {
    const readme = buildAdsReadme({
      clientName: "Palestra Kinetik",
      campaign: googleSet([]).campaign,
      versionNumber: 1,
      approvedAt: null,
      generatedAt: new Date("2026-10-07T10:00:00Z"),
      timeZone: "Europe/Rome",
      variants,
      decisions: [{ variantId: "A", verdict: "APPROVED", note: null }],
      files: [],
      externalMedia: [],
      missingMedia: [],
      googleFiles: buildGoogleExportFiles("Prenotazioni d'autunno", [variants[0]]),
    });
    expect(readme).toContain("Piattaforma: Google Ads");
    expect(readme).toContain("- google-ads-rsa.csv (annunci adattivi della rete di ricerca, da importare in Google Ads Editor)");
    expect(readme).toContain("  Titoli (8):\r\n    1. Palestra Kinetik a Milano");
    expect(readme).toContain('    2. "prova gratuita palestra" (a frase)');
    expect(readme).toContain("  URL visualizzato: palestrakinetik.it/prova/gratis");
  });

  it("names exported media after the PMax placement, never Search", () => {
    const v = { ...pmaxVariant(), placements: ["google_search", "google_pmax"] as AdVariant["placements"] };
    expect(placementsForMedia(v, image(1, 1200, 628))).toEqual(["google_pmax"]);
  });
});

describe("summary of a ready Google set", () => {
  it("has no errors", () => {
    expect(summarizeChecks(adSpecChecks(searchVariant(), { platform: "google" })).errors).toBe(0);
  });
});
