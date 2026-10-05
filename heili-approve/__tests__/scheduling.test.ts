import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTx, mockSchedulePost, mockRecordEvent, mockNotify } = vi.hoisted(() => {
  const mockTx = {
    post: { updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    postEvent: { count: vi.fn() },
  };
  return {
    mockTx,
    mockPrisma: {
      post: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
      postEvent: { count: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
    },
    mockSchedulePost: vi.fn(),
    mockRecordEvent: vi.fn(),
    mockNotify: {
      notifyScheduled: vi.fn(),
      notifyScheduleFailed: vi.fn(),
      notifyReviewReminder: vi.fn(),
    },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/events", () => ({ recordEvent: mockRecordEvent }));
vi.mock("@/lib/notifications", () => mockNotify);
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  SCHEDULE_POST_JOB_NAME: "schedule-post",
  getSchedulingQueue: vi.fn(),
  schedulePostJobId: (postId: string, version: number, attempt = 0) => `schedule_${postId}_v${version}_${attempt}`,
}));
vi.mock("@/lib/metricool/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/metricool/client")>();
  return {
    ...actual,
    getWorkspaceMetricoolClient: vi.fn(async () => ({ schedulePost: mockSchedulePost })),
  };
});

import { UnrecoverableError } from "bullmq";
import { MetricoolError } from "@/lib/metricool/client";
import { SchedulerPayloadError } from "@/lib/metricool/payload";
import {
  CLAIM_STALE_MS,
  MAX_REMINDERS_PER_SUBMISSION,
  attemptInfo,
  describeSchedulingError,
  isClaim,
  isClaimStale,
  isReminderDue,
  isWithinReminderHours,
  makeClaim,
  parseClaim,
  processSchedulePost,
} from "@/lib/scheduling";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-05T10:00:00Z");

describe("claims", () => {
  it("round-trips and detects staleness", () => {
    const claim = makeClaim("job-1", NOW);
    expect(isClaim(claim)).toBe(true);
    expect(isClaim("12345")).toBe(false);
    expect(isClaim(null)).toBe(false);
    expect(parseClaim(claim)).toEqual({ claimedAt: NOW, jobId: "job-1" });
    expect(isClaimStale(claim, new Date(NOW.getTime() + CLAIM_STALE_MS - 1))).toBe(false);
    expect(isClaimStale(claim, new Date(NOW.getTime() + CLAIM_STALE_MS))).toBe(true);
    expect(isClaimStale("pending:garbage", NOW)).toBe(true);
  });
});

describe("attemptInfo", () => {
  it("knows when BullMQ will not retry again", () => {
    expect(attemptInfo({ attemptsMade: 0, opts: { attempts: 5 } })).toEqual({ attempt: 1, maxAttempts: 5, isFinal: false });
    expect(attemptInfo({ attemptsMade: 4, opts: { attempts: 5 } })).toEqual({ attempt: 5, maxAttempts: 5, isFinal: true });
    expect(attemptInfo({ attemptsMade: 0, opts: {} }).isFinal).toBe(true);
  });
});

