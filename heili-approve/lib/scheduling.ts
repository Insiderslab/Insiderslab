/**
 * Scheduling of approved posts on Metricool, plus the review reminders.
 *
 * Flow: approval (or the agency's "Programma ora" / "Riprova") calls
 * requestScheduling, which moves the post to SCHEDULING and enqueues a job;
 * the worker runs processSchedulePost, which calls Metricool once and lands
 * the post in SCHEDULED or FAILED. The cron sweep re-enqueues anything that
 * fell through the cracks (Redis down at approval time, crashed worker).
 *
 * Idempotency: before calling Metricool the worker claims the post with a
 * compare-and-set on `metricoolPostId` (null → "pending:<ts>:<job>") inside a
 * transaction. Only the claim holder calls Metricool, so the same post+version
 * is never created twice — not on a double click, a sweep racing a retry, or
 * two workers. A claim left behind by a crash is never retried blindly: the
 * post goes to FAILED asking the agency to check Metricool first. The same
 * holds for a create call whose outcome is unknown (timeout, dropped
 * connection, 5xx): the client reports it as "uncertain", not retryable, so
 * the post goes to FAILED instead of being POSTed again. Only failures that
 * happened before the request left (DNS, connection refused) and 408/429 are
 * retried automatically.
 */

import { UnrecoverableError } from "bullmq";
import type { PostStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { assertTransition } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { recordEvent } from "@/lib/events";
import { SYSTEM_ACTOR, type Actor } from "@/lib/actor";
import { notifyReviewReminder, notifyScheduleFailed, notifyScheduled } from "@/lib/notifications";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import {
  SCHEDULE_POST_JOB_NAME,
  getSchedulingQueue,
  schedulePostJobId,
  type SchedulePostJob,
} from "@/lib/queue/client";
import { MetricoolError, getWorkspaceMetricoolClient } from "@/lib/metricool/client";
import { SchedulerPayloadError, buildSchedulerPayload, isValidTimeZone } from "@/lib/metricool/payload";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// ─── Pure helpers ────────────────────────────────────────────────────────────

const CLAIM_PREFIX = "pending:";

/**
 * Longest a claim can be held by a live worker: the Metricool timeout (30 s)
 * plus generous slack. An older claim means the holder died mid-call.
 */
export const CLAIM_STALE_MS = 5 * MINUTE_MS;

export function makeClaim(jobId: string, now: Date = new Date()): string {
  return `${CLAIM_PREFIX}${now.getTime()}:${jobId}`;
}

export function isClaim(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(CLAIM_PREFIX);
}

/** When the claim was taken, or null if `value` is not a (well-formed) claim. */
export function parseClaim(value: string | null | undefined): { claimedAt: Date; jobId: string } | null {
  if (!isClaim(value)) return null;
  const rest = value.slice(CLAIM_PREFIX.length);
  const separator = rest.indexOf(":");
  const timestamp = Number(separator === -1 ? rest : rest.slice(0, separator));
  if (!Number.isFinite(timestamp)) return null;
  return { claimedAt: new Date(timestamp), jobId: separator === -1 ? "" : rest.slice(separator + 1) };
}

/** A malformed claim counts as stale: nobody can be relying on it. */
export function isClaimStale(value: string, now: Date = new Date()): boolean {
  const parsed = parseClaim(value);
  if (!parsed) return true;
  return now.getTime() - parsed.claimedAt.getTime() >= CLAIM_STALE_MS;
}

/** BullMQ increments attemptsMade only after a failure, so the current try is +1. */
export function attemptInfo(job: { attemptsMade: number; opts: { attempts?: number } }): {
  attempt: number;
  maxAttempts: number;
  isFinal: boolean;
} {
  const attempt = job.attemptsMade + 1;
  const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
  return { attempt, maxAttempts, isFinal: attempt >= maxAttempts };
}

export interface SchedulingErrorInfo {
  message: string;
  retryable: boolean;
  status: number | null;
  code: string;
}

/** Classify anything thrown while scheduling. Unknown errors are retryable. */
export function describeSchedulingError(error: unknown): SchedulingErrorInfo {
  if (error instanceof SchedulerPayloadError) {
    return {
      message: `Il post non è pubblicabile così com'è: ${error.message}`,
      retryable: false,
      status: null,
      code: "invalid_payload",
    };
  }
  if (error instanceof MetricoolError) {
    return { message: error.message, retryable: error.retryable, status: error.status, code: error.code };
  }
  return {
    message: "Errore imprevisto durante la programmazione.",
    retryable: true,
    status: null,
    code: "unexpected",
  };
}

export const REMINDER_STALE_AFTER_MS = 48 * HOUR_MS;
export const REMINDER_MIN_INTERVAL_MS = 24 * HOUR_MS;
/** Per submission: after this many the agency should pick up the phone. */
export const MAX_REMINDERS_PER_SUBMISSION = 3;
const REMINDER_LOCAL_HOURS = { from: 8, to: 20 };

export interface ReminderState {
  submittedAt: Date | null;
  reviewDueAt: Date | null;
  lastReminderAt: Date | null;
  remindersSinceSubmission: number;
}

/**
 * A post IN_REVIEW gets a reminder when it is past its due date, or has been
 * waiting 48 h without one; never more than once every 24 h, and at most
 * MAX_REMINDERS_PER_SUBMISSION times per submission.
 */
export function isReminderDue(state: ReminderState, now: Date = new Date()): boolean {
  const nowMs = now.getTime();
  const overdue = state.reviewDueAt !== null && state.reviewDueAt.getTime() <= nowMs;
  const stale = state.submittedAt !== null && nowMs - state.submittedAt.getTime() >= REMINDER_STALE_AFTER_MS;
  if (!overdue && !stale) return false;
  if (state.remindersSinceSubmission >= MAX_REMINDERS_PER_SUBMISSION) return false;
  if (state.lastReminderAt && nowMs - state.lastReminderAt.getTime() < REMINDER_MIN_INTERVAL_MS) return false;
  return true;
}

/** Reminders go out during the client's working hours (08:00–19:59 local). */
export function isWithinReminderHours(now: Date, timeZone: string): boolean {
  const zone = isValidTimeZone(timeZone) ? timeZone : "Europe/Rome";
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(now)
  ) % 24;
  return hour >= REMINDER_LOCAL_HOURS.from && hour < REMINDER_LOCAL_HOURS.to;
}

