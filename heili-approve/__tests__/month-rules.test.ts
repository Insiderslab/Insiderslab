import { describe, expect, it } from "vitest";
import {
  browseProgress,
  browseState,
  browseSummary,
  browseSummaryText,
  monthOffers,
  monthRouteAllowed,
  nextBrowseIndex,
  parseMonthView,
  parsePosition,
  parsePostReturn,
  postLinkQuery,
  selectMonthPosts,
  startBrowseIndex,
  stepBrowseIndex,
  viewPath,
  withApproved,
  type BrowseItem,
} from "@/lib/month-rules";
import { progressLabel } from "@/lib/plan-rules";

const item = (id: string, over: Partial<BrowseItem> = {}): BrowseItem => ({
  id,
  status: "IN_REVIEW",
  canAct: true,
  openComments: 0,
  ...over,
});

describe("month view in the URL", () => {
  it("reads ?vista= and falls back for anything unknown", () => {
    expect(parseMonthView("griglia")).toBe("griglia");
    expect(parseMonthView(" Sfoglia ")).toBe("sfoglia");
    expect(parseMonthView(["sfoglia", "griglia"])).toBe("sfoglia");
    expect(parseMonthView("calendario")).toBe("panoramica");
    expect(parseMonthView(undefined)).toBe("panoramica");
    expect(parseMonthView(42)).toBe("panoramica");
  });

  it("honours the views a page has: the month route has no Panoramica", () => {
    const month = { allowed: ["griglia", "sfoglia"] as const, fallback: "griglia" as const };
    expect(parseMonthView("panoramica", month)).toBe("griglia");
    expect(parseMonthView(undefined, month)).toBe("griglia");
    expect(parseMonthView("sfoglia", month)).toBe("sfoglia");
  });

  it("reads ?i= as a 1-based position", () => {
    expect(parsePosition("3")).toBe(3);
    expect(parsePosition(["2"])).toBe(2);
    expect(parsePosition("0")).toBeNull();
    expect(parsePosition("-1")).toBeNull();
    expect(parsePosition("2.5")).toBeNull();
    expect(parsePosition("abc")).toBeNull();
    expect(parsePosition("501")).toBeNull();
    expect(parsePosition(undefined)).toBeNull();
  });

  it("builds view paths: Panoramica is the bare path", () => {
    expect(viewPath("/review/t/piani/p1", "panoramica")).toBe("/review/t/piani/p1");
    expect(viewPath("/review/t/piani/p1", "griglia")).toBe("/review/t/piani/p1?vista=griglia");
    expect(viewPath("/review/t/piani/p1", "sfoglia", 3)).toBe("/review/t/piani/p1?vista=sfoglia&i=3");
    expect(viewPath("/review/t/piani/p1", "griglia", 3)).toBe("/review/t/piani/p1?vista=griglia");
  });

  it("links a post from a month view and reads the way back", () => {
    expect(postLinkQuery("sfoglia", { position: 3 })).toBe("?da=sfoglia&i=3");
    expect(postLinkQuery("sfoglia", { position: 3, month: "2026-10" })).toBe("?da=sfoglia&i=3&mese=2026-10");
    expect(postLinkQuery("griglia")).toBe("?da=griglia");
    expect(postLinkQuery("griglia", { month: "oct" })).toBe("?da=griglia");
    expect(parsePostReturn({ da: "sfoglia", i: "3", mese: "2026-10" })).toEqual({ da: "sfoglia", i: 3, mese: "2026-10" });
    expect(parsePostReturn({ da: "griglia" })).toEqual({ da: "griglia", i: null, mese: null });
    expect(parsePostReturn({ da: "https://evil.example", i: "3" })).toBeNull();
    expect(parsePostReturn({})).toBeNull();
    // A bad month never reaches a link.
    expect(parsePostReturn({ da: "sfoglia", mese: "../x" })?.mese).toBeNull();
  });
});

