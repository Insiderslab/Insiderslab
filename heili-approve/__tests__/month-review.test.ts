import { beforeEach, describe, expect, it, vi } from "vitest";

// The month route and "Approva i rimanenti" of Sfoglia against a small
// in-memory database. The post services are mocks: what is under test is who
// may see a month, and which posts the month's approve-all lets through.

type Row = Record<string, unknown>;

const { db, mockPosts, mockPlans, NOT_FOUND } = vi.hoisted(() => {
  const db = { posts: [] as Row[], feedback: new Map<string, number>() };
  const mockPosts = {
    approvePost: vi.fn(),
    listPostsForReviewer: vi.fn(),
    getPostForReviewer: vi.fn(),
  };
  const mockPlans = {
    openClientCommentCounts: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, db.feedback.get(id) ?? 0]))),
    approvePlan: vi.fn(),
    addPlanComment: vi.fn(),
  };
  return { db, mockPosts, mockPlans, NOT_FOUND: new Error("NEXT_NOT_FOUND") };
});

vi.mock("@/lib/db/client", () => ({
  prisma: {
    post: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; clientId: string; kind: string; status: { in: string[] } } }) =>
        db.posts.filter(
          (p) =>
            where.id.in.includes(p.id as string) &&
            p.clientId === where.clientId &&
            p.kind === where.kind &&
            where.status.in.includes(p.status as string)
        )
      ),
    },
  },
}));
vi.mock("@/lib/posts", () => ({
  approvePost: (...args: unknown[]) => mockPosts.approvePost(...args),
  listPostsForReviewer: (...args: unknown[]) => mockPosts.listPostsForReviewer(...args),
  getPostForReviewer: (...args: unknown[]) => mockPosts.getPostForReviewer(...args),
}));
vi.mock("@/lib/plans", () => mockPlans);
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

import { BulkApprovalFeedbackConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { approveListedPosts } from "@/lib/month-review";

const reviewer = { id: "r1", clientId: "c1" };

function post(id: string, over: Row = {}): Row {
  return {
    id,
    title: `Post ${id}`,
    clientId: "c1",
    kind: "SOCIAL_POST",
    status: "IN_REVIEW",
    currentVersionNumber: 1,
    publishAt: new Date("2026-10-12T09:00:00Z"),
    ...over,
  };
}

/** A summary as listPostsForReviewer returns it. */
function summary(id: string, over: Row = {}): Row {
  return {
    id,
    title: `Post ${id}`,
    kind: "SOCIAL_POST",
    status: "IN_REVIEW",
    publishAt: new Date("2026-10-12T09:00:00Z"),
    networks: ["instagram"],
    currentVersionNumber: 1,
    canAct: true,
    cover: null,
    mediaCount: 0,
    excerpt: "",
    planId: null,
    ...over,
  };
}

beforeEach(() => {
  process.env.APP_VARIANT = "all";
  db.posts.length = 0;
  db.feedback.clear();
  vi.clearAllMocks();
  mockPosts.approvePost.mockImplementation(async (id: string) => {
    const row = db.posts.find((p) => p.id === id)!;
    row.status = "APPROVED";
    return row;
  });
});

describe("Approva i rimanenti of the month route", () => {
  it("approves what waits at the version shown, through approvePost with the feedback guard", async () => {
    db.posts.push(post("a"), post("b"), post("c", { currentVersionNumber: 2 }));
    const result = await approveListedPosts(reviewer, [
      { postId: "a", versionNumber: 1 },
      { postId: "b", versionNumber: 1 },
      { postId: "c", versionNumber: 1 }, // the agency updated it meanwhile
    ]);
    expect(result.approved).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([{ id: "c", title: "Post c", reason: "stale" }]);
    expect(mockPosts.approvePost).toHaveBeenCalledTimes(2);
    expect(mockPosts.approvePost).toHaveBeenCalledWith("a", reviewer, 1, { bulkSafety: true });
  });

  it("leaves out posts with feedback or changes requested and lists them", async () => {
    db.posts.push(post("a"), post("b"), post("c", { status: "CHANGES_REQUESTED" }));
    db.feedback.set("b", 1);
    const result = await approveListedPosts(reviewer, [
      { postId: "a", versionNumber: 1 },
      { postId: "b", versionNumber: 1 },
      { postId: "c", versionNumber: 1 },
    ]);
    expect(result.approved).toEqual(["a"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { id: "b", title: "Post b", reason: "comments" },
        { id: "c", title: "Post c", reason: "changes" },
      ])
    );
  });

  it("lists a post whose feedback arrived after the check (row lock inside approvePost)", async () => {
    db.posts.push(post("a"), post("b"));
    mockPosts.approvePost.mockImplementation(async (id: string) => {
      if (id === "b") throw new BulkApprovalFeedbackConflictError();
      db.posts.find((p) => p.id === id)!.status = "APPROVED";
    });
    const result = await approveListedPosts(reviewer, [
      { postId: "a", versionNumber: 1 },
      { postId: "b", versionNumber: 1 },
    ]);
    expect(result.approved).toEqual(["a"]);
    expect(result.skipped).toEqual([{ id: "b", title: "Post b", reason: "comments" }]);
  });

  it("never touches another client's post, a draft or an article", async () => {
    db.posts.push(
      post("mine"),
      post("theirs", { clientId: "c2" }),
      post("draft", { status: "DRAFT" }),
      post("article", { kind: "BLOG_ARTICLE" })
    );
    const result = await approveListedPosts(reviewer, [
      { postId: "mine", versionNumber: 1 },
      { postId: "theirs", versionNumber: 1 },
      { postId: "draft", versionNumber: 1 },
      { postId: "article", versionNumber: 1 },
    ]);
    expect(result.approved).toEqual(["mine"]);
    expect(mockPosts.approvePost.mock.calls.map((c) => c[0])).toEqual(["mine"]);
  });

  it("refuses when nothing can be approved in one step", async () => {
    db.posts.push(post("a"), post("b", { status: "APPROVED" }));
    db.feedback.set("a", 2);
    await expect(approveListedPosts(reviewer, [{ postId: "a", versionNumber: 1 }])).rejects.toBeInstanceOf(ValidationError);
    await expect(approveListedPosts(reviewer, [{ postId: "b", versionNumber: 1 }])).rejects.toBeInstanceOf(ValidationError);
    await expect(approveListedPosts(reviewer, [])).rejects.toBeInstanceOf(ValidationError);
    expect(mockPosts.approvePost).not.toHaveBeenCalled();
  });

  it("keeps what is approved when a later post breaks, and reports it", async () => {
    db.posts.push(post("a"), post("b"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPosts.approvePost.mockImplementation(async (id: string) => {
      if (id === "b") throw new Error("boom");
      db.posts.find((p) => p.id === id)!.status = "APPROVED";
    });
    const result = await approveListedPosts(reviewer, [
      { postId: "a", versionNumber: 1 },
      { postId: "b", versionNumber: 1 },
    ]);
    expect(result.approved).toEqual(["a"]);
    expect(result.skipped).toEqual([{ id: "b", title: "Post b", reason: "stale" }]);
    error.mockRestore();
  });

  it("throws when the very first approval breaks", async () => {
    db.posts.push(post("a"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPosts.approvePost.mockRejectedValue(new Error("boom"));
    await expect(approveListedPosts(reviewer, [{ postId: "a", versionNumber: 1 }])).rejects.toThrow("boom");
    error.mockRestore();
  });

  it("tolerates a post that disappeared", async () => {
    db.posts.push(post("a"));
    mockPosts.approvePost.mockRejectedValueOnce(new NotFoundError("Post non trovato"));
    await expect(approveListedPosts(reviewer, [{ postId: "a", versionNumber: 1 }])).resolves.toMatchObject({
      approved: [],
      skipped: [{ id: "a", reason: "stale" }],
    });
  });
});

describe("month route /review/<token>/mese/<YYYY-MM>", () => {
  async function renderMonth(token: string, month: string, vista?: string) {
    const { default: Page } = await import("@/app/review/[token]/mese/[month]/page");
    return Page({ params: Promise.resolve({ token, month }), searchParams: Promise.resolve({ vista }) });
  }

  beforeEach(() => {
    mockPosts.listPostsForReviewer.mockImplementation(async (r: { clientId: string }) =>
      db.posts.filter((p) => p.clientId === r.clientId && p.status !== "DRAFT" && p.status !== "CANCELLED")
    );
  });

  it("shows the reviewer's social posts of that month", async () => {
    db.posts.push(summary("a", { clientId: "c1" }), summary("b", { clientId: "c1", publishAt: new Date("2026-10-20T09:00:00Z") }));
    const element = (await renderMonth("token-c1", "2026-10")) as { props: { children: { props: { heading: string } } } };
    expect(element.props.children.props.heading).toBe("Post di ottobre");
  });

  it("answers 404 for another client's month, an empty month and a malformed one", async () => {
    // c2 has posts in October; the reviewer's client (c1) has none that month.
    db.posts.push(summary("theirs", { clientId: "c2" }), summary("mine-nov", { clientId: "c1", publishAt: new Date("2026-11-12T09:00:00Z") }));
    await expect(renderMonth("token-c1", "2026-10")).rejects.toBe(NOT_FOUND);
    await expect(renderMonth("token-c1", "2026-12")).rejects.toBe(NOT_FOUND);
    await expect(renderMonth("token-c1", "ottobre")).rejects.toBe(NOT_FOUND);
    await expect(renderMonth("token-c1", "2026-1")).rejects.toBe(NOT_FOUND);
    await expect(renderMonth("token-c1", "2026-13")).rejects.toBe(NOT_FOUND);
  });

  it("never lists drafts or cancelled posts: a month with only those is 404", async () => {
    db.posts.push(summary("d", { status: "DRAFT" }), summary("x", { status: "CANCELLED" }));
    await expect(renderMonth("token-c1", "2026-10")).rejects.toBe(NOT_FOUND);
  });

  it("ignores blog articles and ads sets", async () => {
    db.posts.push(summary("article", { kind: "BLOG_ARTICLE" }));
    await expect(renderMonth("token-c1", "2026-10")).rejects.toBe(NOT_FOUND);
  });

  it("renders nothing for an invalid link (the layout shows its own page)", async () => {
    await expect(renderMonth("bad", "2026-10")).resolves.toBeNull();
  });
});
