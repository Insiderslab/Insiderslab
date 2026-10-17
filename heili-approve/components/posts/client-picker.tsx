"use client";

/**
 * "Per quale cliente?" with many clients (QA-15): a search field, the three
 * clients used most recently on top, then all the others. Each choice is a
 * plain link (the page decides where it leads).
 */

import Link from "next/link";
import { useId, useState } from "react";
import { filterClients, recentClients } from "@/lib/client-search";

export interface PickerClient {
  id: string;
  name: string;
  href: string;
  /** "Post social · Articoli" */
  detail?: string;
}

/** Below this many clients the list is short enough without search. */
const SEARCH_FROM = 7;

export default function ClientPicker({ clients, recentIds, testId }: { clients: PickerClient[]; recentIds: string[]; testId?: string }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const searchable = clients.length >= SEARCH_FROM;
  const shown = filterClients(clients, query);
  const recent = searchable && !query ? recentClients(clients, recentIds) : [];
  const rest = recent.length > 0 ? shown.filter((c) => !recent.some((r) => r.id === c.id)) : shown;

  const card = (client: PickerClient) => (
    <li key={client.id}>
      <Link
        href={client.href}
        className="panel flex h-full min-h-11 flex-col gap-1 rounded p-4 hover:border-border-hover"
        data-testid={testId}
      >
        <span className="text-base font-semibold text-foreground">{client.name}</span>
        {client.detail && <span className="text-xs text-muted">{client.detail}</span>}
      </Link>
    </li>
  );

  return (
    <div className="space-y-4">
      {searchable && (
        <div className="max-w-md">
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium">
            Cerca cliente
          </label>
          <input
            id={inputId}
            type="search"
            className="field min-h-11 text-base"
            placeholder="Scrivi una parte del nome"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            data-testid="client-picker-search"
          />
        </div>
      )}
      {recent.length > 0 && (
        <section className="space-y-2" aria-labelledby={`${inputId}-recent`}>
          <h3 id={`${inputId}-recent`} className="label-caps">
            Usati di recente
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="client-picker-recent">
            {recent.map(card)}
          </ul>
        </section>
      )}
      {rest.length === 0 ? (
        <p className="text-sm text-muted" role="status">
          Nessun cliente con «{query}». Controlla il nome o cerca una parte più corta.
        </p>
      ) : (
        <section className="space-y-2" aria-label={recent.length > 0 ? "Tutti i clienti" : undefined}>
          {recent.length > 0 && <h3 className="label-caps">Tutti i clienti</h3>}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="client-picker-list">
            {rest.map(card)}
          </ul>
        </section>
      )}
    </div>
  );
}
