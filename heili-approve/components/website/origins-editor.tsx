"use client";

/**
 * Allowed addresses of the site: exact origins only (no wildcards). http://
 * is accepted for localhost and for an address the agency marks as a test
 * site (decided on 16/10). Validated while typing with the same rules as the
 * server (lib/website/origins.ts).
 */

import { useState, useTransition } from "react";
import { saveOriginsAction } from "@/app/(dashboard)/posts/website-actions";
import { MAX_SITE_ORIGINS, isLocalHostname, normalizeOrigin } from "@/lib/website/origins";

interface Entry {
  origin: string;
  test: boolean;
}

function isHttpNonLocal(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

export default function OriginsEditor({
  postId,
  initial,
  suggestion,
  disabled = false,
}: {
  postId: string;
  initial: Entry[];
  /** The site's own origin when it is not registered yet. */
  suggestion: string | null;
  disabled?: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [draft, setDraft] = useState(suggestion ?? "");
  const [draftTest, setDraftTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: Entry[]) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveOriginsAction(postId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEntries(result.data.origins);
      setNotice(result.message ?? "Salvato.");
    });
  }

  function add() {
    const result = normalizeOrigin(draft, { testOrigin: draftTest });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (entries.some((e) => e.origin === result.origin)) {
      setError("Questo indirizzo è già nell'elenco.");
      return;
    }
    setDraft("");
    setDraftTest(false);
    save([...entries, { origin: result.origin, test: draftTest }]);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Lo script funziona solo sugli indirizzi di questo elenco. Scrivili esatti, come https://prova.cliente.it (niente asterischi).
      </p>
      <ul className="space-y-2" data-testid="site-origins">
        {entries.map((entry) => (
          <li key={entry.origin} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm">
            <span className="break-all font-mono text-xs">{entry.origin}</span>
            <span className="flex items-center gap-2">
              {entry.test && <span className="text-xs text-warning">sito di prova</span>}
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={disabled || pending}
                onClick={() => save(entries.filter((e) => e.origin !== entry.origin))}
              >
                Togli
              </button>
            </span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-sm text-muted">Nessun indirizzo ancora: scrivi qui sotto quello del sito di prova e premi «Aggiungi».</li>
        )}
      </ul>
      {entries.length < MAX_SITE_ORIGINS && (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              inputMode="url"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="https://prova.cliente.it"
              aria-label="Nuovo indirizzo consentito"
              disabled={disabled || pending}
              className="w-full rounded border border-border bg-background px-3 py-2 text-base sm:text-sm"
              data-testid="site-origin-input"
            />
            <button type="button" className="btn" onClick={add} disabled={disabled || pending || !draft.trim()} data-testid="site-origin-add">
              Aggiungi
            </button>
          </div>
          {!draft.trim() && <p className="text-xs text-muted">«Aggiungi» si attiva quando scrivi un indirizzo.</p>}
          {isHttpNonLocal(draft) && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-accent" checked={draftTest} onChange={(e) => setDraftTest(e.target.checked)} />
              È un sito di prova senza https (sconsigliato in produzione)
            </label>
          )}
        </div>
      )}
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-success" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
