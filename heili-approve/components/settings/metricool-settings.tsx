"use client";

/**
 * Metricool Settings
 *
 * Guided connection of the agency's Metricool account: three short steps, the
 * API token and the user ID (both on the same Metricool page), and one button
 * that tests them with a real call and saves only if it works. Afterwards the
 * page shows how many brands were found, a few logos and the way on: import
 * the clients. The stored token never comes back to the browser: the page
 * only receives the connection date and the token's last 4 characters.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  disconnectMetricoolAction,
  saveMetricoolCredentialsAction,
  testMetricoolConnectionAction,
  type MetricoolConnectionData,
} from "@/app/(dashboard)/settings/actions";
import { BrandLogo } from "@/components/clients/brand-parts";
import { normalizeMetricoolUserId } from "@/components/settings/helpers";

export interface MetricoolSettingsProps {
  connected: boolean;
  userId: string | null;
  /** Pre-formatted, e.g. "5 ottobre 2026". */
  connectedAtLabel: string | null;
  /** Last 4 characters of the stored token; null if unreadable. */
  tokenTail: string | null;
  tokenUnreadable: boolean;
  canManage: boolean;
  fakeMode: boolean;
}

type Feedback = { tone: "success" | "error"; text: string } | null;

const METRICOOL_URL = "https://app.metricool.com/";

