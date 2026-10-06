import { describe, expect, it } from "vitest";
import {
  checkMomentInput,
  countDecisions,
  dateLabelFor,
  decisionProgressLabel,
  diffBaseline,
  formatMoment,
  formatPortalDate,
  formatShortDateTime,
  groupPortalPosts,
  mediaName,
  nextPostToReview,
  numberPassageComments,
  orderComments,
  parseMomentInput,
  portalNoun,
  portalPath,
  portalStatusLabel,
  portalTitle,
  portalTone,
  portalWording,
} from "@/components/portal/helpers";

const NOW = new Date("2026-10-05T10:00:00Z");

describe("groupPortalPosts", () => {
  const post = (id: string, status: Parameters<typeof portalTone>[0], canAct: boolean, publishAt: string) => ({
    id,
    status,
    canAct,
    publishAt: new Date(publishAt),
  });

  it("puts posts to review first, then changes requested, then approved by date", () => {
    const groups = groupPortalPosts(
      [
        post("approved-late", "SCHEDULED", false, "2026-10-20T10:00:00Z"),
        post("review-b", "IN_REVIEW", true, "2026-10-12T10:00:00Z"),
        post("changes", "CHANGES_REQUESTED", false, "2026-10-08T10:00:00Z"),
        post("review-a", "IN_REVIEW", true, "2026-10-07T10:00:00Z"),
        post("approved-soon", "APPROVED", false, "2026-10-06T10:00:00Z"),
        post("failed", "FAILED", false, "2026-10-09T10:00:00Z"),
        post("past-1", "SCHEDULED", false, "2026-09-01T10:00:00Z"),
        post("past-2", "SCHEDULED", false, "2026-10-01T10:00:00Z"),
      ],
      NOW
    );
    expect(groups.toReview.map((p) => p.id)).toEqual(["review-a", "review-b"]);
    expect(groups.inProgress.map((p) => p.id)).toEqual(["changes"]);
    expect(groups.approvedUpcoming.map((p) => p.id)).toEqual(["approved-soon", "failed", "approved-late"]);
    expect(groups.approvedPast.map((p) => p.id)).toEqual(["past-2", "past-1"]);
  });

  it("treats an IN_REVIEW post the client cannot act on as waiting", () => {
    expect(portalTone("IN_REVIEW", false)).toBe("waiting");
    expect(portalTone("IN_REVIEW", true)).toBe("action");
    expect(portalTone("SCHEDULING", false)).toBe("done");
  });
});

describe("nextPostToReview", () => {
  it("returns the following post and wraps around", () => {
    expect(nextPostToReview(["a", "b", "c"], "a")).toBe("b");
    expect(nextPostToReview(["a", "b", "c"], "c")).toBe("a");
  });

  it("returns the first one when the current post is no longer in the queue", () => {
    expect(nextPostToReview(["b", "c"], "a")).toBe("b");
  });

  it("never returns the current post", () => {
    expect(nextPostToReview(["a"], "a")).toBeNull();
    expect(nextPostToReview([], "a")).toBeNull();
  });
});

describe("dates in the client's time zone", () => {
  it("formats the publish date with weekday and time", () => {
    expect(formatPortalDate(new Date("2026-10-07T16:30:00Z"), "Europe/Rome", { now: NOW })).toBe(
      "mercoledì 7 ottobre alle 18:30"
    );
  });

  it("uses the client's zone, not the server's", () => {
    expect(formatPortalDate(new Date("2026-10-07T16:30:00Z"), "America/New_York", { now: NOW })).toBe(
      "mercoledì 7 ottobre alle 12:30"
    );
  });

  it("adds the year only when it is not the current one, and can omit the time", () => {
    expect(formatPortalDate(new Date("2027-01-04T09:00:00Z"), "Europe/Rome", { now: NOW, withTime: false })).toBe(
      "lunedì 4 gennaio 2027"
    );
  });

  it("falls back to Europe/Rome on an invalid zone", () => {
    expect(formatPortalDate(new Date("2026-10-07T16:30:00Z"), "Mars/Base", { now: NOW })).toBe(
      "mercoledì 7 ottobre alle 18:30"
    );
  });

  it("formats comment timestamps compactly", () => {
    expect(formatShortDateTime(new Date("2026-10-07T07:05:00Z"), "Europe/Rome")).toBe("7 ott, 09:05");
  });
});

