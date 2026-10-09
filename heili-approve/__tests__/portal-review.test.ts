import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The pages' client components, rendered on the server without Next's router
// or the server actions (no database).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/review/[token]/actions", () => ({
  addCommentAction: vi.fn(),
  approvePostAction: vi.fn(),
  decideVariantAction: vi.fn(),
  finalizeDecisionsAction: vi.fn(),
  requestChangesAction: vi.fn(),
}));

import AdsReview from "@/components/portal/ads-review";
import BlogReview from "@/components/portal/blog-review";
import PostCard from "@/components/portal/post-card";
import PostReview from "@/components/portal/post-review";
import { savedFeedbackBlocker } from "@/components/portal/review-pieces";
import type { PortalAdsPost, PortalBlogPost, PortalPost, PortalQueue } from "@/components/portal/types";
import { emptyAdContent } from "@/lib/content/ads";
import { emptyBlogContent, renderMarkdownSafe } from "@/lib/content/blog";

const queue: PortalQueue = { nextPostId: "next", toReviewCount: 2, position: 1 };
const now = new Date("2026-10-05T10:00:00Z");

const base = {
  id: "p1",
  title: "Titolo interno",
  status: "IN_REVIEW" as const,
  canAct: true,
  versionNumber: 2,
  versionId: "v2",
  publishLabel: "mercoledì 7 ottobre alle 18:30",
  reviewDueLabel: null,
  approvedLabel: null,
  timeZone: "Europe/Rome",
};

function blogPost(overrides: Partial<PortalBlogPost> = {}): PortalBlogPost {
  const content = {
    ...emptyBlogContent(),
    headline: "La colomba artigianale",
    bodyMarkdown: "Primo paragrafo con la colomba.\n\nSecondo paragrafo sui prezzi.",
    metaTitle: "Colomba | Rossi",
  };
  return {
    ...base,
    kind: "BLOG_ARTICLE",
    dateLabel: "Pubblicazione prevista",
    content,
    html: renderMarkdownSafe(content.bodyMarkdown),
    articleDateLabel: "mercoledì 7 ottobre",
    comments: [
      {
        id: "c1",
        authorType: "CLIENT",
        authorName: "Giulia",
        isMine: true,
        body: "Più corto",
        mediaIndex: null,
        pinX: null,
        pinY: null,
        timeSec: null,
        timeEndSec: null,
        anchor: { quote: "Secondo paragrafo", prefix: "", suffix: " sui prezzi", blockIndex: 1 },
        variantId: null,
        resolved: false,
        createdAt: now,
        createdLabel: "5 ott, 12:00",
        number: 1,
        placement: "exact",
        fromVersion: null,
      },
    ],
    ...overrides,
  };
}

function adsPost(overrides: Partial<PortalAdsPost> = {}): PortalAdsPost {
  const content = emptyAdContent("meta");
  return {
    ...base,
    kind: "AD_CREATIVE",
    dateLabel: "Inizio campagna",
    content: {
      campaign: { ...content.campaign, name: "Saldi di primavera", objective: "Conversioni", budgetNote: "€30/giorno" },
      variants: ["A", "B", "C"].map((id) => ({
        id,
        name: `Variante ${id}`,
        media: [{ url: `https://cdn.example.com/${id}.jpg`, type: "image" as const, mimeType: "image/jpeg" }],
        primaryText: `Testo ${id}`,
        headline: "Saldi",
        description: "",
        cta: "Prenota ora",
        destinationUrl: "https://esempio.it",
        placements: ["meta_feed" as const],
      })),
    },
    decisions: {
      A: { verdict: "APPROVED", note: null, isMine: true, reviewerName: "Giulia" },
      C: { verdict: "REJECTED", note: "Troppo scura", isMine: true, reviewerName: "Giulia" },
    },
    comments: [],
    ...overrides,
  };
}

