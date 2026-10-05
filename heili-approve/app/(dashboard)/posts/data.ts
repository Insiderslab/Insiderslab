/**
 * Server-side loaders shared by the post pages (not server actions).
 */

import type { EditorClient } from "@/components/posts/types";
import { listClients } from "@/lib/clients";
import { prisma } from "@/lib/db/client";
import type { NetworkOptions } from "@/lib/domain";

/**
 * Clients the editor can pick: the active ones, plus `includeClientId` when
 * it is archived (a post of an archived client still shows its client).
 */
export async function loadEditorClients(workspaceId: string, includeClientId?: string): Promise<EditorClient[]> {
  const clients = await listClients(workspaceId);
  const result: EditorClient[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    timezone: client.timezone,
    networks: client.networks,
    logoUrl: client.logoUrl,
    hasMetricoolBrand: Boolean(client.metricoolBlogId),
    activeReviewers: client._count.reviewers,
  }));

  if (includeClientId && !result.some((c) => c.id === includeClientId)) {
    const extra = await prisma.client.findFirst({
      where: { id: includeClientId, workspaceId },
      include: { _count: { select: { reviewers: { where: { active: true } } } } },
    });
    if (extra) {
      result.push({
        id: extra.id,
        name: `${extra.name} (archiviato)`,
        timezone: extra.timezone,
        networks: extra.networks,
        logoUrl: extra.logoUrl,
        hasMetricoolBrand: Boolean(extra.metricoolBlogId),
        activeReviewers: extra._count.reviewers,
      });
    }
  }
  return result;
}

/** Post.networkOptions as stored (Json) → the editor's NetworkOptions. */
export function toNetworkOptions(value: unknown): NetworkOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: NetworkOptions = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^[a-z]+Data$/.test(key) && typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      result[key] = entry as Record<string, unknown>;
    }
  }
  return result;
}
