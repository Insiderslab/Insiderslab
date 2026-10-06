/**
 * Ads: the client decides variant by variant (approve A and C, discard B).
 *
 * Rules (docs/VARIANTI.md, rule 5):
 * - a decision is bound to a version: a new version needs new decisions;
 * - discarding a variant needs a note, so the agency knows why;
 * - the set becomes APPROVED only when every variant of the current version
 *   has a decision and at least one is APPROVED; when every variant is
 *   discarded it becomes CHANGES_REQUESTED with the notes;
 * - discarded variants stay visible to the agency with their note.
 *
 * Decisions only happen while the set is IN_REVIEW, on the version the client
 * is looking at. Each decision locks the post row (guarded no-op update) so it
 * serialises with approvePost, which re-checks the decisions in its own
 * transaction: a set can never be approved on decisions that changed under it.
 */

import { z } from "zod";
import type { CreativeDecision, Post } from "@/app/generated/prisma/client";
import { reviewerActor } from "@/lib/actor";
import { parseAdContent } from "@/lib/content/ads";
import type { AdContent, VariantDecision } from "@/lib/content/types";
import { prisma } from "@/lib/db/client";
import { CLIENT_VISIBLE_STATUSES, InvalidTransitionError } from "@/lib/domain";
import { ConflictError, NotFoundError, ValidationError, parseOrThrow } from "@/lib/errors";
import { recordEvent, type DbClient } from "@/lib/events";
import type { ReviewerRef } from "@/lib/posts";

export const MAX_DECISION_NOTE_LENGTH = 2000;

const STALE_VERSION_MESSAGE =
  "Le creatività sono state aggiornate dall'agenzia nel frattempo: ricarica la pagina per vedere la versione più recente";

