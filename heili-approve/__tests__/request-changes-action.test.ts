import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  requestChanges: vi.fn(),
  resolveReviewerToken: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/db/client", () => ({ prisma: { reviewSession: { findFirst: vi.fn() } } }));
vi.mock("@/lib/posts", () => ({
  addComment: vi.fn(),
  approvePost: vi.fn(),
  getPostForReviewer: vi.fn(),
  requestChanges: mocks.requestChanges,
}));
vi.mock("@/lib/reviewers", () => ({ resolveReviewerToken: mocks.resolveReviewerToken }));
vi.mock("@/lib/creative-decisions", () => ({ decideVariant: vi.fn(), finalizeCreativeReview: vi.fn() }));
vi.mock("@/lib/plans", () => ({ addPlanComment: vi.fn(), approvePlan: vi.fn() }));

import { requestChangesAction } from "@/app/review/[token]/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveReviewerToken.mockResolvedValue({ id: "reviewer-1", clientId: "client-1" });
  mocks.requestChanges.mockResolvedValue(undefined);
});

describe("requestChangesAction saved feedback contract", () => {
  it("submits saved comments without accepting or creating another message", async () => {
    const result = await requestChangesAction("token", {
      postId: "post-1",
      versionNumber: 4,
      feedback: "saved-comments",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.requestChanges).toHaveBeenCalledWith(
      "post-1",
      { id: "reviewer-1", clientId: "client-1" },
      4,
      null,
      { useSavedComments: true }
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged extra message on the saved-comments path", async () => {
    const result = await requestChangesAction("token", {
      postId: "post-1",
      versionNumber: 4,
      feedback: "saved-comments",
      message: "Testo ridondante",
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(mocks.requestChanges).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
