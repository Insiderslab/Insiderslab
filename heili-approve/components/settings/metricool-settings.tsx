"use client";

/**
 * Metricool Settings
 *
 * Connect the agency's Metricool account (userId + API token), test it,
 * replace or remove it. The stored token never comes back to the browser:
 * the page only receives the connection date and the token's last 4 chars.
 */

import { useState, useTransition } from "react";
import {
  disconnectMetricoolAction,
  saveMetricoolCredentialsAction,
  testMetricoolConnectionAction,
} from "@/app/(dashboard)/settings/actions";

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

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40";

const secondaryButton =
  "rounded border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50";

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
  const [feedback, setFeedback] = useState<Feedback>(null);
  // Set when the test failed: offers "Salva comunque".
  const [canForce, setCanForce] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "disconnect" | null>(null);
  const [, startTransition] = useTransition();

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

  function save(force: boolean) {
    run("save", async () => {
      const result = await saveMetricoolCredentialsAction({ userId: formUserId, token, force });
      if (!result.ok) {
        setFeedback({ tone: "error", text: result.error });
        setCanForce(!force && result.canForce === true);
        return;
      }
      setToken("");
      setCanForce(false);
      setEditing(false);
      setFeedback({ tone: result.data.testFailed ? "error" : "success", text: result.message ?? "Salvato." });
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save(false);
  }

  function test() {
    run("test", async () => {
      const result = await testMetricoolConnectionAction();
      setFeedback(
        result.ok
          ? { tone: "success", text: result.message ?? "Connessione riuscita." }
          : { tone: "error", text: result.error }
      );
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
      setFormUserId("");
      setFeedback({ tone: "success", text: result.message ?? "Metricool scollegato." });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-border py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Stato</p>
          <p className="mt-0.5 text-xs text-muted">
            {connected
              ? `Collegato il ${connectedAtLabel ?? "—"} · userId ${userId ?? "—"}${
                  tokenTail ? ` · token ••••${tokenTail}` : ""
                }`
              : "I post approvati vengono programmati su Metricool con queste credenziali."}
          </p>
          {tokenUnreadable && (
            <p className="mt-1 text-xs text-error">
              Il token salvato non è leggibile (chiave di cifratura cambiata?): inseriscilo di nuovo.
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
            connected ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
          }`}
        >
          {connected ? "Collegato" : "Non collegato"}
        </span>
      </div>

      {fakeMode && (
        <p className="text-xs text-muted">
          Modalità di prova attiva (METRICOOL_FAKE=1): nessuna chiamata reale a Metricool, brand e post finti.
        </p>
      )}

      {feedback && (
        <p role="status" className={`text-sm ${feedback.tone === "error" ? "text-error" : "text-success"}`}>
          {feedback.text}
        </p>
      )}

      {connected && !editing && (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={test} disabled={busy !== null} className={secondaryButton}>
            {busy === "test" ? "Verifica…" : "Prova connessione"}
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setFeedback(null);
                }}
                disabled={busy !== null}
                className={secondaryButton}
              >
                Sostituisci credenziali
              </button>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy !== null}
                className="rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-colors hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
              >
                {busy === "disconnect" ? "Scollegamento…" : "Scollega"}
              </button>
            </>
          )}
        </div>
      )}

      {editing && canManage && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="metricool-user" className="block text-sm font-medium">
                userId
              </label>
              <input
                id="metricool-user"
                value={formUserId}
                onChange={(e) => {
                  setFormUserId(e.target.value);
                  setCanForce(false);
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Es. 1234567"
                required
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="metricool-token" className="block text-sm font-medium">
                Token API
              </label>
              <input
                id="metricool-token"
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setCanForce(false);
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder={connected ? "Nuovo token" : "Incolla il token"}
                required
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "save" ? "Verifica e salvataggio…" : "Verifica e collega"}
            </button>
            {canForce && (
              <button type="button" onClick={() => save(true)} disabled={busy !== null} className={secondaryButton}>
                Salva comunque
              </button>
            )}
            {connected && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setToken("");
                  setCanForce(false);
                  setFormUserId(userId ?? "");
                }}
                className={secondaryButton}
              >
                Annulla
              </button>
            )}
          </div>
        </form>
      )}

      {!canManage && (
        <p className="text-xs text-muted">Solo titolari e amministratori possono modificare la connessione.</p>
      )}

      <details className="rounded border border-border bg-background p-3 text-sm">
        <summary className="cursor-pointer font-medium">Dove trovo userId e token?</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted">
          <li>
            Accedi a Metricool e apri <strong className="text-foreground">Impostazioni account → API</strong>:
            lì trovi il token API (se non c&apos;è, generalo).
          </li>
          <li>
            Lo <strong className="text-foreground">userId</strong> è il numero che compare nell&apos;indirizzo
            della pagina quando apri un brand, dopo <code className="font-mono text-xs">userId=</code>. Puoi
            anche incollare l&apos;indirizzo intero: teniamo solo il numero.
          </li>
          <li>
            L&apos;accesso alle API è incluso solo nei piani Metricool che lo prevedono: se il token non
            compare, controlla il piano dell&apos;account.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted">
          Il token viene salvato cifrato e non viene mai mostrato di nuovo: qui vedi solo le ultime 4 cifre.
        </p>
      </details>
    </div>
  );
}
