import { describe, expect, it } from "vitest";
import {
  FRAME_SEC,
  badgeText,
  clampRatio,
  clampTime,
  formatFromOptions,
  formatLabel,
  formatPublishDate,
  initials,
  isAtTime,
  layoutFor,
  layoutMarkers,
  markerPercent,
  relativePoint,
  resolveFormat,
  roundTime,
  seekBy,
  stepFrame,
  toHandle,
  tokenizeCaption,
  truncateCaption,
  withStartFragment,
} from "../components/post-preview/helpers";

describe("layouts and formats", () => {
  it("picks the mockup from network and format", () => {
    expect(layoutFor("instagram")).toBe("instagram-feed");
    expect(layoutFor("instagram", "REEL")).toBe("instagram-reel");
    expect(layoutFor("instagram", "story")).toBe("instagram-story");
    expect(layoutFor("facebook", "REEL")).toBe("facebook-reel");
    expect(layoutFor("youtube")).toBe("youtube-video");
    expect(layoutFor("youtube", "short")).toBe("youtube-short");
    expect(layoutFor("tiktok", "whatever")).toBe("tiktok");
    expect(layoutFor("twitter")).toBe("twitter");
  });

  it("falls back to the network's first format", () => {
    expect(resolveFormat("instagram", "CAROUSEL")).toBe("POST");
    expect(resolveFormat("tiktok")).toBeUndefined();
  });

  it("reads the format from networkOptions without trusting its shape", () => {
    expect(formatFromOptions("instagram", { instagramData: { type: "REEL" } })).toBe("REEL");
    expect(formatFromOptions("instagram", { instagramData: "REEL" })).toBe("POST");
    expect(formatFromOptions("instagram", null)).toBe("POST");
    expect(formatFromOptions("youtube", { youtubeData: { type: "short" } })).toBe("short");
    expect(formatLabel("instagram", "STORY")).toBe("Storia");
    expect(formatLabel("bluesky")).toBeNull();
  });
});

describe("captions", () => {
  it("highlights hashtags, mentions and links", () => {
    expect(tokenizeCaption("Nuovo menù #autunno con @chef.mario: www.rossi.it!")).toEqual([
      { kind: "text", value: "Nuovo menù " },
      { kind: "hashtag", value: "#autunno" },
      { kind: "text", value: " con " },
      { kind: "mention", value: "@chef.mario" },
      { kind: "text", value: ": " },
      { kind: "url", value: "www.rossi.it" },
      { kind: "text", value: "!" },
    ]);
  });

  it("handles accents, line starts and false positives", () => {
    expect(tokenizeCaption("#caffè\n#città")).toEqual([
      { kind: "hashtag", value: "#caffè" },
      { kind: "text", value: "\n" },
      { kind: "hashtag", value: "#città" },
    ]);
    // E-mail addresses and HTML entities are plain text.
    expect(tokenizeCaption("info@rossi.it &#39;")).toEqual([{ kind: "text", value: "info@rossi.it &#39;" }]);
    expect(tokenizeCaption("vedi https://rossi.it/menu).")).toEqual([
      { kind: "text", value: "vedi " },
      { kind: "url", value: "https://rossi.it/menu" },
      { kind: "text", value: ")." },
    ]);
  });

  it("truncates on lines first, then on a word boundary", () => {
    expect(truncateCaption("corto", { maxChars: 125, maxLines: 2 })).toEqual({ text: "corto", truncated: false });
    expect(truncateCaption("uno\ndue\ntre", { maxChars: 125, maxLines: 2 })).toEqual({
      text: "uno\ndue",
      truncated: true,
    });
    const long = "parola ".repeat(30).trim();
    const cut = truncateCaption(long, { maxChars: 50, maxLines: 2 });
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(50);
    expect(cut.text.endsWith("parola")).toBe(true);
  });
});

describe("accounts and dates", () => {
  it("derives handles and initials", () => {
    expect(toHandle("Pasticceria Ròssi")).toBe("@pasticceriarossi");
    expect(toHandle("!!!")).toBe("@account");
    expect(initials("Pasticceria Rossi")).toBe("PR");
    expect(initials("heili")).toBe("HE");
  });

  it("formats dates in a fixed time zone", () => {
    const date = "2026-10-05T08:30:00Z";
    expect(formatPublishDate(date, "time", "Europe/Rome")).toContain("10:30");
    expect(formatPublishDate(date, "long", "Europe/Rome")).toBe("5 ottobre 2026");
    expect(formatPublishDate("not a date", "short")).toBeNull();
    expect(formatPublishDate(undefined, "short")).toBeNull();
  });
});

