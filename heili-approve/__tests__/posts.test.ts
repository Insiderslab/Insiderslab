import { describe, expect, it } from "vitest";
import type { MediaItem } from "../lib/domain";
import { InvalidTransitionError } from "../lib/domain";
import {
  contentChanged,
  diffText,
  diffVersions,
  effectiveLastSubmittedVersion,
  findDisallowedNetworks,
  needsNewVersion,
  planPostUpdate,
  postInputSchema,
  postUpdateSchema,
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

  it("revokes an approval when the date changes, without a new version", () => {
    expect(plan("APPROVED", { publishAt: new Date("2026-11-03T09:00:00Z") })).toMatchObject({
      createVersion: false,
      scheduleChanged: true,
      nextStatus: "DRAFT",
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