describe("diffBaseline", () => {
  it("compares with the newest version the reviewer opened before", () => {
    expect(diffBaseline([1, 2, 3], 4, [1, 2, 3, 4])).toEqual({ number: 3, seenByReviewer: true });
    expect(diffBaseline([1, 4], 4, [1, 2, 3, 4])).toEqual({ number: 1, seenByReviewer: true });
  });

  it("falls back to the previous version when the reviewer never opened an earlier one", () => {
    expect(diffBaseline([], 3, [1, 2, 3])).toEqual({ number: 2, seenByReviewer: false });
    expect(diffBaseline([3], 3, [1, 2, 3])).toEqual({ number: 2, seenByReviewer: false });
  });

  it("ignores versions the client cannot see and returns null for a first version", () => {
    expect(diffBaseline([5], 3, [1, 2, 3])).toEqual({ number: 2, seenByReviewer: false });
    expect(diffBaseline([], 1, [1])).toBeNull();
  });
});

describe("orderComments", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 10, minute));
  const comment = (
    id: string,
    fields: Partial<{ mediaIndex: number; pinX: number; pinY: number; timeSec: number; timeEndSec: number }>,
    minute: number
  ) => ({
    id,
    mediaIndex: fields.mediaIndex ?? null,
    pinX: fields.pinX ?? null,
    pinY: fields.pinY ?? null,
    timeSec: fields.timeSec ?? null,
    timeEndSec: fields.timeEndSec ?? null,
    createdAt: at(minute),
  });

  it("numbers located comments by media and video moment, general ones stay chronological", () => {
    const { located, general } = orderComments([
      comment("general-late", {}, 9),
      comment("video-12", { mediaIndex: 1, timeSec: 12 }, 1),
      comment("video-3", { mediaIndex: 1, timeSec: 3, timeEndSec: 5 }, 2),
      comment("image-pin", { mediaIndex: 0, pinX: 0.5, pinY: 0.5 }, 3),
      comment("general-early", {}, 0),
      comment("media-without-place", { mediaIndex: 0 }, 4),
    ]);
    expect(located.map((c) => [c.id, c.number])).toEqual([
      ["image-pin", 1],
      ["video-3", 2],
      ["video-12", 3],
    ]);
    expect(general.map((c) => c.id)).toEqual(["general-early", "media-without-place", "general-late"]);
  });
});

describe("video moments", () => {
  it("formats points and ranges", () => {
    expect(formatMoment(7.4)).toBe("0:07");
    expect(formatMoment(12, 15)).toBe("0:12–0:15");
    expect(formatMoment(12, 12)).toBe("0:12");
  });

  it("reads what clients type on a phone keypad", () => {
    expect(parseMomentInput("0:07")).toBe(7);
    expect(parseMomentInput("0.07")).toBe(7);
    expect(parseMomentInput("1,05")).toBe(65);
    expect(parseMomentInput("12")).toBe(12);
    expect(parseMomentInput("")).toBeNull();
    expect(parseMomentInput("abc")).toBeNull();
  });

  it("validates moments and ranges against the duration", () => {
    expect(checkMomentInput("0:07", null, 30)).toEqual({ timeSec: 7 });
    expect(checkMomentInput("0:07", "", 30)).toEqual({ timeSec: 7 });
    expect(checkMomentInput("0:12", "0:15", 30)).toEqual({ timeSec: 12, timeEndSec: 15 });
    expect(checkMomentInput("0:15", "0:12", 30)).toHaveProperty("error");
    expect(checkMomentInput("0:45", null, 30)).toHaveProperty("error");
    expect(checkMomentInput("0:10", "0:45", 30)).toHaveProperty("error");
    expect(checkMomentInput("x", null)).toHaveProperty("error");
    // Unknown duration: no upper bound here (the server checks it when known).
    expect(checkMomentInput("5:00", null)).toEqual({ timeSec: 300 });
    // A 14.6 s clip: "0:15" is still the end of the video.
    expect(checkMomentInput("0:15", null, 14.6)).toEqual({ timeSec: 15 });
  });
});

describe("misc", () => {
  it("names media for people", () => {
    expect(mediaName("image", 1, 3)).toBe("Immagine 2");
    expect(mediaName("video", 0, 1)).toBe("Video");
  });

  it("builds portal paths", () => {
    expect(portalPath("abc_DEF-123")).toBe("/review/abc_DEF-123");
    expect(portalPath("abc", "post1")).toBe("/review/abc/posts/post1");
  });
});