describe("posts of a month and the month route guard", () => {
  const post = (id: string, publishAt: string, kind: "SOCIAL_POST" | "BLOG_ARTICLE" = "SOCIAL_POST") => ({
    id,
    kind,
    publishAt: new Date(publishAt),
  });

  it("keeps social posts of the month in the client's time zone, in calendar order", () => {
    const posts = [
      post("late", "2026-10-31T22:30:00Z"), // 23:30 on 31 October in Rome: October
      post("nov", "2026-10-31T23:30:00Z"), // 00:30 on 1 November in Rome
      post("early", "2026-10-04T07:00:00Z"),
      post("article", "2026-10-10T07:00:00Z", "BLOG_ARTICLE"),
      post("sept", "2026-09-30T21:00:00Z"), // 23:00 on 30 September in Rome
    ];
    expect(selectMonthPosts(posts, "2026-10", "Europe/Rome").map((p) => p.id)).toEqual(["early", "late"]);
    expect(selectMonthPosts(posts, "2026-11", "Europe/Rome").map((p) => p.id)).toEqual(["nov"]);
    expect(selectMonthPosts(posts, "2026-10", "America/New_York").map((p) => p.id)).toEqual(["early", "late", "nov"]);
  });

  it("returns nothing for a malformed month", () => {
    expect(selectMonthPosts([post("a", "2026-10-04T07:00:00Z")], "ottobre", "Europe/Rome")).toEqual([]);
    expect(selectMonthPosts([post("a", "2026-10-04T07:00:00Z")], "2026-13", "Europe/Rome")).toEqual([]);
  });

  it("answers not found for a malformed month or a month with nothing to show", () => {
    expect(monthRouteAllowed("2026-10", 3)).toBe(true);
    expect(monthRouteAllowed("2026-10", 0)).toBe(false);
    expect(monthRouteAllowed("2026-1", 3)).toBe(false);
    expect(monthRouteAllowed(" 2026-10", 3)).toBe(false);
    expect(monthRouteAllowed("../../etc", 3)).toBe(false);
  });
});

describe("offer on the portal home", () => {
  const waiting = (publishAt: string, over: Record<string, unknown> = {}) => ({
    kind: "SOCIAL_POST" as const,
    canAct: true,
    publishAt: new Date(publishAt),
    ...over,
  });

  it("offers a month with at least two social posts waiting", () => {
    expect(monthOffers([waiting("2026-10-12T09:00:00Z"), waiting("2026-10-20T09:00:00Z")], "Europe/Rome")).toEqual([
      { month: "2026-10", count: 2 },
    ]);
  });

  it("does not offer one post, posts not waiting or other kinds", () => {
    expect(monthOffers([waiting("2026-10-12T09:00:00Z")], "Europe/Rome")).toEqual([]);
    expect(
      monthOffers([waiting("2026-10-12T09:00:00Z"), waiting("2026-10-20T09:00:00Z", { canAct: false })], "Europe/Rome")
    ).toEqual([]);
    expect(
      monthOffers([waiting("2026-10-12T09:00:00Z"), waiting("2026-10-20T09:00:00Z", { kind: "BLOG_ARTICLE" })], "Europe/Rome")
    ).toEqual([]);
  });

  it("counts months in the client's time zone, earliest first, at most the limit", () => {
    const posts = [
      waiting("2026-11-02T10:00:00Z"),
      waiting("2026-11-09T10:00:00Z"),
      waiting("2026-10-31T23:30:00Z"), // 00:30 on 1 November in Rome
      waiting("2026-10-05T10:00:00Z"),
      waiting("2026-10-06T10:00:00Z"),
      waiting("2027-01-05T10:00:00Z"),
      waiting("2027-01-06T10:00:00Z"),
      waiting("2027-02-05T10:00:00Z"),
      waiting("2027-02-06T10:00:00Z"),
    ];
    expect(monthOffers(posts, "Europe/Rome")).toEqual([
      { month: "2026-10", count: 2 },
      { month: "2026-11", count: 3 },
      { month: "2027-01", count: 2 },
    ]);
    expect(monthOffers(posts, "Europe/Rome", 1)).toHaveLength(1);
  });
});

