/**
 * Shared plumbing for the public assistant routes: token authentication and
 * mapping of errors to Italian JSON responses (never internal details).
 */

import { NextResponse } from "next/server";
import { httpStatusForError, isDomainError, publicErrorMessage } from "@/lib/errors";
import { resolveReviewerToken } from "@/lib/reviewers";
import { AssistantError, isAssistantEnabled } from "./provider";
import type { AssistantReviewer } from "./service";

export function notFound(): NextResponse {
  return NextResponse.json({ success: false, error: "Non trovato" }, { status: 404 });
}

/**
 * Resolves the link token to the reviewer, or null (→ 404, without saying
 * whether the link or the assistant is the missing piece).
 */
export async function authenticateAssistantRequest(token: string): Promise<AssistantReviewer | null> {
  if (!isAssistantEnabled()) return null;
  const reviewer = await resolveReviewerToken(token);
  if (!reviewer) return null;
  return { id: reviewer.id, clientId: reviewer.clientId, name: reviewer.name };
}

export function assistantErrorResponse(error: unknown): NextResponse {
  if (error instanceof AssistantError) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  }
  if (isDomainError(error)) {
    return NextResponse.json({ success: false, error: publicErrorMessage(error) }, { status: httpStatusForError(error) });
  }
  console.error("[review-assistant] Route error:", error);
  return NextResponse.json(
    { success: false, error: "Si è verificato un errore imprevisto. Riprova tra poco." },
    { status: 500 }
  );
}
