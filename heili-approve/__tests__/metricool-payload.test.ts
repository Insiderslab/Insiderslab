import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import {
  SchedulerPayloadError,
  buildNetworkData,
  buildSchedulerPayload,
  getNetworkFormat,
  isValidTimeZone,
  toZonedDateTimeString,
  validateForNetworks,
  zonedDateTimeToUtc,
  type ValidateInput,
} from "@/lib/metricool/payload";
import {
  MetricoolClient,
  MetricoolError,
  extractMetricoolPostId,
  metricoolErrorFromResponse,
  parseBrands,
} from "@/lib/metricool/client";

const NOW = new Date("2026-03-01T10:00:00Z");
const image = (n = 1) => ({ url: `https://approve.example.com/media/ws/img${n}.jpg`, type: "image", mimeType: "image/jpeg" });
const video = { url: "https://approve.example.com/media/ws/clip.mp4", type: "video", mimeType: "video/mp4" };

function build(overrides: {
  networks?: string[];
  networkOptions?: unknown;
  text?: string;
  firstCommentText?: string | null;
  media?: unknown[];
  publishAt?: Date;
  timezone?: string;
}) {
  return buildSchedulerPayload({
    post: {
      publishAt: overrides.publishAt ?? new Date("2026-04-10T08:30:00Z"),
      networks: overrides.networks ?? ["instagram"],
      networkOptions: overrides.networkOptions ?? {},
    },
    version: {
      text: overrides.text ?? "Nuova collezione #autunno",
      firstCommentText: overrides.firstCommentText ?? null,
      media: overrides.media ?? [image()],
    },
    client: { timezone: overrides.timezone ?? "Europe/Rome" },
    now: NOW,
  });
}

function issues(input: Partial<ValidateInput>) {
  return validateForNetworks({ networks: ["instagram"], text: "Testo", media: [image()], ...input });
}

describe("toZonedDateTimeString", () => {
  it("converts to Rome wall-clock time in winter (+1) and summer (+2)", () => {
    expect(toZonedDateTimeString(new Date("2026-01-15T09:00:00Z"), "Europe/Rome")).toBe("2026-01-15T10:00:00");
    expect(toZonedDateTimeString(new Date("2026-07-15T09:00:00Z"), "Europe/Rome")).toBe("2026-07-15T11:00:00");
  });

  it("handles the March DST change in Europe/Rome", () => {
    // DST starts 2026-03-29 at 01:00 UTC: 02:00 CET jumps to 03:00 CEST.
    expect(toZonedDateTimeString(new Date("2026-03-28T09:00:00Z"), "Europe/Rome")).toBe("2026-03-28T10:00:00");
    expect(toZonedDateTimeString(new Date("2026-03-29T00:59:59Z"), "Europe/Rome")).toBe("2026-03-29T01:59:59");
    expect(toZonedDateTimeString(new Date("2026-03-29T01:00:00Z"), "Europe/Rome")).toBe("2026-03-29T03:00:00");
    expect(toZonedDateTimeString(new Date("2026-03-29T09:00:00Z"), "Europe/Rome")).toBe("2026-03-29T11:00:00");
  });

  it("handles the October DST change in Europe/Rome", () => {
    // DST ends 2026-10-25 at 01:00 UTC: 03:00 CEST goes back to 02:00 CET.
    expect(toZonedDateTimeString(new Date("2026-10-24T08:00:00Z"), "Europe/Rome")).toBe("2026-10-24T10:00:00");
    expect(toZonedDateTimeString(new Date("2026-10-25T00:30:00Z"), "Europe/Rome")).toBe("2026-10-25T02:30:00");
    expect(toZonedDateTimeString(new Date("2026-10-25T01:30:00Z"), "Europe/Rome")).toBe("2026-10-25T02:30:00");
    expect(toZonedDateTimeString(new Date("2026-10-26T08:00:00Z"), "Europe/Rome")).toBe("2026-10-26T09:00:00");
  });

  it("renders midnight as 00, crosses the date line and supports other zones", () => {
    expect(toZonedDateTimeString(new Date("2026-06-30T22:00:00Z"), "Europe/Rome")).toBe("2026-07-01T00:00:00");
    expect(toZonedDateTimeString(new Date("2026-03-09T03:00:00Z"), "America/New_York")).toBe("2026-03-08T23:00:00");
    expect(toZonedDateTimeString(new Date("2026-03-01T12:00:00Z"), "UTC")).toBe("2026-03-01T12:00:00");
  });
});

