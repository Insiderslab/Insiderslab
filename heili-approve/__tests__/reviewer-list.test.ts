import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; clientId: string; planId: string | null; status: string; kind: string; publishAt: Date; currentVersionNumber: number; submittedAt: Date | null };

const db = vi.hoisted(() => ({ posts: [] as Row[], calls: [] as unknown[] }));

/** A tiny in-memory post.findMany that honours the filters listPostsForReviewer uses. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  if (Array.isArray(where.AND)) return where.AND.every((w) => matches(row, w as Record<string, unknown>));
  for (const [key, cond] of Object.entries(where)) {
    const value = (row as Record<string, unknown>)[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; notIn?: unknown[]; gte?: Date; lt?: Date };
      if (c.in && !c.in.includes(value)) return false;
      if (c.notIn && c.notIn.includes(value)) return false;
      if (c.gte && (value as Date) < c.gte) return false;
      if (c.lt && (value as Date) >= c.lt) return false;
    } else if (value !== cond) return false;
  }
  return true;
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    post: {
      findMany: async (args: { where: Record<string, unknown>; orderBy: { publishAt: "asc" | "desc" }; take?: number }) => {
        db.calls.push(args);
        const dir = args.orderBy.publishAt === "asc" ? 1 : -1;
        return db.posts
          .filter((p) => matches(p, args.where))
          .sort((a, b) => dir * (a.publishAt.getTime() - b.publishAt.getTime()))
          .slice(0, args.take ?? Infinity);
      },
    },
    postEvent: { groupBy: async () => [] },
    postVersion: {
      findMany: async () => [],
    },
  },
}));

import { REVIEWER_HISTORY_LIMIT, listPostsForReviewer } from "@/lib/posts";
import { monthQueryRange } from "@/lib/month-rules";

const reviewer = { id: "r1", clientId: "c1" };
const day = (n: number) => new Date(Date.UTC(2024, 0, 1) + n * 86_400_000);
const post = (i: number, status: string, publishAt: Date, extra: Partial<Row> = {}): Row => ({
  id: `p${i}`,
  clientId: "c1",
  planId: null,
  status,
  kind: "SOCIAL_POST",
  publishAt,
  currentVersionNumber: 1,
  submittedAt: publishAt,
  ...extra,
});

beforeEach(() => {
  db.posts = [];
  db.calls = [];
});

describe("listPostsForReviewer", () => {
  it("never hides open posts behind a long history (600 scheduled posts, 9 to review)", async () => {
    for (let i = 0; i < 600; i++) db.posts.push(post(i, "SCHEDULED", day(i)));
    for (let i = 0; i < 9; i++) db.posts.push(post(1000 + i, "IN_REVIEW", day(700 + i)));
    db.posts.push(post(2000, "CHANGES_REQUESTED", day(5)));

    const list = await listPostsForReviewer(reviewer);

    expect(list.filter((p) => p.status === "IN_REVIEW")).toHaveLength(9);
    expect(list.filter((p) => p.status === "CHANGES_REQUESTED")).toHaveLength(1);
    const history = list.filter((p) => p.status === "SCHEDULED");
    expect(history).toHaveLength(REVIEWER_HISTORY_LIMIT);
    // The most recent decided posts are kept, and the list stays in publish order.
    expect(history.at(-1)?.id).toBe("p599");
    const times = list.map((p) => p.publishAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(list.every((p) => p.canAct === (p.status === "IN_REVIEW"))).toBe(true);
  });

  it("lists a whole plan, whatever the client's history", async () => {
    for (let i = 0; i < 600; i++) db.posts.push(post(i, "SCHEDULED", day(i)));
    for (let i = 0; i < 350; i++) db.posts.push(post(1000 + i, i % 2 ? "APPROVED" : "IN_REVIEW", day(i), { planId: "plan1" }));

    const list = await listPostsForReviewer(reviewer, { planId: "plan1" });

    expect(list).toHaveLength(350);
    expect(list.every((p) => p.planId === "plan1")).toBe(true);
  });

  it("limits the month page to its dates, other clients never included", async () => {
    db.posts.push(post(1, "SCHEDULED", new Date("2026-10-31T23:30:00Z")));
    db.posts.push(post(2, "IN_REVIEW", new Date("2026-11-15T10:00:00Z")));
    db.posts.push(post(3, "IN_REVIEW", new Date("2027-01-15T10:00:00Z")));
    db.posts.push(post(4, "IN_REVIEW", new Date("2026-11-16T10:00:00Z"), { clientId: "c2" }));

    const list = await listPostsForReviewer(reviewer, monthQueryRange("2026-11"));

    expect(list.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("monthQueryRange", () => {
  it("widens the month by two days and refuses malformed months", () => {
    expect(monthQueryRange("2026-11")).toEqual({
      from: new Date("2026-10-30T00:00:00.000Z"),
      to: new Date("2026-12-03T00:00:00.000Z"),
    });
    expect(monthQueryRange("2026-13")).toEqual({});
  });
});
