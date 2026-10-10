/**
 * Import clients from Metricool (server side).
 *
 * `loadImportRows` feeds the import page; `importMetricoolBrands` carries out
 * the user's choices. Both read the brands from Metricool and the clients from
 * the database themselves: the browser only sends, per brand, create / link /
 * skip (and the client to link), never names, logos or networks. Everything is
 * scoped to the workspace.
 *
 * Imports of one workspace run one at a time (a double click or two tabs
 * cannot both pass the "not linked yet" check and create twice). The lock is
 * per process, which is enough for the single app container.
 */

import { createClient, updateClient } from "@/lib/clients";
import { prisma } from "@/lib/db/client";
import { isDomainError, publicErrorMessage } from "@/lib/errors";
import { getWorkspaceMetricoolClient } from "@/lib/metricool/client";
import {
  buildImportRows,
  linkClientPatch,
  newClientInput,
  planImport,
  skipMessage,
  type ImportChoice,
  type ImportClient,
  type ImportRow,
  type ImportSummary,
} from "@/lib/metricool/import";
import { enabledKinds } from "@/lib/variant";

async function loadClients(workspaceId: string): Promise<ImportClient[]> {
  return prisma.client.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, metricoolBlogId: true, archivedAt: true, logoUrl: true, networks: true, services: true },
  });
}

export interface ImportPageData {
  fake: boolean;
  rows: ImportRow[];
  /** Active clients without a brand: what a brand can be linked to. */
  candidates: Array<{ id: string; name: string }>;
}

/** Brands of the connected account with their default choice. Throws MetricoolError. */
export async function loadImportRows(workspaceId: string): Promise<ImportPageData> {
  const client = await getWorkspaceMetricoolClient(workspaceId);
  const [brands, clients] = await Promise.all([client.listBrands(), loadClients(workspaceId)]);
  return {
    fake: client.isFake,
    rows: buildImportRows(brands, clients),
    candidates: clients
      .filter((c) => !c.archivedAt && !c.metricoolBlogId)
      .map((c) => ({ id: c.id, name: c.name })),
  };
}

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` after the previous import of the same workspace has finished. */
async function exclusive<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(workspaceId) ?? Promise.resolve();
  const run = previous.then(() => fn());
  const tail = run.catch(() => undefined);
  locks.set(workspaceId, tail);
  try {
    return await run;
  } finally {
    if (locks.get(workspaceId) === tail) locks.delete(workspaceId);
  }
}

/**
 * Creates and links clients as chosen. A brand that is already linked (or whose
 * client vanished) is skipped, never an error: running it twice changes nothing
 * the second time. One failing client does not stop the others.
 */
export async function importMetricoolBrands(
  workspaceId: string,
  choices: readonly ImportChoice[]
): Promise<ImportSummary> {
  return exclusive(workspaceId, async () => {
    const metricool = await getWorkspaceMetricoolClient(workspaceId);
    const brands = await metricool.listBrands();
    const clients = await loadClients(workspaceId);
    const steps = planImport({ brands, clients, choices });
    const enabled = enabledKinds();

    const summary: ImportSummary = { created: [], linked: [], skipped: [] };
    for (const step of steps) {
      if (step.kind === "skip") {
        summary.skipped.push({ blogId: step.blogId, label: step.label, reason: skipMessage(step) });
        continue;
      }
      try {
        if (step.kind === "create") {
          const created = await createClient(workspaceId, newClientInput(step.brand));
          summary.created.push({ id: created.id, name: created.name, blogId: step.brand.blogId });
        } else {
          await updateClient(step.client.id, workspaceId, linkClientPatch(step.brand, step.client, enabled));
          summary.linked.push({ id: step.client.id, name: step.client.name, blogId: step.brand.blogId });
        }
      } catch (error) {
        if (!isDomainError(error)) console.error("[import] Client import failed:", error instanceof Error ? error.name : "unknown");
        summary.skipped.push({
          blogId: step.brand.blogId,
          label: step.brand.label,
          reason: publicErrorMessage(error),
        });
      }
    }
    return summary;
  });
}
