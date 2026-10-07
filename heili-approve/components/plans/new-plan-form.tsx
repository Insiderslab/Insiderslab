"use client";

/**
 * "Nuovo piano": client + month → opens the plan page (creating the plan
 * with the month's posts, or opening the one that already exists).
 */

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createPlanAction } from "@/app/(dashboard)/plans/actions";

export default function NewPlanForm({
  clients,
  clientId,
  month,
  highlight = false,
}: {
  clients: Array<{ id: string; name: string }>;
  clientId: string;
  /** "YYYY-MM" preselected. */
  month: string;
  /** Opened from a "Piano di <mese>" link: say what is about to happen. */
  highlight?: boolean;
}) {
  const router = useRouter();
  const ids = { client: useId(), month: useId() };
  const [client, setClient] = useState(clientId || clients[0]?.id || "");
  const [value, setValue] = useState(month);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!client) {
      setError("Scegli il cliente.");
      return;
    }
    startTransition(async () => {
      const result = await createPlanAction({ clientId: client, month: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/plans/${result.data.id}`);
    });
  }

  if (clients.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nessun cliente con il servizio «Post social»: attivalo nella scheda del cliente per preparare il suo piano.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="new-plan-form">
      {highlight && (
        <p className="text-sm text-muted">
          Il piano raccoglie tutti i post social del cliente in quel mese: poi scrivi un messaggio introduttivo e lo invii
          in un colpo solo.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
        <label htmlFor={ids.client} className="block space-y-1">
          <span className="label-caps block">Cliente</span>
          <select id={ids.client} value={client} onChange={(e) => setClient(e.target.value)} className="field">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.month} className="block space-y-1">
          <span className="label-caps block">Mese</span>
          <input
            id={ids.month}
            type="month"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            className="field"
          />
        </label>
        <button type="submit" disabled={pending || !value} className="btn btn-primary">
          {pending ? "Apro il piano…" : "Apri il piano del mese"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
