/**
 * Revisione del mese — services of the client portal's month views
 * (Griglia / Sfoglia on a plan page and on /review/<token>/mese/<YYYY-MM>).
 *
 * The month views add no way to decide: a single "Approva" is
 * approvePostAction (lib/posts approvePost, version binding included) and
 * "Approva i rimanenti" of a plan is approvePlan. What is here is for the
 * month route, which has no plan: loading the visible posts at the version
 * the client is sent, and the same "approve the waiting ones in one step"
 * over a list of posts the client saw, with the same exclusion rules
 * (selectApproveAll) and the same guard against feedback the client already
 * left (approvePost with bulkSafety).
 */

import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { CLIENT_VISIBLE_STATUSES } from "@/lib/domain";
import {
  BulkApprovalFeedbackConflictError,
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  parseOrThrow,
} from "@/lib/errors";
import { selectApproveAll } from "@/lib/plan-rules";
import { openClientCommentCounts, type ApprovePlanResult } from "@/lib/plans";
import { approvePost, getPostsForReviewer, type ReviewerPost, type ReviewerRef } from "@/lib/posts";
import { isKindEnabled } from "@/lib/variant";

/**
 * Bound for a month or a plan in Sfoglia and «Approva i rimanenti», like the
 * plan's «Approva tutto il piano» (500): a 300-post plan must fit whole.
 */
export const MAX_MONTH_POSTS = 500;

/**
 * The posts as the client may see them (getPostForReviewer: client scope,
 * visible statuses, the version they were sent with), in the order of `ids`.
 * A post that disappeared meanwhile is left out.
 */
export async function getReviewerPosts(reviewer: ReviewerRef, ids: readonly string[]): Promise<ReviewerPost[]> {
  return getPostsForReviewer(ids.slice(0, MAX_MONTH_POSTS), reviewer);
}

const seenSchema = z
  .array(z.object({ postId: z.string().trim().min(1).max(64), versionNumber: z.number().int().min(1).max(100_000) }))
  .max(MAX_MONTH_POSTS);

/**
 * "Approva i rimanenti" of the month route: approves, one by one through
 * approvePost, every listed post still waiting for the client at the version
 * shown. Posts with feedback already left, changes requested or a newer
 * version are left out and returned in `skipped`. Only posts of the
 * reviewer's client that clients can see are ever touched.
 */
export async function approveListedPosts(
  reviewer: ReviewerRef,
  seen: Array<{ postId: string; versionNumber: number }>
): Promise<ApprovePlanResult> {
  const shown = parseOrThrow(seenSchema, seen);
  if (!isKindEnabled("SOCIAL_POST")) throw new NotFoundError("Post non trovati");

  const posts = await prisma.post.findMany({
    where: {
      id: { in: shown.map((s) => s.postId) },
      clientId: reviewer.clientId,
      kind: "SOCIAL_POST",
      status: { in: CLIENT_VISIBLE_STATUSES },
    },
    orderBy: { publishAt: "asc" },
    select: { id: true, title: true, status: true, currentVersionNumber: true },
  });
  const comments = await openClientCommentCounts(posts.map((p) => p.id));
  const selection = selectApproveAll(
    posts.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      versionNumber: p.currentVersionNumber,
      // IN_REVIEW always carries the version that was sent (an edit sends it back to draft).
      canAct: p.status === "IN_REVIEW",
      openClientComments: comments.get(p.id) ?? 0,
    })),
    new Map(shown.map((s) => [s.postId, s.versionNumber]))
  );
  if (selection.approve.length === 0) {
    throw new ValidationError(
      selection.skipped.length > 0
        ? "Nessun post da approvare in blocco: aprili uno per uno per decidere."
        : "Non ci sono post che aspettano la tua approvazione."
    );
  }

  const approved: string[] = [];
  const skipped = [...selection.skipped];
  const titles = new Map(posts.map((p) => [p.id, p.title]));
  for (const item of selection.approve) {
    try {
      await approvePost(item.id, reviewer, item.versionNumber, { bulkSafety: true });
      approved.push(item.id);
    } catch (error) {
      if (error instanceof BulkApprovalFeedbackConflictError) {
        skipped.push({ id: item.id, title: titles.get(item.id) ?? "", reason: "comments" });
        continue;
      }
      if (error instanceof ConflictError || error instanceof InvalidTransitionError || error instanceof NotFoundError) {
        skipped.push({ id: item.id, title: titles.get(item.id) ?? "", reason: "stale" });
        continue;
      }
      // Something else broke: what is approved stays approved; report and stop.
      console.error(`[month-review] Approving post ${item.id} failed:`, error);
      if (approved.length === 0) throw error;
      skipped.push({ id: item.id, title: titles.get(item.id) ?? "", reason: "stale" });
    }
  }
  return { approved, skipped, completed: false };
}