describe("media geometry", () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 };

  it("reports clicks relative to the media box, clamped to 0..1", () => {
    expect(relativePoint(200, 150, rect)).toEqual({ x: 0.5, y: 0.25 });
    expect(relativePoint(50, 1000, rect)).toEqual({ x: 0, y: 1 });
    expect(relativePoint(133.3333, 50, rect)).toEqual({ x: 0.1667, y: 0 });
    expect(relativePoint(10, 10, { ...rect, width: 0 })).toBeNull();
  });

  it("clamps feed ratios", () => {
    expect(clampRatio(0.5, 0.8, 1.91)).toBe(0.8);
    expect(clampRatio(3, 0.8, 1.91)).toBe(1.91);
    expect(clampRatio(1, 0.8, 1.91)).toBe(1);
    expect(clampRatio(Number.NaN, 0.8, 1.91)).toBe(0.8);
  });

  it("keeps short badge labels and numbers long ones", () => {
    expect(badgeText("3", 0)).toBe("3");
    expect(badgeText("Logo troppo piccolo", 4)).toBe("5");
    expect(badgeText("  ", 1)).toBe("2");
  });
});

describe("video helpers", () => {
  it("clamps times to the duration", () => {
    expect(clampTime(-2, 30)).toBe(0);
    expect(clampTime(45, 30)).toBe(30);
    expect(clampTime(45, null)).toBe(45);
    expect(clampTime(Number.NaN, 30)).toBe(0);
    expect(clampTime(12, Number.POSITIVE_INFINITY)).toBe(12);
  });

  it("steps one frame and stops at the edges", () => {
    expect(stepFrame(1, 1, 30)).toBeCloseTo(1 + FRAME_SEC);
    expect(stepFrame(1, -1, 30)).toBeCloseTo(1 - FRAME_SEC);
    expect(stepFrame(0, -1, 30)).toBe(0);
    expect(stepFrame(0.01, -1, 30)).toBe(0);
    // Never lands on the very end (the video would flip to "ended").
    expect(stepFrame(30, 1, 30)).toBeCloseTo(30 - FRAME_SEC);
    expect(stepFrame(29.99, 1, 30)).toBeCloseTo(30 - FRAME_SEC);
    // Unknown duration: only the lower bound applies.
    expect(stepFrame(5, 1, Number.NaN)).toBeCloseTo(5 + FRAME_SEC);
    expect(stepFrame(0, 1, 0.01)).toBe(0);
  });

  it("seeks by seconds within bounds", () => {
    expect(seekBy(0.4, -1, 30)).toBe(0);
    expect(seekBy(29.5, 1, 30)).toBe(30);
    expect(seekBy(7, 1, 30)).toBe(8);
  });

  it("rounds reported times to hundredths", () => {
    expect(roundTime(7.12345)).toBe(7.12);
    expect(roundTime(-1)).toBe(0);
  });

  it("positions markers on the bar", () => {
    expect(markerPercent(7.5, 30)).toBe(25);
    expect(markerPercent(40, 30)).toBe(100);
    expect(markerPercent(-1, 30)).toBe(0);
    expect(markerPercent(5, 0)).toBeNull();
    expect(markerPercent(5, Number.NaN)).toBeNull();
  });

  it("sorts markers, numbers them and draws ranges as bands", () => {
    const markers = layoutMarkers(
      [
        { id: "b", timeSec: 12, timeEndSec: 15, label: "Testo troppo veloce" },
        { id: "a", timeSec: 7, label: "2", tone: "assistant" },
        { id: "c", timeSec: 20, timeEndSec: 18, label: "fine prima dell'inizio" },
        { id: "d", timeSec: 28, timeEndSec: 99, label: "oltre la fine" },
      ],
      40
    );
    expect(markers.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(markers.map((m) => m.text)).toEqual(["2", "2", "3", "4"]);
    expect(markers[0]).toMatchObject({ leftPct: 17.5, widthPct: null, tone: "assistant" });
    expect(markers[1]).toMatchObject({ leftPct: 30, widthPct: 7.5 });
    expect(markers[2].widthPct).toBeNull();
    expect(markers[3]).toMatchObject({ leftPct: 70, widthPct: 30 });
  });

  it("draws no markers until the duration is known", () => {
    expect(layoutMarkers([{ id: "a", timeSec: 1, label: "1" }], null)).toEqual([]);
  });

  it("matches paused frames to pins at their moment", () => {
    expect(isAtTime(7.3, 7)).toBe(true);
    expect(isAtTime(8, 7)).toBe(false);
    expect(isAtTime(13, 12, 15)).toBe(true);
    expect(isAtTime(15.2, 12, 15)).toBe(true);
    expect(isAtTime(16, 12, 15)).toBe(false);
  });

  it("asks iOS for the first frame when there is no poster", () => {
    expect(withStartFragment("https://x.it/v.mp4")).toBe("https://x.it/v.mp4#t=0.001");
    expect(withStartFragment("https://x.it/v.mp4#t=3")).toBe("https://x.it/v.mp4#t=3");
  });
});
