import { describe, expect, it } from "vitest";
import { formatPlanSlot } from "@/components/portal/helpers";
import { planLinkMessage } from "@/components/share/messages";
import { planEmailCopy } from "@/lib/notifications";
import {
  addPlanMonths,
  byPublishAsc,
  defaultPlanTitle,
  derivePlanStatus,
  instagramGridOrder,
  isInPlanMonth,
  isPlanDecided,
  parsePlanMonth,
  planHeading,
  planMonthLabel,
  planMonthOf,
  planMonthRange,
  planNeighbors,
  planOutcomeSummary,
  planProgress,
  planStatusLabel,
  progressLabel,
  progressPercent,
  selectApproveAll,
  type ApproveAllCandidate,
} from "@/lib/plan-rules";

describe("plan months", () => {
  it("parses YYYY-MM and rejects anything else", () => {
    expect(parsePlanMonth("2026-10")).toBe("2026-10");
    expect(parsePlanMonth(" 2026-10 ")).toBe("2026-10");
    expect(parsePlanMonth("2026-13")).toBeNull();
    expect(parsePlanMonth("2026-1")).toBeNull();
    expect(parsePlanMonth("1999-12")).toBeNull();
    expect(parsePlanMonth("ottobre")).toBeNull();
    expect(parsePlanMonth(undefined)).toBeNull();
    expect(parsePlanMonth(["2026-11"])).toBe("2026-11");
  });

  it("adds months across years", () => {
    expect(addPlanMonths("2026-10", 1)).toBe("2026-11");
    expect(addPlanMonths("2026-12", 1)).toBe("2027-01");
    expect(addPlanMonths("2027-01", -1)).toBe("2026-12");
    expect(addPlanMonths("2026-10", 15)).toBe("2028-01");
  });

  it("bounds a month at local midnight in the client's time zone (Europe/Rome, DST change inside)", () => {
    const { start, end } = planMonthRange("2026-10", "Europe/Rome");
    // 1 October 00:00 CEST = 30 September 22:00 UTC; 1 November 00:00 CET = 31 October 23:00 UTC.
    expect(start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });

  it("puts a post at 23:30 on the last day in Rome in that month, and 00:30 the next day in the next one", () => {
    const lastEvening = new Date("2026-10-31T22:30:00Z"); // 31 Oct 23:30 in Rome (CET)
    const firstNight = new Date("2026-10-31T23:30:00Z"); // 1 Nov 00:30 in Rome
    expect(isInPlanMonth(lastEvening, "2026-10", "Europe/Rome")).toBe(true);
    expect(isInPlanMonth(lastEvening, "2026-11", "Europe/Rome")).toBe(false);
    expect(isInPlanMonth(firstNight, "2026-10", "Europe/Rome")).toBe(false);
    expect(isInPlanMonth(firstNight, "2026-11", "Europe/Rome")).toBe(true);
    expect(planMonthOf(lastEvening, "Europe/Rome")).toBe("2026-10");
    expect(planMonthOf(firstNight, "Europe/Rome")).toBe("2026-11");
    // The same instant is already November in UTC terms only for the second one.
    expect(planMonthOf(firstNight, "UTC")).toBe("2026-10");
  });

  it("starts the month at local midnight of the 1st (summer time)", () => {
    const firstMinute = new Date("2026-09-30T22:00:00Z"); // 1 Oct 00:00 CEST
    expect(isInPlanMonth(firstMinute, "2026-10", "Europe/Rome")).toBe(true);
    expect(isInPlanMonth(new Date("2026-09-30T21:59:59Z"), "2026-10", "Europe/Rome")).toBe(false);
  });

  it("follows other time zones and falls back to Rome on a bad one", () => {
    const { start } = planMonthRange("2026-11", "America/New_York");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // EDT until 1 Nov 02:00
    expect(planMonthRange("2026-10", "Not/AZone").start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(() => planMonthRange("2026-1", "Europe/Rome")).toThrow();
  });

  it("names months and plans in Italian", () => {
    expect(planMonthLabel("2026-10")).toBe("ottobre 2026");
    expect(defaultPlanTitle("2026-10")).toBe("Piano social ottobre 2026");
    const now = new Date("2026-10-07T10:00:00Z");
    expect(planHeading("2026-10", { now, timeZone: "Europe/Rome" })).toBe("Piano social di ottobre");
    expect(planHeading("2027-01", { now, timeZone: "Europe/Rome" })).toBe("Piano social di gennaio 2027");
  });
});

describe("plan status", () => {
  it("is a draft without posts or with only drafts", () => {
    expect(derivePlanStatus([])).toBe("DRAFT");
    expect(derivePlanStatus(["DRAFT", "DRAFT"])).toBe("DRAFT");
    expect(derivePlanStatus(["CANCELLED"])).toBe("DRAFT");
  });

  it("is in review while any post waits for the client", () => {
    expect(derivePlanStatus(["IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "DRAFT"])).toBe("IN_REVIEW");
  });

  it("asks for changes when the client decided everything and asked changes on some", () => {
    expect(derivePlanStatus(["APPROVED", "SCHEDULED", "CHANGES_REQUESTED"])).toBe("CHANGES_REQUESTED");
    expect(derivePlanStatus(["CHANGES_REQUESTED", "DRAFT"])).toBe("CHANGES_REQUESTED");
  });

  it("goes back to draft when something must be (re)sent and nothing else is pending", () => {
    expect(derivePlanStatus(["APPROVED", "DRAFT"])).toBe("DRAFT");
  });

  it("is approved when every live post is approved, scheduled or failed on Metricool", () => {
    expect(derivePlanStatus(["APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "CANCELLED"])).toBe("APPROVED");
  });

  it("counts progress and says it in Italian", () => {
    const progress = planProgress(["APPROVED", "SCHEDULED", "IN_REVIEW", "CHANGES_REQUESTED", "DRAFT", "CANCELLED"]);
    expect(progress).toEqual({ total: 5, approved: 2, inReview: 1, changes: 1, draft: 1 });
    expect(progressLabel({ approved: 8, total: 12 })).toBe("8 di 12 approvati");
    expect(progressLabel({ approved: 0, total: 1 })).toBe("0 di 1 approvato");
    expect(progressPercent({ approved: 3, total: 12 })).toBe(25);
    expect(progressPercent({ approved: 0, total: 0 })).toBe(0);
  });

  it("is decided when nothing waits for the client and something got an answer", () => {
    expect(isPlanDecided(["APPROVED", "CHANGES_REQUESTED"])).toBe(true);
    expect(isPlanDecided(["APPROVED", "IN_REVIEW"])).toBe(false);
    expect(isPlanDecided(["DRAFT"])).toBe(false);
    expect(isPlanDecided([])).toBe(false);
    expect(planOutcomeSummary(["APPROVED", "SCHEDULED", "CHANGES_REQUESTED", "CHANGES_REQUESTED"])).toBe(
      "2 approvati, 2 con modifiche"
    );
    expect(planOutcomeSummary(["APPROVED"])).toBe("1 approvato");
  });

  it("labels a draft plan by whether it went out already", () => {
    expect(planStatusLabel("DRAFT", false)).toBe("Bozza");
    expect(planStatusLabel("DRAFT", true)).toBe("Da inviare");
    expect(planStatusLabel("IN_REVIEW", true)).toBe("In revisione");
  });
});

describe("order and navigation", () => {
  const posts = [
    { id: "b", publishAt: new Date("2026-10-10T08:00:00Z") },
    { id: "a", publishAt: new Date("2026-10-03T08:00:00Z") },
    { id: "c", publishAt: new Date("2026-10-20T08:00:00Z") },
  ];

  it("lists the calendar earliest first and the Instagram grid newest first", () => {
    expect(byPublishAsc(posts).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(instagramGridOrder(posts).map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("finds the previous and next post of the plan", () => {
    expect(planNeighbors(["a", "b", "c"], "b")).toEqual({ prevId: "a", nextId: "c", position: 2, total: 3 });
    expect(planNeighbors(["a", "b", "c"], "a")).toEqual({ prevId: null, nextId: "b", position: 1, total: 3 });
    expect(planNeighbors(["a", "b", "c"], "c")).toEqual({ prevId: "b", nextId: null, position: 3, total: 3 });
    expect(planNeighbors(["a"], "x")).toEqual({ prevId: null, nextId: null, position: null, total: 1 });
  });
});

describe("Approva tutto il piano", () => {
  const candidate = (overrides: Partial<ApproveAllCandidate> & { id: string }): ApproveAllCandidate => ({
    title: `Post ${overrides.id}`,
    status: "IN_REVIEW",
    versionNumber: 1,
    canAct: true,
    openClientComments: 0,
    ...overrides,
  });

  it("approves only posts waiting for the client, at their version", () => {
    const result = selectApproveAll([
      candidate({ id: "a" }),
      candidate({ id: "b", versionNumber: 3 }),
      candidate({ id: "c", status: "APPROVED", canAct: false }),
      candidate({ id: "d", status: "SCHEDULED", canAct: false }),
    ]);
    expect(result.approve).toEqual([
      { id: "a", versionNumber: 1 },
      { id: "b", versionNumber: 3 },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("leaves out posts with open client comments and those with changes requested, and lists them", () => {
    const result = selectApproveAll([
      candidate({ id: "a" }),
      candidate({ id: "b", openClientComments: 2 }),
      candidate({ id: "c", status: "CHANGES_REQUESTED", canAct: false }),
    ]);
    expect(result.approve.map((p) => p.id)).toEqual(["a"]);
    expect(result.skipped).toEqual([
      { id: "b", title: "Post b", reason: "comments" },
      { id: "c", title: "Post c", reason: "changes" },
    ]);
  });

  it("leaves out a post at another version than the one shown, or not shown at all", () => {
    const seen = new Map([
      ["a", 1],
      ["b", 1],
    ]);
    const result = selectApproveAll(
      [candidate({ id: "a" }), candidate({ id: "b", versionNumber: 2 }), candidate({ id: "c" })],
      seen
    );
    expect(result.approve).toEqual([{ id: "a", versionNumber: 1 }]);
    expect(result.skipped.map((s) => [s.id, s.reason])).toEqual([
      ["b", "stale"],
      ["c", "stale"],
    ]);
  });

  it("never approves a post that is not IN_REVIEW, whatever the page sent", () => {
    const seen = new Map([
      ["a", 1],
      ["b", 1],
    ]);
    const result = selectApproveAll(
      [candidate({ id: "a", status: "DRAFT", canAct: false }), candidate({ id: "b", status: "FAILED", canAct: false })],
      seen
    );
    expect(result.approve).toEqual([]);
  });
});

describe("plan wording", () => {
  it("writes one email for the whole plan", () => {
    const copy = planEmailCopy({
      heading: "Piano social di ottobre",
      clientName: "Caffè Aurora",
      agencyName: "InsidersLab",
      toReview: 12,
    });
    expect(copy.subject).toBe("Piano social di ottobre per Caffè Aurora: 12 post da approvare");
    expect(copy.intro).toMatch(/^InsidersLab ha preparato il piano social di ottobre per Caffè Aurora: 12 post da rivedere\./);
    expect(copy.ctaLabel).toBe("Rivedi il piano");
  });

  it("prefills the WhatsApp message with the plan link", () => {
    expect(
      planLinkMessage({
        reviewerName: "Chiara Fabbri",
        clientName: "Agriturismo Le Querce",
        planName: "piano social di ottobre",
        toReview: 12,
        url: "https://approve.heili.cloud/review/t/piani/p",
      })
    ).toBe(
      "Ciao Chiara, ecco il piano social di ottobre per Agriturismo Le Querce: 12 post da rivedere. https://approve.heili.cloud/review/t/piani/p"
    );
  });

  it("formats a plan slot in the client's zone", () => {
    expect(formatPlanSlot(new Date("2026-10-31T22:30:00Z"), "Europe/Rome")).toBe("sab 31 ottobre · 23:30");
  });
});
