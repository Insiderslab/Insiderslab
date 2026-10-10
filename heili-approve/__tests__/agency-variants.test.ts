/**
 * Agency panel helpers for the blog / ads variants (components/posts/helpers,
 * components/clients/helpers): wording per kind, commands per kind, status
 * filters per kind, comment threads on passages and variants, timeline lines.
 */

import { describe, expect, it } from "vitest";
import { statusCountEntries } from "@/components/clients/helpers";
import {
  availableCommands,
  buildCommentThreads,
  buildPostsHref,
  contentWords,
  describeEvent,
  editWarning,
  newContentHref,
  statusesForKinds,
  type CommentLike,
} from "@/components/posts/helpers";

function comment(patch: Partial<CommentLike> & { id: string }): CommentLike {
  return {
    versionId: "v1",
    authorType: "CLIENT",
    body: "x",
    mediaIndex: null,
    pinX: null,
    pinY: null,
    timeSec: null,
    timeEndSec: null,
    resolvedAt: null,
    createdAt: new Date("2026-10-06T10:00:00Z"),
    anchor: null,
    variantId: null,
    ...patch,
  };
}

describe("contentWords", () => {
  it("names the items of a single-kind instance", () => {
    expect(contentWords(["SOCIAL_POST"]).the).toBe("i post");
    expect(contentWords(["BLOG_ARTICLE"]).all).toBe("Tutti gli articoli");
    expect(contentWords(["AD_CREATIVE"]).all).toBe("Tutte le creatività ads");
  });
  it("falls back to 'contenuti' when kinds are mixed", () => {
    expect(contentWords(["SOCIAL_POST", "BLOG_ARTICLE"]).plural).toBe("contenuti");
  });
});

describe("availableCommands per kind", () => {
  it("social posts are scheduled, never delivered", () => {
    expect(availableCommands("APPROVED", "SOCIAL_POST")).toEqual(["schedule", "cancel"]);
    expect(availableCommands("FAILED", "SOCIAL_POST")).toContain("retry");
  });
  it("articles and ad sets are delivered by hand, never scheduled", () => {
    expect(availableCommands("APPROVED", "BLOG_ARTICLE")).toEqual(["deliver", "cancel"]);
    expect(availableCommands("APPROVED", "AD_CREATIVE")).toEqual(["deliver", "cancel"]);
    expect(availableCommands("DELIVERED", "BLOG_ARTICLE")).toEqual([]);
  });
  it("defaults to social (existing callers)", () => {
    expect(availableCommands("APPROVED")).toEqual(["schedule", "cancel"]);
  });
});

describe("statusesForKinds", () => {
  it("hides Metricool statuses on blog/ads-only instances", () => {
    const statuses = statusesForKinds(["BLOG_ARTICLE"]);
    expect(statuses).toContain("DELIVERED");
    expect(statuses).not.toContain("SCHEDULED");
    expect(statuses).not.toContain("FAILED");
  });
  it("hides DELIVERED on social-only instances", () => {
    const statuses = statusesForKinds(["SOCIAL_POST"]);
    expect(statuses).toContain("SCHEDULED");
    expect(statuses).not.toContain("DELIVERED");
  });
});

describe("statusCountEntries", () => {
  it("counts DELIVERED and words it for the kind", () => {
    expect(statusCountEntries({ DELIVERED: 2 }, "BLOG_ARTICLE")).toEqual([
      { status: "DELIVERED", count: 2, label: "Pubblicato" },
    ]);
    expect(statusCountEntries({ DELIVERED: 1 })[0].label).toBe("Consegnato");
  });
});

describe("links", () => {
  it("keeps the kind in the list URL and in /posts/new", () => {
    expect(buildPostsHref({ kind: "blog", status: "IN_REVIEW" })).toBe("/posts?kind=blog&status=IN_REVIEW");
    expect(newContentHref("AD_CREATIVE", { clientId: "c1", day: "2026-10-07" })).toBe(
      "/posts/new?kind=ads&clientId=c1&data=2026-10-07"
    );
    expect(newContentHref(null, { day: "2026-10-07" })).toBe("/posts/new?data=2026-10-07");
  });
});

describe("comment threads on passages and variants", () => {
  const anchor = { quote: "la torta di mele", prefix: "Oggi ", suffix: " è pronta", blockIndex: 2 };

  it("an agency reply on the same passage joins the thread", () => {
    const threads = buildCommentThreads([
      comment({ id: "a", anchor }),
      comment({ id: "b", anchor, authorType: "AGENCY", createdAt: new Date("2026-10-06T11:00:00Z") }),
      comment({ id: "c", anchor: { ...anchor, quote: "altro" } }),
    ]);
    expect(threads.map((t) => [t.id, t.replies.map((r) => r.id)])).toEqual([
      ["a", ["b"]],
      ["c", []],
    ]);
  });

  it("the same pin on two variants are two threads", () => {
    const pin = { mediaIndex: 0, pinX: 0.5, pinY: 0.5 };
    const threads = buildCommentThreads([
      comment({ id: "a", variantId: "A", ...pin }),
      comment({ id: "b", variantId: "B", ...pin }),
      comment({ id: "c", variantId: "A", ...pin, authorType: "AGENCY", createdAt: new Date("2026-10-06T12:00:00Z") }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("wording per kind", () => {
  it("edit warnings and timeline lines name the item", () => {
    expect(editWarning("APPROVED", "BLOG_ARTICLE")).toMatch(/^L'articolo è già approvato/);
    expect(describeEvent({ type: "DELIVERED", versionNumber: 2, metadata: {} }, "Europe/Rome", "BLOG_ARTICLE").title).toBe(
      "L'agenzia ha segnato l'articolo come pubblicato (versione 2)"
    );
    const rejected = describeEvent(
      { type: "VARIANT_DECIDED", versionNumber: 1, metadata: { variantName: "Variante B", verdict: "REJECTED", note: "Troppo scura" } },
      "Europe/Rome",
      "AD_CREATIVE"
    );
    expect(rejected.tone).toBe("warning");
    expect(rejected.details).toContain("Nota: Troppo scura");
  });
});
