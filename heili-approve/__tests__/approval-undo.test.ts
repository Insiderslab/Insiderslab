import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(),
    post: { findUnique: vi.fn(), updateMany: vi.fn() },
    postEvent: { findFirst: vi.fn() },
  },
  prisma: {
    $transaction: vi.fn(),
    post: { findUniqueOrThrow: vi.fn() },
  },
  recordEvent: vi.fn(),
  notifyApproved: vi.fn(),
  afterPlanDecision: vi.fn(),
  requestScheduling: vi.fn(),
  queue: { add: vi.fn(), getJob: vi.fn() },
  job: { remove: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/events", () => ({ recordEvent: mocks.recordEvent }));
vi.mock("@/lib/notifications", () => ({ notifyApproved: mocks.notifyApproved }));
vi.mock("@/lib/posts", () => ({ afterPlanDecision: mocks.afterPlanDecision }));
vi.mock("@/lib/scheduling", () => ({ requestScheduling: mocks.requestScheduling }));
vi.mock("@/lib/queue/client", () => ({
  APPROVAL_FINALIZE_JOB_NAME: "finalize-approval",
  approvalFinalizeJobId: (postId: string, version: number, approvedAtMs: number) =>
    `finalize_${postId}_v${version}_${approvedAtMs}`,
  getApprovalQueue: () => mocks.queue,
}));

import {
  ApprovalWindowOpenError,
  UndoTooLateError,
  finalizeApproval,
  scheduleApprovalFinalization,
  undoApproval,
} from "@/lib/approval-undo";
import type { PostStatus } from "@/app/generated/prisma/client";
import { nextStatus } from "@/lib/domain";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  APPROVAL_FINALIZE_DELAY_MS,
  SWEEP_APPROVED_GRACE_MS,
  SWEEP_FRESH_APPROVAL_MS,
  UNDO_TOAST_MS,
  UNDO_TOO_LATE_MESSAGE,
  UNDO_WINDOW_MS,
  evaluateFinalize,
  evaluateUndo,
  sweepApprovedCutoff,
  undoRefusalMessage,
  type FinalizeSubject,
  type UndoSubject,
} from "@/lib/undo-rules";

const T0 = new Date("2026-10-15T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const reviewer = { id: "reviewer-1", clientId: "client-1" };

function subject(overrides: Partial<UndoSubject> = {}): UndoSubject {
  return {
    clientId: "client-1",
    status: "APPROVED",
    currentVersionNumber: 3,
    approvedAt: T0,
    approvedByReviewerId: "reviewer-1",
    undoable: true,
    ...overrides,
  };
}

function ask(s: UndoSubject | null, over: Partial<{ reviewerId: string; clientId: string; versionNumber: number; ms: number }> = {}) {
  return evaluateUndo(s, {
    reviewerId: over.reviewerId ?? "reviewer-1",
    clientId: over.clientId ?? "client-1",
    versionNumber: over.versionNumber ?? 3,
    now: at(over.ms ?? 1_000),
  });
}

describe("the undo window", () => {
  it("holds scheduling and the email for exactly the undo window, and the toast is shorter", () => {
    expect(UNDO_WINDOW_MS).toBe(15_000);
    expect(APPROVAL_FINALIZE_DELAY_MS).toBe(UNDO_WINDOW_MS);
    expect(UNDO_TOAST_MS).toBe(10_000);
    expect(UNDO_TOAST_MS).toBeLessThan(UNDO_WINDOW_MS);
  });
});

describe("the state machine", () => {
  it("undo_approval only goes from APPROVED back to IN_REVIEW", () => {
    expect(nextStatus("APPROVED", "undo_approval")).toBe("IN_REVIEW");
    const others: PostStatus[] = ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "SCHEDULING", "SCHEDULED", "FAILED", "CANCELLED", "DELIVERED"];
    for (const status of others) expect(nextStatus(status, "undo_approval")).toBeNull();
  });
});