// ─── Side-effect helpers ─────────────────────────────────────────────────────

async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.error(`[Scheduling] ${label} failed:`, error instanceof Error ? error.message : error);
  }
}

function requestedByFor(actor: Actor): SchedulePostJob["requestedBy"] {
  if (actor.kind === "user") return { userId: actor.userId };
  if (actor.kind === "reviewer") return { reviewerId: actor.reviewerId };
  return undefined;
}

/**
 * Add the job unless an identical one is still pending. A finished job with
 * the same id (BullMQ keeps them for a while) would silently swallow the add,
 * so it is removed first.
 */
async function enqueueScheduleJob(data: SchedulePostJob, requestIndex: number): Promise<string> {
  const queue = getSchedulingQueue();
  const jobId = schedulePostJobId(data.postId, data.versionNumber, requestIndex);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed") return jobId;
    await existing.remove();
  }
  await queue.add(SCHEDULE_POST_JOB_NAME, data, { jobId });
  return jobId;
}

// ─── requestScheduling ───────────────────────────────────────────────────────

export type RequestSchedulingResult =
  | { queued: true; jobId: string; status: "SCHEDULING" }
  | {
      queued: false;
      status: PostStatus;
      reason: "already_in_progress" | "already_scheduled" | "enqueue_failed";
    };

/**
 * Move an APPROVED post (action `schedule`) or a FAILED one (action `retry`)
 * to SCHEDULING and enqueue the Metricool job. Idempotent: a post already
 * SCHEDULING/SCHEDULED is left alone. Pass `workspaceId` from agency code so
 * a foreign post id is a NotFoundError. Throws InvalidTransitionError for any
 * other status (e.g. a draft).
 */
