import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  availableCommands,
  buildCommentThreads,
  buildMonthGrid,
  buildPostsHref,
  captionCounters,
  charCount,
  dayKeyIn,
  describeEvent,
  editWarning,
  formatBytes,
  formatMoment,
  groupByDay,
  isDayKey,
  isEditable,
  localPartsToUtc,
  moveItem,
  parseMonthParam,
  parseStatusFilter,
  pruneNetworkOptions,
  setNetworkOption,
  sortThreadsByMoment,
  startOfDayUtc,
  startOfWeek,
  statusesForFilter,
  toLocalParts,
  type CommentLike,
} from "../components/posts/helpers";

describe("status filters and commands", () => {
  it("parses ?status=", () => {
    expect(parseStatusFilter("attention")).toEqual({ kind: "attention" });
    expect(parseStatusFilter("FAILED")).toEqual({ kind: "status", status: "FAILED" });
    expect(parseStatusFilter(["IN_REVIEW", "x"])).toEqual({ kind: "status", status: "IN_REVIEW" });
    expect(parseStatusFilter("nope")).toEqual({ kind: "all" });
    expect(parseStatusFilter(undefined)).toEqual({ kind: "all" });
  });

  it("maps filters to statuses; 'all' hides cancelled", () => {
    expect(statusesForFilter({ kind: "attention" })).toEqual(["CHANGES_REQUESTED", "FAILED"]);
    expect(statusesForFilter({ kind: "all" })).not.toContain("CANCELLED");
    expect(statusesForFilter({ kind: "status", status: "CANCELLED" })).toEqual(["CANCELLED"]);
  });

  it("offers only what the state machine allows", () => {
    expect(availableCommands("DRAFT")).toEqual(["submit", "cancel"]);
    expect(availableCommands("CHANGES_REQUESTED")).toEqual(["submit", "cancel"]);
    expect(availableCommands("IN_REVIEW")).toEqual(["cancel"]);
    expect(availableCommands("APPROVED")).toEqual(["schedule", "cancel"]);
    expect(availableCommands("FAILED")).toEqual(["retry", "cancel"]);
    expect(availableCommands("SCHEDULING")).toEqual([]);
    expect(availableCommands("SCHEDULED")).toEqual([]);
    expect(availableCommands("CANCELLED")).toEqual([]);
  });

  it("freezes scheduled and cancelled posts", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("APPROVED")).toBe(true);
    expect(isEditable("SCHEDULED")).toBe(false);
    expect(isEditable("SCHEDULING")).toBe(false);
    expect(isEditable("CANCELLED")).toBe(false);
    expect(editWarning("APPROVED")).toMatch(/torna in bozza/);
    expect(editWarning("DRAFT")).toBeNull();
  });

  it("builds list URLs", () => {
    expect(buildPostsHref({})).toBe("/posts");
    expect(buildPostsHref({ status: "attention", clientId: "c1", q: " lancio ", pagina: 2 })).toBe(
      "/posts?status=attention&clientId=c1&q=lancio&pagina=2"
    );
    expect(buildPostsHref({ periodo: "prossimi", pagina: 1 })).toBe("/posts?periodo=prossimi");
  });
});

