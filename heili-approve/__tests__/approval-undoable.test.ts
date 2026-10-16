import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  scheduleApprovalFinalization: vi.fn(),
  requestScheduling: vi.fn(),
  notifyApproved: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/notifications", () => ({
  notifyApproved: mocks.notifyApproved,
  notifyChangesRequested: vi.fn(),
  notifyReviewRequested: vi.fn(),
}));
vi.mock("@/lib/approval-undo", () => ({ scheduleApprovalFinalization: mocks.scheduleApprovalFinalization }));
vi.mock("@/lib/scheduling", () => ({ requestScheduling: mocks.requestScheduling }));

import { approvePost } from "@/lib/posts";

const reviewer = { id: "reviewer-1", clientId: "client-1" };
const post = {
  id: "post-1",
  workspaceId: "workspace-1",
  clientId: "client-1",
  status: "IN_REVIEW" as const,
  currentVersionNumber: 3,
  approvedAt: null,
  approvedByReviewerId: null,
  kind: "SOCIAL_POST" as const,
  planId: null,
  client: { id: "client-1", autoSchedule: true },
};

function installDb() {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    post: {
      findUnique: vi.fn(async () => post),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    postEvent: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
  };
  Object.assign(mocks.prisma, {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    post: { findUniqueOrThrow: vi.fn(async () => ({ ...post, status: "APPROVED" })) },
  });
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_VARIANT = "all";
});

describe("approvePost with the undo window", () => {
  it("records the approval at once but leaves scheduling and the email to the delayed job", async () => {
    const tx = installDb();

    await expect(approvePost(post.id, reviewer, 3, { undoable: true })).resolves.toMatchObject({ status: "APPROVED" });

    // The approval itself: status, time, reviewer, version; tied to the exact version.
    const write = tx.post.updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
    expect(write[0].where).toMatchObject({ id: "post-1", status: "IN_REVIEW", currentVersionNumber: 3 });
    expect(write[0].data).toMatchObject({ status: "APPROVED", approvedByReviewerId: "reviewer-1" });
    const approvedAt = write[0].data.approvedAt as Date;
    expect(approvedAt).toBeInstanceOf(Date);
    const event = tx.postEvent.create.mock.calls[0][0] as { data: { type: string; versionNumber: number; metadata: Record<string, unknown> } };
    expect(event.data).toMatchObject({ type: "APPROVED", versionNumber: 3 });
    expect(event.data.metadata.undoable).toBe(true);

    // Nothing the agency or Metricool would see happens inside the window.
    expect(mocks.requestScheduling).not.toHaveBeenCalled();
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
    expect(mocks.scheduleApprovalFinalization).toHaveBeenCalledWith({
      postId: "post-1",
      versionNumber: 3,
      approvedAtMs: approvedAt.getTime(),
      reviewerId: "reviewer-1",
      notify: true,
    });
  });

  it("passes the notify choice to the delayed job", async () => {
    installDb();
    await approvePost(post.id, reviewer, 3, { undoable: true, notify: false });
    expect(mocks.scheduleApprovalFinalization).toHaveBeenCalledWith(expect.objectContaining({ notify: false }));
  });

  it("keeps the immediate behaviour for plan-wide approvals (not undoable)", async () => {
    const tx = installDb();

    await approvePost(post.id, reviewer, 3, { notify: false });

    expect(mocks.scheduleApprovalFinalization).not.toHaveBeenCalled();
    expect(mocks.requestScheduling).toHaveBeenCalledWith("post-1", { kind: "reviewer", reviewerId: "reviewer-1" });
    const event = tx.postEvent.create.mock.calls[0][0] as { data: { metadata: Record<string, unknown> } };
    expect(event.data.metadata.undoable).toBeUndefined();
  });

  it("does nothing more for a second click on an already approved post", async () => {
    installDb();
    (mocks.prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (client: unknown) => unknown) =>
      fn({
        $executeRaw: vi.fn(),
        post: { findUnique: vi.fn(async () => ({ ...post, status: "APPROVED", approvedAt: new Date() })) },
      })
    );
    await approvePost(post.id, reviewer, 3, { undoable: true });
    expect(mocks.scheduleApprovalFinalization).not.toHaveBeenCalled();
  });

  it("answers a simultaneous second click with the approval, not «I dati sono cambiati» (QA 2026-10-16)", async () => {
    const tx = installDb();
    // Both clicks read "in review"; this one loses the guarded write.
    tx.post.updateMany.mockResolvedValue({ count: 0 });
    const approved = { ...post, status: "APPROVED", approvedAt: new Date(), approvedByReviewerId: "reviewer-1" };
    (mocks.prisma.post as Record<string, unknown>).findUnique = vi.fn(async () => approved);

    await expect(approvePost(post.id, reviewer, 3, { undoable: true })).resolves.toMatchObject({ status: "APPROVED" });
    expect(mocks.scheduleApprovalFinalization).not.toHaveBeenCalled();
  });

  it("still reports the conflict when someone else's change won", async () => {
    const tx = installDb();
    tx.post.updateMany.mockResolvedValue({ count: 0 });
    // The agency sent a new version meanwhile.
    (mocks.prisma.post as Record<string, unknown>).findUnique = vi.fn(async () => ({ ...post, status: "DRAFT", currentVersionNumber: 4 }));

    await expect(approvePost(post.id, reviewer, 3, { undoable: true })).rejects.toThrow(/cambiati|aggiornato/);
  });
});
