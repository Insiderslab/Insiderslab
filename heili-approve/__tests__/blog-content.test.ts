import { describe, expect, it } from "vitest";
import {
  buildAnchor,
  buildBlogHtmlExport,
  buildBlogMarkdownExport,
  coerceBlogContent,
  diffBlogContent,
  diffWords,
  emptyBlogContent,
  findAnchor,
  gulpeaseIndex,
  htmlToTextWithBlocks,
  locateAnchors,
  markdownToPlainText,
  parseBlogAnchor,
  parseBlogContent,
  readingTime,
  renderMarkdownSafe,
  safeParseBlogContent,
  seoChecks,
  slugify,
  splitDiffIntoParagraphs,
  validateBlogForReview,
  wordCount,
  yamlString,
  type BlogContent,
  type WordDiffSegment,
} from "../lib/content/blog";
import { ValidationError } from "../lib/errors";
import { applyMarkdownAction } from "../components/blog/markdown-actions";

const words = (n: number, word = "parola") => Array.from({ length: n }, () => word).join(" ");

function article(overrides: Partial<BlogContent> = {}): BlogContent {
  return {
    ...emptyBlogContent(),
    headline: "Caffè specialty a Milano: la guida completa",
    slug: "caffe-specialty-milano",
    bodyMarkdown: [
      "Il **caffè specialty** a Milano è cresciuto molto. Ecco dove berlo e perché conviene provarlo.",
      "",
      "## Dove bere caffè specialty",
      "",
      `${words(320, "tazza")}. Leggi la [nostra guida](/guide/caffe) e la [scheda SCA](https://sca.coffee).`,
      "",
      "![Barista che prepara un espresso](https://example.com/espresso.jpg)",
    ].join("\n"),
    excerpt: "Dove bere il miglior caffè specialty a Milano.",
    metaTitle: "Caffè specialty a Milano: la guida",
    metaDescription: "Dove bere il miglior caffè specialty a Milano: torrefazioni, bar e consigli per scegliere la tazza giusta.",
    focusKeyword: "caffè specialty",
    featuredImage: {
      url: "https://example.com/cover.jpg",
      type: "image",
      mimeType: "image/jpeg",
      alt: "Tazza di caffè",
    },
    categories: ["Guide"],
    tags: ["caffè", "Milano"],
    author: "Giulia Rossi",
    ...overrides,
  };
}

const joined = (segments: WordDiffSegment[], side: "before" | "after") =>
  segments
    .filter((s) => s.type === "same" || s.type === (side === "before" ? "removed" : "added"))
    .map((s) => s.value)
    .join("");

