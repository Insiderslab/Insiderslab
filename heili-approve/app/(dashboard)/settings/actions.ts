"use server";

/**
 * Server actions for the Metricool connection.
 *
 * The API token is written encrypted (encryptSecret) and is never returned:
 * none of these actions echo it, and error messages come from MetricoolError,
 * which never includes it. Only owners and admins can change the connection;
 * anyone in the workspace can test it. Instances without social posts (blog,
 * ads) have no Metricool integration: every action refuses.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/clients/action-result";
import { normalizeMetricoolUserId } from "@/components/settings/helpers";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db/client";
import { parseOrThrow, publicErrorMessage, isDomainError } from "@/lib/errors";
import {
  MetricoolClient,
  MetricoolError,
  getWorkspaceMetricoolClient,
} from "@/lib/metricool/client";
import { isMetricoolEnabled, productName } from "@/lib/variant";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspace-access";

const credentialsSchema = z.object({
  userId: z
    .string()
    .transform(normalizeMetricoolUserId)
    .pipe(
      z
        .string()
        .min(1, "Inserisci lo userId di Metricool")
        .max(32, "userId non valido")
        .regex(/^\d+$/, "Lo userId di Metricool è un numero (lo trovi nell'URL di Metricool)")
    ),
  token: z
    .string()
    .trim()
    .min(8, "Il token API sembra troppo corto: copialo di nuovo da Metricool")
    .max(512, "Token API non valido")
    .regex(/^\S+$/, "Il token API non può contenere spazi"),
  /** Save even if the test call fails (e.g. Metricool temporarily down). */
  force: z.boolean().default(false),
});

const SESSION_EXPIRED = "Sessione scaduta: accedi di nuovo.";
const ADMIN_ONLY = "Solo titolari e amministratori possono modificare la connessione a Metricool.";

async function withManager<T>(
  fn: (context: WorkspaceContext) => Promise<ActionResult<T>>,
  options: { requireManager?: boolean } = { requireManager: true }
): Promise<ActionResult<T>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: SESSION_EXPIRED };
  if (!isMetricoolEnabled()) {
    return { ok: false, error: `Metricool non è disponibile in ${productName()}.` };
  }
  if (options.requireManager && !canManageWorkspace(context.role)) {
    return { ok: false, error: ADMIN_ONLY };
  }
  try {
    return await fn(context);
  } catch (error) {
    if (!isDomainError(error)) console.error("[settings] Action failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, error: publicErrorMessage(error) };
  }
}

function revalidateSettings() {
  // The layout shows "Metricool collegato" in the top bar on every page.
  revalidatePath("/", "layout");
}

function brandCountLabel(count: number): string {
  return count === 1 ? "1 brand trovato" : `${count} brand trovati`;
}

/**
 * Tests the credentials, then stores them. A failed test blocks the save
 * unless `force` is set, so typos are caught before posts start failing.
 */
export async function saveMetricoolCredentialsAction(input: {
  userId: string;
  token: string;
  force?: boolean;
}): Promise<ActionResult<{ testFailed: boolean }>> {
  return withManager(async ({ workspaceId }) => {
    const data = parseOrThrow(credentialsSchema, input);

    const test = await new MetricoolClient({ userId: data.userId, token: data.token }).testConnection();
    if (!test.ok && !data.force) {
      return { ok: false, error: test.error, canForce: true };
    }

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        metricoolUserId: data.userId,
        metricoolTokenEncrypted: encryptSecret(data.token),
        metricoolConnectedAt: new Date(),
      },
    });
    revalidateSettings();

    return {
      ok: true,
      data: { testFailed: !test.ok },
      message: test.ok
        ? `Metricool collegato: ${brandCountLabel(test.brandCount)}.`
        : "Credenziali salvate senza verifica: usa \"Prova connessione\" appena Metricool risponde.",
    };
  });
}

export async function testMetricoolConnectionAction(): Promise<ActionResult<{ brandCount: number }>> {
  return withManager(
    async ({ workspaceId }) => {
      let client: MetricoolClient;
      try {
        client = await getWorkspaceMetricoolClient(workspaceId);
      } catch (error) {
        if (error instanceof MetricoolError) return { ok: false, error: error.message };
        throw error;
      }
      const result = await client.testConnection();
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        data: { brandCount: result.brandCount },
        message: `Connessione riuscita: ${brandCountLabel(result.brandCount)}${client.isFake ? " (modalità di prova)" : ""}.`,
      };
    },
    { requireManager: false }
  );
}

export async function disconnectMetricoolAction(): Promise<ActionResult> {
  return withManager(async ({ workspaceId }) => {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        metricoolUserId: null,
        metricoolTokenEncrypted: null,
        metricoolConnectedAt: null,
      },
    });
    revalidateSettings();
    return { ok: true, data: undefined, message: "Metricool scollegato." };
  });
}
