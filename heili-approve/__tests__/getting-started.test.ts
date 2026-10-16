import { describe, expect, it } from "vitest";
import { agencyGuideQuestions, agencyGuideSteps } from "@/lib/help/agency-guide";
import {
  gettingStartedProgress,
  gettingStartedStorageKey,
  gettingStartedSteps,
  nextGettingStartedStep,
  readGettingStartedDismissed,
  showGettingStarted,
  writeGettingStartedDismissed,
  type GettingStartedFacts,
} from "@/lib/help/getting-started";
import { PORTAL_INTRO_STEPS, markPortalIntroSeen, portalIntroSeen, portalIntroStorageKey } from "@/lib/help/portal-intro";

const NONE: GettingStartedFacts = { clients: 0, posts: 0, submitted: 0, approved: 0 };
const ALL = ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"] as const;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("«Per iniziare»: steps from the workspace's real data", () => {
  it("starts from the client and ticks each step from its own fact", () => {
    const steps = gettingStartedSteps(NONE, ALL);
    expect(steps.map((step) => step.id)).toEqual(["client", "post", "submit", "approval"]);
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(nextGettingStartedStep(steps)?.id).toBe("client");
    expect(nextGettingStartedStep(steps)?.action.href).toBe("/clients/new");

    const afterPost = gettingStartedSteps({ clients: 1, posts: 2, submitted: 0, approved: 0 }, ALL);
    expect(afterPost.map((step) => step.done)).toEqual([true, true, false, false]);
    expect(nextGettingStartedStep(afterPost)?.id).toBe("submit");
    expect(gettingStartedProgress(afterPost)).toEqual({ done: 2, total: 4 });
  });

  it("follows the facts, not the order: a later step done earlier stays done", () => {
    // E.g. posts imported by a colleague before anyone added a second client.
    const steps = gettingStartedSteps({ clients: 0, posts: 1, submitted: 1, approved: 0 }, ALL);
    expect(steps.map((step) => step.done)).toEqual([false, true, true, false]);
    expect(nextGettingStartedStep(steps)?.id).toBe("client");
  });

  it("disappears by itself once every step is done, closed or not", () => {
    const done = gettingStartedSteps({ clients: 3, posts: 10, submitted: 8, approved: 5 }, ALL);
    expect(nextGettingStartedStep(done)).toBeNull();
    expect(showGettingStarted(done, false)).toBe(false);
    expect(showGettingStarted(done, true)).toBe(false);

    const halfway = gettingStartedSteps({ clients: 1, posts: 0, submitted: 0, approved: 0 }, ALL);
    expect(showGettingStarted(halfway, false)).toBe(true);
    expect(showGettingStarted(halfway, true)).toBe(false);
  });

  it("offers the sheet import only where social posts exist, and names the kind", () => {
    const social = gettingStartedSteps(NONE, ["SOCIAL_POST"]);
    const post = social.find((step) => step.id === "post")!;
    expect(post.title).toBe("Crea o importa il primo post");
    expect(post.action).toEqual({ label: "Nuovo post", href: "/posts/new" });
    expect(post.secondary).toEqual({ label: "Importa da un foglio", href: "/posts/import" });

    const blog = gettingStartedSteps(NONE, ["BLOG_ARTICLE"]).find((step) => step.id === "post")!;
    expect(blog.title).toBe("Crea o importa il primo articolo");
    expect(blog.secondary).toBeUndefined();
    expect(blog.text).not.toMatch(/foglio/);

    const mixed = gettingStartedSteps(NONE, ALL).find((step) => step.id === "post")!;
    expect(mixed.title).toBe("Crea o importa il primo contenuto");
    expect(mixed.action.href).toBe("/posts/new");
  });

  it("points every step at an agency page", () => {
    for (const step of gettingStartedSteps(NONE, ALL)) {
      for (const link of [step.action, step.secondary].filter(Boolean)) {
        expect(link!.href).toMatch(/^\/(clients|posts)(\/|\?|$)/);
      }
    }
  });
});

