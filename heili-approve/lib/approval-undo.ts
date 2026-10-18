/**
 * «Annulla» right after a client approval, and the delayed follow-up it needs.
 *
 * approvePost (opts.undoable) records the approval at once: status APPROVED,
 * `approvedAt` / `approvedByReviewerId`, the APPROVED event tied to the exact
 * version. What it does NOT do any more is anything the agency or Metricool
 * would see: a delayed job (queue "approval-finalize") runs
 * APPROVAL_FINALIZE_DELAY_MS later and only then schedules the post on
 * Metricool (auto-schedule social posts), emails the agency and updates the
 * monthly plan.
 *
 * undoApproval takes the approval back inside that window. Both sides settle
 * the race under the same row lock (SELECT … FOR UPDATE) and re-read the
 * post inside it:
 * - undo wins: the post is IN_REVIEW again (`undo_approval`), an
 *   APPROVAL_UNDONE event is written, the job finds an approval that no longer
 *   exists and does nothing;
 * - the job wins: scheduling moves the post to SCHEDULING (compare-and-set on
 *   APPROVED, lib/scheduling.requestScheduling) or, for blog / ads / manual
 *   scheduling, the window has closed, so a late undo is refused with
 *   «Troppo tardi per annullare: scrivi all'agenzia».
 * The cron sweep never touches an approval younger than SWEEP_FRESH_APPROVAL_MS.
 *
 * Plan-wide approvals (approvePlan, "Approva i rimanenti") are not undoable:
 * they keep scheduling immediately and their APPROVED event has no
 * `undoable` flag.
 */

import type { Post, Prisma } from "@/app/generated/prisma/client";
import { reviewerActor } from "@/lib/actor";
import { closeInfoActivity } from "@/lib/activity";
import { prisma } from "@/lib/db/client";
import { CLIENT_VISIBLE_STATUSES, assertTransition } from "@/lib/domain";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordEvent } from "@/lib/events";
import { notifyApproved } from "@/lib/notifications";
import { afterPlanDecision, type ReviewerRef } from "@/lib/posts";
import {
  APPROVAL_FINALIZE_JOB_NAME,
  approvalFinalizeJobId,
  getApprovalQueue,
  type FinalizeApprovalJob,
} from "@/lib/queue/client";
import {
  APPROVAL_FINALIZE_DELAY_MS,
  evaluateFinalize,
  evaluateUndo,
  undoRefusalMessage,
  type FinalizeVerdict,
  type UndoRefusal,
} from "@/lib/undo-rules";
import { isKindEnabled } from "@/lib/variant";

/** The window is closed (or scheduling has started): only the agency can change it now. */
export class UndoTooLateError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "UndoTooLateError";
  }
}

/** The delayed job fired before the undo window closed: BullMQ retries it later. */
export class ApprovalWindowOpenError extends Error {
  constructor() {
    super("La finestra per annullare l'approvazione è ancora aperta: riprovo a breve.");
    this.name = "ApprovalWindowOpenError";
  }
}

function lockPost(tx: Prisma.TransactionClient, postId: string) {
  return tx.$executeRaw`SELECT 1 FROM "Post" WHERE "id" = ${postId} FOR UPDATE`;
}

function refusalError(reason: UndoRefusal): Error {
  const message = undoRefusalMessage(reason);
  switch (reason) {
    case "not_found":
      return new NotFoundError(message);
    case "not_yours":
      return new ForbiddenError(message);
    case "too_late":
    case "not_undoable":
      return new UndoTooLateError(message);
    case "stale_version":
    case "not_approved":
      return new ConflictError(message);
  }
}

// ─── Undo ────────────────────────────────────────────────────────────────────

/**
 * Takes back the approval `reviewer` gave to `versionNumber` of the post.
 * Succeeds only if the post is still APPROVED at that version, that reviewer
 * approved it less than UNDO_WINDOW_MS ago with a single (undoable) approval,
 * and scheduling has not started. Returns the post, back IN_REVIEW.
 */
