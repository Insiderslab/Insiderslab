"use server";

import { z } from "zod";
import type { ActionResult } from "@/components/posts/types";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { parseOrThrow, publicErrorMessage } from "@/lib/errors";
import { getQuickReviewLinks, type QuickReviewChoice } from "@/lib/review-links";

const inputSchema = z.object({ kind: z.enum(["post", "plan"]), id: z.string().trim().min(1).max(64) });

export async function quickReviewLinksAction(input: { kind: "post" | "plan"; id: string }): Promise<ActionResult<QuickReviewChoice[]>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: "Sessione scaduta: accedi di nuovo." };
  try {
    const { kind, id } = parseOrThrow(inputSchema, input);
    return { ok: true, data: await getQuickReviewLinks(context.workspaceId, kind, id) };
  } catch (error) { return { ok: false, error: publicErrorMessage(error) }; }
}