describe("BlogReview", () => {
  it("shows the article, the numbered passage comment, the decision buttons and the assistant", () => {
    const html = renderToStaticMarkup(
      createElement(BlogReview, {
        token: "tok",
        post: blogPost(),
        queue,
        listKinds: ["BLOG_ARTICLE"],
        assistantEnabled: true,
        seoSlot: createElement("p", null, "Dettagli per i motori di ricerca"),
      })
    );
    expect(html).toContain("Articolo");
    expect(html).toContain("La colomba artigianale");
    expect(html).toContain("Pubblicazione prevista: </span>");
    expect(html).toContain("Note sul testo");
    expect(html).toContain("«Secondo paragrafo»");
    expect(html).toContain("Mostra nel testo");
    expect(html).toContain("Chiedi modifiche");
    expect(html).toContain(">Approva<");
    expect(html).toContain("Parla con Heili");
    expect(html).toContain("Dettagli per i motori di ricerca");
    expect(html).toContain("Tutti gli articoli");
    expect(html).toContain("Articolo 1 di 2 da approvare");
  });

  it("is read-only once approved", () => {
    const html = renderToStaticMarkup(
      createElement(BlogReview, {
        token: "tok",
        post: blogPost({ status: "APPROVED", canAct: false, approvedLabel: "ieri" }),
        queue: { ...queue, position: null },
        listKinds: ["BLOG_ARTICLE"],
        assistantEnabled: true,
      })
    );
    expect(html).toContain("Hai approvato questo articolo ieri");
    expect(html).not.toContain("Chiedi modifiche");
    expect(html).not.toContain("Parlane con l&#x27;assistente");
  });
});

describe("AdsReview", () => {
  it("shows the campaign, one card per variant, the progress and the send button", () => {
    const html = renderToStaticMarkup(
      createElement(AdsReview, {
        token: "tok",
        post: adsPost(),
        client: { name: "Rossi Srl", logoUrl: null },
        queue,
        listKinds: ["AD_CREATIVE"],
        assistantEnabled: true,
      })
    );
    expect(html).toContain("Creatività ads");
    expect(html).toContain("Saldi di primavera");
    expect(html).toContain("€30/giorno");
    expect(html).toContain("2 di 3 varianti decise");
    expect(html).toContain("manca Variante B");
    expect(html).toContain('id="variante-A"');
    expect(html).toContain('id="variante-B"');
    expect(html).toContain('id="variante-C"');
    expect(html).toContain("Invia le mie decisioni");
    expect(html).toContain("Inizio campagna: </span>");
    expect(html).toContain("Prossimo contenuto");
    // Incomplete: the send button is disabled.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Invia le mie decisioni<\/button>/);
  });

  it("enables sending once every variant is decided", () => {
    const html = renderToStaticMarkup(
      createElement(AdsReview, {
        token: "tok",
        post: adsPost({
          decisions: {
            A: { verdict: "APPROVED", note: null, isMine: true, reviewerName: null },
            B: { verdict: "APPROVED", note: null, isMine: true, reviewerName: null },
            C: { verdict: "REJECTED", note: "No", isMine: true, reviewerName: null },
          },
        }),
        client: { name: "Rossi Srl", logoUrl: null },
        queue,
        listKinds: ["AD_CREATIVE"],
        assistantEnabled: false,
      })
    );
    expect(html).toContain("3 di 3 varianti decise");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Invia le mie decisioni<\/button>/);
    expect(html).not.toContain("Parlane con l&#x27;assistente");
  });
});

describe("PostReview (social) keeps its wording", () => {
  it("renders the original navigation and buttons", () => {
    const post: PortalPost = {
      ...base,
      networks: ["instagram"],
      networkOptions: {},
      text: "La nuova colomba!",
      firstCommentText: null,
      media: [],
      publishAt: now,
      comments: [],
    };
    const html = renderToStaticMarkup(
      createElement(PostReview, {
        token: "tok",
        post,
        client: { name: "Rossi", logoUrl: null, autoSchedule: true },
        queue,
        assistantEnabled: false,
        publishInPast: false,
      })
    );
    expect(html).toContain("Tutti i post");
    expect(html).toContain("Post 1 di 2 da approvare");
    expect(html).toContain("Prossimo post");
    expect(html).toContain("Pubblicazione: </span>");
    expect(html).not.toContain("Post social");
  });

  it("puts the preview before collapsed details and keeps the complete copy accessible", () => {
    const post: PortalPost = {
      ...base,
      networks: ["instagram"],
      networkOptions: {},
      text: "Prima riga\nSeconda riga completa",
      firstCommentText: "Link e dettagli nel primo commento",
      media: [],
      publishAt: now,
      comments: [],
    };
    const html = renderToStaticMarkup(
      createElement(PostReview, {
        token: "tok",
        post,
        client: { name: "Rossi", logoUrl: null, autoSchedule: true },
        queue,
        assistantEnabled: false,
        publishInPast: false,
        changesSlot: createElement("div", { "data-testid": "changes-content" }, "Differenze complete"),
      })
    );

    const previewAt = html.indexOf('aria-label="Anteprima del post"');
    const fullTextAt = html.indexOf("Leggi il testo completo");
    const changesAt = html.indexOf("Modifiche dalla versione precedente");
    const changesContentAt = html.indexOf('data-testid="changes-content"');

    expect(previewAt).toBeGreaterThan(-1);
    expect(fullTextAt).toBeGreaterThan(previewAt);
    expect(changesAt).toBeGreaterThan(fullTextAt);
    expect(changesContentAt).toBeGreaterThan(changesAt);
    expect(html).toContain("Prima riga\nSeconda riga completa");
    expect(html).toContain("Primo commento");
    expect(html).toContain("Link e dettagli nel primo commento");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain('aria-label="Navigazione della revisione"');
    expect(html).toContain('aria-label="Tutti i post"');
    expect(html).toContain('aria-label="Prossimo post"');
  });
});