export async function requestScheduling(
  postId: string,
  actor: Actor,
  opts: { workspaceId?: string } = {}
): Promise<RequestSchedulingResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: postId, ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) },
      select: { id: true, status: true, currentVersionNumber: true },
    });
    if (!post) throw new NotFoundError("Post non trovato");

    if (post.status === "SCHEDULING") return { kind: "noop" as const, status: post.status, reason: "already_in_progress" as const };
    if (post.status === "SCHEDULED") return { kind: "noop" as const, status: post.status, reason: "already_scheduled" as const };

    const action = post.status === "FAILED" ? "retry" : "schedule";
    const next = assertTransition(post.status, action);

    // Compare-and-set on the status: a concurrent approve/sweep loses quietly.
    const updated = await tx.post.updateMany({
      where: { id: post.id, status: post.status },
      data: { status: next, lastError: null, metricoolPostId: null },
    });
    if (updated.count === 0) {
      const current = await tx.post.findUnique({ where: { id: post.id }, select: { status: true } });
      return { kind: "noop" as const, status: current?.status ?? post.status, reason: "already_in_progress" as const };
    }

    // One job id per request: retries of the same request share it (BullMQ
    // dedupes), a new "Riprova" gets a fresh one.
    const requestIndex = await tx.postEvent.count({ where: { postId: post.id, type: "SCHEDULE_REQUESTED" } });
    await recordEvent(tx, {
      postId: post.id,
      type: "SCHEDULE_REQUESTED",
      actor,
      versionNumber: post.currentVersionNumber,
      metadata: { retry: action === "retry", requestIndex },
    });

    return { kind: "queued" as const, versionNumber: post.currentVersionNumber, requestIndex };
  });

  if (outcome.kind === "noop") {
    return { queued: false, status: outcome.status, reason: outcome.reason };
  }

  try {
    const jobId = await enqueueScheduleJob(
      { postId, versionNumber: outcome.versionNumber, requestedBy: requestedByFor(actor) },
      outcome.requestIndex
    );
    return { queued: true, jobId, status: "SCHEDULING" };
  } catch (error) {
    // The post stays SCHEDULING; sweepApprovedPosts re-enqueues it.
    console.error(
      `[Scheduling] Could not enqueue post ${postId}:`,
      error instanceof Error ? error.message : error
    );
    return { queued: false, status: "SCHEDULING", reason: "enqueue_failed" };
  }
}

// ─── processSchedulePost (worker body) ───────────────────────────────────────

export interface ScheduleJobLike {
  id?: string;
  data: SchedulePostJob;
  attemptsMade: number;
  opts: { attempts?: number };
}

export type ProcessScheduleResult =
  | { outcome: "scheduled"; metricoolPostId: string }
  | {
      outcome: "skipped";
      reason: "not_found" | "stale_version" | "already_scheduled" | "not_scheduling" | "in_flight";
    };

/** Thrown when another job holds a fresh claim: retry later, it will be settled by then. */
class ClaimBusyError extends Error {
  constructor() {
    super("Programmazione già in corso per questo post: ricontrollo a breve.");
    this.name = "ClaimBusyError";
  }
}

async function markFailed(params: {
  postId: string;
  versionNumber: number;
  expectedMetricoolPostId: string | null;
  message: string;
  metadata: Record<string, string | number | boolean | null>;
}): Promise<boolean> {
  const failed = await prisma.$transaction(async (tx) => {
    const result = await tx.post.updateMany({
      where: {
        id: params.postId,
        status: "SCHEDULING",
        metricoolPostId: params.expectedMetricoolPostId,
      },
      data: {
        status: assertTransition("SCHEDULING", "schedule_failed"),
        lastError: params.message,
        metricoolPostId: null,
      },
    });
    if (result.count === 0) return false;
    await recordEvent(tx, {
      postId: params.postId,
      type: "SCHEDULE_FAILED",
      actor: SYSTEM_ACTOR,
      versionNumber: params.versionNumber,
      metadata: { error: params.message, ...params.metadata },
    });
    return true;
  });

  if (failed) await safely("notifyScheduleFailed", () => notifyScheduleFailed(params.postId));
  return failed;
}

