import { describe, expect, it } from "vitest";
import type { MediaItem } from "../lib/domain";
import { InvalidTransitionError } from "../lib/domain";
import type { AdContent, BlogContent } from "../lib/content/types";
import {
  blogAnchorSchema,
  checkCommentTime,
  contentChanged,
  contentFingerprint,
  isInternalKind,
  planActionItemCommentFor,
  readBlogAnchor,
  summarizeContentChanges,
  summarizeVersionForList,
  diffText,
  diffVersions,
  effectiveLastSubmittedVersion,
  findDisallowedNetworks,
  mediaMetadataChanged,
  needsNewVersion,
  planActionItemComment,
  planPostUpdate,
  postInputSchema,
  postUpdateSchema,
  resolveVideoCover,
  stableStringify,
  summarizeVersionDiff,
  visibleVersionNumber,
  type VersionContent,
} from "../lib/posts";

const image = (n: number, alt?: string): MediaItem => ({
  url: `https://cdn.example.com/${n}.jpg`,
  type: "image",
  mimeType: "image/jpeg",
  ...(alt ? { alt } : {}),
});

const base: VersionContent = { text: "Ciao mondo", firstCommentText: null, media: [image(1), image(2)] };

const current = {
  ...base,
  title: "Lancio",
  publishAt: new Date("2026-11-02T09:00:00Z"),
  networks: ["instagram", "facebook"],
  networkOptions: { instagramData: { type: "POST" } },
};

describe("contentChanged", () => {
  it("ignores absent fields and identical values", () => {
    expect(contentChanged(base, {})).toBe(false);
    expect(contentChanged(base, { text: "Ciao mondo", media: [image(1), image(2)] })).toBe(false);
  });

  it("treats empty and null first comments as the same", () => {
    expect(contentChanged(base, { firstCommentText: "" })).toBe(false);
    expect(contentChanged(base, { firstCommentText: "   " })).toBe(false);
    expect(contentChanged(base, { firstCommentText: "#hashtag" })).toBe(true);
  });

  it("detects text, media order and alt changes", () => {
    expect(contentChanged(base, { text: "Ciao mondo!" })).toBe(true);
    expect(contentChanged(base, { media: [image(2), image(1)] })).toBe(true);
    expect(contentChanged(base, { media: [image(1, "Logo"), image(2)] })).toBe(true);
    expect(contentChanged(base, { media: [image(1)] })).toBe(true);
  });
});

describe("versioning", () => {
  it("never creates a version before the first submission", () => {
    expect(needsNewVersion({ contentChanged: true, currentVersionNumber: 1, lastSubmittedVersionNumber: null })).toBe(
      false
    );
  });

  it("creates a version when the client has seen the current one", () => {
    expect(needsNewVersion({ contentChanged: true, currentVersionNumber: 1, lastSubmittedVersionNumber: 1 })).toBe(
      true
    );
  });

  it("edits an unsent revision in place instead of piling up versions", () => {
    expect(needsNewVersion({ contentChanged: true, currentVersionNumber: 2, lastSubmittedVersionNumber: 1 })).toBe(
      false
    );
  });

  it("needs a content change", () => {
    expect(needsNewVersion({ contentChanged: false, currentVersionNumber: 1, lastSubmittedVersionNumber: 1 })).toBe(
      false
    );
  });

  it("falls back to submittedAt when no submit event exists", () => {
    expect(effectiveLastSubmittedVersion(undefined, null, 3)).toBeNull();
    expect(effectiveLastSubmittedVersion(undefined, new Date(), 3)).toBe(3);
    expect(effectiveLastSubmittedVersion(2, new Date(), 3)).toBe(2);
  });

  it("hides an unsent revision from the client", () => {
    expect(visibleVersionNumber(1, null)).toBe(1);
    expect(visibleVersionNumber(2, 1)).toBe(1);
    expect(visibleVersionNumber(2, 2)).toBe(2);
  });
});

