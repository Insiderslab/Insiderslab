/**
 * Post Share Panel ("Condividi con il cliente")
 *
 * On the agency's post page, while the item waits for the client
 * (IN_REVIEW, CHANGES_REQUESTED): per active reviewer of the client, a deep
 * link straight to this item in their portal (/review/<token>/posts/<id>)
 * with a ready WhatsApp message. Drafts get a hint (the link appears after
 * "Invia in revisione"); a client without reviewers gets a link to add one.
 *
 * Server component: it decrypts the reviewers' tokens, so it must only be
 * rendered on pages that already checked the workspace of the signed-in
 * agency member. Archived clients show nothing (their links do not work).
 */

import Link from "next/link";
import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getReviewPostUrl } from "@/lib/reviewers";
import { postLinkMessage } from "./messages";
import ShareLink from "./share-link";

interface PostSharePanelProps {
  post: { id: string; title: string; kind: ContentKind; status: PostStatus };
  client: { id: string; name: string; archivedAt: Date | null };
}

const SHARE_STATUSES: readonly PostStatus[] = ["IN_REVIEW", "CHANGES_REQUESTED"];

/** "il post", "l'articolo", "le creatività" (subject of the hints). */
const THE: Record<ContentKind, string> = {
  SOCIAL_POST: "il post",
  BLOG_ARTICLE: "l'articolo",
  AD_CREATIVE: "le creatività",
};

function safePostUrl(reviewer: { tokenEncrypted: string }, postId: string): string | null {
  try {
    return getReviewPostUrl(reviewer, postId);
  } catch (error) {
    // ENCRYPTION_KEY rotated or row corrupted: "Nuovo link" on the client page fixes it.
    console.error("[share] Could not decrypt a review link:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export default async function PostSharePanel({ post, client }: PostSharePanelProps) {
  const shareable = SHARE_STATUSES.includes(post.status);
  if (client.archivedAt || (!shareable && post.status !== "DRAFT")) return null;

  const reviewers = await prisma.clientReviewer.findMany({
    where: { clientId: client.id, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, tokenEncrypted: true },
  });

  const addReviewer = (
    <Link href={`/clients/${client.id}#referenti`} className="btn btn-sm" data-testid="share-add-reviewer">
      Aggiungi chi approva
    </Link>
  );

  return (
    <section className="panel space-y-3 p-4 sm:p-5" aria-labelledby="post-share" data-testid="post-share-panel">
      <div className="space-y-1">
        <h3 id="post-share" className="text-lg font-semibold">
          Condividi con il cliente
        </h3>
        {shareable && reviewers.length > 0 && (
          <p className="text-sm text-muted">
            Il link apre direttamente {THE[post.kind]} nella revisione di {client.name}, senza password.
          </p>
        )}
      </div>

      {reviewers.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {client.name} non ha ancora nessuno che approva: aggiungi una persona per avere il link da mandare.
          </p>
          {addReviewer}
        </div>
      ) : !shareable ? (
        <p className="text-sm text-muted" data-testid="post-share-draft-hint">
          Il link per il cliente compare qui dopo «Invia in revisione».
        </p>
      ) : (
        <ul className="space-y-3">
          {reviewers.map((reviewer) => {
            const url = safePostUrl(reviewer, post.id);
            return (
              <li key={reviewer.id} className="inset space-y-2 p-3" data-testid="post-share-row">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-semibold">{reviewer.name}</p>
                  {!reviewer.email && <span className="chip chip-offline">Nessuna email</span>}
                </div>
                {url ? (
                  <ShareLink
                    url={url}
                    reviewerName={reviewer.name}
                    message={postLinkMessage({
                      kind: post.kind,
                      status: post.status,
                      reviewerName: reviewer.name,
                      title: post.title,
                      url,
                    })}
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
