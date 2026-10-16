import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  undoApproval: vi.fn(),
  approvePost: vi.fn(),
  resolveReviewerToken: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/db/client", () => ({ prisma: { reviewSession: { findFirst: vi.fn() } } }));
vi.mock("@/lib/posts", () => ({
  addComment: vi.fn(),
  approvePost: mocks.approvePost,
  getPostForReviewer: vi.fn(),
  requestChanges: vi.fn(),
}));
vi.mock("@/lib/approval-undo", async () => {
  // The real error class: the action must show its message as it is.
  const { ValidationError } = await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  class UndoTooLateError extends ValidationError {}
  return { undoApproval: mocks.undoApproval, UndoTooLateError };
});
vi.mock("@/lib/reviewers", () => ({ resolveReviewerToken: mocks.resolveReviewerToken }));
vi.mock("@/lib/creative-decisions", () => ({ decideVariant: vi.fn(), finalizeCreativeReview: vi.fn() }));
vi.mock("@/lib/plans", () => ({ addPlanComment: vi.fn(), approvePlan: vi.fn() }));

import { approvePostAction, undoApprovalAction } from "@/app/review/[token]/actions";
import { UndoTooLateError } from "@/lib/approval-undo";
import { UNDO_TOO_LATE_MESSAGE } from "@/lib/undo-rules";

const reviewer = { id: "reviewer-1", clientId: "client-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveReviewerToken.mockResolvedValue({ ...reviewer, active: true });
  mocks.undoApproval.mockResolvedValue({ id: "post-1", status: "IN_REVIEW" });
  mocks.approvePost.mockResolvedValue({ id: "post-1", status: "APPROVED" });
});

describe("approvePostAction", () => {
  it("approves as an undoable single approval (scheduling and email wait for the window)", async () => {
    await expect(approvePostAction("token", { postId: "post-1", versionNumber: 3 })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.approvePost).toHaveBeenCalledWith("post-1", reviewer, 3, { undoable: true });
  });
});

describe("undoApprovalAction", () => {
  it("undoes the approval of that version for the reviewer of the link and refreshes the page", async () => {
    await expect(undoApprovalAction("token", { postId: "post-1", versionNumber: 3 })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.undoApproval).toHaveBeenCalledWith("post-1", reviewer, 3);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses a link that is not valid, without touching the post", async () => {
    mocks.resolveReviewerToken.mockResolvedValue(null);
    const result = await undoApprovalAction("token", { postId: "post-1", versionNumber: 3 });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.undoApproval).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("validates its input", async () => {
    for (const bad of [{ postId: "", versionNumber: 3 }, { postId: "post-1", versionNumber: 0 }, { postId: "post-1", versionNumber: 1.5 }]) {
      expect(await undoApprovalAction("token", bad)).toMatchObject({ ok: false });
    }
    expect(mocks.undoApproval).not.toHaveBeenCalled();
  });

  it("answers «Troppo tardi» in Italian, without asking the page to reload", async () => {
    mocks.undoApproval.mockRejectedValue(new UndoTooLateError(UNDO_TOO_LATE_MESSAGE));
    const result = await undoApprovalAction("token", { postId: "post-1", versionNumber: 3 });
    expect(result).toEqual({ ok: false, error: "Troppo tardi per annullare: scrivi all'agenzia", stale: false });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
