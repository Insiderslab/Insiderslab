import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/plans against a small in-memory database: enough of Prisma's `where`
// (equality, in, not, gte/lt) to check what each query lets through. The
// post services (approvePost, submitForReview) and the emails are mocks: the
// rules under test are the plan's own (who may see it, what "Approva tutto"
// approves, one email per plan).

type Row = Record<string, unknown>;

const { db, mockPrisma, mockPosts, mockNotify, NOT_FOUND } = vi.hoisted(() => {
  const db = { plans: [] as Row[], posts: [] as Row[], comments: [] as Row[] };

  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
        const c = cond as Row;
        if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
        if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
        if ("not" in c && (c.not === null ? value === null || value === undefined : value === c.not)) return false;
        if ("gte" in c && !((value as Date) >= (c.gte as Date))) return false;
        if ("lt" in c && !((value as Date) < (c.lt as Date))) return false;
        return true;
      }
      return value === cond;
    });
  }

  const withPosts = (plan: Row) => ({
    ...plan,
    posts: db.posts.filter((p) => p.planId === plan.id),
    comments: db.comments.filter((c) => c.planId === plan.id),
  });

  const mockPrisma = {
    contentPlan: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const plan = db.plans.find((p) => matches(p, where));
        return plan ? withPosts(plan) : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const plan = db.plans.find((p) => p.id === where.id);
        return plan ? withPosts(plan) : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
        const plan = db.plans.find((p) => p.id === where.id);
        if (!plan) throw new Error("not found");
        return withPosts(plan);
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const plan = db.plans.find((p) => p.id === where.id)!;
        Object.assign(plan, data);
        return plan;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = db.plans.filter((p) => matches(p, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }),
    },
    post: {
      findMany: vi.fn(async ({ where, select }: { where: Row; select?: { comments?: { where?: Row } } }) =>
        db.posts
          .filter((p) => matches(p, where))
          // Nested relation filter (open client comments).
          .map((p) =>
            select?.comments?.where
              ? { ...p, comments: (p.comments as Row[]).filter((c) => matches(c, select.comments!.where)) }
              : p
          )
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = db.posts.filter((p) => matches(p, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }),
    },
    contentPlanComment: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `pc${db.comments.length + 1}`, ...data };
        db.comments.push(row);
        return row;
      }),
    },
  };

  const mockPosts = {
    approvePost: vi.fn(),
    submitForReview: vi.fn(),
  };
  const mockNotify = {
    notifyPlanSent: vi.fn(async () => 1),
    notifyPlanApproved: vi.fn(async () => {}),
    notifyPlanDecided: vi.fn(async () => {}),
    notifyPlanComment: vi.fn(async () => {}),
  };
  const NOT_FOUND = new Error("NEXT_NOT_FOUND");
  return { db, mockPrisma, mockPosts, mockNotify, NOT_FOUND };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/posts", () => ({
  approvePost: (...args: unknown[]) => mockPosts.approvePost(...args),
  submitForReview: (...args: unknown[]) => mockPosts.submitForReview(...args),
  listPostsForReviewer: async (reviewer: { clientId: string }) =>
    db.posts
      .filter((p) => p.clientId === reviewer.clientId && p.status !== "DRAFT")
      .map((p) => ({ ...p, canAct: p.status === "IN_REVIEW", cover: null, mediaCount: 0, excerpt: "", networks: [] })),
}));
vi.mock("@/lib/notifications", () => mockNotify);
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));
vi.mock("@/app/review/[token]/reviewer", () => ({
  getPortalReviewer: async (token: string) =>
    token === "token-c1"
      ? { id: "r1", clientId: "c1", name: "Giulia", client: { name: "Caffè Aurora", timezone: "Europe/Rome", logoUrl: null, autoSchedule: true } }
      : null,
}));

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addPlanComment, afterPlanPostDecided, approvePlan, getPlanForReviewer, sendPlan } from "@/lib/plans";

