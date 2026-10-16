/**
 * POST /api/site/v1/comments (Bearer) { body, anchor? } → saves a client
 * comment on the session's version, optionally on an element of the site
 * (LiveAnchor, checked by lib/posts against the site's origins: never form
 * values, never a page outside the registered origins).
 *
 * Reviewer sessions only, while the post accepts comments. A session never
 * approves or requests changes: that happens in the portal.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { addComment, MAX_COMMENT_LENGTH } from "@/lib/posts";
import { embedContext } from "@/lib/website/embed";
import { errorJson, json, preflight, sessionOf } from "@/lib/website/http";
import { SiteAccessError } from "@/lib/website/sessions";

const commentSchema = z
  .object({
    body: z.string().max(MAX_COMMENT_LENGTH),
    anchor: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  let origins: string[] = [];
  try {
    const view = await sessionOf(request, "comment");
    origins = view.origins;
    if (view.role !== "REVIEWER" || !view.reviewer) throw new SiteAccessError("forbidden");
    if (!view.canComment) throw new SiteAccessError("closed");
    const raw = await request.text();
    if (raw.length > 16_000) return json({ success: false, error: "Richiesta troppo grande" }, { status: 413, request, origins });
    const body = commentSchema.safeParse(JSON.parse(raw || "null"));
    if (!body.success) return json({ success: false, error: "Richiesta non valida" }, { status: 400, request, origins });
    const version = await prisma.postVersion.findUnique({
      where: { postId_number: { postId: view.postId, number: view.versionNumber } },
      select: { id: true },
    });
    if (!version) throw new SiteAccessError("stale");
    const comment = await addComment({
      postId: view.postId,
      actor: { kind: "reviewer", reviewerId: view.reviewer.id },
      body: body.data.body,
      versionId: version.id,
      anchor: body.data.anchor ?? null,
    });
    const context = await embedContext(view);
    return json({ success: true, data: { commentId: comment.id, markers: context.markers } }, { request, origins });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ success: false, error: "Richiesta non valida" }, { status: 400, request, origins });
    return errorJson(error, request, origins);
  }
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