describe("Sfoglia card state", () => {
  it("tells waiting, comments left, changes requested, approved and locked apart", () => {
    expect(browseState(item("a"))).toBe("waiting");
    expect(browseState(item("a", { openComments: 2 }))).toBe("feedback");
    expect(browseState(item("a", { status: "CHANGES_REQUESTED", canAct: false }))).toBe("changes");
    expect(browseState(item("a", { status: "APPROVED", canAct: false }))).toBe("approved");
    expect(browseState(item("a", { status: "SCHEDULED", canAct: false }))).toBe("approved");
    expect(browseState(item("a", { status: "FAILED", canAct: false }))).toBe("approved");
    // IN_REVIEW the client cannot act on: the agency is updating it.
    expect(browseState(item("a", { canAct: false }))).toBe("locked");
  });

  it("overlays what was approved in this session, only on waiting posts", () => {
    const items = [item("a"), item("b", { openComments: 1 }), item("c", { status: "CHANGES_REQUESTED", canAct: false })];
    const after = withApproved(items, new Set(["a", "b", "c"]));
    expect(after.map(browseState)).toEqual(["approved", "feedback", "changes"]);
    expect(withApproved(items, new Set())).toEqual(items);
  });
});

describe("Sfoglia progress and summary", () => {
  const items = [
    item("1", { status: "APPROVED", canAct: false }),
    item("2", { status: "SCHEDULED", canAct: false }),
    item("3"),
    item("4", { openComments: 1 }),
    item("5", { status: "CHANGES_REQUESTED", canAct: false }),
    item("6", { canAct: false }),
  ];

  it("counts approved posts for the bar", () => {
    const progress = browseProgress(items);
    expect(progress).toMatchObject({ total: 6, approved: 2, changes: 1, inReview: 3 });
    expect(progressLabel(progress)).toBe("2 di 6 approvati");
  });

  it("summarises the end: approved, with comments, still to decide", () => {
    const summary = browseSummary(items);
    expect(summary).toEqual({ total: 6, approved: 2, withComments: 2, waiting: 1, locked: 1 });
    expect(browseSummaryText(summary)).toBe("2 approvati, 2 con commenti, 1 da decidere");
    expect(browseSummaryText({ approved: 10, withComments: 2, waiting: 0 })).toBe("10 approvati, 2 con commenti");
    expect(browseSummaryText({ approved: 1, withComments: 1, waiting: 0 })).toBe("1 approvato, 1 con commento");
    expect(browseSummaryText({ approved: 0, withComments: 0, waiting: 0 })).toBe("nessun post deciso");
  });
});

describe("Sfoglia navigation", () => {
  const waiting = (id: string) => item(id);
  const approved = (id: string) => item(id, { status: "APPROVED", canAct: false });
  const commented = (id: string) => item(id, { openComments: 1 });

  it("goes to the next post still waiting, skipping decided ones", () => {
    const items = [approved("a"), waiting("b"), approved("c"), commented("d"), waiting("e")];
    expect(nextBrowseIndex(items, 1)).toBe(4);
    expect(nextBrowseIndex(items, 0)).toBe(1);
  });

  it("brings a skipped post back before the summary", () => {
    const items = [waiting("a"), approved("b"), waiting("c")];
    expect(nextBrowseIndex(items, 2)).toBe(0);
  });

  it("ends on the summary when nothing waits any more", () => {
    const items = [approved("a"), approved("b"), commented("c")];
    expect(nextBrowseIndex(items, 1)).toBe(3);
    expect(nextBrowseIndex([], 0)).toBe(0);
    // The post just approved is no longer waiting.
    expect(nextBrowseIndex(withApproved([waiting("a"), waiting("b")], new Set(["b"])), 1)).toBe(0);
  });

  it("starts on the requested position, else on the first waiting post, else on the summary", () => {
    const items = [approved("a"), waiting("b"), waiting("c")];
    expect(startBrowseIndex(items, 3)).toBe(2);
    expect(startBrowseIndex(items, 1)).toBe(0);
    expect(startBrowseIndex(items, 4)).toBe(3); // the summary
    expect(startBrowseIndex(items, 99)).toBe(3);
    expect(startBrowseIndex(items, null)).toBe(1);
    expect(startBrowseIndex([approved("a")], null)).toBe(1);
  });

  it("steps by hand inside 0..summary", () => {
    expect(stepBrowseIndex(0, -1, 5)).toBe(0);
    expect(stepBrowseIndex(2, 1, 5)).toBe(3);
    expect(stepBrowseIndex(5, 1, 5)).toBe(5);
    expect(stepBrowseIndex(4, 1, 5)).toBe(5);
  });
});
