import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── SDK mocks (no network) ──────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  openaiParse: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic {
    static APIError = actual.APIError;
    static RateLimitError = actual.RateLimitError;
    static APIConnectionError = actual.APIConnectionError;
    static APIConnectionTimeoutError = actual.APIConnectionTimeoutError;
    static AuthenticationError = actual.AuthenticationError;
    static PermissionDeniedError = actual.PermissionDeniedError;
    static BadRequestError = actual.BadRequestError;
    static InternalServerError = actual.InternalServerError;
    beta = { messages: { create: mocks.anthropicCreate } };
  }
  return { ...actual, default: FakeAnthropic };
});

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI {
    static APIError = actual.APIError;
    static RateLimitError = actual.RateLimitError;
    static APIConnectionError = actual.APIConnectionError;
    static APIConnectionTimeoutError = actual.APIConnectionTimeoutError;
    static AuthenticationError = actual.AuthenticationError;
    static PermissionDeniedError = actual.PermissionDeniedError;
    static BadRequestError = actual.BadRequestError;
    static NotFoundError = actual.NotFoundError;
    static InternalServerError = actual.InternalServerError;
    responses = { parse: mocks.openaiParse };
  }
  return { ...actual, default: FakeOpenAI };
});

import { emptyAdContent } from "../lib/content/ads";
import { emptyBlogContent } from "../lib/content/blog";
import type { AdContent, BlogContent } from "../lib/content/types";
import type { MediaItem } from "../lib/domain";
import { planActionItemCommentFor, type ReviewerPost } from "../lib/posts";
import {
  anchorForQuote,
  articleTextModel,
  itemLabelsFor,
  itemTargetFor,
  resolveArticleQuote,
  toRequestChangesItems,
} from "../lib/review-assistant/content";
import {
  buildFinalizeSystemPrompt,
  buildPostContext,
  buildTurnMessages,
  buildTurnSystemPrompt,
  selectAttachments,
  type AssistantPostContext,
  type HistoryMessage,
} from "../lib/review-assistant/prompt";
import { runAssistantFinalize } from "../lib/review-assistant/provider";
import { sanitizeActionItemsFor } from "../lib/review-assistant/rules";
import {
  ASSISTANT_KIND_COPY,
  actionItemPlaceTags,
  formatChangesMessage,
  parseActionItems,
  passageMarker,
  splitMessageMarkers,
  variantMarker,
  type ActionItem,
} from "../lib/review-assistant/shared";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const image = (url: string): MediaItem => ({ url, type: "image", mimeType: "image/jpeg" });
const video = (url: string, durationSec?: number): MediaItem => ({
  url,
  type: "video",
  mimeType: "video/mp4",
  ...(durationSec !== undefined ? { durationSec } : {}),
});

const ARTICLE_BODY = [
  "## Perché scegliere la colomba artigianale",
  "",
  "La nostra colomba lievita per 36 ore con lievito madre. Usiamo solo burro italiano e arance candite da noi.",
  "",
  "I prezzi partono da 25 euro e la spedizione è gratuita sopra i 50 euro.",
].join("\n");

function article(overrides: Partial<BlogContent> = {}): BlogContent {
  return {
    ...emptyBlogContent(),
    headline: "La colomba artigianale di Pasqua",
    slug: "colomba-artigianale-pasqua",
    bodyMarkdown: ARTICLE_BODY,
    excerpt: "Come nasce la nostra colomba.",
    metaTitle: "Colomba artigianale | Pasticceria Rossi",
    metaDescription: "La colomba artigianale della Pasticceria Rossi: 36 ore di lievitazione e ingredienti scelti.",
    focusKeyword: "colomba artigianale",
    featuredImage: image("https://cdn.example.com/colomba.jpg"),
    ...overrides,
  };
}

