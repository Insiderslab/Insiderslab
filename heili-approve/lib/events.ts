/**
 * Append-only audit log of everything that happens to a post (PostEvent).
 * Call it with the transaction client so the event commits together with the
 * change it describes.
 *
 * Metadata written by the services, per type (all optional for readers):
 * - CREATED: { kind }
 * - VERSION_CREATED: { previousVersionNumber, changeNote, changes: string[], fromStatus?, toStatus? }
 * - SUBMITTED_FOR_REVIEW: { fromStatus, reviewDueAt? }
 * - APPROVED (ads): { approvedVariants: string[], rejectedVariants: string[] }
 * - CHANGES_REQUESTED: { commentId, actionCommentIds?, reviewSessionId? }
 * - COMMENTED: { commentId, mediaIndex?, timeSec?, timeEndSec?, variantId?, quote? }
 * - VARIANT_DECIDED (ads): { variantId, variantName, verdict: "APPROVED" | "REJECTED", note? }
 * - DELIVERED (blog/ads): { fromStatus, kind }
 * - CANCELLED: { fromStatus }
 */

import type { Prisma, PostEvent, PostEventType, PrismaClient } from "@/app/generated/prisma/client";
import { actorColumns, type Actor } from "@/lib/actor";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface RecordEventInput {
  postId: string;
  type: PostEventType;
  actor: Actor;
  versionNumber?: number | null;
  metadata?: Prisma.InputJsonObject;
}

export function recordEvent(db: DbClient, input: RecordEventInput): Promise<PostEvent> {
  const { userId, reviewerId } = actorColumns(input.actor);
  return db.postEvent.create({
    data: {
      postId: input.postId,
      type: input.type,
      userId,
      reviewerId,
      versionNumber: input.versionNumber ?? null,
      metadata: {
        ...(input.actor.kind === "system" ? { actor: "system" } : {}),
        ...(input.metadata ?? {}),
      },
    },
  });
}
