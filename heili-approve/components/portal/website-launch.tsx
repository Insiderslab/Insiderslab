"use client";

/**
 * «Apri il sito» in the client portal: opens the test site in a new tab.
 * The compact form is the «Apri» of one page in the list.
 */

import type { PortalWebsitePost } from "./types";

export default function WebsiteLaunch({
  post,
  pageUrl,
  compact = false,
}: {
  token: string;
  post: PortalWebsitePost;
  canComment: boolean;
  /** One page of the round; default the site's address. */
  pageUrl?: string;
  compact?: boolean;
}) {
  const target = pageUrl || post.content.siteUrl;
  if (!target) return null;
  if (compact) {
    return (
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-2"
      >
        Apri questa pagina
      </a>
    );
  }
  return (
    <div className="space-y-2">
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-white hover:bg-accent-hover sm:w-auto"
        data-testid="website-open"
      >
        Apri il sito
      </a>
      <p className="text-sm text-muted">
        Il sito si apre in una nuova scheda. Guardalo con calma, poi torna qui e scrivi le tue note: alla fine scegli
        «Chiedi modifiche» o «Approva».
      </p>
    </div>
  );
}
