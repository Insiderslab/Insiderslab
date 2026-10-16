/**
 * Facts behind «Per iniziare» (lib/help/getting-started.ts), read from the
 * workspace's own data: always the whole workspace, whatever client is picked
 * in the menu, archived clients included (the agency did add them).
 */

import type { ContentKind } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type { GettingStartedFacts } from "./getting-started";

/** Approved and still standing, or gone further (Metricool, published / delivered). */
const APPROVED_OR_LATER = ["APPROVED", "SCHEDULING", "SCHEDULED", "DELIVERED"] as const;

export async function getGettingStartedFacts(workspaceId: string, kinds: readonly ContentKind[]): Promise<GettingStartedFacts> {
  const posts = { workspaceId, kind: { in: [...kinds] } };
  // `take: 1` on each: the list only needs to know whether a step happened.
  const [clients, anyPost, anySubmitted, anyApproved] = await Promise.all([
    prisma.client.count({ where: { workspaceId }, take: 1 }),
    prisma.post.count({ where: posts, take: 1 }),
    prisma.post.count({ where: { ...posts, submittedAt: { not: null } }, take: 1 }),
    prisma.post.count({
      where: { ...posts, OR: [{ approvedAt: { not: null } }, { status: { in: [...APPROVED_OR_LATER] } }] },
      take: 1,
    }),
  ]);
  return { clients, posts: anyPost, submitted: anySubmitted, approved: anyApproved };
}
