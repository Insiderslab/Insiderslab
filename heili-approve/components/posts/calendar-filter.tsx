"use client";

/**
 * Calendar Filter
 *
 * Client select for the calendar and, when the instance handles several
 * content kinds, a kind select; keeps the month/week in the URL.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface CalendarFilterProps {
  clients: Array<{ id: string; name: string }>;
  clientId: string;
  /** Kind options (slug + label); empty or one = no kind select. */
  kinds?: Array<{ value: string; label: string }>;
  /** Selected kind slug, "" = every kind. */
  kind?: string;
  /** Other query params to keep (mese, settimana). */
  keep: Record<string, string>;
}

const selectClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 sm:w-auto";

export default function CalendarFilter({ clients, clientId, kinds = [], kind = "", keep }: CalendarFilterProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(patch: { clientId?: string; kind?: string }) {
    const params = new URLSearchParams(keep);
    const nextClient = patch.clientId ?? clientId;
    const nextKind = patch.kind ?? kind;
    if (nextClient) params.set("clientId", nextClient);
    if (nextKind) params.set("kind", nextKind);
    const query = params.toString();
    startTransition(() => router.replace(query ? `/calendar?${query}` : "/calendar"));
  }

  return (
    <div className={`flex flex-col gap-2 sm:flex-row ${pending ? "opacity-70" : ""}`}>
      {kinds.length > 1 && (
        <select
          aria-label="Tipo di contenuto"
          value={kind}
          onChange={(event) => change({ kind: event.target.value })}
          className={selectClass}
        >
          <option value="">Tutti i tipi</option>
          {kinds.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label="Cliente"
        value={clientId}
        onChange={(event) => change({ clientId: event.target.value })}
        className={selectClass}
      >
        <option value="">Tutti i clienti</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </div>
  );
}