const reviewer = { id: "r1", clientId: "c1" };
const SENT = new Date("2026-10-01T10:00:00Z");

function plan(overrides: Row): Row {
  return {
    workspaceId: "w1",
    kind: "SOCIAL_POST",
    month: "2026-11",
    title: "Piano social novembre 2026",
    status: "IN_REVIEW",
    sentAt: SENT,
    reviewDueAt: null,
    completedNotifiedAt: null,
    client: { id: "c1", name: "Caffè Aurora", timezone: "Europe/Rome", archivedAt: null },
    ...overrides,
  };
}

function post(id: string, overrides: Row = {}): Row {
  return {
    id,
    title: `Post ${id}`,
    workspaceId: "w1",
    clientId: "c1",
    planId: "p1",
    kind: "SOCIAL_POST",
    status: "IN_REVIEW",
    currentVersionNumber: 1,
    submittedAt: SENT,
    publishAt: new Date("2026-11-05T09:00:00Z"),
    versions: [{ id: `${id}-v${(overrides.currentVersionNumber as number) ?? 1}` }],
    comments: [],
    ...overrides,
  };
}

beforeEach(() => {
  process.env.APP_VARIANT = "all";
  db.plans.length = 0;
  db.posts.length = 0;
  db.comments.length = 0;
  db.plans.push(
    plan({ id: "p1", clientId: "c1" }),
    plan({ id: "p2", clientId: "c2", client: { id: "c2", name: "Studio Verde", timezone: "Europe/Rome", archivedAt: null } }),
    plan({ id: "p3", clientId: "c1", month: "2026-12", sentAt: null, status: "DRAFT" })
  );
  vi.clearAllMocks();
  mockPosts.approvePost.mockImplementation(async (id: string) => {
    const row = db.posts.find((p) => p.id === id)!;
    row.status = "APPROVED";
    return row;
  });
});