describe("evaluateUndo", () => {
  it("accepts the reviewer who approved, on that version, inside the window", () => {
    expect(ask(subject())).toEqual({ ok: true });
    expect(ask(subject(), { ms: UNDO_WINDOW_MS - 1 })).toEqual({ ok: true });
  });

  it("refuses once the window has closed", () => {
    expect(ask(subject(), { ms: UNDO_WINDOW_MS })).toEqual({ ok: false, reason: "too_late" });
    expect(ask(subject(), { ms: 60_000 })).toEqual({ ok: false, reason: "too_late" });
  });

  it("refuses another reviewer of the same client", () => {
    expect(ask(subject(), { reviewerId: "reviewer-2" })).toEqual({ ok: false, reason: "not_yours" });
  });

  it("does not reveal a post of another client", () => {
    expect(ask(subject(), { clientId: "client-2" })).toEqual({ ok: false, reason: "not_found" });
    expect(ask(null)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a version that is not the current one", () => {
    expect(ask(subject(), { versionNumber: 2 })).toEqual({ ok: false, reason: "stale_version" });
    expect(ask(subject({ currentVersionNumber: 4 }))).toEqual({ ok: false, reason: "stale_version" });
  });

  it.each(["SCHEDULING", "SCHEDULED", "FAILED", "DELIVERED"] as const)(
    "is too late once the post is %s (scheduling started)",
    (status) => {
      expect(ask(subject({ status }))).toEqual({ ok: false, reason: "too_late" });
    }
  );

  it.each(["IN_REVIEW", "CHANGES_REQUESTED", "DRAFT", "CANCELLED"] as const)("has nothing to undo when the post is %s", (status) => {
    expect(ask(subject({ status, approvedAt: null, approvedByReviewerId: null }))).toEqual({
      ok: false,
      reason: "not_approved",
    });
  });

  it("refuses a plan-wide approval, which was never undoable", () => {
    expect(ask(subject({ undoable: false }))).toEqual({ ok: false, reason: "not_undoable" });
  });

  it("speaks Italian, with the agreed wording for «too late»", () => {
    expect(UNDO_TOO_LATE_MESSAGE).toBe("Troppo tardi per annullare: scrivi all'agenzia");
    expect(undoRefusalMessage("too_late")).toBe(UNDO_TOO_LATE_MESSAGE);
    expect(undoRefusalMessage("not_undoable")).toBe(UNDO_TOO_LATE_MESSAGE);
    expect(undoRefusalMessage("not_yours")).toContain("da te");
  });
});

describe("evaluateFinalize", () => {
  const job = { versionNumber: 3, approvedAtMs: T0.getTime() };
  function post(overrides: Partial<FinalizeSubject> = {}): FinalizeSubject {
    return { status: "APPROVED", kind: "SOCIAL_POST", currentVersionNumber: 3, approvedAt: T0, autoSchedule: true, ...overrides };
  }

  it("schedules an auto-schedule social post once the window is closed", () => {
    expect(evaluateFinalize(post(), job, at(UNDO_WINDOW_MS))).toEqual({ proceed: true, schedule: true });
  });

  it("waits if it runs before the window is closed", () => {
    expect(evaluateFinalize(post(), job, at(UNDO_WINDOW_MS - 1))).toEqual({ proceed: false, reason: "too_early" });
  });

  it("does nothing for an approval that was undone or replaced by another one", () => {
    expect(evaluateFinalize(post({ status: "IN_REVIEW", approvedAt: null }), job, at(20_000))).toEqual({
      proceed: false,
      reason: "undone",
    });
    expect(evaluateFinalize(post({ approvedAt: at(5_000) }), job, at(30_000))).toEqual({ proceed: false, reason: "undone" });
    expect(evaluateFinalize(null, job, at(20_000))).toEqual({ proceed: false, reason: "undone" });
  });

  it("does nothing for another version or a post the agency took back", () => {
    expect(evaluateFinalize(post({ currentVersionNumber: 4 }), job, at(20_000))).toEqual({
      proceed: false,
      reason: "stale_version",
    });
    expect(evaluateFinalize(post({ status: "DRAFT" }), job, at(20_000))).toEqual({ proceed: false, reason: "changed" });
  });

  it("never schedules internal kinds, manual clients or a post the agency already scheduled", () => {
    expect(evaluateFinalize(post({ kind: "BLOG_ARTICLE" }), job, at(20_000))).toEqual({ proceed: true, schedule: false });
    expect(evaluateFinalize(post({ kind: "AD_CREATIVE" }), job, at(20_000))).toEqual({ proceed: true, schedule: false });
    expect(evaluateFinalize(post({ autoSchedule: false }), job, at(20_000))).toEqual({ proceed: true, schedule: false });
    expect(evaluateFinalize(post({ status: "SCHEDULING" }), job, at(20_000))).toEqual({ proceed: true, schedule: false });
  });
});

describe("the cron sweep and fresh approvals", () => {
  it("never reaches into the undo window", () => {
    expect(SWEEP_FRESH_APPROVAL_MS).toBeGreaterThan(UNDO_WINDOW_MS);
    expect(SWEEP_APPROVED_GRACE_MS).toBeGreaterThanOrEqual(SWEEP_FRESH_APPROVAL_MS);
  });

  it("only picks approvals older than the cutoff", () => {
    const now = new Date("2026-10-15T12:00:00.000Z");
    const cutoff = sweepApprovedCutoff(now);
    expect(now.getTime() - cutoff.getTime()).toBe(SWEEP_APPROVED_GRACE_MS);
    // An approval from 19 s ago (still undoable or just closed) is newer than the cutoff.
    const fresh = new Date(now.getTime() - 19_000);
    expect(fresh.getTime()).toBeGreaterThan(cutoff.getTime());
  });
});

// ─── Service: undoApproval ───────────────────────────────────────────────────

const row = {
  clientId: "client-1",
  kind: "SOCIAL_POST" as const,
  status: "APPROVED" as const,
  currentVersionNumber: 3,
  approvedAt: new Date(Date.now() - 2_000),
  approvedByReviewerId: "reviewer-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_VARIANT = "all";
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));
  mocks.tx.$executeRaw.mockResolvedValue(1);
  mocks.tx.post.findUnique.mockResolvedValue(row);
  mocks.tx.post.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.postEvent.findFirst.mockResolvedValue({ metadata: { undoable: true } });
  mocks.recordEvent.mockResolvedValue({});
  mocks.prisma.post.findUniqueOrThrow.mockResolvedValue({ ...row, status: "IN_REVIEW" });
  mocks.queue.getJob.mockResolvedValue(mocks.job);
  mocks.queue.add.mockResolvedValue(undefined);
  mocks.requestScheduling.mockResolvedValue({ queued: true });
});