describe("«Per iniziare»: closing it in this browser", () => {
  it("remembers the choice per workspace", () => {
    const storage = memoryStorage();
    expect(readGettingStartedDismissed(storage, "ws-1")).toBe(false);
    expect(writeGettingStartedDismissed(storage, "ws-1")).toBe(true);
    expect(readGettingStartedDismissed(storage, "ws-1")).toBe(true);
    expect(readGettingStartedDismissed(storage, "ws-2")).toBe(false);
    expect([...storage.map.keys()]).toEqual([gettingStartedStorageKey("ws-1")]);
  });

  it("never throws when the browser blocks storage: the list simply shows again", () => {
    expect(readGettingStartedDismissed(throwing, "ws-1")).toBe(false);
    expect(writeGettingStartedDismissed(throwing, "ws-1")).toBe(false);
    expect(readGettingStartedDismissed(null, "ws-1")).toBe(false);
    expect(writeGettingStartedDismissed(undefined, "ws-1")).toBe(false);
  });
});

describe("client intro: three steps, once per link", () => {
  it("uses the client's words", () => {
    expect(PORTAL_INTRO_STEPS.map((step) => step.title)).toEqual([
      "Guarda i contenuti",
      "Approva o scrivi cosa cambiare",
      "Fatto, ci pensiamo noi",
    ]);
    expect(JSON.stringify(PORTAL_INTRO_STEPS)).not.toMatch(/creativit|\bads\b/i);
  });

  it("is seen once per link and treats a blocked storage as seen", () => {
    const storage = memoryStorage();
    expect(portalIntroSeen(storage, "tok")).toBe(false);
    expect(markPortalIntroSeen(storage, "tok")).toBe(true);
    expect(portalIntroSeen(storage, "tok")).toBe(true);
    expect(portalIntroSeen(storage, "other")).toBe(false);
    // Same key as the home's first-visit steps had: returning clients are not asked again.
    expect(portalIntroStorageKey("tok")).toBe("portal.howto.tok");
    expect(portalIntroSeen(throwing, "tok")).toBe(true);
    expect(portalIntroSeen(null, "tok")).toBe(true);
    expect(markPortalIntroSeen(throwing, "tok")).toBe(false);
  });
});

describe("agency «Guida»", () => {
  it("has 5–7 short steps plus MCP, each with a link into the app", () => {
    for (const kinds of [ALL, ["SOCIAL_POST"], ["BLOG_ARTICLE"], ["AD_CREATIVE"]] as const) {
      const steps = agencyGuideSteps(kinds);
      const numbered = steps.filter((step) => step.id !== "mcp");
      expect(numbered.length).toBeGreaterThanOrEqual(5);
      expect(numbered.length).toBeLessThanOrEqual(7);
      expect(steps.at(-1)?.title).toBe("Collega la tua AI (MCP)");
      for (const step of steps) {
        expect(step.links.length).toBeGreaterThan(0);
        for (const link of step.links) expect(link.href).toMatch(/^\/(clients|posts|plans|calendar|settings)(\/|\?|#|$)/);
        // «2–3 righe»: short enough to read on a phone.
        expect(step.body.length, step.id).toBeLessThanOrEqual(330);
      }
    }
  });

  it("speaks of Metricool and the monthly plan only with social posts", () => {
    const social = agencyGuideSteps(["SOCIAL_POST"]).map((step) => step.title);
    expect(social).toEqual([
      "Aggiungi il cliente",
      "Crea o importa i post",
      "Invia in revisione e condividi il link",
      "Il cliente approva o chiede modifiche",
      "Programmazione su Metricool",
      "Piano del mese",
      "Collega la tua AI (MCP)",
    ]);
    const blog = agencyGuideSteps(["BLOG_ARTICLE"]);
    expect(JSON.stringify(blog)).not.toMatch(/Metricool|\/plans/);
    expect(blog.some((step) => step.id === "consegna")).toBe(true);
  });

  it("answers the three questions the team asks most", () => {
    const questions = agencyGuideQuestions(ALL).map((item) => item.question);
    expect(questions).toEqual(
      expect.arrayContaining(["Il cliente non trova il link", "Ho sbagliato un post già approvato", "Cosa vede il cliente"])
    );
    expect(JSON.stringify(agencyGuideQuestions(["BLOG_ARTICLE"]))).not.toMatch(/Metricool/);
  });
});