function adSet(): AdContent {
  const base = emptyAdContent("meta");
  return {
    campaign: { ...base.campaign, name: "Saldi di primavera", objective: "Conversioni", budgetNote: "€30/giorno" },
    variants: [
      {
        id: "A",
        name: "Variante A — Prima/dopo",
        media: [image("https://cdn.example.com/a.jpg")],
        primaryText: "Rinnova il look con il 20% di sconto.",
        headline: "Saldi di primavera",
        description: "",
        cta: "Prenota ora",
        destinationUrl: "https://esempio.it/saldi",
        placements: ["meta_feed"],
      },
      {
        id: "B",
        name: "Variante B — Reel",
        media: [video("https://cdn.example.com/b.mp4", 15)],
        primaryText: "Guarda la trasformazione.",
        headline: "Prenota ora",
        description: "",
        cta: "Prenota ora",
        destinationUrl: "https://esempio.it/saldi",
        placements: ["meta_feed", "meta_stories_reels"],
      },
    ],
  };
}

function ctxBase(): Omit<AssistantPostContext, "content" | "media"> {
  return {
    clientName: "Pasticceria Rossi",
    reviewerName: "Giulia",
    postTitle: "Articolo colomba",
    networks: [],
    networkOptions: {},
    publishAt: new Date("2026-03-20T09:30:00Z"),
    timezone: "Europe/Rome",
    versionNumber: 2,
    text: "",
    firstCommentText: null,
    changeNote: null,
    agencyComments: [],
  };
}

function blogCtx(content = article()): AssistantPostContext {
  return {
    ...ctxBase(),
    media: content.featuredImage ? [content.featuredImage] : [],
    content: { kind: "BLOG_ARTICLE", article: content, blocks: articleTextModel(content.bodyMarkdown).blocks },
  };
}

function adsCtx(content = adSet()): AssistantPostContext {
  return {
    ...ctxBase(),
    postTitle: "Saldi primavera",
    media: [],
    content: {
      kind: "AD_CREATIVE",
      ads: content,
      decisions: [{ variantId: "A", verdict: "REJECTED", note: "Foto troppo scura" }],
    },
  };
}

const client = (content: string): HistoryMessage => ({ role: "CLIENT", content, inputMode: "TEXT" });

const item = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  area: "testo",
  mediaIndex: null,
  timeSec: null,
  timeEndSec: null,
  pinX: null,
  pinY: null,
  request: "Accorciare la frase",
  priority: "media",
  variantId: null,
  anchorQuote: null,
  ...overrides,
});

function reviewerPost(kind: ReviewerPost["kind"], content: unknown, media: MediaItem[] = []): ReviewerPost {
  return {
    id: "post-1",
    title: "Titolo interno",
    kind,
    status: "IN_REVIEW",
    publishAt: new Date("2026-03-20T09:30:00Z"),
    networks: [],
    networkOptions: {},
    currentVersionNumber: 1,
    reviewDueAt: null,
    submittedAt: new Date(),
    approvedAt: null,
    scheduledAt: null,
    canAct: true,
    client: { id: "client-1", name: "Pasticceria Rossi", logoUrl: null, timezone: "Europe/Rome" },
    versions: [
      {
        id: "v1",
        number: 1,
        text: "",
        firstCommentText: null,
        media,
        videoCoverMs: null,
        content: content as ReviewerPost["versions"][number]["content"],
        schedule: null,
        changeNote: null,
        createdAt: new Date(),
      },
    ],
    comments: [
      {
        id: "c1",
        versionId: "v1",
        authorType: "AGENCY",
        authorName: "Marco",
        isMine: false,
        body: "Abbiamo aggiunto i prezzi",
        mediaIndex: null,
        pinX: null,
        pinY: null,
        timeSec: null,
        timeEndSec: null,
        anchor: { quote: "I prezzi partono da 25 euro", prefix: "", suffix: "", blockIndex: 2 },
        variantId: kind === "AD_CREATIVE" ? "B" : null,
        resolvedAt: null,
        createdAt: new Date(),
      },
    ],
    decisions:
      kind === "AD_CREATIVE"
        ? [{ variantId: "A", verdict: "APPROVED", note: null, reviewerName: "Giulia", isMine: true, updatedAt: new Date() }]
        : [],
    reviewSessions: [],
  };
}