describe("planPostUpdate", () => {
  const plan = (status: Parameters<typeof planPostUpdate>[0]["status"], patch: Parameters<typeof planPostUpdate>[0]["patch"], lastSubmitted: number | null = 1) =>
    planPostUpdate({ status, currentVersionNumber: 1, lastSubmittedVersionNumber: lastSubmitted, current, patch });

  it("is a no-op when nothing changes, even on a frozen post", () => {
    const result = plan("SCHEDULED", { text: "Ciao mondo", networks: ["facebook", "instagram"] });
    expect(result.noop).toBe(true);
    expect(result.nextStatus).toBe("SCHEDULED");
  });

  it("edits a draft in place", () => {
    const result = plan("DRAFT", { text: "Nuovo testo" }, null);
    expect(result).toMatchObject({ noop: false, createVersion: false, nextStatus: "DRAFT", contentChanged: true });
  });

  it("sends an in-review post back to draft with a new version", () => {
    expect(plan("IN_REVIEW", { text: "Nuovo testo" })).toMatchObject({ createVersion: true, nextStatus: "DRAFT" });
  });

  it("keeps CHANGES_REQUESTED while preparing the revision", () => {
    expect(plan("CHANGES_REQUESTED", { media: [image(3)] })).toMatchObject({
      createVersion: true,
      nextStatus: "CHANGES_REQUESTED",
    });
  });

  it("revokes an approval when the date changes, with a new version (the client approved the old date)", () => {
    expect(plan("APPROVED", { publishAt: new Date("2026-11-03T09:00:00Z") })).toMatchObject({
      createVersion: true,
      scheduleChanged: true,
      nextStatus: "DRAFT",
    });
  });

  it("versions a network change on a sent post, edits an unsent one in place", () => {
    expect(plan("IN_REVIEW", { networks: ["facebook", "instagram", "tiktok"] })).toMatchObject({
      createVersion: true,
      scheduleChanged: true,
      nextStatus: "DRAFT",
    });
    expect(plan("DRAFT", { publishAt: new Date("2026-11-03T09:00:00Z") }, null)).toMatchObject({
      createVersion: false,
      scheduleChanged: true,
    });
  });

  it("compares network options regardless of key order", () => {
    expect(plan("APPROVED", { networkOptions: { instagramData: { type: "POST" } } }).noop).toBe(true);
    expect(plan("APPROVED", { networkOptions: { instagramData: { type: "REEL" } } }).nextStatus).toBe("DRAFT");
  });

  it("keeps the status for an internal title change", () => {
    expect(plan("APPROVED", { title: "Lancio autunno" })).toMatchObject({ noop: false, nextStatus: "APPROVED" });
  });

  it("refuses any change to a scheduled or scheduling post", () => {
    expect(() => plan("SCHEDULED", { text: "x" })).toThrow(InvalidTransitionError);
    expect(() => plan("SCHEDULING", { title: "x" })).toThrow(InvalidTransitionError);
    expect(() => plan("CANCELLED", { text: "x" })).toThrow(InvalidTransitionError);
  });
});