/** Persist success; retried a few times because the Metricool post already exists. */
async function markScheduled(params: {
  postId: string;
  versionNumber: number;
  claim: string;
  metricoolPostId: string;
  blogId: string;
  attempt: number;
}): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.post.updateMany({
          where: { id: params.postId, status: "SCHEDULING", metricoolPostId: params.claim },
          data: {
            status: assertTransition("SCHEDULING", "schedule_succeeded"),
            metricoolPostId: params.metricoolPostId,
            scheduledAt: new Date(),
            lastError: null,
          },
        });
        if (result.count === 0) return;
        await recordEvent(tx, {
          postId: params.postId,
          type: "SCHEDULED",
          actor: SYSTEM_ACTOR,
          versionNumber: params.versionNumber,
          metadata: {
            metricoolPostId: params.metricoolPostId,
            blogId: params.blogId,
            attempt: params.attempt,
          },
        });
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  throw lastError;
}

/**
 * Worker body for one "schedule-post" job. Returns when the post is settled
 * (SCHEDULED, or nothing to do); throws to let BullMQ retry (429, 5xx,
 * network) and throws UnrecoverableError after marking the post FAILED when a
 * retry cannot help (credentials, rejected content, missing brand) or this
 * was the last attempt.
 */
export async function processSchedulePost(job: ScheduleJobLike): Promise<ProcessScheduleResult> {
  const { postId, versionNumber } = job.data;
  const { attempt, maxAttempts, isFinal } = attemptInfo(job);

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      client: { select: { name: true, metricoolBlogId: true, timezone: true } },
      versions: { where: { number: versionNumber }, take: 1 },
    },
  });

  if (!post) return { outcome: "skipped", reason: "not_found" };
  // The client approved exactly this version; anything else is a stale job.
  if (post.currentVersionNumber !== versionNumber) return { outcome: "skipped", reason: "stale_version" };
  if (post.status === "SCHEDULED") return { outcome: "skipped", reason: "already_scheduled" };
  if (post.status !== "SCHEDULING") return { outcome: "skipped", reason: "not_scheduling" };

  // Claim the post: only the holder may call Metricool.
  const claim = makeClaim(job.id ?? "job");
  const claimResult = await prisma.$transaction(async (tx) => {
    const result = await tx.post.updateMany({
      where: { id: postId, status: "SCHEDULING", currentVersionNumber: versionNumber, metricoolPostId: null },
      data: { metricoolPostId: claim, scheduleAttempts: { increment: 1 } },
    });
    if (result.count === 1) return { claimed: true as const };
    const current = await tx.post.findUnique({
      where: { id: postId },
      select: { status: true, metricoolPostId: true, currentVersionNumber: true },
    });
    return { claimed: false as const, current };
  });

  if (!claimResult.claimed) {
    const current = claimResult.current;
    if (!current || current.currentVersionNumber !== versionNumber) return { outcome: "skipped", reason: "stale_version" };
    if (current.status === "SCHEDULED") return { outcome: "skipped", reason: "already_scheduled" };
    if (current.status !== "SCHEDULING" || !isClaim(current.metricoolPostId)) {
      return { outcome: "skipped", reason: "not_scheduling" };
    }
    if (!isClaimStale(current.metricoolPostId)) {
      // Another job is talking to Metricool right now. Check back later; on
      // the last attempt leave it to that job (or to the sweep).
      if (isFinal) return { outcome: "skipped", reason: "in_flight" };
      throw new ClaimBusyError();
    }
    // The previous holder died mid-call: Metricool may or may not have the
    // post. Calling again could publish it twice, so a human decides.
    const message =
      "Esito incerto: la programmazione su Metricool si è interrotta a metà. Controlla su Metricool se il post esiste già prima di usare \"Riprova\".";
    await markFailed({
      postId,
      versionNumber,
      expectedMetricoolPostId: current.metricoolPostId,
      message,
      metadata: { code: "uncertain", attempt },
    });
    throw new UnrecoverableError(message);
  }

  let metricoolPostId: string;
  let blogId: string;
  try {
    const version = post.versions[0];
    if (!version) {
      throw new MetricoolError(`La versione ${versionNumber} del post non esiste più.`, null, false, "rejected");
    }
    if (!post.client.metricoolBlogId) {
      throw new MetricoolError(
        `Il cliente "${post.client.name}" non ha un brand Metricool collegato: sceglilo nella scheda del cliente.`,
        null,
        false,
        "not_configured"
      );
    }
    blogId = post.client.metricoolBlogId;

    const payload = buildSchedulerPayload({ post, version, client: post.client });
    const metricool = await getWorkspaceMetricoolClient(post.workspaceId);
    ({ metricoolPostId } = await metricool.schedulePost(blogId, payload));
  } catch (error) {
    const info = describeSchedulingError(error);
    if (info.code === "unexpected") {
      console.error(`[Scheduling] Unexpected error for post ${postId}:`, error instanceof Error ? error.message : error);
    }

    if (info.retryable && !isFinal) {
      // Release the claim so the next attempt can take it.
      await prisma.post.updateMany({
        where: { id: postId, metricoolPostId: claim },
        data: {
          metricoolPostId: null,
          lastError: `Tentativo ${attempt} di ${maxAttempts} non riuscito: ${info.message} Nuovo tentativo automatico a breve.`,
        },
      });
      throw error instanceof Error ? error : new Error(info.message);
    }

    const message = info.retryable
      ? `Programmazione non riuscita dopo ${attempt} tentativi. Ultimo errore: ${info.message} Usa "Riprova" quando il problema è risolto.`
      : info.message;
    await markFailed({
      postId,
      versionNumber,
      expectedMetricoolPostId: claim,
      message,
      metadata: { code: info.code, status: info.status, attempt, retryable: info.retryable },
    });
    throw new UnrecoverableError(message);
  }

  try {
    await markScheduled({ postId, versionNumber, claim, metricoolPostId, blogId, attempt });
  } catch (error) {
    // The post exists on Metricool but not in our DB. Keep the claim: a retry
    // must not create it again (it ends up FAILED "esito incerto" instead).
    const message = `Post ${postId} creato su Metricool (${metricoolPostId}) ma non salvato nel database.`;
    console.error(`[Scheduling] ${message}`, error instanceof Error ? error.message : error);
    await safely("recordWorkerAlert", () =>
      recordWorkerAlert({ level: "error", message, jobId: job.id, postId })
    );
    throw error;
  }

  await safely("notifyScheduled", () => notifyScheduled(postId));
  return { outcome: "scheduled", metricoolPostId };
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

