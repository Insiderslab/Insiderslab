"use server";

/**
 * Server action of the Metricool import. Only owners and admins (like the
 * Metricool connection itself), only on instances with social posts. The
 * action re-reads the workspace from the session; the Metricool token is
 * decrypted inside lib/metricool/client and never leaves the server.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/clients/action-result";
import { isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import { MetricoolError } from "@/lib/metricool/client";
import { IMPORT_ACTIONS, summaryHeadline, type ImportSummary } from "@/lib/metricool/import";
import { importMetricoolBrands } from "@/lib/metricool/import-service";
import { isMetricoolEnabled, productName } from "@/lib/variant";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

const MAX_CHOICES = 500;

const importSchema = z.object({
  choices: z
    .array(
      z.object({
        blogId: z.string().trim().min(1).max(64),
        action: z.enum(IMPORT_ACTIONS),
        clientId: z.string().trim().min(1).max(64).nullish(),
      })
    )
    .max(MAX_CHOICES, "Troppi brand in una volta: importane meno alla volta"),
});

const IMPORT_SESSION_EXPIRED = "Sessione scaduta: accedi di nuovo.";
const IMPORT_ADMIN_ONLY = "Solo titolari e amministratori possono importare i clienti da Metricool.";

export async function importMetricoolClientsAction(input: {
  choices: Array<{ blogId: string; action: "create" | "link" | "skip"; clientId?: string | null }>;
}): Promise<ActionResult<ImportSummary>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: IMPORT_SESSION_EXPIRED };
  if (!isMetricoolEnabled()) {
    return { ok: false, error: `Metricool non è disponibile in ${productName()}.` };
  }
  if (!canManageWorkspace(context.role)) return { ok: false, error: IMPORT_ADMIN_ONLY };

  try {
    const data = parseOrThrow(importSchema, input);
    const summary = await importMetricoolBrands(context.workspaceId, data.choices);
    revalidatePath("/clients");
    revalidatePath("/clients/import");
    revalidatePath("/", "layout");
    return { ok: true, data: summary, message: summaryHeadline(summary) };
  } catch (error) {
    if (error instanceof MetricoolError) return { ok: false, error: error.message };
    if (!isDomainError(error)) console.error("[import] Action failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, error: publicErrorMessage(error) };
  }
}