describe("diff", () => {
  it("diffs words and keeps whitespace", () => {
    expect(diffText("Scopri la nuova collezione", "Scopri subito la collezione autunno")).toEqual([
      { type: "same", value: "Scopri " },
      { type: "added", value: "subito " },
      { type: "same", value: "la " },
      { type: "removed", value: "nuova " },
      { type: "same", value: "collezione" },
      { type: "added", value: " autunno" },
    ]);
    expect(diffText("", "")).toEqual([]);
    expect(diffText("uguale", "uguale")).toEqual([{ type: "same", value: "uguale" }]);
  });

  it("reconstructs both texts from the segments", () => {
    const before = "Una frase\ncon a capo e #hashtag";
    const after = "Una frase diversa\ncon #hashtag e altro";
    const segments = diffText(before, after);
    expect(segments.filter((s) => s.type !== "added").map((s) => s.value).join("")).toBe(before);
    expect(segments.filter((s) => s.type !== "removed").map((s) => s.value).join("")).toBe(after);
  });

  it("summarises media changes between versions", () => {
    const diff = diffVersions(base, {
      text: base.text,
      firstCommentText: "",
      media: [image(2), image(1, "Logo"), image(3)],
    });
    expect(diff.textChanged).toBe(false);
    expect(diff.firstCommentChanged).toBe(false);
    expect(diff.media.added.map((m) => m.url)).toEqual([image(3).url]);
    expect(diff.media.removed).toEqual([]);
    expect(diff.media.reordered).toBe(true);
    expect(diff.media.altChanged).toBe(true);
    expect(summarizeVersionDiff(diff)).toEqual([
      "1 media aggiunto",
      "Ordine dei media cambiato",
      "Testo alternativo dei media modificato",
    ]);
  });

  it("reports no change for identical content", () => {
    expect(diffVersions(base, { ...base, media: [...base.media] }).changed).toBe(false);
  });

  it("reports date and network changes between versions", () => {
    const schedule = {
      publishAt: new Date("2026-10-09T06:30:00Z"),
      networks: ["instagram"],
      networkOptions: { instagramData: { type: "POST" } },
    };
    const diff = diffVersions(
      { ...base, schedule },
      {
        ...base,
        schedule: {
          publishAt: new Date("2026-10-10T06:30:00Z"),
          networks: ["instagram", "tiktok"],
          networkOptions: { instagramData: { type: "REEL" } },
        },
      }
    );
    expect(diff.changed).toBe(true);
    expect(summarizeVersionDiff(diff)).toEqual([
      "Data di pubblicazione cambiata",
      "Reti aggiunte: TikTok",
      "Formato o opzioni per rete cambiati",
    ]);
    expect(diffVersions({ ...base, schedule }, { ...base, schedule: { ...schedule } }).changed).toBe(false);
    // Old rows without a schedule are not compared.
    expect(diffVersions(base, { ...base, schedule }).changed).toBe(false);
  });
});

describe("validation helpers", () => {
  it("restricts networks to the client's enabled ones", () => {
    expect(findDisallowedNetworks(["instagram", "tiktok"], ["instagram"])).toEqual(["tiktok"]);
    expect(findDisallowedNetworks(["instagram", "tiktok"], [])).toEqual([]);
  });

  it("stableStringify ignores key order and undefined", () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [1, 2] } })).toBe(stableStringify({ a: { c: [1, 2] }, b: 1 }));
  });

  it("validates post input", () => {
    const ok = postInputSchema.safeParse({
      clientId: "c1",
      title: " Lancio ",
      publishAt: "2026-11-02T09:00:00Z",
      networks: ["instagram", "instagram"],
      text: "",
      media: [image(1)],
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.title).toBe("Lancio");
      expect(ok.data.networks).toEqual(["instagram"]);
      expect(ok.data.publishAt).toBeInstanceOf(Date);
    }

    expect(postInputSchema.safeParse({ ...ok.data, networks: [] }).success).toBe(false);
    expect(postInputSchema.safeParse({ ...ok.data, networks: ["myspace"] }).success).toBe(false);
    expect(
      postInputSchema.safeParse({ ...ok.data, media: [{ ...image(1), url: "javascript:alert(1)" }] }).success
    ).toBe(false);
  });

  it("does not fill defaults on partial updates", () => {
    const parsed = postUpdateSchema.parse({ title: "Nuovo" });
    expect(parsed).toEqual({ title: "Nuovo" });
  });
});

// ─── Video and Reels ─────────────────────────────────────────────────────────

const clip = (n: number, durationSec?: number): MediaItem => ({
  url: `https://cdn.example.com/${n}.mp4`,
  type: "video",
  mimeType: "video/mp4",
  ...(durationSec !== undefined ? { durationSec } : {}),
});

