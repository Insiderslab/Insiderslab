import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  notifyChangesRequested: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/notifications", () => ({
  notifyApproved: vi.fn(),
  notifyChangesRequested: mocks.notifyChangesRequested,
  notifyReviewRequested: vi.fn(),
}));

import { ValidationError } from "@/lib/errors";
import { requestChanges } from "@/lib/posts";

const post = {
  id: "post-1",
  clientId: "client-1",
  status: "IN_REVIEW" as const,
  currentVersionNumber: 3,
  kind: "SOCIAL_POST" as const,
  planId: null,
  client: { id: "client-1" },
};

const reviewer = { id: "reviewer-1", clientId: "client-1" };

function installDb(savedFeedback: Array<{ id: string }>) {
  const tx = {
    post: {
      findUnique: vi.fn(async () => post),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    postVersion: {
      findUniqueOrThrow: vi.fn(async () => ({ id: "version-3", media: [], content: {} })),
    },
    postComment: {
      findMany: vi.fn(async () => savedFeedback),
      create: vi.fn(),
    },
    postEvent: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
  };

  Object.assign(mocks.prisma, {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    post: { findUniqueOrThrow: vi.fn(async () => post) },
  });
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestChanges with saved comments", () => {
  it("submits only this reviewer's unresolved comments on the exact version, without copying them", async () => {
    const tx = installDb([{ id: "comment-mine" }]);

    const result = await requestChanges("post-1", reviewer, 3, null, { useSavedComments: true });

    expect(tx.postComment.findMany).toHaveBeenCalledWith({
      where: {
        postId: "post-1",
        versionId: "version-3",
        authorType: "CLIENT",
        reviewerId: "reviewer-1",
        resolvedAt: null,
      },
      select: { id: true },
    });
    expect(tx.postComment.create).not.toHaveBeenCalled();
    expect(tx.post.updateMany).toHaveBeenCalledWith({
      where: { id: "post-1", status: "IN_REVIEW", currentVersionNumber: 3 },
      data: { status: "CHANGES_REQUESTED" },
    });
    expect(tx.postEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        postId: "post-1",
        type: "CHANGES_REQUESTED",
        reviewerId: "reviewer-1",
        versionNumber: 3,
        metadata: { feedbackCommentIds: ["comment-mine"] },
      }),
    });
    expect(result).toMatchObject({ comment: null, actionComments: [] });
    expect(mocks.notifyChangesRequested).toHaveBeenCalledWith("post-1");
  });

  it("does not change status or notify when there is no saved feedback", async () => {
    const tx = installDb([]);

    await expect(
      requestChanges("post-1", reviewer, 3, null, { useSavedComments: true })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ValidationError>>({
        message: expect.stringContaining("Non hai ancora indicato modifiche"),
      })
    );

    expect(tx.post.updateMany).not.toHaveBeenCalled();
    expect(tx.postComment.create).not.toHaveBeenCalled();
    expect(tx.postEvent.create).not.toHaveBeenCalled();
    expect(mocks.notifyChangesRequested).not.toHaveBeenCalled();
  });

  it("rejects mixing saved comments with a new summary or assistant payload", async () => {
    const tx = installDb([{ id: "comment-mine" }]);

    await expect(
      requestChanges("post-1", reviewer, 3, "Un altro testo", { useSavedComments: true })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(tx.postComment.findMany).not.toHaveBeenCalled();
    expect(tx.post.updateMany).not.toHaveBeenCalled();
  });
});
