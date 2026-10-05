import { describe, expect, it } from "vitest";
import {
  checkMomentInput,
  diffBaseline,
  formatMoment,
  formatPortalDate,
  formatShortDateTime,
  groupPortalPosts,
  mediaName,
  nextPostToReview,
  orderComments,
  parseMomentInput,
  portalPath,
  portalTone,
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
