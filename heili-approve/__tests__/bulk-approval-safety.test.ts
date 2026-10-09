import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  comment: null as { id: string } | null,
  clientMessage: null as { id: string } | null,
  activeVoice: null as { id: string } | null,
  clientVoiceFragment: null as { id: string } | null,
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/notifications", () => ({
  notifyApproved: vi.fn(),
  notifyChangesRequested: vi.fn(),
  notifyReviewRequested: vi.fn(),
}));

import { BulkApprovalFeedbackConflictError } from "@/lib/errors";
import { addComment, approvePost } from "@/lib/posts";

const reviewer = { id: "reviewer-1", clientId: "client-1" };
const post = {
  id: "post-1",
  workspaceId: "workspace-1",
  clientId: "client-1",
  status: "IN_REVIEW" as const,
  currentVersionNumber: 3,
  submittedAt: new Date("2026-10-01T10:00:00Z"),
  approvedAt: null,
  approvedByReviewerId: null,
  kind: "SOCIAL_POST" as const,
  planId: "plan-1",
  client: { id: "client-1", autoSchedule: false },
};

function installApprovalDb() {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    post: {
      findUnique: vi.fn(async () => post),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    postVersion: {
      findUnique: vi.fn(async () => ({ id: "version-3" })),
    },
    postComment: {
      findFirst: vi.fn(async () => mocks.comment),
    },
    reviewMessage: {
      findFirst: vi.fn(async () => mocks.clientMessage),
    },
    reviewVoiceCall: {
      findFirst: vi.fn(async () => mocks.activeVoice),
    },
    reviewVoiceTranscriptFragment: {
      findFirst: vi.fn(async () => mocks.clientVoiceFragment),
    },
    postEvent: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
  };
  Object.assign(mocks.prisma, {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    post: { findUniqueOrThrow: vi.fn(async () => ({ ...post, status: "APPROVED" })) },
  });
  return tx;
}

function installCommentDb(overrides: Record<string, unknown> = {}) {
  const currentPost = { ...post, ...overrides };
  const savedComment = { id: "comment-1", postId: post.id, body: "Rivedere il titolo" };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    post: { findUnique: vi.fn(async () => currentPost) },
    clientReviewer: { findUnique: vi.fn(async () => ({ clientId: post.clientId, active: true })) },
    workspaceMember: { findUnique: vi.fn(async () => ({ id: "member-1" })) },
    postEvent: {
      groupBy: vi.fn(async () => [{ postId: post.id, _max: { versionNumber: 3 } }]),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
    },
    postVersion: {
      findUnique: vi.fn(async () => ({ id: "version-3", number: 3, media: [], content: {} })),
      findFirst: vi.fn(async () => ({ id: "version-2", number: 2, media: [], content: {} })),
    },
    postComment: { create: vi.fn(async () => savedComment) },
  };
  Object.assign(mocks.prisma, {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  });
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.comment = null;
  mocks.clientMessage = null;
  mocks.activeVoice = null;
  mocks.clientVoiceFragment = null;
  process.env.APP_VARIANT = "all";
});

