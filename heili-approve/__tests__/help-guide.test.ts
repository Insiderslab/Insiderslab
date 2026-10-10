import { describe, expect, it } from "vitest";
import { helpTopics, suggestedHelpTopics } from "@/lib/help/catalog";

describe("help guide catalog", () => {
  it("strictly separates client and agency guidance", () => {
    const client = helpTopics({ audience: "client", services: ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"] });
    const agency = helpTopics({ audience: "agency", services: ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"] });

    expect(client.some((topic) => topic.id === "agency-import")).toBe(false);
    expect(client.every((topic) => topic.audience === "client")).toBe(true);
    expect(agency.some((topic) => topic.id === "agency-import")).toBe(true);
    expect(agency.every((topic) => topic.audience === "agency")).toBe(true);
  });

  it("filters content guidance by the active client services", () => {
    const blogOnly = helpTopics({ audience: "client", services: ["BLOG_ARTICLE"] });
    expect(blogOnly.some((topic) => topic.id === "client-blog")).toBe(true);
    expect(blogOnly.some((topic) => topic.id === "client-review-social")).toBe(false);
    expect(blogOnly.some((topic) => topic.id === "client-ads")).toBe(false);
    expect(blogOnly.some((topic) => topic.id === "client-comments")).toBe(true);
  });

  it("finds topics from simple natural questions without accents", () => {
    expect(helpTopics({ audience: "client", services: ["SOCIAL_POST"], query: "come chiedo una modifica?" }).map((topic) => topic.id)).toContain("client-comments");
    expect(helpTopics({ audience: "client", services: ["SOCIAL_POST"], query: "come approvo il piano?" }).map((topic) => topic.id)).toContain("client-plan");
    expect(helpTopics({ audience: "client", services: ["SOCIAL_POST"], query: "vorrei sapere come approvare un post" }).map((topic) => topic.id)).toContain("client-review-social");
    expect(helpTopics({ audience: "agency", services: ["SOCIAL_POST"], query: "dove importo l excel con codex" }).map((topic) => topic.id)).toEqual(["agency-import"]);
    expect(helpTopics({ audience: "agency", services: ["SOCIAL_POST"], query: "non riesco a importare l’Excel" }).map((topic) => topic.id)).toContain("agency-import");
  });

  it("prioritizes help related to the current route", () => {
    const topics = helpTopics({ audience: "agency", services: ["SOCIAL_POST"] });
    expect(suggestedHelpTopics(topics, "/plans/plan-1")[0]?.id).toBe("agency-plans");
    expect(suggestedHelpTopics(topics, "/settings")[0]?.id).toBe("agency-import");
  });
});
