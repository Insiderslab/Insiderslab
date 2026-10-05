"use server";

/**
 * Server actions of the client portal: approve, request changes, comment.
 *
 * Actions are public POST endpoints, so each one trusts nothing from the
 * browser: it validates the input with zod, resolves the link token on the
 * server (resolveReviewerToken) and hands the reviewer to the lib/posts
 * services, which check that the post belongs to the reviewer's client, is
 * visible to clients and is still at the version the client was looking at.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import type { PortalActionResult } from "@/components/portal/types";
import { prisma } from "@/lib/db/client";
import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  isDomainError,
  parseOrThrow,
  publicErrorMessage,
} from "@/lib/errors";
import {
  addComment,
  approvePost,
  getPostForReviewer,
  requestChanges,
  type ReviewerRef,
} from "@/lib/posts";
import { parseActionItems } from "@/lib/review-assistant/shared";
import { resolveReviewerToken } from "@/lib/reviewers";

const LINK_INVALID = "Questo link non è più valido. Chiedi all'agenzia di inviartene uno nuovo.";
const STALE_VERSION =
  "Il post è stato aggiornato dall'agenzia nel frattempo: ricarica la pagina per vedere la versione più recente";

const tokenSchema = z.string().min(1).max(256);
const idSchema = z.string().trim().min(1).max(64);
const versionSchema = z.number().int().min(1).max(100_000);

const approveSchema = z.object({ postId: idSchema, versionNumber: versionSchema });

const changesSchema = z.object({
  postId: idSchema,
  versionNumber: versionSchema,
  message: z.string().max(10_000),
  reviewSessionId: idSchema.optional(),
});

const commentSchema = z.object({
  postId: idSchema,
  versionNumber: versionSchema,
  body: z.string().max(10_000),
  mediaIndex: z.number().int().min(0).max(100).optional(),
  pinX: z.number().min(0).max(1).optional(),
  pinY: z.number().min(0).max(1).optional(),
  timeSec: z.number().min(0).optional(),
  timeEndSec: z.number().min(0).optional(),
});

export type ApproveInput = z.input<typeof approveSchema>;
export type RequestChangesInput = z.input<typeof changesSchema>;
export type PortalCommentInput = z.input<typeof commentSchema>;

class InvalidLinkError extends Error {}

/** Resolves the token and runs `fn` as that reviewer, mapping errors to messages. */
async function asReviewer<T>(
  token: unknown,
  fn: (reviewer: ReviewerRef) => Promise<T>
): Promise<PortalActionResult<T>> {
  try {
    const parsedToken = tokenSchema.safeParse(token);
    const reviewer = parsedToken.success ? await resolveReviewerToken(parsedToken.data) : null;
    if (!reviewer) throw new InvalidLinkError();
    return { ok: true, data: await fn({ id: reviewer.id, clientId: reviewer.clientId }) };
  } catch (error) {
    if (error instanceof InvalidLinkError) return { ok: false, error: LINK_INVALID };
    if (!isDomainError(error)) console.error("[review] Portal action failed:", error);
    return {
      ok: false,
      error: publicErrorMessage(error),
      stale: error instanceof ConflictError || error instanceof InvalidTransitionError,
    };
  }
}

/** Approves exactly the version the client saw. Approve-all does not exist on purpose. */
export async function approvePostAction(token: string, input: ApproveInput): Promise<PortalActionResult> {
  const result = await asReviewer(token, async (reviewer) => {
    const { postId, versionNumber } = parseOrThrow(approveSchema, input);
    await approvePost(postId, reviewer, versionNumber);
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

/**
 * Sends the change request. With `reviewSessionId` (assistant panel) the
 * session's structured action items travel along, read from the DB — never
 * from the browser — so each timed item lands as a marker on the video.
 */
export async function requestChangesAction(
  token: string,
  input: RequestChangesInput
): Promise<PortalActionResult> {
  const result = await asReviewer(token, async (reviewer) => {
    const { postId, versionNumber, message, reviewSessionId } = parseOrThrow(changesSchema, input);

    let actionItems: ReturnType<typeof parseActionItems> | undefined;
    if (reviewSessionId) {
      const session = await prisma.reviewSession.findFirst({
        where: { id: reviewSessionId, postId, reviewerId: reviewer.id, versionNumber },
        select: { actionItems: true },
      });
      if (!session) throw new NotFoundError("Conversazione con l'assistente non trovata");
      actionItems = parseActionItems(session.actionItems);
    }

    await requestChanges(postId, reviewer, versionNumber, message, { reviewSessionId, actionItems });
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

/**
 * General, pinned (image point) or video-moment comment on the version the
 * client is looking at. A comment on a version that is no longer current is
 * refused: its pins and moments would point at media that changed.
 */
export async function addCommentAction(token: string, input: PortalCommentInput): Promise<PortalActionResult> {
  const result = await asReviewer(token, async (reviewer) => {
    const data = parseOrThrow(commentSchema, input);
    // Ownership + visibility (throws NotFoundError), and the visible version.
    const post = await getPostForReviewer(data.postId, reviewer);
    if (post.currentVersionNumber !== data.versionNumber) throw new ConflictError(STALE_VERSION);
    if (!post.canAct && post.status !== "CHANGES_REQUESTED") {
      throw new ConflictError("Questo post è già stato approvato: per altre modifiche contatta l'agenzia.");
    }
    const version = post.versions.find((v) => v.number === data.versionNumber);
    if (!version) throw new NotFoundError("Versione non trovata");

    await addComment({
      postId: post.id,
      actor: { kind: "reviewer", reviewerId: reviewer.id },
      body: data.body,
      versionId: version.id,
      mediaIndex: data.mediaIndex,
      pinX: data.pinX,
      pinY: data.pinY,
      timeSec: data.timeSec,
      timeEndSec: data.timeEndSec,
    });
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}