describe("undoApproval", () => {
  it("puts the post back IN_REVIEW, records the event and drops the pending job", async () => {
    const post = await undoApproval("post-1", reviewer, 3);

    expect(post.status).toBe("IN_REVIEW");
    // Row lock first, then the read inside the same transaction.
    expect(mocks.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.post.findUnique.mock.invocationCallOrder[0]);
    expect(mocks.tx.post.updateMany).toHaveBeenCalledWith({
      where: { id: "post-1", status: "APPROVED", currentVersionNumber: 3, approvedByReviewerId: "reviewer-1" },
      data: { status: "IN_REVIEW", approvedAt: null, approvedByReviewerId: null, lastError: null },
    });
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        postId: "post-1",
        type: "APPROVAL_UNDONE",
        actor: { kind: "reviewer", reviewerId: "reviewer-1" },
        versionNumber: 3,
      })
    );
    expect(mocks.queue.getJob).toHaveBeenCalledWith(`finalize_post-1_v3_${row.approvedAt.getTime()}`);
    expect(mocks.job.remove).toHaveBeenCalledTimes(1);
    // Nothing was scheduled or sent by the undo itself.
    expect(mocks.requestScheduling).not.toHaveBeenCalled();
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
  });

  it("works for blog and ads (internal kinds have no scheduling to cancel)", async () => {
    for (const kind of ["BLOG_ARTICLE", "AD_CREATIVE"] as const) {
      mocks.tx.post.findUnique.mockResolvedValue({ ...row, kind });
      await expect(undoApproval("post-1", reviewer, 3)).resolves.toMatchObject({ status: "IN_REVIEW" });
    }
    expect(mocks.requestScheduling).not.toHaveBeenCalled();
  });

  it("refuses after the window and writes nothing", async () => {
    mocks.tx.post.findUnique.mockResolvedValue({ ...row, approvedAt: new Date(Date.now() - 16_000) });
    const error = await undoApproval("post-1", reviewer, 3).catch((e) => e);
    expect(error).toBeInstanceOf(UndoTooLateError);
    expect(error.message).toBe("Troppo tardi per annullare: scrivi all'agenzia");
    expect(mocks.tx.post.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
    expect(mocks.job.remove).not.toHaveBeenCalled();
  });

  it("refuses another reviewer", async () => {
    await expect(undoApproval("post-1", { id: "reviewer-2", clientId: "client-1" }, 3)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.tx.post.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a post of another client as not found", async () => {
    await expect(undoApproval("post-1", { id: "reviewer-1", clientId: "client-2" }, 3)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses another version as a stale page", async () => {
    await expect(undoApproval("post-1", reviewer, 2)).rejects.toBeInstanceOf(ConflictError);
    mocks.tx.post.findUnique.mockResolvedValue({ ...row, currentVersionNumber: 4 });
    await expect(undoApproval("post-1", reviewer, 3)).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.tx.post.updateMany).not.toHaveBeenCalled();
  });

  it.each(["SCHEDULING", "SCHEDULED"] as const)("is too late when the post is already %s (the race lost to scheduling)", async (status) => {
    mocks.tx.post.findUnique.mockResolvedValue({ ...row, status });
    await expect(undoApproval("post-1", reviewer, 3)).rejects.toBeInstanceOf(UndoTooLateError);
    expect(mocks.tx.post.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("is too late if scheduling wins between the check and the write", async () => {
    mocks.tx.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(undoApproval("post-1", reviewer, 3)).rejects.toBeInstanceOf(UndoTooLateError);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("refuses a plan-wide approval (its event has no undoable flag)", async () => {
    mocks.tx.postEvent.findFirst.mockResolvedValue({ metadata: {} });
    await expect(undoApproval("post-1", reviewer, 3)).rejects.toBeInstanceOf(UndoTooLateError);
    expect(mocks.tx.post.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the undo when the job cannot be removed (it will find nothing to do)", async () => {
    mocks.queue.getJob.mockRejectedValue(new Error("redis away"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(undoApproval("post-1", reviewer, 3)).resolves.toMatchObject({ status: "IN_REVIEW" });
    quiet.mockRestore();
  });
});

// ─── Service: delayed follow-up ──────────────────────────────────────────────

describe("scheduleApprovalFinalization", () => {
  it("queues one job per approval, delayed by the undo window", async () => {
    await scheduleApprovalFinalization({
      postId: "post-1",
      versionNumber: 3,
      approvedAtMs: T0.getTime(),
      reviewerId: "reviewer-1",
      notify: true,
    });
    expect(mocks.queue.add).toHaveBeenCalledWith(
      "finalize-approval",
      expect.objectContaining({ postId: "post-1", versionNumber: 3, approvedAtMs: T0.getTime() }),
      { jobId: `finalize_post-1_v3_${T0.getTime()}`, delay: 15_000 }
    );
  });
});

describe("finalizeApproval", () => {
  const data = { postId: "post-1", versionNumber: 3, approvedAtMs: T0.getTime(), reviewerId: "reviewer-1", notify: true };
  const finalizeRow = (overrides: Record<string, unknown> = {}) => ({
    kind: "SOCIAL_POST",
    status: "APPROVED",
    currentVersionNumber: 3,
    approvedAt: T0,
    planId: "plan-1",
    client: { autoSchedule: true },
    ...overrides,
  });

  it("schedules, emails the agency and updates the plan once the window is closed", async () => {
    mocks.tx.post.findUnique.mockResolvedValue(finalizeRow());
    await expect(finalizeApproval(data, at(15_100))).resolves.toEqual({ outcome: "finalized", scheduled: true });
    expect(mocks.requestScheduling).toHaveBeenCalledWith("post-1", { kind: "reviewer", reviewerId: "reviewer-1" });
    expect(mocks.notifyApproved).toHaveBeenCalledWith("post-1");
    expect(mocks.afterPlanDecision).toHaveBeenCalledWith("plan-1");
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an approval that was undone", async () => {
    mocks.tx.post.findUnique.mockResolvedValue(finalizeRow({ status: "IN_REVIEW", approvedAt: null }));
    await expect(finalizeApproval(data, at(15_100))).resolves.toEqual({ outcome: "skipped", reason: "undone" });
    expect(mocks.requestScheduling).not.toHaveBeenCalled();
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
  });

  it("does nothing for the old approval when the post was approved again", async () => {
    mocks.tx.post.findUnique.mockResolvedValue(finalizeRow({ approvedAt: at(40_000) }));
    await expect(finalizeApproval(data, at(55_000))).resolves.toEqual({ outcome: "skipped", reason: "undone" });
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
  });

  it("emails but never schedules a blog article or an ads set", async () => {
    mocks.tx.post.findUnique.mockResolvedValue(finalizeRow({ kind: "BLOG_ARTICLE" }));
    await expect(finalizeApproval(data, at(15_100))).resolves.toEqual({ outcome: "finalized", scheduled: false });
    expect(mocks.requestScheduling).not.toHaveBeenCalled();
    expect(mocks.notifyApproved).toHaveBeenCalledWith("post-1");
  });

  it("sends no email for a plan-wide approval (notify off) but still schedules", async () => {
    mocks.tx.post.findUnique.mockResolvedValue(finalizeRow());
    await finalizeApproval({ ...data, notify: false }, at(15_100));
    expect(mocks.requestScheduling).toHaveBeenCalledTimes(1);
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
    expect(mocks.afterPlanDecision).not.toHaveBeenCalled();
  });

  it("throws (BullMQ retries) when it runs before the window closed", async () => {
    mocks.tx.post.findUnique.mockResolvedValue(finalizeRow());
    await expect(finalizeApproval(data, at(14_000))).rejects.toBeInstanceOf(ApprovalWindowOpenError);
    expect(mocks.requestScheduling).not.toHaveBeenCalled();
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
  });

  it("still emails when the scheduling request fails (the sweep schedules later)", async () => {
    mocks.tx.post.findUnique.mockResolvedValue(finalizeRow());
    mocks.requestScheduling.mockRejectedValue(new Error("redis"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(finalizeApproval(data, at(15_100))).resolves.toEqual({ outcome: "finalized", scheduled: true });
    quiet.mockRestore();
    expect(mocks.notifyApproved).toHaveBeenCalledTimes(1);
  });
});
