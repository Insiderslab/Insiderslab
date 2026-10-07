"use client";

/**
 * Client Links Panel
 *
 * "Link per il cliente" at the top of the client page: one ready-to-send
 * personal link per active reviewer (copy, WhatsApp, share sheet, preview,
 * QR). With no active reviewer it asks "Chi approva per …?" (name, optional
 * email) and shows the new link right away.
 *
 * Rendered only for signed-in agency members of the client's workspace, and
 * never for archived clients (their links do not work).
 */

import { useState, useTransition } from "react";
import { addReviewerAction } from "@/app/(dashboard)/clients/actions";
import { clientLinkMessage } from "./messages";
import ShareLink from "./share-link";

export interface ClientLinkRow {
  id: string;
  name: string;
  email: string | null;
  /** Decrypted on the server; null when it could not be (use "Nuovo link"). */
  reviewUrl: string | null;
  /** Pre-formatted on the server, e.g. "5 ott 2026, 14:20". */
  lastSeenLabel: string | null;
}

interface ClientLinksPanelProps {
  clientId: string;
  clientName: string;
  reviewers: ClientLinkRow[];
  /** "i post", "gli articoli", "le creatività", "i contenuti". */
  contentsThe: string;
}

export default function ClientLinksPanel({ clientId, clientName, reviewers, contentsThe }: ClientLinksPanelProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string; email: string | null; url: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const message = (reviewerName: string, url: string) =>
    clientLinkMessage({ reviewerName, clientName, url, contentsThe });

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const typedEmail = email.trim() || null;
        const result = await addReviewerAction(clientId, { name, email: typedEmail, sendInvite: false });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setCreated({
          id: result.data.reviewerId,
          name: result.data.reviewerName,
          email: typedEmail,
          url: result.data.reviewUrl,
        });
        setName("");
        setEmail("");
      } catch {
        setError("Si è verificato un errore imprevisto. Riprova tra poco.");
      }
    });
  }

  // After "Crea link" the page refreshes with the new reviewer in `reviewers`:
  // keep showing the link just created until then, without duplicating it.
  const rows: ClientLinkRow[] =
    created && !reviewers.some((r) => r.id === created.id)
      ? [...reviewers, { id: created.id, name: created.name, email: created.email, reviewUrl: created.url, lastSeenLabel: null }]
      : reviewers;

  return (
    <section className="panel p-4 sm:p-6" aria-labelledby="client-links" data-testid="client-links-panel">
      <div className="mb-4 space-y-1">
        <h3 id="client-links" className="text-lg font-semibold">
          Link per il cliente
        </h3>
        <p className="text-sm text-muted">
          {rows.length > 0
            ? `Manda il link a chi approva: apre ${contentsThe} da rivedere, senza password. Il link è personale, come una chiave.`
            : `Crea il link personale di chi approva ${contentsThe}: lo mandi tu su WhatsApp, per messaggio o via email.`}
        </p>
      </div>

      {created && (
        <p role="status" className="mb-3 text-sm text-success">
          Link creato per {created.name}: copialo o mandalo su WhatsApp.
        </p>
      )}

      {rows.length > 0 ? (
        <ul className="space-y-3">
          {rows.map((reviewer) => (
            <li key={reviewer.id} className="inset space-y-3 p-3 sm:p-4" data-testid="client-link-row">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="truncate font-semibold">{reviewer.name}</p>
                  {reviewer.email ? (
                    <p className="truncate text-sm text-muted">{reviewer.email}</p>
                  ) : (
                    <span className="chip chip-offline">Nessuna email</span>
                  )}
                </div>
                <p className="text-xs text-muted sm:text-right">
                  {reviewer.lastSeenLabel ? (
                    <>
                      Ultimo accesso: <span className="tabular">{reviewer.lastSeenLabel}</span>
                    </>
                  ) : (
                    "Non ha ancora aperto il link"
                  )}
                </p>
              </div>
              {reviewer.reviewUrl ? (
                <ShareLink
                  url={reviewer.reviewUrl}
                  message={message(reviewer.name, reviewer.reviewUrl)}
                  reviewerName={reviewer.name}
                />
              ) : (
                <p className="text-sm text-warning">
                  Link non leggibile: crea un nuovo link per {reviewer.name} nella sezione Referenti qui sotto.
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <form onSubmit={handleCreate} className="inset space-y-4 p-4" data-testid="quick-reviewer-form">
          <p className="font-semibold">Chi approva per {clientName}?</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Nome</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Chiara Fabbri"
                maxLength={120}
                required
                autoComplete="off"
                className="field"
                data-testid="quick-reviewer-name"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">
                Email <span className="font-normal text-muted">(facoltativa)</span>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@cliente.it"
                autoCapitalize="none"
                autoComplete="off"
                className="field"
                aria-describedby="quick-reviewer-email-hint"
                data-testid="quick-reviewer-email"
              />
              <span id="quick-reviewer-email-hint" className="block text-xs text-muted">
                Facoltativa: serve solo per le notifiche via email.
              </span>
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto" data-testid="quick-reviewer-submit">
            {pending ? "Creazione…" : "Crea link"}
          </button>
        </form>
      )}

      {rows.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Altre persone, email e nuovi link:{" "}
          <a href="#referenti" className="text-accent hover:underline">
            Referenti
          </a>
          .
        </p>
      )}
    </section>
  );
}
