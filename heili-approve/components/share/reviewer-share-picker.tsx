"use client";

import { useId, useState } from "react";
import ShareLink from "./share-link";

export interface ReviewerShareChoice {
  id: string;
  name: string;
  email: string | null;
  url: string | null;
  message: string | null;
}

export default function ReviewerSharePicker({
  choices,
  previewLabel,
}: {
  choices: ReviewerShareChoice[];
  previewLabel?: string;
}) {
  const selectId = useId();
  const [selectedId, setSelectedId] = useState(choices[0]?.id ?? "");
  const selected = choices.find((choice) => choice.id === selectedId) ?? choices[0];

  if (!selected) return null;

  return (
    <div className="space-y-3" data-testid="reviewer-share-picker">
      {choices.length > 1 ? (
        <label htmlFor={selectId} className="block space-y-1">
          <span className="text-sm font-medium">Link personale di</span>
          <select
            id={selectId}
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
            className="field min-h-11 text-base"
            data-testid="share-reviewer-select"
          >
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}{choice.email ? ` · ${choice.email}` : " · senza email"}
              </option>
            ))}
          </select>
          <span className="block text-xs text-muted">Ogni referente ha un link personale: scegli chi lo riceverà.</span>
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{selected.name}</p>
          {selected.email ? (
            <p className="text-sm text-muted">{selected.email}</p>
          ) : (
            <span className="chip chip-offline">Nessuna email</span>
          )}
        </div>
      )}

      {selected.url && selected.message ? (
        <ShareLink
          key={`${selected.id}:${selected.url}`}
          url={selected.url}
          reviewerName={selected.name}
          message={selected.message}
          previewLabel={previewLabel}
          compact
        />
      ) : (
        <p className="text-sm text-warning">
          Il link di {selected.name} non è leggibile. Generane uno nuovo nella scheda del cliente.
        </p>
      )}
    </div>
  );
}
