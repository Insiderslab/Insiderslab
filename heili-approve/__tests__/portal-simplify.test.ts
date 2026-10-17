import { describe, expect, it } from "vitest";
import { firstOfList, messageLooksLong } from "@/components/portal/helpers";
import { guideStatusSentence } from "@/components/portal/heili/rules";
import { channelsLabel } from "@/components/portal/month/month-grid";
import { MONTH_VIEW_LABELS, parseMonthView, parsePostReturn, planViews, postLinkQuery, viewPath } from "@/lib/month-rules";
import { isInstagramFeedPost } from "@/lib/plan-rules";
import { instagramFormatOf } from "@/lib/posts";

/** Portal simplification of 17/10/2026 (docs/notte/PORTALE-2026-10-17.md). */

describe("K-09: the agency's message of a plan in four lines", () => {
  it("offers «Leggi tutto» only when the message is long", () => {
    expect(messageLooksLong("Ecco il piano di novembre. Buona revisione!")).toBe(false);
    expect(messageLooksLong("uno\ndue\ntre\nquattro")).toBe(false);
    expect(messageLooksLong("uno\ndue\ntre\nquattro\ncinque")).toBe(true);
    expect(messageLooksLong("parola ".repeat(40))).toBe(true);
    // Trailing blank lines do not count.
    expect(messageLooksLong("uno\ndue\n\n\n\n")).toBe(false);
  });
});

describe("K-13: Griglia and Anteprima Instagram are two different views", () => {
  it("offers «Anteprima Instagram» only for a plan with Instagram feed posts", () => {
    expect(planViews(true)).toEqual(["panoramica", "griglia", "instagram", "sfoglia"]);
    expect(planViews(false)).toEqual(["panoramica", "griglia", "sfoglia"]);
    expect(parseMonthView("instagram", { allowed: planViews(false) })).toBe("panoramica");
    expect(viewPath("/review/t/piani/p", "instagram")).toBe("/review/t/piani/p?vista=instagram");
    expect(MONTH_VIEW_LABELS.instagram).toBe("Anteprima Instagram");
  });

  it("keeps in the Instagram preview only feed posts: posts, carousels and Reels, not Stories nor other networks", () => {
    expect(isInstagramFeedPost({ networks: ["instagram"], instagramFormat: "POST" })).toBe(true);
    expect(isInstagramFeedPost({ networks: ["instagram", "facebook"], instagramFormat: "REEL" })).toBe(true);
    expect(isInstagramFeedPost({ networks: ["instagram"], instagramFormat: "STORY" })).toBe(false);
    expect(isInstagramFeedPost({ networks: ["facebook"], instagramFormat: null })).toBe(false);
    expect(instagramFormatOf(["instagram"], { instagramData: { type: "STORY" } })).toBe("STORY");
    expect(instagramFormatOf(["instagram"], {})).toBe("POST");
    expect(instagramFormatOf(["facebook"], { instagramData: { type: "REEL" } })).toBeNull();
  });

  it("says in the grid where each content goes", () => {
    expect(channelsLabel(["instagram", "facebook"], "POST")).toBe("Instagram · Facebook");
    expect(channelsLabel(["instagram"], "REEL")).toBe("Instagram Reel");
    expect(channelsLabel(["instagram"], "STORY")).toBe("Instagram Storia");
    expect(channelsLabel(["linkedin"], null)).toBe("LinkedIn");
  });

  it("brings a post opened from the Instagram preview back there", () => {
    expect(postLinkQuery("instagram")).toBe("?da=instagram");
    expect(parsePostReturn({ da: "instagram" })).toEqual({ da: "instagram", i: null, mese: null });
    expect(guideStatusSentence({ page: "plan-instagram", title: "Piano social di novembre" })).toBe(
      "Sei nell'anteprima Instagram del piano social di novembre."
    );
  });
});

describe("K-11 / QA-12: a long home shows the first contents and keeps the others one tap away", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("splits a long list without dropping anything", () => {
    const { shown, more } = firstOfList(items(59));
    expect(shown).toEqual(items(10));
    expect(more).toHaveLength(49);
    expect([...shown, ...more]).toEqual(items(59));
  });

  it("shows a short list, or one just over the limit, whole", () => {
    expect(firstOfList(items(3))).toEqual({ shown: items(3), more: [] });
    expect(firstOfList(items(12))).toEqual({ shown: items(12), more: [] });
    expect(firstOfList(items(13)).more).toEqual([11, 12, 13]);
  });
});
