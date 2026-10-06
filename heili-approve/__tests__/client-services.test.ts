import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// createPost runs against a fake transaction: only the client lookup matters
// here (the refusal happens before anything is written).
const { mockPrisma, mockTx } = vi.hoisted(() => {
  const mockTx = {
    client: { findFirst: vi.fn() },
    post: { create: vi.fn(), findFirst: vi.fn() },
    postVersion: { findUnique: vi.fn() },
  };
  return {
    mockTx,
    mockPrisma: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
    },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  clientHasService,
  clientServices,
  inferClientServices,
  mergeServices,
  serviceNotActiveMessage,
  servicesSchema,
  validateServices,
} from "@/lib/clients";
import { groupKindStatusCounts, serviceOverview } from "@/components/clients/helpers";
import { parsePortalKind, portalKindTabs, portalKinds, portalTagline } from "@/components/portal/helpers";
import { ValidationError } from "@/lib/errors";
import { reviewEmailCopy } from "@/lib/notifications";
import { createPost, updatePost } from "@/lib/posts";
import { joinItalian, kindCountPhrase, servicesSentence, sortKinds } from "@/lib/variant";

const ALL = ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"] as const;
const previousVariant = process.env.APP_VARIANT;

beforeEach(() => {
  process.env.APP_VARIANT = "all";
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.APP_VARIANT = previousVariant;
});

describe("services: validation", () => {
  it("sorts and deduplicates in menu order", () => {
    expect(validateServices(["AD_CREATIVE", "SOCIAL_POST", "AD_CREATIVE"], [...ALL])).toEqual([
      "SOCIAL_POST",
      "AD_CREATIVE",
    ]);
    expect(servicesSchema.parse(["BLOG_ARTICLE", "SOCIAL_POST", "BLOG_ARTICLE"])).toEqual(["SOCIAL_POST", "BLOG_ARTICLE"]);
  });

  it("refuses an empty list", () => {
    expect(() => validateServices([], [...ALL])).toThrow(ValidationError);
    expect(() => validateServices([], [...ALL])).toThrow("Scegli almeno un servizio per il cliente");
  });

  it("refuses kinds this instance does not handle", () => {
    process.env.APP_VARIANT = "blog";
    expect(() => validateServices(["BLOG_ARTICLE", "AD_CREATIVE"], ["BLOG_ARTICLE"])).toThrow(
      "Il servizio «Creatività» non è disponibile in Approve by Heili — Blog"
    );
  });

  it("rejects values that are not content kinds", () => {
    expect(servicesSchema.safeParse(["SOCIAL_POST", "NEWSLETTER"]).success).toBe(false);
  });
});

describe("services: edits and what a client gets", () => {
  it("keeps the services of kinds the instance does not show", () => {
    // A blog instance editing a social client: social stays, blog is added.
    expect(mergeServices(["SOCIAL_POST"], ["BLOG_ARTICLE"], ["BLOG_ARTICLE"])).toEqual(["SOCIAL_POST", "BLOG_ARTICLE"]);
    // Nothing ticked there is fine: the social service is still there.
    expect(mergeServices(["SOCIAL_POST"], [], ["BLOG_ARTICLE"])).toEqual(["SOCIAL_POST"]);
  });

  it("replaces the shown services and never ends empty", () => {
    expect(mergeServices(["SOCIAL_POST", "BLOG_ARTICLE"], ["AD_CREATIVE"], [...ALL])).toEqual(["AD_CREATIVE"]);
    expect(() => mergeServices(["SOCIAL_POST"], [], [...ALL])).toThrow("Scegli almeno un servizio per il cliente");
  });

  it("intersects the client's services with the enabled kinds", () => {
    const client = { services: ["AD_CREATIVE", "SOCIAL_POST"] as ("AD_CREATIVE" | "SOCIAL_POST")[] };
    expect(clientServices(client, [...ALL])).toEqual(["SOCIAL_POST", "AD_CREATIVE"]);
    expect(clientServices(client, ["BLOG_ARTICLE"])).toEqual([]);
    expect(clientHasService(client, "AD_CREATIVE", [...ALL])).toBe(true);
    expect(clientHasService(client, "BLOG_ARTICLE", [...ALL])).toBe(false);
    expect(clientHasService(client, "AD_CREATIVE", ["SOCIAL_POST"])).toBe(false);
  });

  it("names the refused service in Italian", () => {
    expect(serviceNotActiveMessage("BLOG_ARTICLE")).toBe("Il servizio «Articoli» non è attivo per questo cliente");
  });
});

describe("services: backfill of existing clients (migration client_services)", () => {
  it("uses the kinds the client already has content of", () => {
    expect(inferClientServices({ postKinds: ["BLOG_ARTICLE", "BLOG_ARTICLE"], networks: [], metricoolBlogId: null })).toEqual([
      "BLOG_ARTICLE",
    ]);
    expect(
      inferClientServices({ postKinds: ["AD_CREATIVE", "SOCIAL_POST"], networks: [], metricoolBlogId: null })
    ).toEqual(["SOCIAL_POST", "AD_CREATIVE"]);
  });

  it("adds social posts for clients with networks or a Metricool brand", () => {
    expect(inferClientServices({ postKinds: ["BLOG_ARTICLE"], networks: ["instagram"], metricoolBlogId: null })).toEqual([
      "SOCIAL_POST",
      "BLOG_ARTICLE",
    ]);
    expect(inferClientServices({ postKinds: [], networks: null, metricoolBlogId: "123456" })).toEqual(["SOCIAL_POST"]);
  });

  it("is never empty", () => {
    expect(inferClientServices({ postKinds: [], networks: [], metricoolBlogId: null })).toEqual(["SOCIAL_POST"]);
  });
});

describe("createPost and the client's services", () => {
  const client = {
    id: "c1",
    workspaceId: "w1",
    archivedAt: null,
    networks: ["instagram"],
    services: ["SOCIAL_POST"],
  };

  it("refuses a kind that is not among the client's services", async () => {
    mockTx.client.findFirst.mockResolvedValue(client);
    await expect(
      createPost(
        "w1",
        { clientId: "c1", kind: "BLOG_ARTICLE", title: "Articolo", publishAt: new Date(), content: {} },
        { kind: "user", userId: "u1" }
      )
    ).rejects.toThrow("Il servizio «Articoli» non è attivo per questo cliente");
    expect(mockTx.post.create).not.toHaveBeenCalled();
  });

  it("checks the instance first: a disabled kind is refused as such", async () => {
    process.env.APP_VARIANT = "social";
    await expect(
      createPost(
        "w1",
        { clientId: "c1", kind: "AD_CREATIVE", title: "Set", publishAt: new Date(), content: {} },
        { kind: "user", userId: "u1" }
      )
    ).rejects.toThrow("Le creatività ads non sono disponibili in Approve by Heili");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses moving a draft to a client without the service", async () => {
    mockTx.post.findFirst.mockResolvedValue({
      id: "p1",
      kind: "BLOG_ARTICLE",
      clientId: "c2",
      submittedAt: null,
      currentVersionNumber: 1,
      client: { ...client, id: "c2", services: ["BLOG_ARTICLE"] },
    });
    mockTx.postVersion.findUnique.mockResolvedValue({ id: "v1", number: 1, text: "", media: [], content: {} });
    mockTx.client.findFirst.mockResolvedValue(client);
    await expect(updatePost("p1", "w1", { clientId: "c1" }, { kind: "user", userId: "u1" })).rejects.toThrow(
      "Il servizio «Articoli» non è attivo per questo cliente"
    );
  });
});

describe("wording for several services", () => {
  it("joins in Italian", () => {
    expect(joinItalian([])).toBe("");
    expect(joinItalian(["a"])).toBe("a");
    expect(joinItalian(["a", "b"])).toBe("a e b");
    expect(joinItalian(["a", "b", "c"])).toBe("a, b e c");
  });

  it("lists services and counts in menu order", () => {
    expect(sortKinds(["AD_CREATIVE", "SOCIAL_POST"])).toEqual(["SOCIAL_POST", "AD_CREATIVE"]);
    expect(servicesSentence(["AD_CREATIVE", "BLOG_ARTICLE", "SOCIAL_POST"])).toBe("post social, articoli e creatività");
    expect(kindCountPhrase({ BLOG_ARTICLE: 1, SOCIAL_POST: 2 })).toBe("2 post social e 1 articolo");
    expect(kindCountPhrase({ SOCIAL_POST: 1, BLOG_ARTICLE: 0, AD_CREATIVE: 3 })).toBe("1 post social e 3 creatività");
    expect(kindCountPhrase({ AD_CREATIVE: 1, BLOG_ARTICLE: 2 }, { adSets: true })).toBe("2 articoli e 1 set di creatività");
  });

  it("writes a mixed review email that says what it holds", () => {
    const at = new Date("2026-10-10T08:00:00Z");
    const posts = [
      { title: "Post 1", kind: "SOCIAL_POST" as const, publishAt: at, networks: ["instagram"] },
      { title: "Post 2", kind: "SOCIAL_POST" as const, publishAt: at, networks: ["facebook"] },
      { title: "Articolo", kind: "BLOG_ARTICLE" as const, publishAt: at, networks: [] },
    ];
    const request = reviewEmailCopy(posts, { kind: "request", clientName: "Le Querce", agencyName: "InsidersLab" });
    expect(request.subject).toBe("2 post social e 1 articolo da approvare per Le Querce");
    expect(request.intro).toMatch(/^InsidersLab ha preparato 2 post social e 1 articolo per Le Querce\./);
    const reminder = reviewEmailCopy(posts, { kind: "reminder", clientName: "Le Querce", agencyName: "InsidersLab" });
    expect(reminder.subject).toBe("Promemoria: 2 post social e 1 articolo aspettano la tua revisione");
    expect(reminder.intro).toBe("Ci sono ancora 2 post social e 1 articolo di Le Querce in attesa della tua revisione.");
  });
});

describe("unified portal", () => {
  const items = [
    { kind: "SOCIAL_POST" as const, canAct: true },
    { kind: "SOCIAL_POST" as const, canAct: false },
    { kind: "BLOG_ARTICLE" as const, canAct: true },
    { kind: "AD_CREATIVE" as const, canAct: true },
  ];

  it("shows the client's services plus kinds it already has items of", () => {
    expect(portalKinds(["BLOG_ARTICLE"], [{ kind: "SOCIAL_POST" }])).toEqual(["SOCIAL_POST", "BLOG_ARTICLE"]);
    expect(portalKinds(["AD_CREATIVE"], [])).toEqual(["AD_CREATIVE"]);
  });

  it("builds the tabs with the items waiting for the client", () => {
    const tabs = portalKindTabs("tok", ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"], items, "BLOG_ARTICLE");
    expect(tabs.map((t) => [t.label, t.toAct, t.active])).toEqual([
      ["Tutti", 3, false],
      ["Post social", 1, false],
      ["Articoli", 1, true],
      ["Creatività", 1, false],
    ]);
    expect(tabs[0].href).toBe("/review/tok");
    expect(tabs[2].href).toBe("/review/tok?tipo=blog");
  });

  it("has no tabs for a single kind", () => {
    expect(portalKindTabs("tok", ["SOCIAL_POST"], items, null)).toEqual([]);
  });

  it("only filters on kinds the portal shows", () => {
    expect(parsePortalKind("blog", ["SOCIAL_POST", "BLOG_ARTICLE"])).toBe("BLOG_ARTICLE");
    expect(parsePortalKind("ads", ["SOCIAL_POST", "BLOG_ARTICLE"])).toBeNull();
    expect(parsePortalKind(undefined, ["SOCIAL_POST", "BLOG_ARTICLE"])).toBeNull();
  });

  it("says what the client finds in the header", () => {
    expect(portalTagline(["AD_CREATIVE", "SOCIAL_POST", "BLOG_ARTICLE"])).toBe(
      "I tuoi contenuti da approvare: post social, articoli e creatività"
    );
    expect(portalTagline(["SOCIAL_POST"])).toBe("I tuoi post da approvare");
    expect(portalTagline(["BLOG_ARTICLE"])).toBe("I tuoi articoli da approvare");
    expect(portalTagline(["AD_CREATIVE"])).toBe("Le tue creatività da approvare");
  });
});

describe("client page: overview per service", () => {
  it("counts per kind and status, cancelled dropped", () => {
    expect(
      groupKindStatusCounts([
        { kind: "SOCIAL_POST", status: "IN_REVIEW", count: 2 },
        { kind: "SOCIAL_POST", status: "CANCELLED", count: 5 },
        { kind: "BLOG_ARTICLE", status: "DELIVERED", count: 1 },
      ])
    ).toEqual({ SOCIAL_POST: { IN_REVIEW: 2 }, BLOG_ARTICLE: { DELIVERED: 1 } });
  });

  it("buckets social posts: scheduled is the last step, errors apart", () => {
    const overview = serviceOverview("SOCIAL_POST", {
      IN_REVIEW: 2,
      CHANGES_REQUESTED: 1,
      APPROVED: 1,
      SCHEDULING: 1,
      SCHEDULED: 4,
      FAILED: 1,
      DRAFT: 3,
    });
    expect(overview.entries.map((e) => [e.label, e.count, e.status])).toEqual([
      ["Da approvare", 2, "IN_REVIEW"],
      ["Modifiche richieste", 1, "CHANGES_REQUESTED"],
      ["Approvati", 2, "APPROVED"],
      ["Programmati", 4, "SCHEDULED"],
    ]);
    expect(overview.drafts).toBe(3);
    expect(overview.failed).toBe(1);
    expect(overview.total).toBe(13);
  });

  it("buckets articles and ads: published / delivered", () => {
    expect(serviceOverview("BLOG_ARTICLE", { DELIVERED: 2 }).entries[3]).toMatchObject({ label: "Pubblicati", count: 2, status: "DELIVERED" });
    expect(serviceOverview("AD_CREATIVE", undefined).entries[3]).toMatchObject({ label: "Consegnati", count: 0 });
  });
});
