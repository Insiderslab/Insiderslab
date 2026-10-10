import { describe, expect, it } from "vitest";
import { feedbackDraftKey, feedbackStorage, parseStoredFeedbackDraft } from "../components/portal/feedback-draft";

describe("portal feedback draft recovery", () => {
  it("never places the review token or post identity in the browser storage key", () => {
    const token = "private-review-token-123";
    const postId = "post-sensitive";
    const key = feedbackDraftKey(`${token}:${postId}:4`, { kind: "general" });
    expect(key).toMatch(/^approve-feedback-draft:v1:[a-f0-9]{32}$/);
    expect(key).not.toContain(token);
    expect(key).not.toContain(postId);
  });

  it("isolates versions and anchored drafts so stale text cannot move to another target", () => {
    const generalV4 = feedbackDraftKey("token:post:4", { kind: "general" });
    const generalV5 = feedbackDraftKey("token:post:5", { kind: "general" });
    const firstPoint = feedbackDraftKey("token:post:4", { kind: "pin", mediaIndex: 0, x: 0.2, y: 0.4 });
    const secondPoint = feedbackDraftKey("token:post:4", { kind: "pin", mediaIndex: 1, x: 0.2, y: 0.4 });
    expect(new Set([generalV4, generalV5, firstPoint, secondPoint]).size).toBe(4);
  });

  it("accepts only bounded draft data", () => {
    expect(parseStoredFeedbackDraft(JSON.stringify({ body: "Titolo più grande", start: "0:07", end: "0:10", withEnd: true })))
      .toEqual({ body: "Titolo più grande", start: "0:07", end: "0:10", withEnd: true });
    expect(parseStoredFeedbackDraft(JSON.stringify({ body: "x".repeat(5001) }))).toBeNull();
    expect(parseStoredFeedbackDraft("not-json")).toBeNull();
  });

  it("keeps comments usable when the browser blocks access to localStorage", () => {
    const source = Object.defineProperty({}, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    }) as { readonly localStorage: Storage };
    expect(feedbackStorage(source)).toBeNull();
  });
});