/** approvePost schedules inline; give it this long before the sweep steps in. */
const SWEEP_APPROVED_GRACE_MS = 2 * MINUTE_MS;
/** A SCHEDULING post untouched for this long may have lost its job. */
const SWEEP_SCHEDULING_STUCK_MS = 10 * MINUTE_MS;
const SWEEP_BATCH = 100;

export interface SweepResult {
  approvedQueued: number;
  stuckRequeued: number;
  errors: number;
}

/**
 * Safety net, run by the cron every 5 minutes: schedules APPROVED posts of
 * auto-schedule clients that never got a job, and re-enqueues SCHEDULING
 * posts whose job vanished (Redis restart, enqueue failure).
 */
export async function sweepApprovedPosts(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { approvedQueued: 0, stuckRequeued: 0, errors: 0 };

  const approved = await prisma.post.findMany({
    where: {
      status: "APPROVED",
      approvedAt: { lte: new Date(now.getTime() - SWEEP_APPROVED_GRACE_MS) },
      client: { autoSchedule: true, archivedAt: null },
    },
    select: { id: true },
    orderBy: { publishAt: "asc" },
    take: SWEEP_BATCH,
  });

  for (const { id } of approved) {
    try {
      const outcome = await requestScheduling(id, SYSTEM_ACTOR);
      if (outcome.queued) result.approvedQueued++;
    } catch (error) {
      result.errors++;
      console.error(`[Sweep] Could not schedule post ${id}:`, error instanceof Error ? error.message : error);
    }
  }

  const stuck = await prisma.post.findMany({
    where: {
      status: "SCHEDULING",
      updatedAt: { lte: new Date(now.getTime() - SWEEP_SCHEDULING_STUCK_MS) },
    },
    select: { id: true, currentVersionNumber: true },
    orderBy: { updatedAt: "asc" },
    take: SWEEP_BATCH,
  });

  for (const post of stuck) {
    try {
      const requests = await prisma.postEvent.count({ where: { postId: post.id, type: "SCHEDULE_REQUESTED" } });
      // Same id as the original request: a job still pending makes this a no-op.
      await enqueueScheduleJob(
        { postId: post.id, versionNumber: post.currentVersionNumber },
        Math.max(0, requests - 1)
      );
      result.stuckRequeued++;
    } catch (error) {
      result.errors++;
      console.error(`[Sweep] Could not requeue post ${post.id}:`, error instanceof Error ? error.message : error);
    }
  }

  return result;
}