describe("bulk approval feedback safety", () => {
  it("locks the post, checks the exact version, then approves when there is no feedback", async () => {
    const tx = installApprovalDb();

    await expect(approvePost(post.id, reviewer, 3, { notify: false, bulkSafety: true })).resolves.toMatchObject({
      status: "APPROVED",
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.postVersion.findUnique).toHaveBeenCalledWith({
      where: { postId_number: { postId: post.id, number: 3 } },
      select: { id: true },
    });
    expect(tx.postComment.findFirst).toHaveBeenCalledWith({
      where: {
        postId: post.id,
        authorType: "CLIENT",
        resolvedAt: null,
        OR: [{ versionId: "version-3" }, { versionId: null }],
      },
      select: { id: true },
    });
    expect(tx.reviewMessage.findFirst).toHaveBeenCalledWith({
      where: { role: "CLIENT", session: { postId: post.id, versionNumber: 3 } },
      select: { id: true },
    });
    expect(tx.reviewVoiceCall.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: ["STARTING", "ACTIVE", "CLOSING"] },
        session: { postId: post.id, versionNumber: 3 },
      },
      select: { id: true },
    });
    expect(tx.reviewVoiceTranscriptFragment.findFirst).toHaveBeenCalledWith({
      where: { speaker: "user", call: { session: { postId: post.id, versionNumber: 3 } } },
      select: { id: true },
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.post.findUnique.mock.invocationCallOrder[0]);
    expect(tx.post.findUnique.mock.invocationCallOrder[0]).toBeLessThan(tx.postComment.findFirst.mock.invocationCallOrder[0]);
    expect(tx.postComment.findFirst.mock.invocationCallOrder[0]).toBeLessThan(tx.post.updateMany.mock.invocationCallOrder[0]);
  });

  it.each([
    ["an unresolved comment", "comment", { id: "comment-1" }],
    ["a client assistant message", "clientMessage", { id: "message-1" }],
    ["an active voice call", "activeVoice", { id: "call-1" }],
    ["authenticated client speech awaiting projection", "clientVoiceFragment", { id: "fragment-1" }],
  ] as const)("leaves the post for individual review when it has %s", async (_label, field, blocker) => {
    const tx = installApprovalDb();
    mocks[field] = blocker;

    await expect(approvePost(post.id, reviewer, 3, { notify: false, bulkSafety: true })).rejects.toBeInstanceOf(
      BulkApprovalFeedbackConflictError
    );
    expect(tx.post.updateMany).not.toHaveBeenCalled();
    expect(tx.postEvent.create).not.toHaveBeenCalled();
  });

  it("does not impose the bulk policy on a single explicit approval", async () => {
    const tx = installApprovalDb();
    mocks.clientMessage = { id: "message-1" };

    await expect(approvePost(post.id, reviewer, 3, { notify: false })).resolves.toMatchObject({ status: "APPROVED" });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.postComment.findFirst).not.toHaveBeenCalled();
    expect(tx.reviewMessage.findFirst).not.toHaveBeenCalled();
    expect(tx.reviewVoiceCall.findFirst).not.toHaveBeenCalled();
    expect(tx.reviewVoiceTranscriptFragment.findFirst).not.toHaveBeenCalled();
  });
});

describe("comment write serialization", () => {
  it("locks the post row before validating and creating a reviewer comment", async () => {
    const tx = installCommentDb();

    await addComment({ postId: post.id, actor: { kind: "reviewer", reviewerId: reviewer.id }, body: "Rivedere il titolo" });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.post.findUnique.mock.invocationCallOrder[0]);
    expect(tx.post.findUnique.mock.invocationCallOrder[0]).toBeLessThan(tx.postComment.create.mock.invocationCallOrder[0]);
  });

  it("does not write a reviewer comment when bulk approval won the row-lock race", async () => {
    const tx = installCommentDb({ status: "APPROVED", approvedAt: new Date() });

    await expect(
      addComment({ postId: post.id, actor: { kind: "reviewer", reviewerId: reviewer.id }, body: "Arrivato tardi" })
    ).rejects.toEqual(expect.objectContaining({ name: "ConflictError", message: expect.stringContaining("già stato deciso") }));

    expect(tx.postComment.create).not.toHaveBeenCalled();
    expect(tx.postEvent.create).not.toHaveBeenCalled();
  });

  it("does not let a reviewer attach new feedback to an older version", async () => {
    const tx = installCommentDb();

    await expect(
      addComment({
        postId: post.id,
        actor: { kind: "reviewer", reviewerId: reviewer.id },
        body: "Versione vecchia",
        versionId: "version-2",
      })
    ).rejects.toEqual(expect.objectContaining({ name: "ConflictError", message: expect.stringContaining("aggiornato") }));

    expect(tx.postComment.create).not.toHaveBeenCalled();
  });

  it("keeps agency historical comments available after the client decision", async () => {
    const tx = installCommentDb({ status: "APPROVED", approvedAt: new Date() });

    await expect(
      addComment({
        postId: post.id,
        actor: { kind: "user", userId: "user-1" },
        workspaceId: post.workspaceId,
        body: "Nota interna dopo l'approvazione",
      })
    ).resolves.toMatchObject({ id: "comment-1" });

    expect(tx.postComment.create).toHaveBeenCalledTimes(1);
  });
});
