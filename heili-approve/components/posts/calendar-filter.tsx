"use client";

/**
 * Calendar Filter
 *
 * Client select for the calendar; keeps the month/week in the URL.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface CalendarFilterProps {
  clients: Array<{ id: string; name: string }>;
  clientId: string;
  /** Other query params to keep (mese, settimana). */
  keep: Record<string, string>;
}

export default function CalendarFilter({ clients, clientId, keep }: CalendarFilterProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(value: string) {
    const params = new URLSearchParams(keep);
    if (value) params.set("clientId", value);
    const query = params.toString();
    startTransition(() => router.replace(query ? `/calendar?${query}` : "/calendar"));
  }

  return (
    <select
      aria-label="Cliente"
      value={clientId}
      onChange={(event) => change(event.target.value)}
      className={`w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 sm:w-auto ${
        pending ? "opacity-70" : ""
      }`}
    >
      <option value="">Tutti i clienti</option>
      {clients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.name}
        </option>
      ))}
    </select>
  );
}
