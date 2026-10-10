/**
 * "Link del piano": per active reviewer of the client, the link straight to
 * the plan page of their portal (/review/<token>/piani/<planId>) with a
 * ready WhatsApp message ("Ciao Chiara, ecco il piano social di ottobre per
 * …: 12 post da rivedere. <url>").
 *
 * Server component: it decrypts the reviewers' tokens, so it must only be
 * rendered on pages that already checked the signed-in agency workspace.
 */

import Link from "next/link";
import { planLinkMessage } from "@/components/share/messages";
import ReviewerSharePicker, { type ReviewerShareChoice } from "@/components/share/reviewer-share-picker";
import { prisma } from "@/lib/db/client";
import { getReviewPlanUrl } from "@/lib/reviewers";
import PlanAvailabilityButton from "./plan-availability-button";

function safePlanUrl(reviewer: { tokenEncrypted: string }, planId: string): string | null {
  try {
    return getReviewPlanUrl(reviewer, planId);
  } catch (error) {
    console.error("[plans] Could not decrypt a review link:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export default async function PlanSharePanel({
  workspaceId,
  plan,
  client,
  planName,
  toReview,
}: {
  workspaceId: string;
  plan: { id: string; sentAt: Date | null };
  client: { id: string; name: string; archivedAt: Date | null };
  /** "piano social di ottobre". */
  planName: string;
  toReview: number;
}) {
  if (client.archivedAt) return null;
  const reviewers = await prisma.clientReviewer.findMany({
    where: { clientId: client.id, active: true, client: { workspaceId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, tokenEncrypted: true },
  });
  const choices: ReviewerShareChoice[] = reviewers.map((reviewer) => {
    const url = safePlanUrl(reviewer, plan.id);
    return {
      id: reviewer.id,
      name: reviewer.name,
      email: reviewer.email,
      url,
      message: url
        ? planLinkMessage({ reviewerName: reviewer.name, clientName: client.name, planName, toReview, url })
        : null,
    };
  });

  return (
    <section className="panel space-y-3 p-4 sm:p-5" aria-labelledby="plan-share" data-testid="plan-share-panel">
      <div className="space-y-1">
        <h2 id="plan-share" className="text-lg font-semibold">
          Link diretto del piano
        </h2>
        {plan.sentAt && reviewers.length > 0 && (
          <p className="text-sm text-muted">Scegli il referente, poi copia o apri il suo link personale.</p>
        )}
      </div>
      {reviewers.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {client.name} non ha ancora nessuno che approva: aggiungi una persona per avere il link da mandare.
          </p>
          <Link href={`/clients/${client.id}#referenti`} className="btn btn-sm min-h-11">
            Aggiungi chi approva
          </Link>
        </div>
      ) : !plan.sentAt ? (
        <div className="inset space-y-1 p-3" data-testid="plan-share-hint">
          <p className="text-sm font-medium">Il piano non è ancora visibile al cliente.</p>
          <p className="text-sm text-muted">
            Se i post sono già in revisione, rendi disponibile il piano senza reinviarli.
          </p>
          <PlanAvailabilityButton planId={plan.id} />
        </div>
      ) : (
        <div className="inset p-3" data-testid="plan-share-row">
          <ReviewerSharePicker choices={choices} previewLabel="Apri il piano" />
          {choices.some((choice) => !choice.url) && (
            <p className="mt-2 text-xs text-muted">
              Gestisci o rinnova i link nella{" "}
              <Link href={`/clients/${client.id}#referenti`} className="text-accent hover:underline">
                scheda del cliente
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </section>
  );
}
