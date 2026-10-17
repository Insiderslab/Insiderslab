"use client";

/**
 * «Sul sito» on the agency's post page, in the order the work is done:
 * what to do next → where to put the line (per platform, 3 steps) → the
 * allowed addresses → «Verifica installazione» with its outcome in plain
 * words → the waiver for protected sites. After «Segna come pubblicato» the
 * key is revoked and the panel reminds to remove the line from the site.
 */

import { useState, useTransition } from "react";
import {
  renewSiteKeyAction,
  revokeSiteAction,
  saveOriginsAction,
  verifySiteAction,
  waiveVerificationAction,
} from "@/app/(dashboard)/posts/website-actions";
import { nextStepSentence } from "@/lib/website/install";
import { isLocalHostname } from "@/lib/website/origins";
import type { AgencySiteView } from "@/lib/website/service";
import { describeVerification } from "@/lib/website/verify-outcomes";
import InstallGuide from "./install-guide";
import OriginsEditor from "./origins-editor";
import VerifyResult from "./verify-result";

type Outcome = { ok: true; data: AgencySiteView } | { ok: false; error: string };

function isHttpNonLocal(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

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
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pending, startTransition] = useTransition();
  /** The last action that failed, for «Riprova». */
  const [failed, setFailed] = useState<(() => Promise<Outcome>) | null>(null);

  function run(action: () => Promise<Outcome>) {
    setError(null);
    setFailed(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        setFailed(() => action);
      } else setSite(result.data);
    });
  }

  const verified = Boolean(site.verifiedAt);
  const revoked = Boolean(site.revokedAt);
  const outcome = describeVerification(site.verifyMessage);
  // Found once, but the last check does not find it any more.
  const lostSince = verified && outcome !== null && outcome.group !== "found";
  const needsOrigin = !site.siteOriginRegistered && Boolean(site.siteOrigin);

  const status = revoked
    ? { text: "Chiave revocata", tone: "text-muted" }
    : lostSince
      ? { text: `Non più trovato · era stato trovato il ${when(site.verifiedAt)}`, tone: "text-warning" }
      : verified
        ? { text: `Script trovato sul sito · ${when(site.verifiedAt)}`, tone: "text-success" }
        : site.verifyWaivedAt
          ? { text: "Da inviare senza verifica (sito protetto)", tone: "text-warning" }
          : { text: "Script non ancora verificato", tone: "text-warning" };

  return (
    <section className="panel space-y-4 rounded p-4" aria-labelledby="site-panel-title" data-testid="site-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="site-panel-title" className="text-base font-semibold">
          Sul sito
        </h3>
        <span className={`text-sm font-medium ${status.tone}`} data-testid="site-status">
          {status.text}
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
          <p className="text-sm" data-testid="site-next-step">
            {nextStepSentence({ revoked, verified: verified && !lostSince, waived: Boolean(site.verifyWaivedAt), originRegistered: !needsOrigin })}
          </p>

          {needsOrigin && (
            <div className="space-y-2 rounded border border-warning/50 bg-surface p-3 text-sm" data-testid="site-origin-callout">
              <p>
                Prima di tutto consenti l&apos;indirizzo del sito: lo script funziona solo sugli indirizzi consentiti, e senza non si può
                verificare.
              </p>
              <button
                type="button"
                className="btn btn-sm btn-primary break-all"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    saveOriginsAction(postId, [...site.origins, { origin: site.siteOrigin as string, test: isHttpNonLocal(site.siteOrigin) }])
                  )
                }
                data-testid="site-origin-allow"
              >
                Consenti {site.siteOrigin}
              </button>
              {isHttpNonLocal(site.siteOrigin) && (
                <p className="text-xs text-muted">Il sito non usa https: lo segno come «sito di prova». Va bene solo per la versione di prova.</p>
              )}
            </div>
          )}

          <InstallGuide snippet={site.snippet} siteKey={site.siteKey} />

          <details className="rounded border border-border p-3" open={!site.siteOriginRegistered || site.origins.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">Indirizzi consentiti ({site.origins.length})</summary>
            <div className="mt-3">
              <OriginsEditor
                postId={postId}
                initial={site.origins}
                suggestion={site.siteOriginRegistered ? null : site.siteOrigin}
                disabled={pending}
              />
            </div>
          </details>

          <div className="space-y-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || !site.siteOriginRegistered}
              aria-describedby={!site.siteOriginRegistered ? "site-verify-why" : undefined}
              onClick={() => run(() => verifySiteAction(postId))}
              data-testid="site-verify"
            >
              {pending ? "Verifico…" : "Verifica installazione"}
            </button>
            {!site.siteOriginRegistered && (
              <p id="site-verify-why" className="text-xs text-warning">
                {site.siteOrigin
                  ? `Per verificare, consenti prima ${site.siteOrigin} (vedi sopra).`
                  : "Per verificare, salva prima l'indirizzo del sito di prova in Modifica."}
              </p>
            )}
            <VerifyResult
              message={site.verifyMessage}
              pending={pending}
              onRetry={() => run(() => verifySiteAction(postId))}
            />
            {(!verified || lostSince) && (
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

          <div className="space-y-2 border-t border-border pt-3 text-sm">
            {site.lastSeenAt && <p className="text-xs text-muted">Ultima apertura del cliente: {when(site.lastSeenAt)}</p>}
            {confirmRevoke ? (
              <div className="space-y-2 rounded border border-warning/50 bg-surface p-3" role="alertdialog" aria-label="Revocare la chiave?">
                <p>Revocare la chiave? Lo script sul sito smetterà subito di funzionare e il cliente non potrà più aprire il sito con Heili.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={pending}
                    onClick={() => {
                      setConfirmRevoke(false);
                      run(() => revokeSiteAction(postId));
                    }}
                    data-testid="site-revoke-confirm"
                  >
                    Sì, revoca la chiave
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmRevoke(false)}>
                    No, lasciala com&apos;è
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-quiet btn-sm" disabled={pending} onClick={() => setConfirmRevoke(true)} data-testid="site-revoke">
                Revoca la chiave
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-error">{error}</p>
          {failed && (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(failed)} data-testid="site-retry">
              Riprova
            </button>
          )}
        </div>
      )}
    </section>
  );
}