export const decisionInputSchema = z
  .object({
    variantId: z.string().trim().min(1, "Variante non valida").max(64, "Variante non valida"),
    verdict: z.enum(["APPROVED", "REJECTED"], { error: "Decisione non valida" }),
    note: z
      .string()
      .trim()
      .max(MAX_DECISION_NOTE_LENGTH, "Nota troppo lunga")
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .refine((d) => d.verdict !== "REJECTED" || d.note !== null, {
    message: "Scrivi perché scarti questa variante: la nota arriva all'agenzia",
    path: ["note"],
  });

export type DecisionInput = z.input<typeof decisionInputSchema>;

// ─── Pure helpers ────────────────────────────────────────────────────────────

export interface DecisionEvaluation {
  /** "approve": complete with ≥ 1 approved; "changes": complete, all discarded. */
  outcome: "incomplete" | "approve" | "changes";
  /** Variant ids (in content order) still without a decision. */
  missing: string[];
  approved: string[];
  rejected: Array<{ variantId: string; note: string | null }>;
}

/**
 * Applies rule 5 to the variants of a version and the decisions taken on it.
 * Decisions about variants that no longer exist are ignored; a set without
 * variants is never complete.
 */
export function evaluateCreativeDecisions(
  variantIds: readonly string[],
  decisions: ReadonlyArray<Pick<VariantDecision, "variantId" | "verdict" | "note">>
): DecisionEvaluation {
  const byVariant = new Map(decisions.map((d) => [d.variantId, d]));
  const missing: string[] = [];
  const approved: string[] = [];
  const rejected: DecisionEvaluation["rejected"] = [];
  for (const id of variantIds) {
    const decision = byVariant.get(id);
    if (!decision) missing.push(id);
    else if (decision.verdict === "APPROVED") approved.push(id);
    else rejected.push({ variantId: id, note: decision.note });
  }
  const outcome =
    variantIds.length === 0 || missing.length > 0 ? "incomplete" : approved.length > 0 ? "approve" : "changes";
  return { outcome, missing, approved, rejected };
}

/** "Variante A — Prima/dopo" or the id when the variant has no name. */
export function variantLabel(variant: { id: string; name?: string | null } | undefined, fallbackId: string): string {
  const name = variant?.name?.trim();
  return name ? name : `Variante ${fallbackId}`;
}

function labelsFor(ids: string[], content: Pick<AdContent, "variants">): string {
  return ids.map((id) => variantLabel(content.variants.find((v) => v.id === id), id)).join(", ");
}

/** Italian reason why the set cannot be approved yet, or null when it can. */
export function approvalBlocker(evaluation: DecisionEvaluation, content: Pick<AdContent, "variants">): string | null {
  if (content.variants.length === 0) return "Questo set non ha varianti da approvare";
  if (evaluation.outcome === "incomplete") {
    return `Decidi tutte le varianti prima di inviare: manca ${labelsFor(evaluation.missing, content)}`;
  }
  if (evaluation.outcome === "changes") {
    return "Hai scartato tutte le varianti: invia le tue decisioni per chiedere modifiche all'agenzia";
  }
  return null;
}

/** Change request sent to the agency when every variant was discarded. */
export function buildRejectionMessage(
  evaluation: DecisionEvaluation,
  content: Pick<AdContent, "variants">
): string {
  const lines = evaluation.rejected.map(
    ({ variantId, note }) => `- ${labelsFor([variantId], content)}: ${note ?? "scartata senza nota"}`
  );
  return ["Tutte le varianti sono state scartate.", "", ...lines].join("\n");
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function loadAdSetForDecision(db: DbClient, postId: string, reviewer: ReviewerRef, versionNumber: number) {
  const post = await db.post.findUnique({ where: { id: postId } });
  if (
    !post ||
    post.clientId !== reviewer.clientId ||
    post.kind !== "AD_CREATIVE" ||
    !CLIENT_VISIBLE_STATUSES.includes(post.status)
  ) {
    throw new NotFoundError("Creatività non trovate");
  }
  if (post.currentVersionNumber !== versionNumber) throw new ConflictError(STALE_VERSION_MESSAGE);
  if (post.status !== "IN_REVIEW") throw new InvalidTransitionError(post.status, "approve");

  const version = await db.postVersion.findUnique({
    where: { postId_number: { postId, number: versionNumber } },
    select: { content: true },
  });
  if (!version) throw new NotFoundError("Versione non trovata");
  return { post, content: parseAdContent(version.content) };
}

// ─── Services ────────────────────────────────────────────────────────────────

export type CreativeDecisionWithReviewer = CreativeDecision & {
  reviewer: { id: string; name: string } | null;
};

/**
 * Decisions taken on one version of a set, oldest first. Not scoped: callers
 * must have authorised the post already (getPostForWorkspace /
 * getPostForReviewer).
 */
export async function listDecisions(postId: string, versionNumber: number): Promise<CreativeDecisionWithReviewer[]> {
  return prisma.creativeDecision.findMany({
    where: { postId, versionNumber },
    orderBy: { createdAt: "asc" },
    include: { reviewer: { select: { id: true, name: true } } },
  });
}

/**
 * Records (or changes) the client's decision on one variant of the version
 * they are looking at. Returns the decision and where the set stands.
 */
export async function decideVariant(
  postId: string,
  reviewer: ReviewerRef,
  versionNumber: number,
  input: DecisionInput
): Promise<{ decision: CreativeDecision; evaluation: DecisionEvaluation }> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ValidationError("Versione non valida");
  const data = parseOrThrow(decisionInputSchema, input);

  return prisma.$transaction(async (tx) => {
    const { content } = await loadAdSetForDecision(tx, postId, reviewer, versionNumber);
    if (!content.variants.some((v) => v.id === data.variantId)) throw new NotFoundError("Variante non trovata");

    // Lock the row while it is still IN_REVIEW on this version: an approval
    // or a new version committed in the meantime makes this a conflict.
    const { count } = await tx.post.updateMany({
      where: { id: postId, status: "IN_REVIEW", currentVersionNumber: versionNumber },
      data: { updatedAt: new Date() },
    });
    if (count !== 1) throw new ConflictError();

    const decision = await tx.creativeDecision.upsert({
      where: { postId_versionNumber_variantId: { postId, versionNumber, variantId: data.variantId } },
      create: {
        postId,
        versionNumber,
        variantId: data.variantId,
        reviewerId: reviewer.id,
        verdict: data.verdict,
        note: data.note,
      },
      update: { reviewerId: reviewer.id, verdict: data.verdict, note: data.note },
    });
    await recordEvent(tx, {
      postId,
      type: "VARIANT_DECIDED",
      actor: reviewerActor(reviewer.id),
      versionNumber,
      metadata: {
        variantId: data.variantId,
        variantName: variantLabel(content.variants.find((v) => v.id === data.variantId), data.variantId),
        verdict: data.verdict,
        ...(data.note ? { note: data.note } : {}),
      },
    });

    const decisions = await tx.creativeDecision.findMany({ where: { postId, versionNumber } });
    return {
      decision,
      evaluation: evaluateCreativeDecisions(
        content.variants.map((v) => v.id),
        decisions
      ),
    };
  });
}

/**
 * "Invia le mie decisioni": once every variant is decided, approves the set
 * (≥ 1 variant approved; approvePost re-checks the decisions atomically) or
 * sends it back with the notes when every variant was discarded.
 */
export async function finalizeCreativeReview(
  postId: string,
  reviewer: ReviewerRef,
  versionNumber: number
): Promise<{ outcome: "APPROVED" | "CHANGES_REQUESTED"; post: Post; evaluation: DecisionEvaluation }> {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ValidationError("Versione non valida");

  const { content } = await loadAdSetForDecision(prisma, postId, reviewer, versionNumber);
  const decisions = await prisma.creativeDecision.findMany({ where: { postId, versionNumber } });
  const evaluation = evaluateCreativeDecisions(
    content.variants.map((v) => v.id),
    decisions
  );
  const blocker = evaluation.outcome === "changes" ? null : approvalBlocker(evaluation, content);
  if (blocker) throw new ValidationError(blocker);

  // Imported lazily: lib/posts imports this module for the approval check.
  const { approvePost, requestChanges } = await import("@/lib/posts");
  if (evaluation.outcome === "approve") {
    const post = await approvePost(postId, reviewer, versionNumber);
    return { outcome: "APPROVED", post, evaluation };
  }
  const { post } = await requestChanges(postId, reviewer, versionNumber, buildRejectionMessage(evaluation, content));
  return { outcome: "CHANGES_REQUESTED", post, evaluation };
}