describe("zonedDateTimeToUtc", () => {
  it("is the inverse of toZonedDateTimeString on both sides of DST", () => {
    expect(zonedDateTimeToUtc("2026-03-28T10:00", "Europe/Rome")?.toISOString()).toBe("2026-03-28T09:00:00.000Z");
    expect(zonedDateTimeToUtc("2026-03-29T10:00", "Europe/Rome")?.toISOString()).toBe("2026-03-29T08:00:00.000Z");
    expect(zonedDateTimeToUtc("2026-10-26T09:00:00", "Europe/Rome")?.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("moves a time skipped by spring-forward ahead and resolves the autumn overlap", () => {
    expect(zonedDateTimeToUtc("2026-03-29T02:30", "Europe/Rome")?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(zonedDateTimeToUtc("2026-10-25T02:30", "Europe/Rome")?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("rejects malformed input and unknown zones", () => {
    expect(zonedDateTimeToUtc("29/03/2026 10:00", "Europe/Rome")).toBeNull();
    expect(zonedDateTimeToUtc("2026-03-29T10:00", "Mars/Olympus")).toBeNull();
    expect(isValidTimeZone("Europe/Rome")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("buildSchedulerPayload", () => {
  it("produces Metricool's scheduler body", () => {
    const payload = build({
      networks: ["instagram", "facebook"],
      firstCommentText: "  #moda #autunno  ",
      media: [image(1), image(2)],
    });

    expect(payload).toMatchObject({
      publicationDate: { dateTime: "2026-04-10T10:30:00", timezone: "Europe/Rome" },
      text: "Nuova collezione #autunno",
      firstCommentText: "#moda #autunno",
      providers: [{ network: "instagram" }, { network: "facebook" }],
      media: [image(1).url, image(2).url],
      mediaAltText: [],
      autoPublish: true,
      draft: false,
      shortener: false,
      smartLinkData: { ids: [] },
      descendants: [],
      hasNotReadNotes: false,
      instagramData: { type: "POST" },
      facebookData: { type: "POST" },
    });
    expect(payload).not.toHaveProperty("linkedinData");
  });

  it("uses the client's time zone for publicationDate", () => {
    const payload = build({ timezone: "America/New_York", publishAt: new Date("2026-04-10T14:00:00Z") });
    expect(payload.publicationDate).toEqual({ dateTime: "2026-04-10T10:00:00", timezone: "America/New_York" });
  });

  it("adds a data object for every selected network, with defaults", () => {
    const payload = build({
      networks: ["linkedin", "tiktok", "twitter", "threads", "bluesky", "gmb", "youtube", "pinterest"],
      text: "Breve",
      media: [video, image()],
      networkOptions: {
        youtubeData: { title: "Il backstage", type: "short" },
        pinterestData: { boardId: "board-1", pinLink: "https://example.com" },
      },
    });

    expect(payload.linkedinData).toEqual({ type: "post", previewIncluded: true });
    expect(payload.tiktokData).toEqual({
      privacyOption: "PUBLIC_TO_EVERYONE",
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
    });
    expect(payload.twitterData).toEqual({ tags: [] });
    expect(payload.threadsData).toEqual({});
    expect(payload.blueskyData).toEqual({ postLanguages: [] });
    expect(payload.gmbData).toEqual({ type: "publication" });
    expect(payload.youtubeData).toEqual({ title: "Il backstage", type: "short", privacy: "public", madeForKids: false });
    expect(payload.pinterestData).toEqual({ boardId: "board-1", pinLink: "https://example.com" });
    expect(payload).not.toHaveProperty("instagramData");
  });

  it("merges agency options over the defaults and shows reels in the feed", () => {
    expect(buildNetworkData("instagram", { instagramData: { type: "REEL" } })).toEqual({ type: "REEL", showReelOnFeed: true });
    expect(buildNetworkData("instagram", { instagramData: { type: "REEL", showReelOnFeed: false } })).toEqual({
      type: "REEL",
      showReelOnFeed: false,
    });
    expect(buildNetworkData("tiktok", { tiktokData: { disableComment: true } })).toMatchObject({ disableComment: true });
    expect(buildNetworkData("facebook", "not an object")).toEqual({ type: "POST" });
    expect(getNetworkFormat("instagram", {})).toBe("POST");
    expect(getNetworkFormat("twitter", {})).toBeUndefined();
  });

  it("sends no caption when every target is a story", () => {
    const payload = build({
      networks: ["instagram", "facebook"],
      networkOptions: { instagramData: { type: "STORY" }, facebookData: { type: "STORY" } },
      firstCommentText: "primo commento",
    });
    expect(payload.text).toBe("");
    expect(payload).not.toHaveProperty("firstCommentText");
  });

  it("keeps the caption when a story is mixed with a feed post", () => {
    const payload = build({
      networks: ["instagram", "linkedin"],
      networkOptions: { instagramData: { type: "STORY" } },
    });
    expect(payload.text).toBe("Nuova collezione #autunno");
  });

  it("deduplicates networks and omits an empty first comment", () => {
    const payload = build({ networks: ["instagram", "instagram"], firstCommentText: "   " });
    expect(payload.providers).toEqual([{ network: "instagram" }]);
    expect(payload).not.toHaveProperty("firstCommentText");
  });

  it("throws SchedulerPayloadError with Italian messages on invalid content", () => {
    try {
      build({ networks: ["instagram"], media: [] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulerPayloadError);
      expect((error as SchedulerPayloadError).issues[0]).toMatchObject({ network: "instagram", field: "media" });
      expect((error as Error).message).toContain("Instagram richiede almeno un'immagine o un video");
    }
  });

  it("refuses a publication date in the past", () => {
    expect(() => build({ publishAt: new Date("2026-02-01T10:00:00Z") })).toThrow(/già passata/);
  });
});

describe("validateForNetworks", () => {
  it("accepts a valid post", () => {
    expect(issues({})).toEqual([]);
  });

  it("requires at least one known network", () => {
    expect(issues({ networks: [] })[0].message).toBe("Seleziona almeno una rete.");
    expect(issues({ networks: ["myspace"] })[0].message).toContain("non è supportata");
  });

  it("rejects an empty post", () => {
    expect(issues({ networks: ["linkedin"], text: " ", media: [] }).map((i) => i.field)).toContain("text");
  });

  it("enforces Instagram media rules", () => {
    expect(issues({ media: [] })[0].message).toContain("Instagram richiede");
    expect(issues({ networkOptions: { instagramData: { type: "REEL" } } })[0].message).toBe(
      "Il Reel di Instagram richiede un video."
    );
    expect(issues({ networkOptions: { instagramData: { type: "REEL" } }, media: [video] })).toEqual([]);
    const eleven = Array.from({ length: 11 }, (_, i) => image(i));
    expect(issues({ media: eleven })[0].message).toContain("al massimo 10");
  });

  it("requires a video for a Facebook reel", () => {
    expect(issues({ networks: ["facebook"], networkOptions: { facebookData: { type: "REEL" } } })[0].message).toBe(
      "Il Reel di Facebook richiede un video."
    );
  });

  it("requires media on TikTok", () => {
    expect(issues({ networks: ["tiktok"], media: [] }).some((i) => i.network === "tiktok")).toBe(true);
  });

  it("requires a video and a title on YouTube", () => {
    const found = issues({ networks: ["youtube"], media: [image()] }).map((i) => i.message);
    expect(found).toEqual(["YouTube richiede un video.", "YouTube richiede un titolo per il video."]);
    expect(issues({ networks: ["youtube"], media: [video], networkOptions: { youtubeData: { title: "Ok" } } })).toEqual([]);
  });

  it("requires an image and a board on Pinterest", () => {
    const found = issues({ networks: ["pinterest"], media: [video] }).map((i) => i.message);
    expect(found).toEqual(["Pinterest richiede almeno un'immagine.", "Pinterest richiede la bacheca (boardId)."]);
  });

  it("limits Bluesky to 300 characters, counting emoji as one", () => {
    expect(issues({ networks: ["bluesky"], text: "a".repeat(300) })).toEqual([]);
    expect(issues({ networks: ["bluesky"], text: "😀".repeat(300) })).toEqual([]);
    expect(issues({ networks: ["bluesky"], text: "a".repeat(301) })[0].message).toBe(
      "Il testo supera il limite di 300 caratteri per Bluesky (301)."
    );
  });

  it("limits Google Business publications to 1500 characters", () => {
    expect(issues({ networks: ["gmb"], text: "a".repeat(1501) })[0].network).toBe("gmb");
  });

  it("ignores the caption limit for stories", () => {
    const long = "a".repeat(2300);
    expect(issues({ text: long })[0].message).toContain("2200");
    expect(issues({ text: long, networkOptions: { instagramData: { type: "STORY" } } })).toEqual([]);
  });

  it("rejects unknown formats, relative media URLs, bad zones and past dates", () => {
    expect(issues({ networkOptions: { instagramData: { type: "CAROUSEL" } } })[0].message).toContain('"CAROUSEL"');
    expect(issues({ media: [{ url: "/media/x.jpg", type: "image", mimeType: "image/jpeg" }] })[0].field).toBe("media");
    expect(issues({ timezone: "Roma" })[0].field).toBe("timezone");
    expect(issues({ publishAt: new Date("2026-02-28T10:00:00Z"), now: NOW })[0].field).toBe("publishAt");
    expect(issues({ publishAt: new Date("2026-03-02T10:00:00Z"), now: NOW })).toEqual([]);
  });
});

describe("Metricool client helpers", () => {
  it("classifies HTTP errors as retryable or not", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(metricoolErrorFromResponse(status, {}).retryable).toBe(false);
    }
    for (const status of [429, 500, 502, 503]) {
      expect(metricoolErrorFromResponse(status, {}).retryable).toBe(true);
    }
    expect(metricoolErrorFromResponse(401, {}).message).toContain("Impostazioni");
    expect(metricoolErrorFromResponse(400, { message: "Invalid date" }).message).toContain("Invalid date");
  });

  it("parses brands defensively", () => {
    const brands = parseBrands([
      { id: 123, label: "Heili", timezone: "Europe/Rome", instagram: "heili", facebook: "", linkedinCompany: "heili-srl" },
      { blogId: "456", name: "Altro" },
      { label: "senza id" },
    ]);
    expect(brands).toEqual([
      { blogId: "123", label: "Heili", timezone: "Europe/Rome", avatarUrl: null, networks: ["instagram", "linkedin"] },
      { blogId: "456", label: "Altro", timezone: null, avatarUrl: null, networks: [] },
    ]);
    expect(parseBrands({ data: [{ id: "7", title: "T" }] })[0]).toMatchObject({ blogId: "7", label: "T" });
    expect(parseBrands("nope")).toEqual([]);
  });

  it("reads the created post id from several shapes", () => {
    expect(extractMetricoolPostId({ data: { id: 99 } })).toBe("99");
    expect(extractMetricoolPostId({ id: "abc" })).toBe("abc");
    expect(extractMetricoolPostId({ data: { uuid: "u-1" } })).toBe("u-1");
    expect(extractMetricoolPostId({ ok: true })).toBeNull();
  });

  it("sends the token in X-Mc-Auth and ids in the query string", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { id: 42 } }), { status: 200 }));
    const client = new MetricoolClient({
      userId: "u1",
      token: "secret-token",
      baseUrl: "https://metricool.test/api",
      fake: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.schedulePost("b1", build({}));
    expect(result).toEqual({ metricoolPostId: "42" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://metricool.test/api/v2/scheduler/posts?blogId=b1&userId=u1");
    expect((init.headers as Record<string, string>)["X-Mc-Auth"]).toBe("secret-token");
    expect(String(url)).not.toContain("secret-token");
  });

  it("turns network failures into retryable errors without leaking the token", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed secret-token");
    });
    const client = new MetricoolClient({
      userId: "u1",
      token: "secret-token",
      fake: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const error = await client.listBrands().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetricoolError);
    expect((error as MetricoolError).retryable).toBe(true);
    expect((error as MetricoolError).message).not.toContain("secret-token");
  });

  it("works without network in fake mode", async () => {
    const fetchImpl = vi.fn();
    const client = new MetricoolClient({ userId: "u", token: "t", fake: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await client.listBrands()).length).toBeGreaterThan(0);
    expect((await client.schedulePost("fake-1001", build({}))).metricoolPostId).toMatch(/^fake-/);
    await expect(client.schedulePost("fake-1001", build({ text: "x [metricool:fail]" }))).rejects.toMatchObject({
      status: 422,
      retryable: false,
    });
    expect(await client.testConnection()).toEqual({ ok: true, brandCount: 2 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
