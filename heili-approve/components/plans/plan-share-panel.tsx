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
import ShareLink from "@/components/share/share-link";
import { prisma } from "@/lib/db/client";
import { getReviewPlanUrl } from "@/lib/reviewers";

function safePlanUrl(reviewer: { tokenEncrypted: string }, planId: string): string | null {
  try {
    return getReviewPlanUrl(reviewer, planId);
  } catch (error) {
    console.error("[plans] Could not decrypt a review link:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export default async function PlanSharePanel({
  plan,
  client,
  planName,
  toReview,
}: {
  plan: { id: string; sentAt: Date | null };
  client: { id: string; name: string; archivedAt: Date | null };
  /** "piano social di ottobre". */
  planName: string;
  toReview: number;
}) {
  if (client.archivedAt) return null;
  const reviewers = await prisma.clientReviewer.findMany({
    where: { clientId: client.id, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, tokenEncrypted: true },
  });

  return (
    <section className="panel space-y-3 p-4 sm:p-5" aria-labelledby="plan-share" data-testid="plan-share-panel">
      <div className="space-y-1">
        <h2 id="plan-share" className="text-lg font-semibold">
          Link del piano
        </h2>
        {plan.sentAt && reviewers.length > 0 && (
          <p className="text-sm text-muted">Apre il piano nella revisione di {client.name}, senza password.</p>
        )}
      </div>
      {reviewers.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {client.name} non ha ancora nessuno che approva: aggiungi una persona per avere il link da mandare.
          </p>
          <Link href={`/clients/${client.id}#referenti`} className="btn btn-sm">
            Aggiungi chi approva
          </Link>
        </div>
      ) : !plan.sentAt ? (
        <p className="text-sm text-muted" data-testid="plan-share-hint">
          Il link per il cliente compare qui dopo «Invia il piano al cliente».
        </p>
      ) : (
        <ul className="space-y-3">
          {reviewers.map((reviewer) => {
            const url = safePlanUrl(reviewer, plan.id);
            return (
              <li key={reviewer.id} className="inset space-y-2 p-3" data-testid="plan-share-row">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-semibold">{reviewer.name}</p>
                  {!reviewer.email && <span className="chip chip-offline">Nessuna email</span>}
                </div>
                {url ? (
                  <ShareLink
                    url={url}
                    reviewerName={reviewer.name}
                    message={planLinkMessage({ reviewerName: reviewer.name, clientName: client.name, planName, toReview, url })}
                    previewLabel="Apri il piano"
                    compact
                  />
                ) : (
                  <p className="text-sm text-warning">
                    Link non leggibile: crea un nuovo link per {reviewer.name} nella{" "}
                    <Link href={`/clients/${client.id}#referenti`} className="underline">
                      scheda del cliente
                    </Link>
                    .
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
