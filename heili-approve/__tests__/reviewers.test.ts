import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, hashToken } from "../lib/crypto";
import {
  LAST_SEEN_THROTTLE_MS,
  buildReviewUrl,
  getReviewUrl,
  isPlausibleReviewToken,
  issueReviewerToken,
  reviewerInputSchema,
  shouldTouchLastSeen,
} from "../lib/reviewers";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  vi.stubEnv("PUBLIC_BASE_URL", "https://approve.example.com/");
});

describe("reviewer link tokens", () => {
  it("stores only the hash and an encrypted copy, never the token", () => {
    const issued = issueReviewerToken();
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenHash).toBe(hashToken(issued.token));
    expect(issued.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(issued.tokenEncrypted).not.toContain(issued.token);
    expect(decryptSecret(issued.tokenEncrypted)).toBe(issued.token);
  });

  it("issues a different token every time", () => {
    const a = issueReviewerToken();
    const b = issueReviewerToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hashes deterministically so lookups by hash work", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("rebuilds the review URL from the encrypted token", () => {
    const issued = issueReviewerToken();
    expect(buildReviewUrl(issued.token)).toBe(`https://approve.example.com/review/${issued.token}`);
    expect(getReviewUrl({ tokenEncrypted: issued.tokenEncrypted })).toBe(buildReviewUrl(issued.token));
  });

  it("rejects implausible tokens before touching the database", () => {
    expect(isPlausibleReviewToken(issueReviewerToken().token)).toBe(true);
    expect(isPlausibleReviewToken("")).toBe(false);
    expect(isPlausibleReviewToken("short")).toBe(false);
    expect(isPlausibleReviewToken("../../etc/passwd".padEnd(40, "a"))).toBe(false);
    expect(isPlausibleReviewToken("a".repeat(200))).toBe(false);
    expect(isPlausibleReviewToken(undefined)).toBe(false);
  });
});

describe("lastSeenAt throttling", () => {
  const now = new Date("2026-10-05T12:00:00Z");

  it("touches a reviewer never seen or seen long ago", () => {
    expect(shouldTouchLastSeen(null, now)).toBe(true);
    expect(shouldTouchLastSeen(new Date(now.getTime() - LAST_SEEN_THROTTLE_MS), now)).toBe(true);
  });

  it("skips the write within five minutes", () => {
    expect(shouldTouchLastSeen(new Date(now.getTime() - 60_000), now)).toBe(false);
  });
});

describe("reviewer input", () => {
  it("normalises the email", () => {
    expect(reviewerInputSchema.parse({ name: " Giulia ", email: " Giulia@Example.COM " })).toEqual({
      name: "Giulia",
      email: "giulia@example.com",
    });
  });

  it("rejects invalid input", () => {
    expect(reviewerInputSchema.safeParse({ name: "", email: "a@b.it" }).success).toBe(false);
    expect(reviewerInputSchema.safeParse({ name: "Giulia", email: "non-una-email" }).success).toBe(false);
  });
});