describe("portal access to a plan", () => {
  it("shows the reviewer's own sent plan", async () => {
    await expect(getPlanForReviewer("p1", reviewer)).resolves.toMatchObject({ id: "p1", clientId: "c1" });
  });

  it("hides another client's plan, a plan never sent and unknown ids", async () => {
    await expect(getPlanForReviewer("p2", reviewer)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPlanForReviewer("p3", reviewer)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPlanForReviewer("nope", reviewer)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPlanForReviewer("x".repeat(65), reviewer)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to approve or comment another client's plan", async () => {
    db.posts.push(post("a", { planId: "p2", clientId: "c2" }));
    await expect(approvePlan("p2", reviewer, [{ postId: "a", versionNumber: 1 }])).rejects.toBeInstanceOf(NotFoundError);
    expect(mockPosts.approvePost).not.toHaveBeenCalled();
    await expect(addPlanComment("p2", reviewer, "Mi piace")).rejects.toBeInstanceOf(NotFoundError);
    expect(db.comments).toHaveLength(0);
  });

  it("answers 404 on the portal route for another client's plan", async () => {
    const { default: Page } = await import("@/app/review/[token]/piani/[planId]/page");
    await expect(Page({ params: Promise.resolve({ token: "token-c1", planId: "p2" }) })).rejects.toBe(NOT_FOUND);
    await expect(Page({ params: Promise.resolve({ token: "token-c1", planId: "p3" }) })).rejects.toBe(NOT_FOUND);
    // An invalid link renders nothing here (the layout shows its own page).
    await expect(Page({ params: Promise.resolve({ token: "bad", planId: "p1" }) })).resolves.toBeNull();
  });

  it("renders the reviewer's own plan on the portal route", async () => {
    db.posts.push(post("a"), post("b", { status: "DRAFT" }), post("x", { planId: "p2", clientId: "c2" }));
    const { default: Page } = await import("@/app/review/[token]/piani/[planId]/page");
    const element = (await Page({ params: Promise.resolve({ token: "token-c1", planId: "p1" }) })) as {
      props: { children: { props: { plan: { posts: Array<{ id: string }> } } } };
    };
    // Only the client's visible posts of this plan: no draft, nothing of another client.
    expect(element.props.children.props.plan.posts.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("Approva tutto il piano", () => {
  it("approves only what waits for the client at the version shown, and lists the rest", async () => {
    db.posts.push(
      post("a"),
      post("b", { comments: [{ authorType: "CLIENT", resolvedAt: null, versionId: "b-v1" }] }),
      post("c", { status: "CHANGES_REQUESTED" }),
      post("d", { currentVersionNumber: 2, versions: [{ id: "d-v2" }] }),
      post("e", { status: "SCHEDULED" })
    );
    const result = await approvePlan("p1", reviewer, [
      { postId: "a", versionNumber: 1 },
      { postId: "b", versionNumber: 1 },
      { postId: "c", versionNumber: 1 },
      { postId: "d", versionNumber: 1 },
      { postId: "e", versionNumber: 1 },
    ]);
    expect(mockPosts.approvePost).toHaveBeenCalledTimes(1);
    // Same service as a single approval, bound to the version, without the per-post email.
    expect(mockPosts.approvePost).toHaveBeenCalledWith("a", reviewer, 1, { notify: false });
    expect(result.approved).toEqual(["a"]);
    expect(result.skipped.map((s) => [s.id, s.reason])).toEqual([
      ["b", "comments"],
      ["c", "changes"],
      ["d", "stale"],
    ]);
  });

  it("does not count resolved comments or comments on an older version", async () => {
    db.posts.push(
      post("a", {
        currentVersionNumber: 2,
        versions: [{ id: "a-v2" }],
        comments: [
          { authorType: "CLIENT", resolvedAt: new Date(), versionId: "a-v2" },
          { authorType: "CLIENT", resolvedAt: null, versionId: "a-v1" },
        ],
      })
    );
    const result = await approvePlan("p1", reviewer, [{ postId: "a", versionNumber: 2 }]);
    expect(result.approved).toEqual(["a"]);
  });

  it("turns a post changed meanwhile into a skipped one instead of failing everything", async () => {
    db.posts.push(post("a"), post("b"));
    mockPosts.approvePost.mockImplementation(async (id: string) => {
      if (id === "a") throw new ConflictError("aggiornato");
      const row = db.posts.find((p) => p.id === id)!;
      row.status = "APPROVED";
      return row;
    });
    const result = await approvePlan("p1", reviewer, [
      { postId: "a", versionNumber: 1 },
      { postId: "b", versionNumber: 1 },
    ]);
    expect(result.approved).toEqual(["b"]);
    expect(result.skipped).toEqual([{ id: "a", title: "Post a", reason: "stale" }]);
  });

  it("sends one summary email, or the 'plan decided' one when nothing is left", async () => {
    db.posts.push(post("a"), post("b", { comments: [{ authorType: "CLIENT", resolvedAt: null, versionId: "b-v1" }] }));
    const partial = await approvePlan("p1", reviewer, [
      { postId: "a", versionNumber: 1 },
      { postId: "b", versionNumber: 1 },
    ]);
    expect(partial.completed).toBe(false);
    expect(mockNotify.notifyPlanApproved).toHaveBeenCalledTimes(1);
    expect(mockNotify.notifyPlanApproved).toHaveBeenCalledWith("p1", "r1", ["a"]);
    expect(mockNotify.notifyPlanDecided).not.toHaveBeenCalled();

    db.posts.length = 0;
    vi.clearAllMocks();
    db.posts.push(post("c"), post("d", { status: "CHANGES_REQUESTED" }));
    const done = await approvePlan("p1", reviewer, [
      { postId: "c", versionNumber: 1 },
      { postId: "d", versionNumber: 1 },
    ]);
    expect(done.completed).toBe(true);
    expect(mockNotify.notifyPlanDecided).toHaveBeenCalledTimes(1);
    expect(mockNotify.notifyPlanApproved).not.toHaveBeenCalled();
    expect(db.plans.find((p) => p.id === "p1")!.status).toBe("CHANGES_REQUESTED");
  });

  it("says so when nothing can be approved in one step", async () => {
    db.posts.push(post("a", { status: "APPROVED" }));
    await expect(approvePlan("p1", reviewer, [{ postId: "a", versionNumber: 1 }])).rejects.toBeInstanceOf(ValidationError);
    expect(mockPosts.approvePost).not.toHaveBeenCalled();
  });
});

describe("plan follow-up", () => {
  it("tells the agency once when the client has decided every post", async () => {
    db.posts.push(post("a", { status: "APPROVED" }), post("b", { status: "CHANGES_REQUESTED" }));
    expect(await afterPlanPostDecided("p1")).toBe(true);
    expect(await afterPlanPostDecided("p1")).toBe(false);
    expect(mockNotify.notifyPlanDecided).toHaveBeenCalledTimes(1);
  });

  it("waits while posts are still in review, and never for an unsent plan", async () => {
    db.posts.push(post("a", { status: "APPROVED" }), post("b"));
    expect(await afterPlanPostDecided("p1")).toBe(false);
    db.posts.push(post("z", { planId: "p3", status: "APPROVED" }));
    expect(await afterPlanPostDecided("p3")).toBe(false);
    expect(mockNotify.notifyPlanDecided).not.toHaveBeenCalled();
  });
});

describe("Invia il piano al cliente", () => {
  beforeEach(() => {
    mockPosts.submitForReview.mockImplementation(async (ids: string[]) => {
      for (const id of ids) db.posts.find((p) => p.id === id)!.status = "IN_REVIEW";
      return { submitted: ids, clientsWithoutReviewers: [], clientsWithoutEmail: [] };
    });
  });

  it("sends drafts and changes-requested posts in one go, with one plan email", async () => {
    db.plans.find((p) => p.id === "p1")!.sentAt = null;
    db.posts.push(
      post("a", { status: "DRAFT" }),
      post("b", { status: "CHANGES_REQUESTED" }),
      post("c", { status: "APPROVED" }),
      // Same month, not in the plan yet: attached before sending.
      post("d", { status: "DRAFT", planId: null, publishAt: new Date("2026-11-30T22:30:00Z") }),
      // Next month in Rome (1 Dec 00:30): stays out.
      post("e", { status: "DRAFT", planId: null, publishAt: new Date("2026-11-30T23:30:00Z") })
    );
    const result = await sendPlan("p1", "w1", { kind: "user", userId: "u1" });
    expect(mockPosts.submitForReview).toHaveBeenCalledTimes(1);
    const [ids, workspaceId, , opts] = mockPosts.submitForReview.mock.calls[0];
    expect([...ids].sort()).toEqual(["a", "b", "d"]);
    expect(workspaceId).toBe("w1");
    expect(opts).toMatchObject({ notify: false });
    expect(mockNotify.notifyPlanSent).toHaveBeenCalledTimes(1);
    expect(result.attached).toBe(1);
    expect(db.posts.find((p) => p.id === "e")!.planId).toBeNull();
    expect(db.plans.find((p) => p.id === "p1")!.sentAt).toBeInstanceOf(Date);
  });

  it("refuses another workspace's plan and a plan with nothing to send", async () => {
    await expect(sendPlan("p1", "w2", { kind: "user", userId: "u1" })).rejects.toBeInstanceOf(NotFoundError);
    db.posts.push(post("a", { status: "IN_REVIEW" }));
    await expect(sendPlan("p1", "w1", { kind: "user", userId: "u1" })).rejects.toBeInstanceOf(ValidationError);
    expect(mockPosts.submitForReview).not.toHaveBeenCalled();
  });
});