describe("describeSchedulingError", () => {
  it("never retries invalid content or rejected credentials", () => {
    expect(describeSchedulingError(new SchedulerPayloadError([{ network: null, field: "text", message: "Vuoto." }]))).toMatchObject({
      retryable: false,
      code: "invalid_payload",
    });
    expect(describeSchedulingError(new MetricoolError("no", 401, false, "unauthorized")).retryable).toBe(false);
    expect(describeSchedulingError(new MetricoolError("busy", 503, true, "unavailable")).retryable).toBe(true);
  });

  it("treats unknown errors as retryable without exposing their message", () => {
    const info = describeSchedulingError(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    expect(info.retryable).toBe(true);
    expect(info.message).not.toContain("ECONNREFUSED");
  });
});

describe("isReminderDue", () => {
  const base = { submittedAt: new Date(NOW.getTime() - 6 * HOUR), reviewDueAt: null, lastReminderAt: null, remindersSinceSubmission: 0 };

  it("waits 48 h when there is no due date", () => {
    expect(isReminderDue(base, NOW)).toBe(false);
    expect(isReminderDue({ ...base, submittedAt: new Date(NOW.getTime() - 48 * HOUR) }, NOW)).toBe(true);
  });

  it("fires once the due date has passed", () => {
    expect(isReminderDue({ ...base, reviewDueAt: new Date(NOW.getTime() + HOUR) }, NOW)).toBe(false);
    expect(isReminderDue({ ...base, reviewDueAt: new Date(NOW.getTime() - HOUR) }, NOW)).toBe(true);
  });

  it("sends at most one reminder every 24 h, and a bounded number overall", () => {
    const overdue = { ...base, reviewDueAt: new Date(NOW.getTime() - 72 * HOUR) };
    expect(isReminderDue({ ...overdue, lastReminderAt: new Date(NOW.getTime() - 23 * HOUR) }, NOW)).toBe(false);
    expect(isReminderDue({ ...overdue, lastReminderAt: new Date(NOW.getTime() - 24 * HOUR) }, NOW)).toBe(true);
    expect(isReminderDue({ ...overdue, remindersSinceSubmission: MAX_REMINDERS_PER_SUBMISSION }, NOW)).toBe(false);
  });
});

describe("isWithinReminderHours", () => {
  it("uses the client's local time, DST included", () => {
    // 06:30 UTC = 08:30 in Rome (summer), 07:30 in Rome (winter).
    expect(isWithinReminderHours(new Date("2026-10-05T06:30:00Z"), "Europe/Rome")).toBe(true);
    expect(isWithinReminderHours(new Date("2026-11-05T06:30:00Z"), "Europe/Rome")).toBe(false);
    expect(isWithinReminderHours(new Date("2026-10-05T18:30:00Z"), "Europe/Rome")).toBe(false);
    expect(isWithinReminderHours(new Date("2026-10-05T13:00:00Z"), "America/New_York")).toBe(true);
  });

  it("falls back to Europe/Rome for an invalid zone", () => {
    expect(isWithinReminderHours(new Date("2026-10-05T10:00:00Z"), "nope")).toBe(true);
  });
});

// ─── processSchedulePost with a mocked database ──────────────────────────────

function schedulingPost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    workspaceId: "ws-1",
    status: "SCHEDULING",
    currentVersionNumber: 2,
    metricoolPostId: null,
    publishAt: new Date(Date.now() + 48 * HOUR),
    networks: ["instagram"],
    networkOptions: {},
    client: { name: "Heili", metricoolBlogId: "blog-1", timezone: "Europe/Rome" },
    versions: [
      {
        number: 2,
        text: "Ciao",
        firstCommentText: null,
        media: [{ url: "https://approve.example.com/media/a.jpg", type: "image", mimeType: "image/jpeg" }],
      },
    ],
    ...overrides,
  };
}

const job = (attemptsMade = 0) => ({
  id: "schedule_post-1_v2_0",
  data: { postId: "post-1", versionNumber: 2 },
  attemptsMade,
  opts: { attempts: 5 },
});

