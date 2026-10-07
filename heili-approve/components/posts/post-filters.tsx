"use client";

/**
 * Post Filters
 *
 * Kind (when the instance handles several), status (including "Da
 * gestire"), client, period and title search for the posts list. Everything
 * lives in the URL, so a filtered list can be shared and the server renders
 * it; selects apply immediately, the search on Invio. "Azzera filtri" keeps
 * the kind: it is the section of the menu the list was opened from.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { STATUS_LABELS } from "@/lib/domain";
import { POST_STATUSES, buildPostsHref, type PostFilterValues } from "./helpers";

interface Option {
  value: string;
  label: string;
}

interface PostFiltersProps {
  values: PostFilterValues;
  clients: Array<{ id: string; name: string }>;
  /** Kind options (slug + label); fewer than two = no kind select. */
  kinds?: Option[];
  /** Status options worded for the kinds shown (default: every status). */
  statuses?: Option[];
  /** Label of the "attention" option. */
  attentionLabel?: string;
}

const selectClass =
  "field sm:!w-auto";

const DEFAULT_STATUSES: Option[] = POST_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }));

export default function PostFilters({
  values,
  clients,
  kinds = [],
  statuses = DEFAULT_STATUSES,
  attentionLabel = "Da gestire (modifiche richieste ed errori)",
}: PostFiltersProps) {
  const router = useRouter();
  const [q, setQ] = useState(values.q);
  const [pending, startTransition] = useTransition();

  function apply(patch: Partial<PostFilterValues>) {
    startTransition(() => {
      router.replace(buildPostsHref({ ...values, q, ...patch }));
    });
  }

  const active = Boolean(values.status || values.clientId || values.periodo || values.q);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        apply({ q });
      }}
      className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center ${pending ? "opacity-70" : ""}`}
      role="search"
    >
      {kinds.length > 1 && (
        <select
          aria-label="Tipo di contenuto"
          value={values.kind ?? ""}
          onChange={(event) => apply({ kind: event.target.value })}
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
        aria-label="Stato"
        value={values.status}
        onChange={(event) => apply({ status: event.target.value })}
        className={selectClass}
      >
        <option value="">Tutti gli stati (esclusi annullati)</option>
        <option value="attention">{attentionLabel}</option>
        {statuses.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Cliente"
        value={values.clientId}
        onChange={(event) => apply({ clientId: event.target.value })}
        className={selectClass}
      >
        <option value="">Tutti i clienti</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Periodo"
        value={values.periodo}
        onChange={(event) => apply({ periodo: event.target.value })}
        className={selectClass}
      >
        <option value="">Qualsiasi data</option>
        <option value="prossimi">Da pubblicare</option>
        <option value="passati">Data passata</option>
      </select>
      <input
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Cerca per titolo"
        aria-label="Cerca per titolo"
        className={`${selectClass} sm:w-56`}
      />
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(buildPostsHref({ kind: values.kind })));
          }}
          className="px-2 py-2 text-left text-sm text-muted hover:text-foreground"
        >
          Azzera filtri
        </button>
      )}
    </form>
  );
}
