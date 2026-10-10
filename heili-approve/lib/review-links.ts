import { prisma } from "@/lib/db/client";
import { CLIENT_VISIBLE_STATUSES } from "@/lib/domain";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getReviewPlanUrl, getReviewPostUrl } from "@/lib/reviewers";
import { isKindEnabled } from "@/lib/variant";

export type QuickReviewChoice = { id: string; name: string; url: string | null };

/** Resolve fresh links only after checking the authenticated workspace and visible target. */
export async function getQuickReviewLinks(workspaceId: string, kind: "post" | "plan", id: string): Promise<QuickReviewChoice[]> {
  const target = kind === "post"
    ? await prisma.post.findFirst({ where: { id, workspaceId }, select: { clientId: true, kind: true, status: true, client: { select: { archivedAt: true } } } })
    : await prisma.contentPlan.findFirst({ where: { id, workspaceId }, select: { clientId: true, kind: true, sentAt: true, client: { select: { archivedAt: true } } } });
  if (!target || target.client.archivedAt || !isKindEnabled(target.kind)) throw new NotFoundError("Contenuto non disponibile");
  if (("status" in target && !CLIENT_VISIBLE_STATUSES.includes(target.status)) || ("sentAt" in target && !target.sentAt)) {
    throw new ValidationError("Il contenuto non è ancora disponibile al cliente.");
  }
  const reviewers = await prisma.clientReviewer.findMany({
    where: { clientId: target.clientId, active: true, client: { workspaceId, archivedAt: null } },
    select: { id: true, name: true, tokenEncrypted: true }, orderBy: { createdAt: "asc" },
  });
  return reviewers.map(reviewer => {
    let url: string | null = null;
    try { url = kind === "post" ? getReviewPostUrl(reviewer, id) : getReviewPlanUrl(reviewer, id); } catch { /* Show recovery without leaking encrypted tokens. */ }
    return { id: reviewer.id, name: reviewer.name, url };
  });
}
