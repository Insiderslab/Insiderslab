"use server";

/**
 * Server actions of "Importa post" (agency panel). The browser reads the sheet
 * and sends plain rows; both actions re-read the workspace from the session
 * and hand the rows to lib/post-import/service, which validates them again
 * with the automation API's rules. Drafts only: nothing is sent or scheduled.
 *
 * `checkImportAction` writes nothing. `createImportAction` receives the
 * MediaItems of the files the browser already uploaded to /api/uploads.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/posts/types";
import { isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import { mediaItemSchema } from "@/lib/posts";
import { MAX_IMPORT_ROWS } from "@/lib/post-import/rows";
import {
  checkImportRows,
  createImportedDrafts,
  type ImportResult,
  type RowCheck,
} from "@/lib/post-import/service";
import { getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

const cell = (max: number) => z.string().max(max);

const rowSchema = z.object({
  sourceRow: z.number().int().min(0).max(1_000_000),
  date: cell(200),
  time: cell(100),
  networks: cell(500),
  text: cell(100_000),
  firstComment: cell(20_000),
  title: cell(1000),
  images: cell(5000),
  kind: cell(100).optional(),
  networkOptions: cell(5000).optional(),
});

const fileSchema = z.object({
  name: z.string().min(1).max(500),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  type: z.enum(["image", "video"]),
  mimeType: z.string().min(1).max(100),
});

const requestSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  rows: z.array(rowSchema).min(1, "Non ci sono righe da importare").max(MAX_IMPORT_ROWS, `Puoi importare al massimo ${MAX_IMPORT_ROWS} righe alla volta`),
  files: z.array(fileSchema).max(1000),
});

const createSchema = requestSchema.extend({
  /** What /api/uploads returned; lib/posts still resolves every item to an asset of this workspace. */
  uploaded: z.record(z.string().max(500), mediaItemSchema),
  plan: z.boolean(),
});

const SESSION_EXPIRED = "Sessione scaduta: accedi di nuovo.";

async function withWorkspace<T>(fn: (context: WorkspaceContext) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: SESSION_EXPIRED };
  try {
    return await fn(context);
  } catch (error) {
    if (!isDomainError(error)) console.error("[post-import] Action failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, error: publicErrorMessage(error) };
  }
}

/** Validates every row with the server's rules; creates nothing. */
export async function checkImportAction(input: z.input<typeof requestSchema>): Promise<ActionResult<RowCheck[]>> {
  return withWorkspace(async ({ workspaceId }) => {
    const data = parseOrThrow(requestSchema, input);
    return { ok: true, data: await checkImportRows(workspaceId, data) };
  });
}

/** Creates the drafts (and the month's plan when asked). */
export async function createImportAction(input: z.input<typeof createSchema>): Promise<ActionResult<ImportResult>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const data = parseOrThrow(createSchema, input);
    const result = await createImportedDrafts({ workspaceId, userId }, data);
    revalidatePath("/posts");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    if (result.plan?.status === "ok") {
      revalidatePath("/plans");
      revalidatePath(`/plans/${result.plan.id}`);
    }
    return { ok: true, data: result };
  });
}
