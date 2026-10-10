"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAutomationToken, revokeAutomationToken } from "@/app/(dashboard)/settings/automation-actions";

export default function AutomationSettings({ tokens }: {
  tokens: Array<{ id: string; name: string; expiresAt: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true); setError(null); setSecret(null);
    try {
      const result = await createAutomationToken({ name, days: 30 });
      if (!result.ok) { setError(result.error); return; }
      setSecret(result.token); setName(""); router.refresh();
    } catch { setError("Creazione non riuscita. Controlla la connessione e riprova."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setError(null); setSecret(null);
    try {
      const result = await revokeAutomationToken(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } catch { setError("Revoca non riuscita. Controlla la connessione e riprova."); }
    finally { setBusy(false); }
  }

  return <section className="panel space-y-4 rounded p-4 sm:p-6">
    <div>
      <h2 className="text-base font-semibold">Importa con Codex o Claude</h2>
      <p className="mt-2 text-sm text-muted">Prepara i post da Excel o CSV e carica i media con una chiave personale. I post vengono creati in bozza e restano da inviare al cliente.</p>
      <p className="mt-2 text-sm text-muted">La chiave consente di leggere i contenuti di questo workspace. Scade dopo 30 giorni e puoi revocarla in qualsiasi momento.</p>
    </div>
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); void create(); }}>
      <label className="flex-1 text-sm">Nome della chiave
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} required placeholder="Es. Importazione piano ottobre" className="field mt-1 w-full" style={{ fontSize: 16 }} />
      </label>
      <button type="submit" disabled={busy || !name.trim()} className="btn btn-primary self-end" style={{ minHeight: 44 }}>{busy ? "Un attimo…" : "Crea chiave"}</button>
    </form>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {secret && <div className="inset space-y-2 p-3" role="status">
      <p className="text-sm font-semibold">Copia la chiave: viene mostrata solo ora.</p>
      <textarea aria-label="Chiave automazione appena creata" readOnly value={secret} rows={3} className="field w-full break-all" style={{ fontSize: 16 }} onFocus={e => e.currentTarget.select()} />
      <p className="text-sm text-muted">Salvala nella configurazione locale dell&apos;assistente. Non inserirla nel foglio Excel o nei post.</p>
    </div>}
    {tokens.length > 0 ? <ul className="divide-y divide-border">
      {tokens.map(token => <li key={token.id} className="flex items-center justify-between gap-3 py-3">
        <div className="min-w-0"><p className="break-words font-medium">{token.name}</p><p className="text-sm text-muted">Scade il {new Date(token.expiresAt).toLocaleDateString("it-IT", { timeZone: "Europe/Rome" })}</p></div>
        <button type="button" disabled={busy} onClick={() => void revoke(token.id)} className="btn btn-quiet" style={{ minHeight: 44 }}>Revoca</button>
      </li>)}
    </ul> : <p className="text-sm text-muted">Non hai chiavi attive in questo workspace.</p>}
  </section>;
}