describe("schema", () => {
  it("fills defaults for an empty or missing value", () => {
    expect(parseBlogContent(undefined)).toEqual(emptyBlogContent());
    expect(parseBlogContent({})).toEqual(emptyBlogContent());
  });

  it("trims, dedupes labels and drops unknown keys", () => {
    const parsed = parseBlogContent({
      headline: "  Titolo  ",
      tags: ["Milano", "milano", " caffè ", ""],
      evil: "<script>",
    });
    expect(parsed.headline).toBe("Titolo");
    expect(parsed.tags).toEqual(["Milano", "caffè"]);
    expect(parsed).not.toHaveProperty("evil");
  });

  it("rejects malformed input with an Italian ValidationError", () => {
    expect(() => parseBlogContent({ headline: 42 })).toThrow(ValidationError);
    expect(() =>
      parseBlogContent({ featuredImage: { url: "javascript:alert(1)", type: "image", mimeType: "image/png" } })
    ).toThrow(/URL dell'immagine non valido/);
    expect(() =>
      parseBlogContent({ featuredImage: { url: "https://x.it/a.mp4", type: "video", mimeType: "video/mp4" } })
    ).toThrow(/deve essere un'immagine/);
    expect(safeParseBlogContent({ tags: "no" })).toMatchObject({ ok: false });
  });

  it("coerces stored JSON field by field without throwing", () => {
    const content = coerceBlogContent({ headline: "Ok", slug: 12, tags: ["a"] });
    expect(content.headline).toBe("Ok");
    expect(content.slug).toBe("");
    expect(content.tags).toEqual(["a"]);
    expect(coerceBlogContent("garbage")).toEqual(emptyBlogContent());
  });

  it("validates anchors", () => {
    expect(parseBlogAnchor({ quote: "ciao", prefix: "", suffix: "", blockIndex: 2 })).toEqual({
      quote: "ciao",
      prefix: "",
      suffix: "",
      blockIndex: 2,
    });
    expect(parseBlogAnchor({ quote: "   " })).toBeNull();
    expect(parseBlogAnchor({ quote: "x", blockIndex: -1 })).toBeNull();
    expect(parseBlogAnchor(null)).toBeNull();
  });
});

describe("validation for review", () => {
  it("accepts a complete article", () => {
    expect(validateBlogForReview(article())).toEqual([]);
  });

  it("explains every problem in Italian", () => {
    const issues = validateBlogForReview(
      article({
        headline: "",
        slug: "Perché Sì",
        bodyMarkdown: "Troppo corto.",
        metaDescription: "Breve",
        featuredImage: { url: "https://example.com/a.jpg", type: "image", mimeType: "image/jpeg" },
      })
    );
    const byField = Object.fromEntries(issues.map((i) => [i.field, i.message]));
    expect(byField.headline).toBe("Inserisci il titolo dell'articolo.");
    expect(byField.slug).toMatch(/solo lettere minuscole senza accenti/);
    expect(byField.bodyMarkdown).toBe("Il testo è troppo corto: 2 parole, ne servono almeno 100.");
    expect(byField.metaDescription).toBe("La meta description deve avere tra 50 e 160 caratteri (ora 5).");
    expect(byField.featuredImage).toBe("Aggiungi il testo alternativo all'immagine in evidenza.");
  });

  it("asks for missing slug and meta description", () => {
    const issues = validateBlogForReview(article({ slug: "", metaDescription: "" }));
    expect(issues.map((i) => i.field)).toEqual(["slug", "metaDescription"]);
    expect(issues[1].message).toMatch(/tra 50 e 160 caratteri/);
  });
});

describe("slugify", () => {
  it("handles Italian accents and punctuation", () => {
    expect(slugify("Perché è così")).toBe("perche-e-cosi");
    expect(slugify("L'arte del caffè: più gusto, meno zucchero!")).toBe("l-arte-del-caffe-piu-gusto-meno-zucchero");
    expect(slugify("Pane & Vino")).toBe("pane-e-vino");
    expect(slugify("  --Già   fatto--  ")).toBe("gia-fatto");
    expect(slugify("")).toBe("");
  });

  it("cuts long titles at a dash", () => {
    const slug = slugify("una guida davvero molto lunga per spiegare come scegliere il caffè migliore della città", 40);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).not.toMatch(/-$/);
    expect(slug.startsWith("una-guida-davvero")).toBe(true);
  });
});

describe("renderMarkdownSafe", () => {
  it("renders Markdown with block markers", () => {
    const html = renderMarkdownSafe("# Titolo\n\nUn **paragrafo**.\n\n- uno\n- due");
    expect(html).toContain('<h1 data-block="0">Titolo</h1>');
    expect(html).toContain('<p data-block="1">Un <strong>paragrafo</strong>.</p>');
    expect(html).toContain('<ul data-block="2">');
    expect(renderMarkdownSafe("Ciao", { blockMarkers: false })).toBe("<p>Ciao</p>");
  });

  it("strips scripts, event handlers and javascript: links", () => {
    const html = renderMarkdownSafe(
      [
        "<script>alert(1)</script>",
        "",
        '<img src="https://x.it/a.png" onerror="alert(1)" alt="a">',
        "",
        "[clic](javascript:alert(1)) e <a href=\"JaVaScRiPt:alert(1)\">qui</a>",
        "",
        '<p onclick="steal()" style="color:red">testo</p>',
        "",
        "![x](data:image/png;base64,AAAA)",
      ].join("\n")
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/alert\(1\)<\/script>/);
    expect(html).not.toMatch(/onerror|onclick|style=/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/data:image/);
    expect(html).toContain("testo");
  });

  it("marks external links noopener and keeps internal ones plain", () => {
    const html = renderMarkdownSafe("[Fonte](https://istat.it) e [servizi](/servizi)", { blockMarkers: false });
    expect(html).toContain('<a href="https://istat.it" rel="noopener noreferrer" target="_blank">Fonte</a>');
    expect(html).toContain('<a href="/servizi">servizi</a>');
  });

  it("cannot forge block markers from raw HTML", () => {
    const html = renderMarkdownSafe('<p data-block="99">finto</p>');
    expect(html).toBe('<p data-block="0">finto</p>');
  });
});

describe("counts and plain text", () => {
  it("counts words of the rendered text, not the syntax", () => {
    expect(wordCount("## Titolo\n\nUn **bel** [link](https://x.it).")).toBe(4);
    expect(wordCount("")).toBe(0);
    expect(readingTime(words(450))).toBe(2);
    expect(readingTime("ciao")).toBe(1);
    expect(readingTime("")).toBe(0);
  });

  it("produces readable plain text", () => {
    expect(markdownToPlainText("## Sezione\n\nTesto &amp; altro.\n\n- uno\n- due\n\n![Foto](https://x.it/a.jpg)")).toBe(
      "Sezione\n\nTesto & altro.\n\n• uno\n• due\n\n[Immagine: Foto]"
    );
  });

  it("mirrors textContent and block offsets", () => {
    const html = renderMarkdownSafe("Uno &lt; due.\n\n## Tre");
    const { text, blockStarts } = htmlToTextWithBlocks(html);
    expect(text).toBe("Uno < due.\nTre");
    expect(blockStarts).toEqual([0, 11]);
  });

  it("computes the Gulpease index", () => {
    expect(gulpeaseIndex("")).toBeNull();
    expect(gulpeaseIndex("Il gatto dorme. Il cane gioca.")).toBeGreaterThan(70);
  });
});

describe("seoChecks", () => {
  const byId = (content: BlogContent) => Object.fromEntries(seoChecks(content).map((c) => [c.id, c]));

  it("passes the main checks on a well-prepared article", () => {
    const checks = byId(article());
    for (const id of ["keyword-title", "keyword-intro", "keyword-meta", "keyword-slug", "meta-description", "slug", "length", "headings", "images", "internal-links", "external-links"]) {
      expect(checks[id]?.status, id).toBe("ok");
    }
    expect(checks.length.message).toMatch(/parole, \d+ min di lettura/);
  });

  it("flags missing keyword, meta and links with one-line Italian messages", () => {
    const checks = byId(
      article({
        focusKeyword: "",
        metaDescription: "",
        bodyMarkdown: `# Titolo nel testo\n\n${words(120)}`,
        featuredImage: null,
      })
    );
    expect(checks.keyword.status).toBe("warning");
    expect(checks["keyword-title"]).toBeUndefined();
    expect(checks["meta-description"].status).toBe("error");
    expect(checks.headings.message).toMatch(/il titolo è già l'H1/);
    expect(checks["internal-links"].status).toBe("warning");
    expect(checks["external-links"].status).toBe("warning");
    expect(checks.images.message).toMatch(/Manca l'immagine in evidenza/);
    expect(checks.length.status).toBe("warning");
    for (const check of seoChecks(article({ focusKeyword: "" }))) {
      expect(check.message).not.toContain("\n");
    }
  });

  it("matches the keyword ignoring case and accents", () => {
    const checks = byId(article({ focusKeyword: "CAFFE SPECIALTY" }));
    expect(checks["keyword-title"].status).toBe("ok");
    expect(checks["keyword-intro"].status).toBe("ok");
  });

  it("warns about long sentences, keyword stuffing and images without alt", () => {
    const longSentence = `${words(30)}.`;
    const checks = byId(
      article({
        bodyMarkdown: `${Array.from({ length: 12 }, () => longSentence).join(" ")} caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty caffè specialty\n\n![](https://x.it/a.jpg)`,
      })
    );
    expect(checks["long-sentences"].status).toBe("warning");
    expect(checks["keyword-density"].status).toBe("warning");
    expect(checks.images.message).toMatch(/non ha il testo alternativo/);
  });

  it("counts absolute links to the client's site as internal when the host is known", () => {
    const content = article({ bodyMarkdown: `${words(300)} [chi siamo](https://www.rossi.it/chi-siamo)` });
    const checks = Object.fromEntries(seoChecks(content, { siteHost: "rossi.it" }).map((c) => [c.id, c]));
    expect(checks["internal-links"].status).toBe("ok");
    expect(checks["external-links"].status).toBe("warning");
  });
});

describe("diffWords", () => {
  it("reconstructs both sides exactly", () => {
    const before = "Il gatto nero dorme sul divano.";
    const after = "Un cane bianco dorme sul divano rosso.";
    const segments = diffWords(before, after);
    expect(joined(segments, "before")).toBe(before);
    expect(joined(segments, "after")).toBe(after);
  });

  it("groups a rewritten phrase into one deletion and one insertion", () => {
    const segments = diffWords("Il gatto nero dorme.", "Un cane bianco dorme.");
    expect(segments).toEqual([
      { type: "removed", value: "Il gatto nero" },
      { type: "added", value: "Un cane bianco" },
      { type: "same", value: " dorme." },
    ]);
  });

  it("handles insertions, deletions and empty sides", () => {
    expect(diffWords("a c", "a b c").filter((s) => s.type === "added").map((s) => s.value.trim())).toEqual(["b"]);
    expect(diffWords("", "nuovo")).toEqual([{ type: "added", value: "nuovo" }]);
    expect(diffWords("vecchio", "")).toEqual([{ type: "removed", value: "vecchio" }]);
    expect(diffWords("uguale", "uguale")).toEqual([{ type: "same", value: "uguale" }]);
  });

  it("splits a body diff into paragraphs", () => {
    const paragraphs = splitDiffIntoParagraphs(diffWords("Uno.\n\nDue.\n\nTre.", "Uno.\n\nDue bis.\n\nTre."));
    expect(paragraphs.map((p) => p.changed)).toEqual([false, true, false]);
  });

  it("diffs headline, excerpt and SEO fields of two versions", () => {
    const before = article();
    const after = article({
      headline: "Caffè specialty a Milano: dove berlo",
      metaDescription: `${before.metaDescription} Aggiornata.`,
      tags: ["caffè"],
    });
    const diff = diffBlogContent(before, after);
    expect(diff.changed).toBe(true);
    expect(diff.fields.map((f) => f.field)).toEqual(["headline", "metaDescription", "tags"]);
    expect(diff.body).toBeNull();
    expect(diff.summary).toContain("Titolo modificato");
    expect(joined(diff.fields[0].segments, "after")).toBe(after.headline);
    expect(diffBlogContent(before, article()).changed).toBe(false);
  });

  it("reports body paragraphs and featured image changes", () => {
    const before = article({ bodyMarkdown: "Primo.\n\nSecondo." });
    const after = article({
      bodyMarkdown: "Primo.\n\nSecondo cambiato.",
      featuredImage: { ...before.featuredImage!, alt: "Altro testo" },
    });
    const diff = diffBlogContent(before, after);
    expect(diff.changedParagraphs).toBe(1);
    expect(diff.summary).toContain("Testo: 1 paragrafo modificato");
    expect(diff.featuredImage?.altOnly).toBe(true);
  });
});

describe("anchors", () => {
  const original =
    "Il caffè specialty è un mondo. Le torrefazioni di Milano sono cresciute. Il caffè specialty costa di più, ma vale la pena.";

  function anchorOn(text: string, quote: string, occurrence = 0) {
    let at = -1;
    for (let i = 0; i <= occurrence; i++) at = text.indexOf(quote, at + 1);
    return buildAnchor(text, at, at + quote.length, null)!;
  }

  it("builds an anchor with trimmed quote and context", () => {
    const anchor = buildAnchor("Uno due tre quattro", 3, 8, 0);
    expect(anchor).toEqual({ quote: "due", prefix: "Uno ", suffix: " tre quattro", blockIndex: 0 });
    expect(buildAnchor("a   b", 1, 4, null)).toBeNull();
  });

  it("finds the exact passage and disambiguates repeats with context", () => {
    const anchor = anchorOn(original, "Il caffè specialty", 1);
    const match = findAnchor(original, anchor)!;
    expect(match.exact).toBe(true);
    expect(match.start).toBe(original.indexOf("Il caffè specialty costa"));
  });

  it("re-anchors after edits around the quote", () => {
    const anchor = anchorOn(original, "Le torrefazioni di Milano sono cresciute.");
    const edited = `Introduzione nuova. ${original.replace("Il caffè specialty è un mondo.", "Il caffè specialty è un universo intero.")}`;
    const match = findAnchor(edited, anchor)!;
    expect(edited.slice(match.start, match.end)).toBe("Le torrefazioni di Milano sono cresciute.");
  });

  it("tolerates whitespace, case and accent changes", () => {
    const anchor = anchorOn(original, "Le torrefazioni di Milano");
    const edited = original.replace("Le torrefazioni di Milano", "le  torrefazioni di MILANO");
    const match = findAnchor(edited, anchor)!;
    expect(edited.slice(match.start, match.end)).toBe("le  torrefazioni di MILANO");
  });

  it("follows a lightly edited quote", () => {
    const anchor = anchorOn(original, "Le torrefazioni di Milano sono cresciute.");
    const edited = original.replace("Le torrefazioni di Milano sono cresciute.", "Le torrefazioni di Milano sono molto cresciute.");
    const match = findAnchor(edited, anchor)!;
    expect(match.exact).toBe(false);
    expect(edited.slice(match.start, match.end)).toBe("Le torrefazioni di Milano sono molto cresciute.");
  });

  it("finds a similar passage even when the context changed too", () => {
    const anchor = anchorOn(original, "Le torrefazioni di Milano sono cresciute.");
    const edited = "Testo completamente diverso qui. Le torrefazioni a Milano sono cresciute! Altro testo nuovo in fondo.";
    const match = findAnchor(edited, anchor)!;
    expect(edited.slice(match.start, match.end)).toMatch(/^Le torrefazioni a Milano sono cresciute/);
  });

  it("returns null when the passage is gone", () => {
    const anchor = anchorOn(original, "Le torrefazioni di Milano sono cresciute.");
    expect(findAnchor("Un articolo completamente riscritto che parla di tè verde giapponese.", anchor)).toBeNull();
  });

  it("works on rendered HTML and reports comment placement", () => {
    const html = renderMarkdownSafe(`${original}\n\n## Prezzi\n\nIl caffè specialty costa di più.`);
    const anchor = anchorOn(htmlToTextWithBlocks(html).text, "Prezzi");
    expect(anchor).toBeTruthy();
    const match = findAnchor(html, { ...anchor, blockIndex: 1 });
    expect(match?.exact).toBe(true);
    const placed = locateAnchors(html, [
      { id: "a", anchor },
      { id: "b", anchor: { quote: "tè matcha", prefix: "", suffix: "", blockIndex: null } },
      { id: "c", anchor: null },
    ]);
    expect(placed.get("a")?.status).toBe("exact");
    expect(placed.get("b")?.status).toBe("missing");
    expect(placed.has("c")).toBe(false);
  });
});

describe("export builders", () => {
  const meta = { publishAt: new Date("2026-10-10T08:00:00Z"), versionNumber: 3, approved: true, postTitle: "Articolo" };

  it("escapes YAML strings", () => {
    expect(yamlString('Il "vero" caffè: sì\\no')).toBe('"Il \\"vero\\" caffè: sì\\\\no"');
    expect(yamlString("riga\nnuova\u2028")).toBe('"riga\\nnuova\\u2028"');
  });

  it("builds Markdown with front matter", () => {
    const md = buildBlogMarkdownExport(article({ headline: 'Titolo: "citato"\n---' }), meta);
    expect(md.startsWith("---\ntitle: \"Titolo: \\\"citato\\\"\\n---\"\n")).toBe(true);
    expect(md).toContain('slug: "caffe-specialty-milano"');
    expect(md).toContain('date: "2026-10-10T08:00:00.000Z"');
    expect(md).toContain('categories:\n  - "Guide"');
    expect(md).toContain("approved: true");
    expect(md.split("\n---\n")[1]).toContain("Il **caffè specialty** a Milano");
  });

  it("builds clean HTML with h1, featured image alt and no scripts", () => {
    const html = buildBlogHtmlExport(
      article({ headline: "A <b>B</b>", bodyMarkdown: "Testo<script>alert(1)</script>" }),
      { ...meta, approved: false }
    );
    expect(html).toContain("<h1>A &lt;b&gt;B&lt;/b&gt;</h1>");
    expect(html).toContain('<img src="https://example.com/cover.jpg" alt="Tazza di caffè">');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("NON ancora approvata");
  });
});

describe("markdown toolbar actions", () => {
  it("wraps the selection in bold and toggles it off", () => {
    const edit = applyMarkdownAction("un testo qui", 3, 8, "bold");
    expect(edit).toMatchObject({ start: 3, end: 8, text: "**testo**", selectionStart: 5, selectionEnd: 10 });
    const applied = "un **testo** qui";
    expect(applyMarkdownAction(applied, 5, 10, "bold")).toMatchObject({ start: 3, end: 12, text: "testo" });
  });

  it("inserts a placeholder when nothing is selected", () => {
    const edit = applyMarkdownAction("ab", 1, 1, "italic");
    expect(edit.text).toBe("_corsivo_");
    expect(edit.selectionEnd - edit.selectionStart).toBe("corsivo".length);
  });

  it("prefixes whole lines for headings, lists and quotes", () => {
    expect(applyMarkdownAction("riga uno\nriga due", 2, 12, "ul").text).toBe("- riga uno\n- riga due");
    expect(applyMarkdownAction("riga uno\nriga due", 0, 17, "ol").text).toBe("1. riga uno\n2. riga due");
    expect(applyMarkdownAction("### Titolo", 4, 4, "h2").text).toBe("## Titolo");
    expect(applyMarkdownAction("## Titolo", 4, 4, "h2").text).toBe("Titolo");
    expect(applyMarkdownAction("citazione", 0, 0, "quote").text).toBe("> citazione");
  });

  it("builds links around the selection", () => {
    const edit = applyMarkdownAction("vedi sito", 5, 9, "link");
    expect(edit.text).toBe("[sito](https://)");
    expect(edit.text.slice(edit.selectionStart - edit.start, edit.selectionEnd - edit.start)).toBe("https://");
  });
});