const STEPS: Array<{ title: string; text: React.ReactNode }> = [
  {
    title: "Apri Metricool",
    text: (
      <>
        Accedi con l&apos;account dell&apos;agenzia su{" "}
        <a href={METRICOOL_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          app.metricool.com
        </a>
        .
      </>
    ),
  },
  {
    title: "Vai su Impostazioni dell'account → API",
    text: "L'accesso alle API è incluso solo in alcuni piani Metricool: se non vedi la pagina, controlla il piano.",
  },
  {
    title: "Copia il token e l'ID utente",
    text: "Si trovano nella stessa pagina: incollali qui sotto.",
  },
];

export default function MetricoolSettings({
  connected,
  userId,
  connectedAtLabel,
  tokenTail,
  tokenUnreadable,
  canManage,
  fakeMode,
}: MetricoolSettingsProps) {
  const [editing, setEditing] = useState(!connected);
  const [formUserId, setFormUserId] = useState(userId ?? "");
  const [token, setToken] = useState("");
  const [userIdTouched, setUserIdTouched] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  // Brands found by the last successful connection or test.
  const [found, setFound] = useState<MetricoolConnectionData | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "disconnect" | null>(null);
  const [, startTransition] = useTransition();

  const normalizedUserId = normalizeMetricoolUserId(formUserId);
  const userIdInvalid = normalizedUserId !== "" && !/^\d+$/.test(normalizedUserId);
  const showUserIdError = userIdInvalid && (userIdTouched || formUserId.length > 3);

  function run(kind: "save" | "test" | "disconnect", fn: () => Promise<void>) {
    setBusy(kind);
    setFeedback(null);
    startTransition(async () => {
      try {
        await fn();
      } catch {
        setFeedback({ tone: "error", text: "Si è verificato un errore imprevisto. Riprova tra poco." });
      } finally {
        setBusy(null);
      }
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserIdTouched(true);
    if (userIdInvalid || !normalizedUserId) return;
    run("save", async () => {
      const result = await saveMetricoolCredentialsAction({ userId: formUserId, token });
      if (!result.ok) {
        setFeedback({ tone: "error", text: result.error });
        return;
      }
      setToken("");
      setEditing(false);
      setFound(result.data);
      setFormUserId(normalizedUserId);
      setFeedback({ tone: "success", text: result.message ?? "Collegato." });
    });
  }

  function test() {
    run("test", async () => {
      const result = await testMetricoolConnectionAction();
      if (!result.ok) {
        setFound(null);
        setFeedback({ tone: "error", text: result.error });
        return;
      }
      setFound(result.data);
      setFeedback({ tone: "success", text: result.message ?? "Connessione riuscita." });
    });
  }

  function disconnect() {
    if (
      !confirm(
        "Scollegare Metricool? I post approvati non verranno programmati finché non lo ricolleghi."
      )
    ) {
      return;
    }
    run("disconnect", async () => {
      const result = await disconnectMetricoolAction();
      if (!result.ok) {
        setFeedback({ tone: "error", text: result.error });
        return;
      }
      setEditing(true);
      setFound(null);
      setFormUserId("");
      setFeedback({ tone: "success", text: result.message ?? "Metricool scollegato." });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Stato</p>
          <p className="mt-0.5 text-xs text-muted">
            {connected
              ? `Collegato il ${connectedAtLabel ?? "—"} · ID utente ${userId ?? "—"}${
                  tokenTail ? ` · token ••••${tokenTail}` : ""
                }`
              : "Collega l'account per programmare i post approvati e importare i clienti."}
          </p>
          {tokenUnreadable && (
            <p className="mt-1 text-xs text-error">
              Il token salvato non è leggibile (chiave di cifratura cambiata?): inseriscilo di nuovo.
            </p>
          )}
        </div>
        <span className={`chip shrink-0 ${connected ? "chip-fresh" : "chip-stale"}`}>
          {connected ? "Collegato" : "Non collegato"}
        </span>
      </div>

      {fakeMode && (
        <p className="text-xs text-muted">
          Modalità di prova attiva (METRICOOL_FAKE=1): nessuna chiamata reale a Metricool, brand e post finti.
        </p>
      )}

      {feedback && !(feedback.tone === "success" && found && found.brandCount > 0) && (
        <p role="status" className={`text-sm ${feedback.tone === "error" ? "text-error" : "text-success"}`}>
          {feedback.text}
        </p>
      )}

      {found && (
        <div className="inset space-y-3 p-4" data-testid="metricool-found">
          <p className="text-sm font-medium text-foreground">
            Collegato: {found.brandCount === 1 ? "1 brand trovato" : `${found.brandCount} brand trovati`}
          </p>
          {found.preview.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Primi brand trovati">
              {found.preview.map((brand) => (
                <li key={brand.label} title={brand.label}>
                  <BrandLogo src={brand.imageUrl} label={brand.label} className="h-10 w-10" />
                </li>
              ))}
              {found.brandCount > found.preview.length && (
                <li className="flex h-10 items-center px-1 text-xs text-muted">
                  +{found.brandCount - found.preview.length}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {connected && !editing && (
        <div className="space-y-3">
          {canManage && (
            <div>
              <Link href="/clients/import" className="btn btn-primary w-full sm:w-auto">
                Importa i clienti da Metricool
              </Link>
              <p className="mt-1.5 text-xs text-muted">
                Ogni brand diventa un cliente: scegli tu quali creare e quali collegare a clienti che hai già.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={test} disabled={busy !== null} className="btn">
              {busy === "test" ? "Verifica…" : "Prova connessione"}
            </button>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    setFeedback(null);
                    setFound(null);
                  }}
                  disabled={busy !== null}
                  className="btn"
                >
                  Sostituisci credenziali
                </button>
                <button type="button" onClick={disconnect} disabled={busy !== null} className="btn btn-danger">
                  {busy === "disconnect" ? "Scollegamento…" : "Scollega"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {editing && canManage && (
        <div className="space-y-4">
          <ol className="inset space-y-3 p-4 text-sm" aria-label="Come collegare Metricool">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{step.title}</span>
                  <span className="mt-0.5 block text-muted">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="metricool-token" className="block text-sm font-medium">
                  Token API
                </label>
                <input
                  id="metricool-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={connected ? "Nuovo token" : "Incolla il token"}
                  required
                  className="field"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="metricool-user" className="block text-sm font-medium">
                  ID utente
                </label>
                <input
                  id="metricool-user"
                  value={formUserId}
                  onChange={(e) => setFormUserId(e.target.value)}
                  onBlur={() => setUserIdTouched(true)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Es. 1234567"
                  required
                  aria-invalid={showUserIdError}
                  aria-describedby={showUserIdError ? "metricool-user-error" : undefined}
                  className="field"
                  style={showUserIdError ? { borderColor: "var(--color-error)" } : undefined}
                />
                {showUserIdError && (
                  <p id="metricool-user-error" className="text-xs text-error">
                    L&apos;ID utente è un numero, per esempio 1234567.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy !== null || !token.trim() || !formUserId.trim()}
                className="btn btn-primary w-full sm:w-auto"
              >
                {busy === "save" ? "Verifica in corso…" : "Collega e verifica"}
              </button>
              {connected && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setToken("");
                    setFormUserId(userId ?? "");
                    setUserIdTouched(false);
                  }}
                  className="btn btn-quiet"
                >
                  Annulla
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              Il token viene salvato cifrato e non viene mai mostrato di nuovo: qui vedrai solo le ultime 4 cifre.
              Se non funziona, non salviamo nulla.
            </p>
          </form>
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-muted">Solo titolari e amministratori possono modificare la connessione.</p>
      )}
    </div>
  );
}
