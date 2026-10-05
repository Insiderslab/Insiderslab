/**
 * Metricool brands for the client form. Server-only: the Metricool token is
 * decrypted inside getWorkspaceMetricoolClient and never reaches the browser;
 * only blogId / label / timezone / networks do.
 */

import type { BrandsState } from "@/components/clients/action-result";
import { MetricoolError, getWorkspaceMetricoolClient } from "@/lib/metricool/client";

export async function loadBrandOptions(workspaceId: string): Promise<BrandsState> {
  try {
    const client = await getWorkspaceMetricoolClient(workspaceId);
    const brands = await client.listBrands();
    return {
      status: "ok",
      fake: client.isFake,
      brands: brands
        .map((brand) => ({
          blogId: brand.blogId,
          label: brand.label,
          timezone: brand.timezone,
          networks: [...brand.networks],
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
