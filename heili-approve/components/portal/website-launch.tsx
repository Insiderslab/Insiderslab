"use client";

/**
 * «Apri il sito» in the client portal. When the review key is ready it asks
 * the server for a one-time code (10 minutes) and opens the site in a new tab
 * with `#heili-review=<code>`: the site shows Heili's button, the client points
 * at elements and comments there, then comes back here to decide. Otherwise
 * (or after the decision) it is a plain link to the site.
 * The compact form is the «Apri questa pagina» of one page in the list.
 */

import { useState } from "react";
import { createWebsiteLaunchAction } from "@/app/review/[token]/website-actions";
import type { PortalWebsitePost } from "./types";

export default function WebsiteLaunch({
  token,
  post,
  canComment,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = pageUrl || post.content.siteUrl;
  if (!target) return null;
  const withHeili = post.liveReady && canComment;

  async function launch() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Opened during the tap (popup blockers), pointed at the site once the code is ready.
    const win = window.open("about:blank", "_blank");
    const result = await createWebsiteLaunchAction(token, { postId: post.id, pageUrl: pageUrl ?? null });
    setBusy(false);
    if (!result.ok) {
      win?.close();
      setError(`${result.error} Tocca «Riprova», oppure scrivi le note qui nel portale.`);
      return;
    }
    if (win) {
      win.opener = null;
      win.location.href = result.data.url;
    } else {
      window.location.href = result.data.url;
    }
  }

  const label = error ? "Riprova" : compact ? "Apri questa pagina" : "Apri il sito";
  const control = withHeili ? (
    <button
      type="button"
      onClick={launch}
      disabled={busy}
      className={
        compact
          ? "inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-2"
          : "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
      }
      data-testid={compact ? "website-open-page" : "website-open"}
    >
      {busy ? "Apro…" : label}
    </button>
  ) : (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      className={
        compact
          ? "inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-2"
          : "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-white hover:bg-accent-hover sm:w-auto"
      }
      data-testid={compact ? "website-open-page" : "website-open"}
    >
      {label}
    </a>
  );

  if (compact) {
    return (
      <span className="inline-flex flex-col items-end">
        {control}
        {error && <span className="text-xs text-error">{error}</span>}
      </span>
    );
  }
  return (
    <div className="space-y-2">
      {control}
      {withHeili ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Il sito si apre in una nuova scheda, con il pulsante di Heili in basso a destra.</li>
          <li>Tocca Heili, poi «Indica un punto» e tocca l&apos;elemento che vuoi commentare.</li>
          <li>Scrivi la nota e inviala; quando hai finito torna qui per approvare o chiedere modifiche.</li>
        </ol>
      ) : (
        <p className="text-sm text-muted">
          Il sito si apre in una nuova scheda. Guardalo con calma, poi torna qui e scrivi le tue note: alla fine scegli
          «Chiedi modifiche» o «Approva».
        </p>
      )}
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