describe("dates in the client's time zone", () => {
  it("round-trips the editor's date and time inputs", () => {
    const instant = new Date("2026-07-15T08:30:00Z");
    expect(toLocalParts(instant, "Europe/Rome")).toEqual({ date: "2026-07-15", time: "10:30" });
    expect(localPartsToUtc("2026-07-15", "10:30", "Europe/Rome")?.toISOString()).toBe("2026-07-15T08:30:00.000Z");
    expect(toLocalParts(instant, "America/New_York")).toEqual({ date: "2026-07-15", time: "04:30" });
  });

  it("handles winter time and rejects incomplete input", () => {
    expect(localPartsToUtc("2026-12-01", "10:00", "Europe/Rome")?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(localPartsToUtc("2026-12-01", "", "Europe/Rome")).toBeNull();
    expect(localPartsToUtc("01/12/2026", "10:00", "Europe/Rome")).toBeNull();
  });

  it("falls back to Europe/Rome for an invalid zone", () => {
    expect(toLocalParts(new Date("2026-07-15T08:30:00Z"), "Mars/Base")).toEqual({ date: "2026-07-15", time: "10:30" });
  });

  it("puts a post on the client's day, not the server's", () => {
    // 23:30 UTC on Oct 5 is already Oct 6 in Rome.
    const late = new Date("2026-10-05T23:30:00Z");
    expect(dayKeyIn(late, "Europe/Rome")).toBe("2026-10-06");
    expect(dayKeyIn(late, "America/New_York")).toBe("2026-10-05");
    const grouped = groupByDay([{ at: late }, { at: new Date("2026-10-06T10:00:00Z") }], (x) => x.at, "Europe/Rome");
    expect(grouped.get("2026-10-06")).toHaveLength(2);
  });

  it("computes local midnight across the DST change", () => {
    expect(startOfDayUtc("2026-10-25", "Europe/Rome").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfDayUtc("2026-10-26", "Europe/Rome").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("calendar grid", () => {
  it("validates day and month params", () => {
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-2-3")).toBe(false);
    expect(parseMonthParam("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
  });

  it("does day and month arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(startOfWeek("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("builds Monday-first weeks covering the month", () => {
    const grid = buildMonthGrid({ year: 2026, month: 10 });
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid[grid.length - 1][6]).toBe("2026-11-01");
    expect(grid).toHaveLength(5);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    // February 2027 starts on a Monday and fits in 4 weeks.
    expect(buildMonthGrid({ year: 2027, month: 2 })).toHaveLength(4);
  });
});

describe("caption and network options", () => {
  it("counts characters like users do", () => {
    expect(charCount("ciao 👋")).toBe(6);
  });

  it("shows a counter per network, without a limit for Stories", () => {
    const text = "x".repeat(301);
    const counters = captionCounters(text, ["bluesky", "instagram", "facebook"], { facebookData: { type: "STORY" } });
    expect(counters.find((c) => c.network === "bluesky")).toMatchObject({ limit: 300, over: true });
    expect(counters.find((c) => c.network === "instagram")).toMatchObject({ limit: 2200, over: false });
    expect(counters.find((c) => c.network === "facebook")).toMatchObject({ noCaption: true, over: false });
  });

  it("sets and removes options immutably", () => {
    const base = { instagramData: { type: "REEL" } };
    const withTitle = setNetworkOption(base, "youtube", "title", "Video");
    expect(withTitle).toEqual({ instagramData: { type: "REEL" }, youtubeData: { title: "Video" } });
    expect(base).toEqual({ instagramData: { type: "REEL" } });
    expect(setNetworkOption(withTitle, "youtube", "title", "")).toEqual(base);
    expect(pruneNetworkOptions(withTitle, ["youtube"])).toEqual({ youtubeData: { title: "Video" } });
  });

  it("moves media", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("formats sizes and moments", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5,5 MB");
    expect(formatMoment(7)).toBe("0:07");
    expect(formatMoment(12, 15)).toBe("0:12–0:15");
    expect(formatMoment(12, 12)).toBe("0:12");
  });
});

describe("comment threads", () => {
  const base: CommentLike = {
    id: "",
    versionId: "v1",
    authorType: "CLIENT",
    body: "",
    mediaIndex: null,
    pinX: null,
    pinY: null,
    timeSec: null,
    timeEndSec: null,
    resolvedAt: null,
    createdAt: "2026-10-01T10:00:00Z",
  };
  const c = (patch: Partial<CommentLike>): CommentLike => ({ ...base, ...patch });

  it("groups replies on the same anchor and keeps general comments apart", () => {
    const comments = [
      c({ id: "a", mediaIndex: 0, timeSec: 7, createdAt: "2026-10-01T10:00:00Z" }),
      c({ id: "g1", createdAt: "2026-10-01T10:01:00Z" }),
      c({ id: "r", authorType: "AGENCY", mediaIndex: 0, timeSec: 7, createdAt: "2026-10-01T11:00:00Z" }),
      c({ id: "g2", authorType: "AGENCY", createdAt: "2026-10-01T12:00:00Z" }),
      c({ id: "other-version", versionId: "v2", mediaIndex: 0, timeSec: 7, createdAt: "2026-10-01T12:30:00Z" }),
    ];
    const threads = buildCommentThreads(comments);
    expect(threads.map((t) => t.id)).toEqual(["a", "g1", "g2", "other-version"]);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["r"]);
  });

  it("is resolved only when every comment is", () => {
    const threads = buildCommentThreads([
      c({ id: "a", mediaIndex: 1, pinX: 0.5, pinY: 0.5, resolvedAt: "2026-10-02T10:00:00Z" }),
      c({ id: "b", mediaIndex: 1, pinX: 0.5, pinY: 0.5, createdAt: "2026-10-01T11:00:00Z" }),
      c({ id: "g", resolvedAt: "2026-10-02T10:00:00Z" }),
    ]);
    expect(threads.find((t) => t.id === "a")?.resolved).toBe(false);
    expect(threads.find((t) => t.id === "g")?.resolved).toBe(true);
  });

  it("sorts video notes by media and moment, then the rest by date", () => {
    const threads = buildCommentThreads([
      c({ id: "late", mediaIndex: 0, timeSec: 12, createdAt: "2026-10-01T09:00:00Z" }),
      c({ id: "general", createdAt: "2026-10-01T08:00:00Z" }),
      c({ id: "early", mediaIndex: 0, timeSec: 3, createdAt: "2026-10-01T10:00:00Z" }),
      c({ id: "second-video", mediaIndex: 1, timeSec: 1, createdAt: "2026-10-01T07:00:00Z" }),
    ]);
    expect(sortThreadsByMoment(threads).map((t) => t.id)).toEqual(["early", "late", "second-video", "general"]);
  });
});

describe("event timeline", () => {
  it("describes events in Italian with their actor and details", () => {
    expect(
      describeEvent({ type: "APPROVED", versionNumber: 2, metadata: {}, reviewer: { name: "Giulia" } }).title
    ).toBe("Giulia ha approvato il post (versione 2)");

    const version = describeEvent({
      type: "VERSION_CREATED",
      versionNumber: 3,
      metadata: { changes: ["Testo modificato"], changeNote: "Accorciato", toStatus: "DRAFT" },
      user: { name: null, email: "anna@agenzia.it" },
    });
    expect(version.title).toBe("anna@agenzia.it ha creato la versione 3");
    expect(version.details).toEqual(["Testo modificato", "Nota: Accorciato", "Stato: bozza"]);

    const failed = describeEvent({ type: "SCHEDULE_FAILED", versionNumber: 1, metadata: { error: "Token scaduto" } });
    expect(failed).toMatchObject({ tone: "error", details: ["Token scaduto"] });

    const comment = describeEvent({
      type: "COMMENTED",
      versionNumber: 1,
      metadata: { timeSec: 12, timeEndSec: 15 },
      reviewer: { name: "Luca" },
    });
    expect(comment.title).toBe("Luca ha scritto un commento (versione 1)");
    expect(comment.details).toEqual(["Al momento 0:12–0:15"]);

    expect(describeEvent({ type: "SCHEDULE_REQUESTED", versionNumber: 1, metadata: { retry: true }, user: { name: "Anna" } }).title).toBe(
      "Anna ha riprovato la programmazione"
    );
    expect(describeEvent({ type: "SCHEDULE_REQUESTED", versionNumber: 1, metadata: {} }).title).toBe(
      "Programmazione su Metricool richiesta"
    );
  });
});
