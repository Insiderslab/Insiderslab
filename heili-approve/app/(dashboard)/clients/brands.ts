/**
 * Metricool brands for the client form. Server-only: the Metricool token is
 * decrypted inside getWorkspaceMetricoolClient and never reaches the browser;
 * only the brand's public data (id, name, logo, time zone, networks) does.
 */

import type { BrandsState } from "@/components/clients/action-result";
import { prisma } from "@/lib/db/client";
import { MetricoolError, getWorkspaceMetricoolClient } from "@/lib/metricool/client";

/**
 * Brands for the client form. `exceptClientId` = the client being edited: its
 * own brand is not "used by another client".
 */
export async function loadBrandOptions(workspaceId: string, exceptClientId?: string): Promise<BrandsState> {
  try {
    const client = await getWorkspaceMetricoolClient(workspaceId);
    const [brands, linked] = await Promise.all([
      client.listBrands(),
      prisma.client.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          metricoolBlogId: { not: null },
          ...(exceptClientId ? { id: { not: exceptClientId } } : {}),
        },
        select: { name: true, metricoolBlogId: true },
      }),
    ]);
    const usedBy = new Map(linked.map((c) => [c.metricoolBlogId, c.name]));
    return {
      status: "ok",
      fake: client.isFake,
      brands: brands
        .map((brand) => ({
          blogId: brand.blogId,
          label: brand.label,
          timezone: brand.timezone,
          networks: [...brand.networks],
          imageUrl: brand.avatarUrl,
          accounts: { ...brand.accounts },
          usedBy: usedBy.get(brand.blogId) ?? null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "it")),
    };
  } catch (error) {
    if (error instanceof MetricoolError && error.code === "not_configured") {
      return { status: "not_configured" };
    }
    if (error instanceof MetricoolError) {
      return { status: "error", message: error.message };
    }
    console.error("[clients] Failed to load Metricool brands:", error);
    return { status: "error", message: "Impossibile leggere i brand da Metricool in questo momento." };
  }
}