describe("processSchedulePost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.post.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.post.updateMany.mockResolvedValue({ count: 1 });
  });

  it("schedules once and stores the Metricool id", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost());
    mockSchedulePost.mockResolvedValue({ metricoolPostId: "mc-77" });

    await expect(processSchedulePost(job())).resolves.toEqual({ outcome: "scheduled", metricoolPostId: "mc-77" });

    expect(mockSchedulePost).toHaveBeenCalledTimes(1);
    expect(mockSchedulePost.mock.calls[0][0]).toBe("blog-1");
    // Claim first (CAS on metricoolPostId: null), then success guarded by the claim.
    const [claimCall, successCall] = mockTx.post.updateMany.mock.calls;
    expect(claimCall[0].where).toMatchObject({ status: "SCHEDULING", metricoolPostId: null, currentVersionNumber: 2 });
    expect(successCall[0].where.metricoolPostId).toBe(claimCall[0].data.metricoolPostId);
    expect(successCall[0].data).toMatchObject({ status: "SCHEDULED", metricoolPostId: "mc-77", lastError: null });
    expect(mockRecordEvent.mock.calls[0][1]).toMatchObject({ type: "SCHEDULED", versionNumber: 2 });
    expect(mockNotify.notifyScheduled).toHaveBeenCalledWith("post-1");
  });

  it("skips a job for a version the client did not approve", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost({ currentVersionNumber: 3 }));
    await expect(processSchedulePost(job())).resolves.toEqual({ outcome: "skipped", reason: "stale_version" });
    expect(mockSchedulePost).not.toHaveBeenCalled();
  });

  it("never calls Metricool for an already scheduled post", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost({ status: "SCHEDULED", metricoolPostId: "mc-1" }));
    await expect(processSchedulePost(job())).resolves.toEqual({ outcome: "skipped", reason: "already_scheduled" });
    expect(mockSchedulePost).not.toHaveBeenCalled();
  });

  it("backs off when another job holds a fresh claim", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost());
    mockTx.post.updateMany.mockResolvedValueOnce({ count: 0 });
    mockTx.post.findUnique.mockResolvedValue({
      status: "SCHEDULING",
      currentVersionNumber: 2,
      metricoolPostId: makeClaim("other-job"),
    });

    await expect(processSchedulePost(job())).rejects.toThrow(/già in corso/);
    expect(mockSchedulePost).not.toHaveBeenCalled();
  });

  it("fails without calling Metricool when a crashed job left a stale claim", async () => {
    const stale = makeClaim("crashed", new Date(Date.now() - CLAIM_STALE_MS - 1000));
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost());
    mockTx.post.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mockTx.post.findUnique.mockResolvedValue({ status: "SCHEDULING", currentVersionNumber: 2, metricoolPostId: stale });

    await expect(processSchedulePost(job())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(mockSchedulePost).not.toHaveBeenCalled();
    const failCall = mockTx.post.updateMany.mock.calls[1][0];
    expect(failCall.where.metricoolPostId).toBe(stale);
    expect(failCall.data).toMatchObject({ status: "FAILED", metricoolPostId: null });
    expect(failCall.data.lastError).toContain("Esito incerto");
    expect(mockNotify.notifyScheduleFailed).toHaveBeenCalledWith("post-1");
  });

  it("marks FAILED right away on a non-retryable Metricool error", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost());
    mockSchedulePost.mockRejectedValue(new MetricoolError("Credenziali rifiutate.", 401, false, "unauthorized"));

    await expect(processSchedulePost(job())).rejects.toBeInstanceOf(UnrecoverableError);
    const failCall = mockTx.post.updateMany.mock.calls[1][0];
    expect(failCall.data).toMatchObject({ status: "FAILED", lastError: "Credenziali rifiutate.", metricoolPostId: null });
    expect(mockRecordEvent.mock.calls[0][1]).toMatchObject({ type: "SCHEDULE_FAILED" });
  });

  it("fails without a Metricool call when the client has no brand", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      schedulingPost({ client: { name: "Heili", metricoolBlogId: null, timezone: "Europe/Rome" } })
    );
    await expect(processSchedulePost(job())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(mockSchedulePost).not.toHaveBeenCalled();
    expect(mockTx.post.updateMany.mock.calls[1][0].data.lastError).toContain("brand Metricool");
  });

  it("releases the claim and rethrows on a retryable error", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost());
    const outage = new MetricoolError("Metricool non è raggiungibile in questo momento (503).", 503, true, "unavailable");
    mockSchedulePost.mockRejectedValue(outage);

    await expect(processSchedulePost(job(1))).rejects.toBe(outage);
    const release = mockPrisma.post.updateMany.mock.calls[0][0];
    expect(isClaim(release.where.metricoolPostId)).toBe(true);
    expect(release.data.metricoolPostId).toBeNull();
    expect(release.data.lastError).toContain("Tentativo 2 di 5");
    expect(mockNotify.notifyScheduleFailed).not.toHaveBeenCalled();
  });

  it("marks FAILED on the last attempt of a retryable error", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(schedulingPost());
    mockSchedulePost.mockRejectedValue(new MetricoolError("Troppe richieste a Metricool (429).", 429, true, "rate_limited"));

    await expect(processSchedulePost(job(4))).rejects.toBeInstanceOf(UnrecoverableError);
    const failCall = mockTx.post.updateMany.mock.calls[1][0];
    expect(failCall.data.status).toBe("FAILED");
    expect(failCall.data.lastError).toContain("dopo 5 tentativi");
  });
});