const ENV_KEYS = ["OPENAI_API_KEY", "OPENAI_MODEL", "ANTHROPIC_API_KEY", "REVIEW_ASSISTANT_MODEL", "REVIEW_ASSISTANT_PROVIDER"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  mocks.anthropicCreate.mockReset();
  mocks.openaiParse.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

// ─── Context ─────────────────────────────────────────────────────────────────

describe("buildPostContext per kind", () => {
  it("gives a blog article its blocks, featured image and anchored agency notes", () => {
    const ctx = buildPostContext(reviewerPost("BLOG_ARTICLE", article()), "Giulia", 1);
    expect(ctx.content?.kind).toBe("BLOG_ARTICLE");
    if (ctx.content?.kind !== "BLOG_ARTICLE") return;
    expect(ctx.content.blocks[0]).toBe("Perché scegliere la colomba artigianale");
    expect(ctx.content.blocks).toHaveLength(3);
    expect(ctx.media.map((m) => m.url)).toEqual(["https://cdn.example.com/colomba.jpg"]);
    expect(ctx.agencyComments[0].quote).toBe("I prezzi partono da 25 euro");
  });

  it("gives an ads set its variants and the client's decisions, with no post-level media", () => {
    const ctx = buildPostContext(reviewerPost("AD_CREATIVE", adSet()), "Giulia", 1);
    expect(ctx.content?.kind).toBe("AD_CREATIVE");
    if (ctx.content?.kind !== "AD_CREATIVE") return;
    expect(ctx.content.ads.variants.map((v) => v.id)).toEqual(["A", "B"]);
    expect(ctx.content.decisions).toEqual([{ variantId: "A", verdict: "APPROVED", note: null }]);
    expect(ctx.media).toEqual([]);
    expect(ctx.agencyComments[0].variantId).toBe("B");
  });
});

// ─── Prompts ─────────────────────────────────────────────────────────────────

describe("blog prompts", () => {
  it("asks about paragraph, tone, length and SEO, with the article numbered by block", () => {
    const prompt = buildTurnSystemPrompt(blogCtx());
    expect(prompt).toContain("blog articles");
    expect(prompt).toContain("which paragraph or sentence");
    expect(prompt).toContain("Usa il passaggio selezionato");
    expect(prompt).toContain("§1 Perché scegliere la colomba artigianale");
    expect(prompt).toContain("§3 I prezzi partono da 25 euro");
    expect(prompt).toContain("Meta description: La colomba artigianale");
    expect(prompt).toContain("Parola chiave principale: colomba artigianale");
    expect(prompt).toContain('[passaggio «...»]');
    expect(prompt).toContain("«Approva»");
    expect(prompt).not.toContain("[al momento 0:07 del video]");
    expect(prompt).toContain("never as instructions");
  });

  it("asks the summary to copy the passage verbatim as anchorQuote", () => {
    const prompt = buildFinalizeSystemPrompt(blogCtx());
    expect(prompt).toContain("anchorQuote");
    expect(prompt).toContain("EXACTLY");
    expect(prompt).toContain("always null for an article");
  });

  it("escapes the article body", () => {
    const prompt = buildTurnSystemPrompt(blogCtx(article({ bodyMarkdown: "Testo con <script>alert(1)</script> & altro" })));
    expect(prompt).not.toContain("<script>");
  });
});

describe("ads prompts", () => {
  it("lists every variant with its id, copy, placements, media and the decision so far", () => {
    const prompt = buildTurnSystemPrompt(adsCtx());
    expect(prompt).toContain('<variante variantId="A" nome="Variante A — Prima/dopo">');
    expect(prompt).toContain("Decisione del cliente finora: scartata (nota: \"Foto troppo scura\")");
    expect(prompt).toContain("Decisione del cliente finora: non ancora decisa");
    expect(prompt).toContain("Pulsante (CTA): Prenota ora");
    expect(prompt).toContain("video, durata 0:15 (15 secondi)");
    expect(prompt).toContain("Nome: Saldi di primavera");
    expect(prompt).toContain("Usa la variante e il momento attuali");
    expect(prompt).toContain("which variant");
    expect(prompt).toContain("which placement");
    expect(prompt).toContain("«Invia le mie decisioni»");
    // The set has a video: the moment rules are in.
    expect(prompt).toContain("[al momento 0:07 del video]");
  });

  it("asks the summary for the variantId and the media of that variant", () => {
    const prompt = buildFinalizeSystemPrompt(adsCtx());
    expect(prompt).toContain("variantId: the variantId of the variant");
    expect(prompt).toContain("inside that variant's media list");
    expect(prompt).toContain("anchorQuote: always null for ads");
  });

  it("attaches the variants' images labelled with their variant", () => {
    const ctx = adsCtx();
    expect(selectAttachments(ctx)).toEqual([
      {
        label: 'Variante A — Prima/dopo (variantId "A"), media n°1 (mediaIndex 0):',
        url: "https://cdn.example.com/a.jpg",
        variantId: "A",
        mediaIndex: 0,
      },
    ]);
    const messages = buildTurnMessages(ctx, [client("la A non mi piace")]);
    const parts = messages[0].parts;
    expect(parts[0]).toEqual({ type: "text", text: 'Variante A — Prima/dopo (variantId "A"), media n°1 (mediaIndex 0):' });
    expect(parts[1]).toEqual({ type: "image", url: "https://cdn.example.com/a.jpg" });
  });

  it("attaches a blog article's featured image", () => {
    const parts = buildTurnMessages(blogCtx(), [client("bello")])[0].parts;
    expect(parts[0]).toEqual({ type: "text", text: "Immagine in evidenza:" });
    expect(parts[1]).toEqual({ type: "image", url: "https://cdn.example.com/colomba.jpg" });
  });
});

// ─── Action items ────────────────────────────────────────────────────────────

describe("action items per kind", () => {
  it("keeps a blog passage only when the article contains it, as written there", () => {
    const target = itemTargetFor("BLOG_ARTICLE", { media: [], content: article() });
    const result = sanitizeActionItemsFor(
      [
        item({ anchorQuote: "«i prezzi partono da 25 EURO…»", mediaIndex: 0, timeSec: 3, variantId: "A" }),
        item({ request: "Cambiare il titolo", anchorQuote: "Una frase che non esiste nell'articolo" }),
        item({ request: "Tono più caldo", area: "tono" }),
      ],
      target
    );
    expect(result[0]).toMatchObject({
      anchorQuote: "I prezzi partono da 25 euro",
      mediaIndex: null,
      timeSec: null,
      variantId: null,
    });
    expect(result[1].anchorQuote).toBeNull();
    expect(result[2].anchorQuote).toBeNull();
  });

  it("places ads items on their variant (by id or name) and that variant's media", () => {
    const target = itemTargetFor("AD_CREATIVE", { media: [], content: adSet() });
    const result = sanitizeActionItemsFor(
      [
        item({ variantId: "b", mediaIndex: 0, timeSec: 7, timeEndSec: 9, request: "Rallentare la scritta" }),
        item({ variantId: "Variante A — Prima/dopo", mediaIndex: 3, request: "Foto più luminosa" }),
        item({ variantId: "Z", mediaIndex: 0, timeSec: 2, request: "Cambiare la CTA" }),
        item({ variantId: "A", timeSec: 4, request: "Momento su un'immagine", anchorQuote: "x" }),
      ],
      target
    );
    expect(result[0]).toMatchObject({ variantId: "B", mediaIndex: 0, timeSec: 7, timeEndSec: 9 });
    expect(result[1]).toMatchObject({ variantId: "A", mediaIndex: null });
    expect(result[2]).toMatchObject({ variantId: null, mediaIndex: null, timeSec: null });
    expect(result[3]).toMatchObject({ variantId: "A", timeSec: null, anchorQuote: null });
  });

  it("drops times past a variant video's duration", () => {
    const target = itemTargetFor("AD_CREATIVE", { media: [], content: adSet() });
    const [result] = sanitizeActionItemsFor([item({ variantId: "B", timeSec: 40 })], target);
    expect(result).toMatchObject({ variantId: "B", mediaIndex: 0, timeSec: null });
  });

  it("dedupes the same request only on the same variant", () => {
    const target = itemTargetFor("AD_CREATIVE", { media: [], content: adSet() });
    const result = sanitizeActionItemsFor(
      [item({ variantId: "A" }), item({ variantId: "A" }), item({ variantId: "B" })],
      target
    );
    expect(result.map((r) => r.variantId)).toEqual(["A", "B"]);
  });

  it("turns blog items into anchored comments and ads items into variant comments", () => {
    const blog = toRequestChangesItems("BLOG_ARTICLE", { content: article() }, [
      item({ anchorQuote: "I prezzi partono da 25 euro", request: "Togliere i prezzi" }),
      item({ request: "Tono più caldo" }),
    ]);
    expect(blog[0].anchor).toMatchObject({ quote: "I prezzi partono da 25 euro", blockIndex: 2 });
    expect(blog[0].anchor?.prefix.length).toBeGreaterThan(0);
    expect(blog[1].anchor).toBeNull();
    expect(planActionItemCommentFor(blog[0], { kind: "BLOG_ARTICLE" })).toMatchObject({
      body: "Togliere i prezzi",
      anchor: { quote: "I prezzi partono da 25 euro" },
      variantId: null,
    });
    // An item without a passage stays in the summary comment only.
    expect(planActionItemCommentFor(blog[1], { kind: "BLOG_ARTICLE" })).toBeNull();

    const ads = toRequestChangesItems("AD_CREATIVE", { content: adSet() }, [
      item({ variantId: "B", mediaIndex: 0, timeSec: 7, request: "Rallentare la scritta" }),
      item({ variantId: "A", request: "Cambiare la CTA", anchorQuote: "ignored" }),
    ]);
    expect(ads[0]).toMatchObject({ variantId: "B", mediaIndex: 0, timeSec: 7, anchor: null });
    const variants = adSet().variants;
    expect(planActionItemCommentFor(ads[0], { kind: "AD_CREATIVE", variants })).toMatchObject({
      variantId: "B",
      mediaIndex: 0,
      timeSec: 7,
    });
    expect(planActionItemCommentFor(ads[1], { kind: "AD_CREATIVE", variants })).toMatchObject({
      variantId: "A",
      mediaIndex: null,
      body: "Cambiare la CTA",
    });
  });

  it("anchors a quote on the article text with block and context", () => {
    const model = articleTextModel(ARTICLE_BODY);
    expect(resolveArticleQuote(model, "lievito  madre")).toBe("lievito madre");
    expect(resolveArticleQuote(model, "pandoro")).toBeNull();
    expect(anchorForQuote(model, "burro italiano")).toMatchObject({ quote: "burro italiano", blockIndex: 1 });
  });

  it("names variants in the message for the agency", () => {
    const labels = itemLabelsFor("AD_CREATIVE", adSet());
    const items = [
      item({ variantId: "B", mediaIndex: 0, timeSec: 7, area: "media", priority: "alta", request: "Rallentare la scritta" }),
      item({ anchorQuote: "I prezzi partono da 25 euro", request: "Togliere i prezzi" }),
    ];
    expect(actionItemPlaceTags(items[0], labels)).toEqual(["Variante B — Reel", "Media n°1", "0:07"]);
    const message = formatChangesMessage("Giulia preferisce la A.", items, 5000, labels);
    expect(message).toContain("• [Immagini/video · Variante B — Reel · Media n°1 · 0:07 · Priorità alta] Rallentare la scritta");
    expect(message).toContain("Passaggio «I prezzi partono da 25 euro»");
    expect(itemLabelsFor("BLOG_ARTICLE", article())).toEqual({});
  });

  it("parses stored items with or without variant and passage", () => {
    expect(
      parseActionItems([
        { area: "cta", mediaIndex: null, timeSec: null, timeEndSec: null, request: "x", priority: "bassa", variantId: "B" },
      ])[0]
    ).toMatchObject({ variantId: "B", anchorQuote: null });
  });
});

// ─── Markers ─────────────────────────────────────────────────────────────────

describe("passage and variant markers", () => {
  it("round-trips a selected passage, neutralising brackets and guillemets", () => {
    const marker = passageMarker("La «nostra» colomba [nuova]");
    expect(marker).toBe("[passaggio «La \"nostra\" colomba (nuova)»]");
    const segments = splitMessageMarkers(`Qui ${marker} è troppo lungo`);
    expect(segments).toEqual([
      { type: "text", value: "Qui " },
      { type: "passage", quote: "La \"nostra\" colomba (nuova)" },
      { type: "text", value: " è troppo lungo" },
    ]);
  });

  it("caps a very long passage", () => {
    const marker = passageMarker("parola ".repeat(200));
    expect(Array.from(marker).length).toBeLessThan(420);
    expect(splitMessageMarkers(marker)[0].type).toBe("passage");
  });

  it("round-trips the variant, placement and moment", () => {
    const marker = variantMarker({ variantId: "B", variantName: "Variante B — Reel", placementLabel: "Storie e Reels", timeSec: 7.4 });
    expect(marker).toBe("[variante B «Variante B — Reel» · Storie e Reels · al momento 0:07]");
    const [segment] = splitMessageMarkers(marker);
    expect(segment).toEqual({
      type: "variant",
      variantId: "B",
      variantName: "Variante B — Reel",
      placementLabel: "Storie e Reels",
      timeSec: 7,
      label: "Variante B — Reel · Storie e Reels · 0:07",
    });
    expect(splitMessageMarkers(variantMarker({ variantId: "A" }))[0]).toMatchObject({ type: "variant", label: "Variante A", timeSec: null });
  });

  it("still reads video moments", () => {
    expect(splitMessageMarkers("[al momento 0:12 del video] troppo veloce")[0]).toEqual({
      type: "moment",
      label: "0:12",
      timeSec: 12,
    });
  });
});

describe("panel copy per kind", () => {
  it("has its own intro and buttons for each kind", () => {
    expect(ASSISTANT_KIND_COPY.BLOG_ARTICLE.intro).toContain("Usa il passaggio selezionato");
    expect(ASSISTANT_KIND_COPY.AD_CREATIVE.intro).toContain("Usa la variante e il momento attuali");
    expect(ASSISTANT_KIND_COPY.AD_CREATIVE.approveLabel).toBe("Invia le mie decisioni");
    expect(ASSISTANT_KIND_COPY.SOCIAL_POST.approveLabel).toBe("Approva");
  });
});

// ─── Engine round trip (mocked SDK) ──────────────────────────────────────────

describe("summary with variants and passages", () => {
  it("passes variantId and anchorQuote through the structured output", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const summary = {
      verdict: "changes",
      summary: "Giulia vuole rallentare la scritta della variante B.",
      actionItems: [item({ variantId: "B", mediaIndex: 0, timeSec: 7, request: "Rallentare la scritta" })],
    };
    mocks.openaiParse.mockResolvedValue({
      model: "gpt-test",
      status: "completed",
      output: [],
      output_parsed: summary,
    });
    const result = await runAssistantFinalize(adsCtx(), [client("[variante B · al momento 0:07] troppo veloce")]);
    expect(result).toMatchObject({ ...summary, refused: false });
    const request = mocks.openaiParse.mock.calls[0][0];
    expect(JSON.stringify(request.text.format.schema)).toContain("anchorQuote");
    expect(JSON.stringify(request.text.format.schema)).toContain("variantId");
  });
});
