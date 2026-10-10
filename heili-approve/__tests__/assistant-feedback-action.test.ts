import { beforeEach, describe, expect, it, vi } from "vitest";

/** «Aggiungi al feedback»: the server action behind Heili's conclusion after «Chiedi modifiche». */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  addAssistantFeedback: vi.fn(),
  requestChanges: vi.fn(),
  approvePost: vi.fn(),
  getPostForReviewer: vi.fn(),
  findSession: vi.fn(),
  resolveReviewerToken: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/db/client", () => ({ prisma: { reviewSession: { findFirst: mocks.findSession } } }));
vi.mock("@/lib/posts", () => ({
  addAssistantFeedback: mocks.addAssistantFeedback,
  addComment: vi.fn(),
  approvePost: mocks.approvePost,
  getPostForReviewer: mocks.getPostForReviewer,
  requestChanges: mocks.requestChanges,
}));
vi.mock("@/lib/reviewers", () => ({ resolveReviewerToken: mocks.resolveReviewerToken }));
vi.mock("@/lib/creative-decisions", () => ({ decideVariant: vi.fn(), finalizeCreativeReview: vi.fn() }));
vi.mock("@/lib/plans", () => ({ addPlanComment: vi.fn(), approvePlan: vi.fn() }));

import { ConflictError } from "@/lib/errors";
import { addAssistantFeedbackAction } from "@/app/review/[token]/actions";

const reviewer = { id: "reviewer-1", clientId: "client-1" };
const input = { postId: "post-1", versionNumber: 3, message: "Aggiungere il logo", reviewSessionId: "session-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveReviewerToken.mockResolvedValue(reviewer);
  mocks.findSession.mockResolvedValue({
    actionItems: [{ area: "media", mediaIndex: 0, timeSec: null, timeEndSec: null, request: "Spostare il logo", priority: "media" }],
  });
  mocks.getPostForReviewer.mockResolvedValue({
    kind: "SOCIAL_POST",
    versions: [{ number: 3, id: "v3", media: [{ type: "image", url: "https://example.com/a.png" }], content: null }],
  });
  mocks.addAssistantFeedback.mockResolvedValue({ comment: {}, actionComments: [] });
});

describe("addAssistantFeedbackAction", () => {
  it("adds the feedback with the items read from the database, and only that", async () => {
    const result = await addAssistantFeedbackAction("token", input);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: { id: "session-1", postId: "post-1", reviewerId: "reviewer-1", versionNumber: 3 },
      select: { actionItems: true },
    });
    expect(mocks.addAssistantFeedback).toHaveBeenCalledWith("post-1", reviewer, 3, "Aggiungere il logo", {
      reviewSessionId: "session-1",
      actionItems: [expect.objectContaining({ request: "Spostare il logo", mediaIndex: 0 })],
    });
    // It is not a decision: no change request, no approval.
    expect(mocks.requestChanges).not.toHaveBeenCalled();
    expect(mocks.approvePost).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses a bad link, a forged extra field and a conversation that is not the reviewer's", async () => {
    mocks.resolveReviewerToken.mockResolvedValueOnce(null);
    expect(await addAssistantFeedbackAction("bad", input)).toMatchObject({ ok: false });

    expect(await addAssistantFeedbackAction("token", { ...input, status: "APPROVED" } as never)).toMatchObject({ ok: false });

    mocks.findSession.mockResolvedValueOnce(null);
    expect(await addAssistantFeedbackAction("token", input)).toMatchObject({ ok: false });

    expect(mocks.addAssistantFeedback).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reports a post that moved on as stale", async () => {
    mocks.addAssistantFeedback.mockRejectedValueOnce(new ConflictError("Il post è stato aggiornato dall'agenzia"));

    expect(await addAssistantFeedbackAction("token", input)).toMatchObject({ ok: false, stale: true });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
