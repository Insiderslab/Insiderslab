import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ posts: [] as unknown[], plans: [] as unknown[] }));
vi.mock("@/lib/posts", () => ({ listPostsForReviewer: async () => data.posts }));
vi.mock("@/lib/plans", () => ({ listPlansForReviewer: async () => data.plans }));
vi.mock("@/lib/clients", () => ({ clientServices: () => ["SOCIAL_POST", "BLOG_ARTICLE"] }));
vi.mock("@/app/review/[token]/reviewer", () => ({ getPortalReviewer: async () => ({
  id: "r", clientId: "c", name: "Giulia", client: { timezone: "Europe/Rome" },
}) }));
import ReviewHomePage from "@/app/review/[token]/page";

const post = (id: string, planId: string | null, kind = "SOCIAL_POST") => ({
  id, planId, kind, title: `Contenuto ${id}`, status: "IN_REVIEW", canAct: true,
  networks: kind === "SOCIAL_POST" ? ["instagram"] : [], currentVersionNumber: 1,
  cover: null, mediaCount: 0, variantCount: null, excerpt: "Testo di esempio",
  publishAt: new Date("2026-10-30T12:00:00Z"), reviewDueAt: null,
});
async function render(tipo?: string) {
  return renderToStaticMarkup(await ReviewHomePage({ params: Promise.resolve({ token: "test" }), searchParams: Promise.resolve({ tipo }) }));
}
beforeEach(() => {
  data.posts = [post("nel-piano", "piano"), post("singolo", null), post("articolo", null, "BLOG_ARTICLE")];
  data.plans = [{ id: "piano", month: "2026-10", kind: "SOCIAL_POST", posts: [{ status: "IN_REVIEW" }] }];
});
describe("portal plans and standalone content", () => {
  it("keeps the total count but shows each review path only once", async () => {
    const html = await render();
    expect(html).toContain("Ci sono 3 contenuti");
    expect(html).toContain("Rivedi il piano del mese");
    expect(html).not.toContain("Contenuto nel-piano");
    expect(html).toContain("Contenuto singolo");
    expect(html).toContain("Contenuto articolo");
  });
  it("does not hide a post just because its plan has no visible portal card", async () => {
    data.plans = [];
    expect(await render()).toContain("Contenuto nel-piano");
  });
  it("keeps the article filter free of social plan cards", async () => {
    const html = await render("blog");
    expect(html).toContain("Contenuto articolo");
    expect(html).not.toContain("portal-plan-card");
    expect(html).not.toContain("Contenuto singolo");
  });
});