describe("wording per kind", () => {
  it("keeps the original social wording", () => {
    const wording = portalWording(["SOCIAL_POST", "SOCIAL_POST"]);
    expect(wording.backLabel).toBe("← Tutti i post");
    expect(wording.position(1, 3)).toBe("Post 1 di 3 da approvare");
    expect(wording.nextLabel).toBe("Prossimo post →");
    expect(wording.remaining(1)).toBe("C'è ancora un post da rivedere.");
    expect(wording.remaining(2)).toBe("Ci sono ancora 2 post da rivedere.");
    expect(wording.allDone).toBe("Hai rivisto tutti i post in attesa. Grazie!");
    expect(wording.homeLabel).toBe("Torna all'elenco dei post");
    expect(portalTitle(["SOCIAL_POST"])).toBe("Post da approvare");
    expect(portalNoun([]).one).toBe("post");
  });

  it("speaks of articles for blog and of contents for ads or mixed lists", () => {
    expect(portalWording(["BLOG_ARTICLE"]).backLabel).toBe("← Tutti gli articoli");
    expect(portalWording(["BLOG_ARTICLE"]).homeLabel).toBe("Torna all'elenco degli articoli");
    expect(portalNoun(["BLOG_ARTICLE"]).theOne).toBe("l'articolo");
    expect(portalWording(["AD_CREATIVE"]).nextLabel).toBe("Prossimo contenuto →");
    expect(portalWording(["SOCIAL_POST", "BLOG_ARTICLE"]).position(2, 4)).toBe("Contenuto 2 di 4 da approvare");
    expect(portalTitle(["BLOG_ARTICLE"])).toBe("Articoli da approvare");
    expect(portalTitle(["SOCIAL_POST", "AD_CREATIVE"])).toBe("Da approvare");
  });

  it("labels dates and statuses per kind", () => {
    expect(dateLabelFor("SOCIAL_POST")).toBe("Pubblicazione");
    expect(dateLabelFor("BLOG_ARTICLE")).toBe("Pubblicazione prevista");
    expect(dateLabelFor("AD_CREATIVE")).toBe("Inizio campagna");
    expect(portalStatusLabel("SOCIAL_POST", "SCHEDULED")).toBe("Programmato");
    expect(portalStatusLabel("BLOG_ARTICLE", "DELIVERED")).toBe("Pubblicato");
    expect(portalStatusLabel("AD_CREATIVE", "APPROVED")).toBe("Approvate");
    expect(portalStatusLabel("AD_CREATIVE", "DELIVERED")).toBe("Consegnate");
    expect(portalStatusLabel("AD_CREATIVE", "IN_REVIEW")).toBe("Da approvare");
  });
});

describe("numberPassageComments", () => {
  const at = (iso: string) => new Date(iso);
  it("numbers passages in reading order, then the rewritten ones by date, skipping general comments", () => {
    const comments = [
      { id: "late-in-text", createdAt: at("2026-10-01T10:00:00Z") },
      { id: "early-in-text", createdAt: at("2026-10-02T10:00:00Z") },
      { id: "missing", createdAt: at("2026-09-30T10:00:00Z") },
      { id: "general", createdAt: at("2026-09-29T10:00:00Z") },
    ];
    const numbers = numberPassageComments(
      comments,
      new Map([
        ["late-in-text", { status: "exact" as const, start: 120 }],
        ["early-in-text", { status: "moved" as const, start: 10 }],
        ["missing", { status: "missing" as const, start: null }],
      ])
    );
    expect([...numbers]).toEqual([
      ["early-in-text", 1],
      ["late-in-text", 2],
      ["missing", 3],
    ]);
    expect(numbers.has("general")).toBe(false);
  });
});

describe("countDecisions", () => {
  it("counts the decisions on the variants that exist, in content order", () => {
    const count = countDecisions(["A", "B", "C"], {
      A: { verdict: "APPROVED" },
      C: { verdict: "REJECTED" },
      Z: { verdict: "APPROVED" },
    });
    expect(count).toEqual({ decided: 2, total: 3, approved: ["A"], rejected: ["C"], missing: ["B"] });
    expect(decisionProgressLabel(count)).toBe("2 di 3 varianti decise");
    expect(decisionProgressLabel({ decided: 0, total: 1 })).toBe("Variante da decidere");
    expect(decisionProgressLabel({ decided: 1, total: 1 })).toBe("Variante decisa");
  });
});