const reel: VersionContent = { text: "Reel", firstCommentText: null, media: [clip(1, 20)], videoCoverMs: 3000 };

describe("video cover and metadata versioning", () => {
  it("treats a cover change as a content change", () => {
    expect(contentChanged(reel, { videoCoverMs: 3000 })).toBe(false);
    expect(contentChanged(reel, { videoCoverMs: 4500 })).toBe(true);
    expect(contentChanged(reel, { videoCoverMs: null })).toBe(true);
    expect(contentChanged({ ...reel, videoCoverMs: undefined }, { videoCoverMs: null })).toBe(false);
  });

  it("creates a new version when the cover of a sent Reel changes", () => {
    const result = planPostUpdate({
      status: "IN_REVIEW",
      currentVersionNumber: 1,
      lastSubmittedVersionNumber: 1,
      current: { ...reel, title: "Reel", publishAt: current.publishAt, networks: ["instagram"], networkOptions: {} },
      patch: { videoCoverMs: 9000 },
    });
    expect(result).toMatchObject({ contentChanged: true, createVersion: true, nextStatus: "DRAFT" });
  });

  it("does not version on duration/poster only", () => {
    const withPoster = [{ ...clip(1, 20.04), posterUrl: "https://cdn.example.com/1.jpg" }];
    expect(contentChanged(reel, { media: withPoster })).toBe(false);
    expect(mediaMetadataChanged(reel.media, withPoster)).toBe(true);
    expect(mediaMetadataChanged(reel.media, [clip(1, 20)])).toBe(false);
    expect(mediaMetadataChanged(reel.media, [clip(2, 20)])).toBe(false);
  });

  it("lists the cover change in the version diff", () => {
    const diff = diffVersions(reel, { ...reel, videoCoverMs: 5000 });
    expect(diff).toMatchObject({ changed: true, coverChanged: true });
    expect(summarizeVersionDiff(diff)).toEqual(["Copertina del video modificata"]);
    expect(diffVersions(reel, { ...reel }).changed).toBe(false);
  });

  it("keeps the cover only on posts with a video, within its duration", () => {
    expect(resolveVideoCover(reel.media, 3000)).toBe(3000);
    expect(resolveVideoCover(reel.media, undefined)).toBeNull();
    expect(resolveVideoCover([image(1)], 3000)).toBeNull();
    expect(resolveVideoCover([clip(1)], 999_000)).toBe(999_000);
    expect(() => resolveVideoCover(reel.media, 25_000)).toThrow(/oltre la durata/);
  });

  it("validates video fields in post input", () => {
    const input = {
      clientId: "c1",
      title: "Reel",
      publishAt: "2026-11-02T09:00:00Z",
      networks: ["instagram"],
      text: "",
      media: [{ ...clip(1, 12.5), posterUrl: "https://cdn.example.com/1.jpg" }],
      videoCoverMs: 1200,
    };
    const ok = postInputSchema.safeParse(input);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.media?.[0]).toMatchObject({ durationSec: 12.5, posterUrl: "https://cdn.example.com/1.jpg" });

    for (const bad of [
      { videoCoverMs: -1 },
      { videoCoverMs: 1.5 },
      { media: [{ ...clip(1), durationSec: -3 }] },
      { media: [{ ...clip(1), posterUrl: "javascript:alert(1)" }] },
    ]) {
      expect(postInputSchema.safeParse({ ...input, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(postUpdateSchema.parse({ videoCoverMs: null })).toEqual({ videoCoverMs: null });
  });
});

describe("video comments", () => {
  it("accepts moments and ranges on a video", () => {
    expect(checkCommentTime(clip(1, 20), 7, undefined)).toEqual({ timeSec: 7, timeEndSec: null });
    expect(checkCommentTime(clip(1, 20), 12.345, 15)).toEqual({ timeSec: 12.35, timeEndSec: 15 });
    expect(checkCommentTime(clip(1), 120, 130)).toEqual({ timeSec: 120, timeEndSec: 130 });
    expect(checkCommentTime(image(1), undefined, undefined)).toEqual({ timeSec: null, timeEndSec: null });
  });

  it("clamps to the duration within one second of slack", () => {
    expect(checkCommentTime(clip(1, 14.9), 15, undefined)).toEqual({ timeSec: 14.9, timeEndSec: null });
    expect(checkCommentTime(clip(1, 14.9), 12, 15.5)).toEqual({ timeSec: 12, timeEndSec: 14.9 });
  });

  it("rejects invalid moments", () => {
    const error = (r: ReturnType<typeof checkCommentTime>) => ("error" in r ? r.error : null);
    expect(error(checkCommentTime(image(1), 3, undefined))).toMatch(/solo su un video/);
    expect(error(checkCommentTime(undefined, 3, undefined))).toMatch(/solo su un video/);
    expect(error(checkCommentTime(clip(1, 20), -1, undefined))).toMatch(/negativo/);
    expect(error(checkCommentTime(clip(1, 20), 10, 10))).toMatch(/dopo l'inizio/);
    expect(error(checkCommentTime(clip(1, 20), 10, 8))).toMatch(/dopo l'inizio/);
    expect(error(checkCommentTime(clip(1, 20), 22, undefined))).toMatch(/oltre la durata/);
    expect(error(checkCommentTime(clip(1, 20), 10, 25))).toMatch(/oltre la durata/);
    expect(error(checkCommentTime(clip(1, 20), undefined, 5))).toMatch(/inizio/);
  });
});

describe("assistant action items as comments", () => {
  const item = (over: Partial<Parameters<typeof planActionItemComment>[0]>) => ({
    area: "media",
    mediaIndex: null,
    timeSec: null,
    timeEndSec: null,
    request: "Cambiare la clip",
    priority: "alta",
    ...over,
  });
  const media = [image(1), clip(2, 20)];

  it("creates a comment for items about a media or a moment", () => {
    expect(planActionItemComment(item({ mediaIndex: 1, timeSec: 7, timeEndSec: 9 }), media)).toEqual({
      body: "Cambiare la clip",
      mediaIndex: 1,
      timeSec: 7,
      timeEndSec: 9,
      pinX: null,
      pinY: null,
    });
    expect(planActionItemComment(item({ mediaIndex: 0 }), media)).toMatchObject({ mediaIndex: 0, timeSec: null });
  });

  it("puts a timed item without media on the only video", () => {
    expect(planActionItemComment(item({ timeSec: 12 }), media)).toMatchObject({ mediaIndex: 1, timeSec: 12 });
    expect(planActionItemComment(item({ timeSec: 12 }), [clip(1), clip(2)])).toBeNull();
  });

  it("skips general items and drops invalid parts instead of failing", () => {
    expect(planActionItemComment(item({}), media)).toBeNull();
    expect(planActionItemComment(item({ mediaIndex: 5 }), media)).toBeNull();
    expect(planActionItemComment(item({ mediaIndex: 1.5 }), media)).toBeNull();
    expect(planActionItemComment(item({ mediaIndex: 1, request: "  " }), media)).toBeNull();
    // A moment on an image or past the end: kept as a comment on the media.
    expect(planActionItemComment(item({ mediaIndex: 0, timeSec: 3 }), media)).toMatchObject({ mediaIndex: 0, timeSec: null });
    expect(planActionItemComment(item({ mediaIndex: 1, timeSec: 45 }), media)).toMatchObject({ mediaIndex: 1, timeSec: null });
    // A bad end keeps the start.
    expect(planActionItemComment(item({ mediaIndex: 1, timeSec: 10, timeEndSec: 8 }), media)).toMatchObject({
      timeSec: 10,
      timeEndSec: null,
    });
    expect(planActionItemComment(item({ mediaIndex: 1, timeSec: -2 }), media)).toMatchObject({ timeSec: null });
  });
});

// ─── Content kinds (blog, ads) ───────────────────────────────────────────────

const article = (over: Partial<BlogContent> = {}): BlogContent => ({
  headline: "Come scegliere le extension",
  slug: "come-scegliere-le-extension",
  bodyMarkdown: "## Introduzione\n\nLe **extension** cambiano il look in un'ora.",
  excerpt: "",
  metaTitle: "Extension: la guida",
  metaDescription: "Tutto quello che serve sapere per scegliere le extension giuste, dal colore alla lunghezza.",
  focusKeyword: "extension",
  featuredImage: null,
  categories: ["Guide"],
  tags: ["capelli"],
  author: "Barbara",
  ...over,
});

const adSet = (over: Partial<AdContent> = {}): AdContent => ({
  campaign: { name: "Autunno", platform: "meta", objective: "Conversioni", budgetNote: "", audienceNote: "" },
  variants: [
    {
      id: "A",
      name: "Variante A — Prima/dopo",
      media: [image(1)],
      primaryText: "Prenota la tua consulenza gratuita",
      headline: "Extension naturali",
      description: "",
      cta: "Prenota ora",
      destinationUrl: "https://example.com/prenota",
      placements: ["meta_feed"],
    },
    {
      id: "B",
      name: "Variante B — Reel",
      media: [clip(2, 15)],
      primaryText: "Guarda la trasformazione",
      headline: "Prima e dopo",
      description: "",
      cta: "Scopri di più",
      destinationUrl: "https://example.com",
      placements: ["meta_stories_reels"],
    },
  ],
  ...over,
});

describe("content kinds", () => {
  it("marks blog and ads as internal", () => {
    expect(isInternalKind("SOCIAL_POST")).toBe(false);
    expect(isInternalKind("BLOG_ARTICLE")).toBe(true);
    expect(isInternalKind("AD_CREATIVE")).toBe(true);
  });

  it("validates input per kind: social needs networks/text/media, blog and ads need content", () => {
    const common = { clientId: "c1", title: "Articolo", publishAt: "2026-11-02T09:00:00Z" };
    expect(postInputSchema.safeParse({ ...common, kind: "BLOG_ARTICLE", content: article() }).success).toBe(true);
    expect(postInputSchema.safeParse({ ...common, kind: "AD_CREATIVE", content: adSet() }).success).toBe(true);
    expect(postInputSchema.safeParse({ ...common, kind: "BLOG_ARTICLE" }).success).toBe(false);
    expect(postInputSchema.safeParse({ ...common, kind: "PODCAST", content: {} }).success).toBe(false);
    // No kind = social, as before.
    expect(postInputSchema.safeParse({ ...common, networks: ["instagram"], text: "", media: [] }).success).toBe(true);
    expect(postInputSchema.safeParse({ ...common, networks: ["instagram"], media: [] }).success).toBe(false);
    expect(postInputSchema.safeParse({ ...common, kind: "SOCIAL_POST", text: "", media: [] }).success).toBe(false);
  });

  it("passes content through updates without inventing other fields", () => {
    expect(postUpdateSchema.parse({ content: { headline: "x" } })).toEqual({ content: { headline: "x" } });
    expect(postUpdateSchema.parse({ networks: [] })).toEqual({ networks: [] });
  });
});

describe("content versioning", () => {
  it("fingerprints content regardless of key order and media metadata", () => {
    const a = adSet();
    const reordered = JSON.parse(JSON.stringify({ variants: a.variants, campaign: a.campaign }));
    expect(contentFingerprint(reordered)).toBe(contentFingerprint(a));
    const withMeta = adSet();
    withMeta.variants[1].media = [{ ...clip(2, 15.2), posterUrl: "https://cdn.example.com/p.jpg", width: 1080, height: 1920 }];
    expect(contentFingerprint(withMeta)).toBe(contentFingerprint(a));
    const otherFile = adSet();
    otherFile.variants[1].media = [clip(3, 15)];
    expect(contentFingerprint(otherFile)).not.toBe(contentFingerprint(a));
  });

  it("treats a content change as a change the client must re-approve", () => {
    const current = { ...base, content: article() };
    expect(contentChanged(current, { content: article() })).toBe(false);
    expect(contentChanged(current, { content: article({ headline: "Nuovo titolo" }) })).toBe(true);
    expect(contentChanged(current, {})).toBe(false);

    const plan = planPostUpdate({
      status: "IN_REVIEW",
      currentVersionNumber: 1,
      lastSubmittedVersionNumber: 1,
      current: { ...current, title: "Articolo", publishAt: new Date("2026-11-02T09:00:00Z"), networks: [], networkOptions: {} },
      patch: { content: article({ bodyMarkdown: "Testo nuovo" }) },
    });
    expect(plan).toMatchObject({ contentChanged: true, createVersion: true, nextStatus: "DRAFT" });
  });

  it("describes blog changes", () => {
    expect(
      summarizeContentChanges(
        "BLOG_ARTICLE",
        article(),
        article({ headline: "Altro", metaDescription: "Nuova", slug: "altro", tags: ["capelli", "colore"] })
      )
    ).toEqual(["Titolo dell'articolo modificato", "SEO modificata: meta description, slug", "Categorie o tag modificati"]);
    expect(summarizeContentChanges("BLOG_ARTICLE", article(), article())).toEqual([]);
    expect(
      summarizeContentChanges("BLOG_ARTICLE", article(), article({ featuredImage: image(9) }))
    ).toEqual(["Immagine in evidenza cambiata"]);
  });

  it("describes ads changes per variant", () => {
    const before = adSet();
    const after = adSet();
    after.variants = [
      after.variants[1],
      { ...after.variants[0], cta: "Scopri di più", media: [image(4)] },
      { ...after.variants[0], id: "C", name: "Variante C — Testimonial" },
    ];
    expect(summarizeContentChanges("AD_CREATIVE", before, after)).toEqual([
      "Variante aggiunta: Variante C — Testimonial",
      "Ordine delle varianti cambiato",
      "Variante A — Prima/dopo modificata: media, CTA",
    ]);
    expect(
      summarizeContentChanges("AD_CREATIVE", before, { ...before, campaign: { ...before.campaign, budgetNote: "€30/giorno" } })
    ).toEqual(["Dati della campagna modificati"]);
    expect(summarizeContentChanges("AD_CREATIVE", before, { ...before, variants: [before.variants[0]] })).toEqual([
      "Variante rimossa: Variante B — Reel",
    ]);
  });

  it("adds content changes to the version diff, only for the kind that has them", () => {
    const before = { text: "", firstCommentText: null, media: [], content: article() };
    const after = { ...before, content: article({ bodyMarkdown: "Altro testo" }) };
    const diff = diffVersions(before, after, "BLOG_ARTICLE");
    expect(diff.changed).toBe(true);
    expect(summarizeVersionDiff(diff)).toEqual(["Testo dell'articolo modificato"]);
    // Social posts keep the previous behaviour (content is {}).
    expect(diffVersions({ ...base, content: {} }, { ...base, content: {} }).content).toEqual([]);
    expect(diffVersions(base, base, "BLOG_ARTICLE").changed).toBe(false);
  });
});

describe("assistant action items per kind", () => {
  const item = (over: Partial<Parameters<typeof planActionItemCommentFor>[0]>) => ({
    area: "testo",
    mediaIndex: null,
    timeSec: null,
    timeEndSec: null,
    request: "Accorciare",
    priority: "media",
    ...over,
  });
  const anchor = { quote: "cambiano il look", prefix: "Le extension ", suffix: " in un'ora", blockIndex: 1 };

  it("anchors blog items to their passage", () => {
    expect(planActionItemCommentFor(item({ anchor }), { kind: "BLOG_ARTICLE" })).toEqual({
      body: "Accorciare",
      mediaIndex: null,
      timeSec: null,
      timeEndSec: null,
      pinX: null,
      pinY: null,
      variantId: null,
      anchor,
    });
    expect(planActionItemCommentFor(item({}), { kind: "BLOG_ARTICLE" })).toBeNull();
  });

  it("puts ads items on their variant and its media", () => {
    const target = { kind: "AD_CREATIVE" as const, variants: adSet().variants };
    expect(planActionItemCommentFor(item({ variantId: "B", timeSec: 7 }), target)).toMatchObject({
      variantId: "B",
      mediaIndex: 0,
      timeSec: 7,
    });
    expect(planActionItemCommentFor(item({ variantId: "A" }), target)).toMatchObject({
      variantId: "A",
      mediaIndex: null,
    });
    expect(planActionItemCommentFor(item({ variantId: "Z", mediaIndex: 0 }), target)).toBeNull();
  });

  it("keeps the social behaviour", () => {
    const media = [image(1), clip(2, 20)];
    expect(planActionItemCommentFor(item({ mediaIndex: 1, timeSec: 7 }), { kind: "SOCIAL_POST", media })).toMatchObject({
      mediaIndex: 1,
      timeSec: 7,
      variantId: null,
      anchor: null,
    });
    expect(planActionItemCommentFor(item({}), { kind: "SOCIAL_POST", media })).toBeNull();
  });
});

describe("blog anchors", () => {
  it("validates and reads anchors", () => {
    expect(blogAnchorSchema.parse({ quote: " una frase " })).toEqual({
      quote: " una frase ",
      prefix: "",
      suffix: "",
      blockIndex: null,
    });
    expect(blogAnchorSchema.safeParse({ quote: "   " }).success).toBe(false);
    expect(blogAnchorSchema.safeParse({ quote: "x".repeat(2001) }).success).toBe(false);
    expect(readBlogAnchor({ quote: "ok", prefix: "a", suffix: "b", blockIndex: 2 })).toMatchObject({ blockIndex: 2 });
    expect(readBlogAnchor(null)).toBeNull();
    expect(readBlogAnchor({ nope: true })).toBeNull();
  });
});

describe("portal list summary per kind", () => {
  it("uses the caption and first media for social posts", () => {
    expect(summarizeVersionForList("SOCIAL_POST", { text: "Ciao", media: [image(1), image(2)], content: {} })).toEqual({
      cover: image(1),
      mediaCount: 2,
      variantCount: null,
      excerpt: "Ciao",
    });
  });

  it("uses the featured image and the excerpt (or the body) for articles", () => {
    const withImage = summarizeVersionForList("BLOG_ARTICLE", {
      text: "",
      media: [],
      content: article({ featuredImage: image(5), excerpt: "Una guida pratica" }),
    });
    expect(withImage).toMatchObject({ cover: { url: image(5).url }, mediaCount: 1, excerpt: "Una guida pratica" });
    expect(summarizeVersionForList("BLOG_ARTICLE", { text: "", media: [], content: article() }).excerpt).toBe(
      "Introduzione Le extension cambiano il look in un'ora."
    );
  });

  it("counts the variants of an ads set", () => {
    expect(summarizeVersionForList("AD_CREATIVE", { text: "", media: [], content: adSet() })).toMatchObject({
      cover: { url: image(1).url },
      mediaCount: 2,
      variantCount: 2,
      excerpt: "Prenota la tua consulenza gratuita",
    });
    expect(summarizeVersionForList("AD_CREATIVE", undefined)).toMatchObject({ variantCount: 0, cover: null });
  });
});
