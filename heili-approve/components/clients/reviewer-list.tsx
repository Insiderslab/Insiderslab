"use client";

/**
 * Reviewer List
 *
 * The people on the client side who approve posts, each with a personal
 * link (/review/<token>, no password). Add, copy link, re-send by email,
 * generate a new link (the old one stops working), deactivate, reactivate.
 */

import { useState, useTransition } from "react";
import {
  addReviewerAction,
  deactivateReviewerAction,
  reactivateReviewerAction,
  resendReviewerLinkAction,
  rotateReviewerLinkAction,
} from "@/app/(dashboard)/clients/actions";
import CopyButton from "@/components/clients/copy-button";

export interface ReviewerRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  /** Only for active reviewers; decrypted on the server. */
  reviewUrl: string | null;
  /** Pre-formatted on the server, e.g. "5 ott 2026, 14:20". */
  lastSeenLabel: string | null;
  createdLabel: string;
}

interface ReviewerListProps {
  clientId: string;
  clientName: string;
  reviewers: ReviewerRow[];
  /** Archived clients: links don't work, nothing can be changed. */
  archived: boolean;
  /** What the reviewers approve, with the article: "i post" (default), "gli articoli", "le creatività". */
  contentsThe?: string;
}

type Feedback = { tone: "success" | "error"; text: string; link?: string } | null;

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40";

const smallButton =
  "rounded border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50";

