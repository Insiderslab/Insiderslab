"use client";

/**
 * «Sul sito» on the agency's post page: the line of code, the allowed
 * addresses, «Verifica installazione», the waiver for protected sites, and
 * revoke / new key. After «Segna come pubblicato» the key is revoked and the
 * panel reminds to remove the line from the site.
 */

import { useState, useTransition } from "react";
import { renewSiteKeyAction, revokeSiteAction, verifySiteAction, waiveVerificationAction } from "@/app/(dashboard)/posts/website-actions";
import type { AgencySiteView } from "@/lib/website/service";
import InstallSnippet from "./install-snippet";
import OriginsEditor from "./origins-editor";

export default function SitePanel({
  postId,
  site: initial,
  delivered,
  timezone,
}: {
  postId: string;
  site: AgencySiteView;
  delivered: boolean;
  /** The client's time zone (same text on server and browser). */
  timezone: string;
}) {
  const when = (value: Date | string | null): string =>
    value
      ? new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(
          new Date(value)
        )
      : "";
  const [site, setSite] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true; data: AgencySiteView } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else setSite(result.data);
    });
  }

  const verified = Boolean(site.verifiedAt);
  const revoked = Boolean(site.revokedAt);

  return (
    <section className="panel space-y-4 rounded p-4" aria-labelledby="site-panel-title" data-testid="site-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="site-panel-title" className="text-base font-semibold">
          Sul sito
        </h3>
        <span
          className={`text-sm font-medium ${revoked ? "text-muted" : verified ? "text-success" : "text-warning"}`}
          data-testid="site-status"
        >
          {revoked
            ? "Chiave revocata"
            : verified
              ? `Script trovato sul sito · ${when(site.verifiedAt)}`
              : site.verifyWaivedAt
                ? "Da inviare senza verifica (sito protetto)"
                : "Script non ancora verificato"}
        </span>
      </div>

      {revoked ? (
        <div className="space-y-3 text-sm">
          <p className="rounded border border-warning/50 bg-surface p-3">
            {delivered
              ? "Il sito è pubblicato e la chiave è revocata: ricordati di togliere la riga di codice di Heili (o il plugin) dal sito."
              : "La chiave è revocata: lo script sul sito non fa più nulla. Toglilo, oppure crea una nuova chiave e aggiorna la riga."}
          </p>
          {!delivered && (
            <button type="button" className="btn" disabled={pending} onClick={() => run(() => renewSiteKeyAction(postId))}>
              Crea una nuova chiave
            </button>
          )}
        </div>
      ) : (
        <>
          <InstallSnippet snippet={site.snippet} siteKey={site.siteKey} />
          <OriginsEditor
            postId={postId}
            initial={site.origins}
            suggestion={site.siteOriginRegistered ? null : site.siteOrigin}
            disabled={pending}
          />
          <div className="space-y-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || !site.siteOriginRegistered}
              onClick={() => run(() => verifySiteAction(postId))}
              data-testid="site-verify"
            >
              {pending ? "Verifico…" : "Verifica installazione"}
            </button>
            {!site.siteOriginRegistered && site.siteOrigin && (
              <p className="text-xs text-warning">Aggiungi {site.siteOrigin} agli indirizzi consentiti per verificare.</p>
            )}
            {site.verifyMessage && (
              <p className={`text-sm ${verified && site.verifyMessage.startsWith("Script trovato") ? "text-success" : "text-muted"}`} data-testid="site-verify-message">
                {site.verifyMessage}
              </p>
            )}
            {!verified && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-accent"
                  checked={Boolean(site.verifyWaivedAt)}
                  disabled={pending}
                  onChange={(event) => run(() => waiveVerificationAction(postId, event.target.checked))}
                />
                Non riesco a verificare (sito protetto da password o IP): invia comunque
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted">
            {site.lastSeenAt && <span>Ultima apertura del cliente: {when(site.lastSeenAt)}</span>}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Revocare la chiave? Lo script sul sito smetterà subito di funzionare.")) run(() => revokeSiteAction(postId));
              }}
            >
              Revoca la chiave
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