// ─── Review reminders ────────────────────────────────────────────────────────

export interface ReminderRunResult {
  checked: number;
  sent: number;
  outsideHours: number;
}

const REMINDER_PAGE_SIZE = 200;

/**
 * Remind reviewers about posts waiting IN_REVIEW past their due date or for
 * 48 h (see isReminderDue), during the client's working hours. Run hourly.
 * Due posts are grouped per client, so a batch sent together is reminded
 * together: one email per reviewer listing every due post, never one per post.
 * Candidates are read in pages until exhausted, so posts that can no longer be
 * reminded (cap reached, no reviewers) never starve newer ones.
 */
export async function sendReviewReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { checked: 0, sent: 0, outsideHours: 0 };
  const dueByClient = new Map<string, Array<{ id: string; versionNumber: number; reminderNumber: number }>>();

  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.post.findMany({
      where: {
        status: "IN_REVIEW",
        client: { archivedAt: null },
        OR: [
          { reviewDueAt: { lte: now } },
          { submittedAt: { lte: new Date(now.getTime() - REMINDER_STALE_AFTER_MS) } },
        ],
      },
      select: {
        id: true,
        clientId: true,
        submittedAt: true,
        reviewDueAt: true,
        currentVersionNumber: true,
        client: { select: { timezone: true } },
        events: {
          where: { type: "REMINDER_SENT" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
          take: MAX_REMINDERS_PER_SUBMISSION + 1,
        },
      },
      orderBy: { id: "asc" },
      take: REMINDER_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const post of page) {
      result.checked++;
      const sinceSubmission = post.events.filter(
        (event) => !post.submittedAt || event.createdAt >= post.submittedAt
      );
      const due = isReminderDue(
        {
          submittedAt: post.submittedAt,
          reviewDueAt: post.reviewDueAt,
          lastReminderAt: post.events[0]?.createdAt ?? null,
          remindersSinceSubmission: sinceSubmission.length,
        },
        now
      );
      if (!due) continue;
      if (!isWithinReminderHours(now, post.client.timezone)) {
        result.outsideHours++;
        continue;
      }
      const list = dueByClient.get(post.clientId) ?? [];
      list.push({ id: post.id, versionNumber: post.currentVersionNumber, reminderNumber: sinceSubmission.length + 1 });
      dueByClient.set(post.clientId, list);
    }
    if (page.length < REMINDER_PAGE_SIZE) break;
  }

  for (const [clientId, posts] of dueByClient) {
    try {
      // The event is the audit trail and the "already reminded" marker, so it
      // is written only for posts listed in an email that actually went out
      // (no active reviewer = nothing sent, nothing recorded).
      const reminded = await notifyReviewReminder(posts.map((p) => p.id));
      for (const post of posts) {
        if (!reminded.has(post.id)) continue;
        await recordEvent(prisma, {
          postId: post.id,
          type: "REMINDER_SENT",
          actor: SYSTEM_ACTOR,
          versionNumber: post.versionNumber,
          metadata: { reminderNumber: post.reminderNumber },
        });
        result.sent++;
      }
    } catch (error) {
      console.error(`[Reminders] Client ${clientId}:`, error instanceof Error ? error.message : error);
    }
  }

  return result;
}
