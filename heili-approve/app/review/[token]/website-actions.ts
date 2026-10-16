"use server";

/**
 * «Apri il sito» (portal, «Sul sito»): a one-time launch code for this
 * reviewer, post and version, valid 10 minutes, returned inside the site's
 * address fragment (#heili-review=…). Never the client's permanent link.
 */

import { z } from "zod";
import type { PortalActionResult } from "@/components/portal/types";
import { ConflictError, InvalidTransitionError, isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import { resolveReviewerToken } from "@/lib/reviewers";
import { createWebsiteLaunch } from "@/lib/website/service";

const launchSchema = z
  .object({
    postId: z.string().trim().min(1).max(64),
    pageUrl: z.string().max(2048).nullish(),
  })
  .strict();

export async function createWebsiteLaunchAction(
  token: string,
  input: z.input<typeof launchSchema>
): Promise<PortalActionResult<{ url: string }>> {
  try {
    const reviewer = typeof token === "string" && token.length <= 256 ? await resolveReviewerToken(token) : null;
    if (!reviewer) return { ok: false, error: "Questo link non è più valido. Chiedi all'agenzia di inviartene uno nuovo." };
    const { postId, pageUrl } = parseOrThrow(launchSchema, input);
    const launch = await createWebsiteLaunch({ id: reviewer.id, clientId: reviewer.clientId }, postId, pageUrl ?? null);
    return { ok: true, data: launch };
  } catch (error) {
    if (!isDomainError(error)) console.error("[review] Website launch failed:", error);
    return {
      ok: false,
      error: publicErrorMessage(error),
      stale: error instanceof ConflictError || error instanceof InvalidTransitionError,
    };
  }
}
