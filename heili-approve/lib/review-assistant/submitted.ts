/**
 * Which of a reviewer's conversations already reached the agency.
 *
 * A conversation is "submitted" when its summary became the change request
 * (CHANGES_REQUESTED event) or was added to the feedback after it
 * (COMMENTED event); both events carry `reviewSessionId` in their metadata.
 * After "Chiedi modifiche" the same version stays under review in
 * CHANGES_REQUESTED, so a session that was already sent must not be offered
 * again with its "Non ancora inviato" summary: pickSessionForVersion skips it.
 */

import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

type EventDb = Pick<PrismaClient | Prisma.TransactionClient, "postEvent">;

export async function loadSubmittedSessionIds(
  db: EventDb,
  postId: string,
  reviewerId: string
): Promise<Set<string>> {
  const events = await db.postEvent.findMany({
    where: { postId, reviewerId, type: { in: ["CHANGES_REQUESTED", "COMMENTED"] } },
    select: { metadata: true },
  });
  const ids = new Set<string>();
  for (const event of events) {
    const metadata = event.metadata;
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const id = (metadata as Record<string, unknown>).reviewSessionId;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}
