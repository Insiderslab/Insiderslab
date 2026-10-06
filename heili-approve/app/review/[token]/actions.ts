"use server";

/**
 * Server actions of the client portal: approve, request changes, comment,
 * and for ads sets the per-variant decisions and "Invia le mie decisioni".
 *
 * Actions are public POST endpoints, so each one trusts nothing from the
 * browser: it validates the input with zod, resolves the link token on the
 * server (resolveReviewerToken) and hands the reviewer to the lib/posts
 * services, which check that the post belongs to the reviewer's client, is
 * visible to clients and is still at the version the client was looking at.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import type { ContentKind } from "@/app/generated/prisma/client";
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
import { decideVariant, finalizeCreativeReview, type DecisionEvaluation } from "@/lib/creative-decisions";
import {
  addComment,
  approvePost,
  getPostForReviewer,
  requestChanges,
  type RequestChangesActionItem,
  type ReviewerRef,
} from "@/lib/posts";
import { toRequestChangesItems } from "@/lib/review-assistant/content";
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

// Shape only: lib/posts validates the passage (blogAnchorSchema) and checks
// that it is used on an article.
const anchorSchema = z.object({
  quote: z.string().max(2000),
  prefix: z.string().max(200),
  suffix: z.string().max(200),
  blockIndex: z.number().int().min(0).max(100_000).nullable(),
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
  /** Blog: the selected passage. */
  anchor: anchorSchema.optional(),
  /** Ads: the variant (mediaIndex then refers to its media). */
  variantId: idSchema.optional(),
});

const decideSchema = z.object({
  postId: idSchema,
  versionNumber: versionSchema,
  variantId: idSchema,
  verdict: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(10_000).nullish(),
});

export type ApproveInput = z.input<typeof approveSchema>;
export type RequestChangesInput = z.input<typeof changesSchema>;
export type PortalCommentInput = z.input<typeof commentSchema>;
export type DecideVariantInput = z.input<typeof decideSchema>;
export type FinalizeDecisionsInput = z.input<typeof approveSchema>;

/** Where an ads set stands after a decision (variant ids in content order). */
export interface DecisionProgress {
  outcome: DecisionEvaluation["outcome"];
  missing: string[];
  approved: string[];
  rejected: string[];
}

function progressOf(evaluation: DecisionEvaluation): DecisionProgress {
  return {
    outcome: evaluation.outcome,
    missing: evaluation.missing,
    approved: evaluation.approved,
    rejected: evaluation.rejected.map((r) => r.variantId),
  };
}

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
 * from the browser — so each timed item lands as a marker on the video, each
 * ads item on its variant and each article item on its passage (re-anchored
 * on the version's text here, on the server).
 */
export async function requestChangesAction(
  token: string,
  input: RequestChangesInput
): Promise<PortalActionResult> {
  const result = await asReviewer(token, async (reviewer) => {
    const { postId, versionNumber, message, reviewSessionId } = parseOrThrow(changesSchema, input);

    let actionItems: RequestChangesActionItem[] | undefined;
    if (reviewSessionId) {
      const session = await prisma.reviewSession.findFirst({
        where: { id: reviewSessionId, postId, reviewerId: reviewer.id, versionNumber },
        select: { actionItems: true },
      });
      if (!session) throw new NotFoundError("Conversazione con l'assistente non trovata");
      // Ownership + visibility (throws NotFoundError); requestChanges re-checks the version.
      const post = await getPostForReviewer(postId, reviewer);
      const version = post.versions.find((v) => v.number === versionNumber);
      if (!version) throw new ConflictError(STALE_VERSION);
      actionItems = toRequestChangesItems(post.kind, version, parseActionItems(session.actionItems));
    }

    await requestChanges(postId, reviewer, versionNumber, message, { reviewSessionId, actionItems });
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

/**
 * General, pinned (image point), video-moment, article-passage (anchor) or
 * ads-variant comment on the version the client is looking at. A comment on
 * a version that is no longer current is refused: its pins, moments and
 * passages would point at content that changed. lib/posts checks that the
 * anchor / variant fit the post's kind and version.
 */
const ALREADY_APPROVED: Record<ContentKind, string> = {
  SOCIAL_POST: "Questo post è già stato approvato",
  BLOG_ARTICLE: "Questo articolo è già stato approvato",
  AD_CREATIVE: "Questo set di creatività è già stato approvato",
};

export async function addCommentAction(token: string, input: PortalCommentInput): Promise<PortalActionResult> {
  const result = await asReviewer(token, async (reviewer) => {
    const data = parseOrThrow(commentSchema, input);
    // Ownership + visibility (throws NotFoundError), and the visible version.
    const post = await getPostForReviewer(data.postId, reviewer);
    if (post.currentVersionNumber !== data.versionNumber) throw new ConflictError(STALE_VERSION);
    if (!post.canAct && post.status !== "CHANGES_REQUESTED") {
      throw new ConflictError(`${ALREADY_APPROVED[post.kind]}: per altre modifiche contatta l'agenzia.`);
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
      anchor: data.anchor ?? null,
      variantId: data.variantId ?? null,
    });
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

/**
 * Ads: approves or discards one variant of the version the client sees (a
 * note is required to discard). Changing one's mind is allowed until the
 * decisions are sent. Returns where the set stands.
 */
export async function decideVariantAction(
  token: string,
  input: DecideVariantInput
): Promise<PortalActionResult<DecisionProgress>> {
  const result = await asReviewer(token, async (reviewer) => {
    const { postId, versionNumber, variantId, verdict, note } = parseOrThrow(decideSchema, input);
    // decideVariant checks client, kind, visibility, IN_REVIEW and the version.
    const { evaluation } = await decideVariant(postId, reviewer, versionNumber, { variantId, verdict, note });
    return progressOf(evaluation);
  });
  if (result.ok) refresh();
  return result;
}

/**
 * Ads: "Invia le mie decisioni". Every variant must be decided; the set is
 * approved when at least one variant is, otherwise it goes back to the
 * agency with the notes (lib/creative-decisions, rule 5).
 */
export async function finalizeDecisionsAction(
  token: string,
  input: FinalizeDecisionsInput
): Promise<PortalActionResult<DecisionProgress & { result: "APPROVED" | "CHANGES_REQUESTED" }>> {
  const result = await asReviewer(token, async (reviewer) => {
    const { postId, versionNumber } = parseOrThrow(approveSchema, input);
    const { outcome, evaluation } = await finalizeCreativeReview(postId, reviewer, versionNumber);
    return { ...progressOf(evaluation), result: outcome };
  });
  if (result.ok) refresh();
  return result;
}