describe("PostCard", () => {
  const card = {
    id: "p1",
    title: "Saldi",
    status: "IN_REVIEW" as const,
    canAct: true,
    networks: [],
    versionNumber: 1,
    cover: null,
    mediaCount: 0,
    excerpt: "",
    publishLabel: "lunedì 12 ottobre alle 09:00",
    reviewDueLabel: null,
  };

  it("says what each item is and labels the date per kind", () => {
    const ads = renderToStaticMarkup(
      createElement(PostCard, { post: { ...card, kind: "AD_CREATIVE", variantCount: 3 }, href: "/x" })
    );
    expect(ads).toContain("Creatività ads");
    expect(ads).toContain("Inizio campagna: </span>");
    expect(ads).toContain("3 varianti · Versione 1");

    const blog = renderToStaticMarkup(
      createElement(PostCard, { post: { ...card, kind: "BLOG_ARTICLE", variantCount: null }, href: "/x" })
    );
    expect(blog).toContain("Articolo");
    expect(blog).toContain("Pubblicazione prevista: </span>");

    const social = renderToStaticMarkup(
      createElement(PostCard, {
        post: { ...card, kind: "SOCIAL_POST", variantCount: null, networks: ["instagram", "facebook"] },
        href: "/x",
      })
    );
    expect(social).toContain("Post social");
    expect(social).toContain("Instagram · Facebook · Versione 1");
    expect(social).toContain("Pubblicazione: </span>");
  });
});

describe("saved feedback submission", () => {
  it("guides an unsaved draft before checking stored comments", () => {
    expect(savedFeedbackBlocker(true, 2)).toContain("commento ancora da inviare");
  });

  it("blocks an empty request and allows saved feedback", () => {
    expect(savedFeedbackBlocker(false, 0)).toContain("Non hai ancora indicato modifiche");
    expect(savedFeedbackBlocker(false, 1)).toBeNull();
  });

  it("keeps the change-request confirmation visible after refresh", () => {
    const socialPost: PortalPost = {
      ...base,
      status: "CHANGES_REQUESTED",
      canAct: false,
      networks: ["instagram"],
      networkOptions: {},
      text: "La nuova colomba!",
      firstCommentText: null,
      media: [],
      publishAt: now,
      comments: [],
    };
    const social = renderToStaticMarkup(
      createElement(PostReview, {
        token: "tok",
        post: socialPost,
        client: { name: "Rossi", logoUrl: null, autoSchedule: true },
        queue: { ...queue, position: null },
        assistantEnabled: false,
        publishInPast: false,
      })
    );
    const blog = renderToStaticMarkup(
      createElement(BlogReview, {
        token: "tok",
        post: blogPost({ status: "CHANGES_REQUESTED", canAct: false }),
        queue: { ...queue, position: null },
        listKinds: ["BLOG_ARTICLE"],
        assistantEnabled: false,
      })
    );
    const ads = renderToStaticMarkup(
      createElement(AdsReview, {
        token: "tok",
        post: adsPost({ status: "CHANGES_REQUESTED", canAct: false }),
        client: { name: "Rossi Srl", logoUrl: null },
        queue: { ...queue, position: null },
        listKinds: ["AD_CREATIVE"],
        assistantEnabled: false,
      })
    );

    expect(social).toContain("Modifiche inviate all&#x27;agenzia");
    expect(blog).toContain("Modifiche inviate all&#x27;agenzia");
    expect(ads).toContain("Modifiche inviate all&#x27;agenzia");
    expect(social).toContain('role="status"');
    expect(blog).toContain('role="status"');
    expect(ads).toContain('role="status"');
    expect(blog).not.toContain("Cosa vorresti cambiare?");
    expect(ads).not.toContain("Cosa vorresti cambiare?");
  });
});
