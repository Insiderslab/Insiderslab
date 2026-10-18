import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(),
    post: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    postEvent: { groupBy: vi.fn() },
    postVersion: { findUnique: vi.fn() },
    postComment: { create: vi.fn() },
    clientReviewer: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
  },
  prisma: {
    $transaction: vi.fn(),
    post: { findUniqueOrThrow: vi.fn() },
  },
  recordEvent: vi.fn(),
  recordActivity: vi.fn(),
  closeTasksForPost: vi.fn(),
  notifyReviewRequested: vi.fn(),
  notifyApproved: vi.fn(),
  notifyChangesRequested: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/events", () => ({ recordEvent: mocks.recordEvent }));
vi.mock("@/lib/activity", () => ({
  recordActivity: mocks.recordActivity,
  closeTasksForPost: mocks.closeTasksForPost,
}));
vi.mock("@/lib/notifications", () => ({
  notifyReviewRequested: mocks.notifyReviewRequested,
  notifyApproved: mocks.notifyApproved,
  notifyChangesRequested: mocks.notifyChangesRequested,
}));

import { addComment, cancelPost, submitForReview } from "@/lib/posts";
import type { Actor } from "@/lib/actor";

const agencyActor: Actor = { kind: "user", userId: "user-1" };

function reviewPost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    title: "Lancio autunno",
    kind: "SOCIAL_POST",
    status: "DRAFT",
    workspaceId: "workspace-1",
    clientId: "client-1",
    currentVersionNumber: 1,
    networks: ["threads"],
    networkOptions: {},
    client: {
      name: "Caffè Aurora",
      archivedAt: null,
      timezone: "Europe/Rome",
      autoSchedule: false,
      metricoolBlogId: null,
      reviewers: [],
    },
    versions: [{ number: 1, text: "Ciao", firstCommentText: null, media: [], content: null }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));
  mocks.recordActivity.mockResolvedValue({ id: "act-1" });
  mocks.closeTasksForPost.mockResolvedValue(0);
});

describe("closeTasksForPost hooks", () => {
  it("closes the open tasks when a post is cancelled", async () => {
    mocks.tx.post.findFirst.mockResolvedValue(reviewPost());
    mocks.tx.post.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.post.findUniqueOrThrow.mockResolvedValue(reviewPost({ status: "CANCELLED" }));

    await cancelPost("post-1", "workspace-1", agencyActor);

    expect(mocks.closeTasksForPost).toHaveBeenCalledWith("post-1", "user-1");
  });

  it("closes the open tasks of every post submitted in review", async () => {
    mocks.tx.post.findMany.mockResolvedValue([reviewPost(), reviewPost({ id: "post-2", title: "Secondo" })]);
    mocks.tx.post.updateMany.mockResolvedValue({ count: 1 });

    await submitForReview(["post-1", "post-2"], "workspace-1", agencyActor);

    expect(mocks.closeTasksForPost).toHaveBeenCalledTimes(2);
    expect(mocks.closeTasksForPost).toHaveBeenCalledWith("post-1", "user-1");
    expect(mocks.closeTasksForPost).toHaveBeenCalledWith("post-2", "user-1");
  });

  it("still completes the submit when closeTasksForPost throws", async () => {
    mocks.tx.post.findMany.mockResolvedValue([reviewPost()]);
    mocks.tx.post.updateMany.mockResolvedValue({ count: 1 });
    mocks.closeTasksForPost.mockRejectedValue(new Error("db down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await submitForReview(["post-1"], "workspace-1", agencyActor);

    expect(result.submitted).toEqual(["post-1"]);
    quiet.mockRestore();
  });
});

describe("CLIENT_COMMENT hook", () => {
  it("records a client comment as a task", async () => {
    const post = {
      id: "post-1",
      clientId: "client-1",
      workspaceId: "workspace-1",
      title: "Lancio autunno",
      kind: "SOCIAL_POST",
      status: "IN_REVIEW",
      currentVersionNumber: 1,
      submittedAt: new Date("2026-10-01T00:00:00Z"),
      planId: null,
    };
    mocks.tx.post.findUnique.mockResolvedValue(post);
    mocks.tx.clientReviewer.findUnique.mockResolvedValue({ clientId: "client-1", active: true });
    mocks.tx.postEvent.groupBy.mockResolvedValue([{ _max: { versionNumber: 1 } }]);
    mocks.tx.postVersion.findUnique.mockResolvedValue({ id: "version-1", number: 1, media: [], content: null });
    mocks.tx.postComment.create.mockResolvedValue({ id: "comment-1", postId: "post-1", body: "Schiarisci lo sfondo" });

    await addComment({
      postId: "post-1",
      actor: { kind: "reviewer", reviewerId: "reviewer-1" },
      body: "Schiarisci lo sfondo",
    });

    expect(mocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        clientId: "client-1",
        postId: "post-1",
        type: "CLIENT_COMMENT",
        title: "Commento del cliente: Lancio autunno",
        summary: "Schiarisci lo sfondo",
        dedupeKey: "comment:comment-1",
      })
    );
  });

  it("does not record an activity for an agency comment", async () => {
    mocks.tx.post.findUnique.mockResolvedValue({
      id: "post-1",
      clientId: "client-1",
      workspaceId: "workspace-1",
      title: "Lancio autunno",
      kind: "SOCIAL_POST",
      status: "DRAFT",
      currentVersionNumber: 1,
      submittedAt: null,
      planId: null,
    });
    mocks.tx.workspaceMember.findUnique.mockResolvedValue({ id: "member-1" });
    mocks.tx.postVersion.findUnique.mockResolvedValue({ id: "version-1", number: 1, media: [], content: null });
    mocks.tx.postComment.create.mockResolvedValue({ id: "comment-2", postId: "post-1", body: "Nota interna" });

    await addComment({
      postId: "post-1",
      actor: agencyActor,
      body: "Nota interna",
      workspaceId: "workspace-1",
    });

    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });
});