export async function undoApproval(
  postId: string,
  reviewer: ReviewerRef,
  versionNumber: number,
  now: Date = new Date()
): Promise<Post> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ValidationError("Versione non valida");

  const outcome = await prisma.$transaction(async (tx): Promise<{ refused: UndoRefusal } | { refused: null; approvedAtMs: number; workspaceId: string }> => {
    await lockPost(tx, postId);
    const post = await tx.post.findUnique({
      where: { id: postId },
      select: {
        clientId: true,
        kind: true,
        status: true,
        currentVersionNumber: true,
        approvedAt: true,
        approvedByReviewerId: true,
        workspaceId: true,
      },
    });
    const visible = post !== null && CLIENT_VISIBLE_STATUSES.includes(post.status) && isKindEnabled(post.kind);
    const approval = visible
      ? await tx.postEvent.findFirst({
          where: { postId, type: "APPROVED", versionNumber },
          orderBy: { createdAt: "desc" },
          select: { metadata: true },
        })
      : null;
    const metadata = approval?.metadata as { undoable?: unknown } | null | undefined;

    const verdict = evaluateUndo(
      visible && post
        ? {
            clientId: post.clientId,
            status: post.status,
            currentVersionNumber: post.currentVersionNumber,
            approvedAt: post.approvedAt,
            approvedByReviewerId: post.approvedByReviewerId,
            undoable: metadata?.undoable === true,
          }
        : null,
      { reviewerId: reviewer.id, clientId: reviewer.clientId, versionNumber, now }
    );
    if (!verdict.ok) return { refused: verdict.reason };
    if (!post || !post.approvedAt) return { refused: "not_approved" };

    const next = assertTransition(post.status, "undo_approval");
    // The row is locked: this only fails if something else wrote it in between.
    const { count } = await tx.post.updateMany({
      where: {
        id: postId,
        status: post.status,
        currentVersionNumber: versionNumber,
        approvedByReviewerId: reviewer.id,
      },
      data: { status: next, approvedAt: null, approvedByReviewerId: null, lastError: null },
    });
    if (count !== 1) return { refused: "too_late" };

    await recordEvent(tx, {
      postId,
      type: "APPROVAL_UNDONE",
      actor: reviewerActor(reviewer.id),
      versionNumber,
      metadata: {
        approvedAt: post.approvedAt.toISOString(),
        elapsedMs: now.getTime() - post.approvedAt.getTime(),
      },
    });
    return { refused: null, approvedAtMs: post.approvedAt.getTime(), workspaceId: post.workspaceId };
  });

  if (outcome.refused) throw refusalError(outcome.refused);

  // The pending job would only find nothing to do; removing it keeps Redis tidy.
  await removeApprovalFinalization(postId, versionNumber, outcome.approvedAtMs);
  // The approval is no longer true: close its "Approvato" notification.
  try {
    await closeInfoActivity(outcome.workspaceId, `approved:${postId}:v${versionNumber}`);
  } catch (error) {
    console.error(`[Approval] Failed to close the approval activity of post ${postId}:`, error);
  }
  return prisma.post.findUniqueOrThrow({ where: { id: postId } });
}

// ─── Delayed follow-up ───────────────────────────────────────────────────────

/**
 * Queues the follow-up of an approval to run once the undo window is closed.
 * If Redis is unreachable the approval stays valid: an in-process timer does
 * the follow-up best effort and the cron sweep schedules social posts anyway.
 */
export async function scheduleApprovalFinalization(data: FinalizeApprovalJob): Promise<void> {
  try {
    await getApprovalQueue().add(APPROVAL_FINALIZE_JOB_NAME, data, {
      jobId: approvalFinalizeJobId(data.postId, data.versionNumber, data.approvedAtMs),
      delay: APPROVAL_FINALIZE_DELAY_MS,
    });
  } catch (error) {
    console.error(
      `[Approval] Could not queue the follow-up of post ${data.postId}:`,
      error instanceof Error ? error.message : error
    );
    const timer = setTimeout(() => {
      finalizeApproval(data).catch((failure) =>
        console.error(`[Approval] Fallback follow-up of post ${data.postId} failed:`, failure)
      );
    }, APPROVAL_FINALIZE_DELAY_MS + 500);
    timer.unref?.();
  }
}

/** Drops the delayed job of an approval that was undone (best effort). */
export async function removeApprovalFinalization(
  postId: string,
  versionNumber: number,
  approvedAtMs: number
): Promise<void> {
  try {
    const job = await getApprovalQueue().getJob(approvalFinalizeJobId(postId, versionNumber, approvedAtMs));
    if (job) await job.remove();
  } catch (error) {
    // Already running, or Redis is away: the job re-reads the post and does nothing.
    console.error(
      `[Approval] Could not remove the follow-up of post ${postId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

export type FinalizeApprovalResult =
  | { outcome: "finalized"; scheduled: boolean }
  | { outcome: "skipped"; reason: Exclude<Extract<FinalizeVerdict, { proceed: false }>["reason"], "too_early"> };

/**
 * Worker body of the delayed job. Re-reads the post under the row lock and
 * runs the follow-up only for the approval the job belongs to; throws
 * ApprovalWindowOpenError if it ran before the window closed (BullMQ retries).
 */
export async function finalizeApproval(
  data: FinalizeApprovalJob,
  now: Date = new Date()
): Promise<FinalizeApprovalResult> {
  const { verdict, planId } = await prisma.$transaction(async (tx) => {
    await lockPost(tx, data.postId);
    const post = await tx.post.findUnique({
      where: { id: data.postId },
      select: {
        kind: true,
        status: true,
        currentVersionNumber: true,
        approvedAt: true,
        planId: true,
        client: { select: { autoSchedule: true } },
      },
    });
    return {
      verdict: evaluateFinalize(
        post
          ? {
              kind: post.kind,
              status: post.status,
              currentVersionNumber: post.currentVersionNumber,
              approvedAt: post.approvedAt,
              autoSchedule: post.client.autoSchedule,
            }
          : null,
        data,
        now
      ),
      planId: post?.planId ?? null,
    };
  });

  if (!verdict.proceed) {
    if (verdict.reason === "too_early") throw new ApprovalWindowOpenError();
    return { outcome: "skipped", reason: verdict.reason };
  }

  if (verdict.schedule) {
    try {
      // Imported lazily: scheduling pulls in BullMQ/Redis and the Metricool client.
      const { requestScheduling } = await import("@/lib/scheduling");
      await requestScheduling(data.postId, reviewerActor(data.reviewerId));
    } catch (error) {
      // The approval is committed; the sweep cron re-queues APPROVED posts.
      console.error(`[Approval] Scheduling request failed for approved post ${data.postId}:`, error);
    }
  }

  if (data.notify) {
    await notifyApproved(data.postId);
    await afterPlanDecision(planId);
  }
  return { outcome: "finalized", scheduled: verdict.schedule };
}