export default function ReviewerList({
  clientId,
  clientName,
  reviewers,
  archived,
  contentsThe = "i post",
}: ReviewerListProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotateSendEmail, setRotateSendEmail] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [, startTransition] = useTransition();

  const active = reviewers.filter((r) => r.active);
  const inactive = reviewers.filter((r) => !r.active);

  /** Runs a server action, tracking which button is busy. */
  function run(key: string, fn: () => Promise<Feedback | void>) {
    setBusy(key);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result) setFeedback(result);
      } catch {
        setFeedback({ tone: "error", text: "Si è verificato un errore imprevisto. Riprova tra poco." });
      } finally {
        setBusy(null);
      }
    });
  }

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run("add", async () => {
      const result = await addReviewerAction(clientId, { name, email, sendInvite });
      if (!result.ok) return { tone: "error", text: result.error };
      setName("");
      setEmail("");
      return {
        tone: result.data.emailSent === false ? "error" : "success",
        text: result.message ?? "Referente aggiunto.",
        link: result.data.reviewUrl,
      };
    });
  }

  function handleRotate(reviewer: ReviewerRow) {
    run(`rotate:${reviewer.id}`, async () => {
      const result = await rotateReviewerLinkAction(reviewer.id, { sendEmail: rotateSendEmail });
      setRotating(null);
      if (!result.ok) return { tone: "error", text: result.error };
      return {
        tone: result.data.emailSent === false ? "error" : "success",
        text: `${reviewer.name}: ${result.message ?? "nuovo link creato."}`,
        link: result.data.reviewUrl,
      };
    });
  }

  function handleDeactivate(reviewer: ReviewerRow) {
    if (
      !confirm(
        `Disattivare ${reviewer.name}? Il suo link smetterà di funzionare e non riceverà più email.`
      )
    ) {
      return;
    }
    run(`deactivate:${reviewer.id}`, async () => {
      const result = await deactivateReviewerAction(reviewer.id);
      return result.ok
        ? { tone: "success", text: result.message ?? "Referente disattivato." }
        : { tone: "error", text: result.error };
    });
  }

  function handleResend(reviewer: ReviewerRow) {
    run(`resend:${reviewer.id}`, async () => {
      const result = await resendReviewerLinkAction(reviewer.id);
      return result.ok
        ? { tone: "success", text: `${reviewer.name}: ${result.message ?? "link inviato."}` }
        : { tone: "error", text: result.error };
    });
  }

  function handleReactivate(reviewer: ReviewerRow) {
    run(`reactivate:${reviewer.id}`, async () => {
      const result = await reactivateReviewerAction(clientId, { name: reviewer.name, email: reviewer.email });
      if (!result.ok) return { tone: "error", text: result.error };
      return {
        tone: "success",
        text: `${reviewer.name} è di nuovo attivo con un link nuovo (quello vecchio resta disattivato).`,
        link: result.data.reviewUrl,
      };
    });
  }

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          role="status"
          className={`rounded border p-3 text-sm ${
            feedback.tone === "error" ? "border-error/30 text-error" : "border-success/30 text-success"
          }`}
        >
          <p>{feedback.text}</p>
          {feedback.link && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={feedback.link}
                aria-label="Link personale"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
              />
              <CopyButton value={feedback.link} />
            </div>
          )}
        </div>
      )}

      {active.length === 0 && (
        <p className="text-sm text-muted">
          Nessun referente attivo: aggiungi almeno una persona di {clientName} per poter inviare {contentsThe} in
          revisione.
        </p>
      )}

      {active.length > 0 && (
        <ul className="divide-y divide-border rounded border border-border bg-background">
          {active.map((reviewer) => (
            <li key={reviewer.id} className="space-y-3 p-3 sm:p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{reviewer.name}</p>
                  <p className="truncate text-xs text-muted">{reviewer.email}</p>
                </div>
                <p className="text-xs text-muted sm:text-right">
                  {reviewer.lastSeenLabel
                    ? `Ultimo accesso: ${reviewer.lastSeenLabel}`
                    : "Non ha ancora aperto il link"}
                </p>
              </div>

              {!archived && (
                <div className="flex flex-wrap gap-2">
                  {reviewer.reviewUrl && <CopyButton value={reviewer.reviewUrl} />}
                  <button
                    type="button"
                    onClick={() => handleResend(reviewer)}
                    disabled={busy !== null}
                    className={smallButton}
                  >
                    {busy === `resend:${reviewer.id}` ? "Invio…" : "Reinvia via email"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRotating(rotating === reviewer.id ? null : reviewer.id);
                      setRotateSendEmail(true);
                    }}
                    disabled={busy !== null}
                    className={smallButton}
                  >
                    Nuovo link
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeactivate(reviewer)}
                    disabled={busy !== null}
                    className="rounded border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                  >
                    {busy === `deactivate:${reviewer.id}` ? "Disattivazione…" : "Disattiva"}
                  </button>
                </div>
              )}

              {rotating === reviewer.id && (
                <div className="space-y-3 rounded border border-warning/30 p-3">
                  <p className="text-sm text-warning">
                    Il link attuale di {reviewer.name} smetterà di funzionare subito. Usalo se il link è
                    stato inoltrato a qualcuno che non dovrebbe averlo.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rotateSendEmail}
                      onChange={(e) => setRotateSendEmail(e.target.checked)}
                      className="accent-accent"
                    />
                    Invia il nuovo link via email a {reviewer.email}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleRotate(reviewer)}
                      disabled={busy !== null}
                      className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busy === `rotate:${reviewer.id}` ? "Creazione…" : "Crea nuovo link"}
                    </button>
                    <button type="button" onClick={() => setRotating(null)} className={smallButton}>
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {inactive.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="text-xs text-muted hover:text-foreground"
            aria-expanded={showInactive}
          >
            {showInactive ? "Nascondi" : "Mostra"} referenti disattivati ({inactive.length})
          </button>
          {showInactive && (
            <ul className="mt-2 divide-y divide-border rounded border border-border">
              {inactive.map((reviewer) => (
                <li
                  key={reviewer.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-muted">
                      {reviewer.name} · {reviewer.email}
                    </p>
                    <p className="text-xs text-muted">
                      Disattivato
                      {reviewer.lastSeenLabel ? ` · ultimo accesso ${reviewer.lastSeenLabel}` : ""}
                    </p>
                  </div>
                  {!archived && (
                    <button
                      type="button"
                      onClick={() => handleReactivate(reviewer)}
                      disabled={busy !== null}
                      className={smallButton}
                    >
                      {busy === `reactivate:${reviewer.id}` ? "Riattivazione…" : "Riattiva con nuovo link"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!archived && (
        <form onSubmit={handleAdd} className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium">Aggiungi referente</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome e cognome"
              aria-label="Nome del referente"
              maxLength={120}
              required
              className={inputClass}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@cliente.it"
              aria-label="Email del referente"
              autoCapitalize="none"
              required
              className={inputClass}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
              className="accent-accent"
            />
            Invia subito il link personale via email
          </label>
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "add" ? "Aggiunta…" : "Aggiungi referente"}
          </button>
          <p className="text-xs text-muted">
            Il referente apre {contentsThe} da un link personale, senza password. Il link è come una chiave:
            se finisce nelle mani sbagliate, crea un nuovo link.
          </p>
        </form>
      )}
    </div>
  );
}
