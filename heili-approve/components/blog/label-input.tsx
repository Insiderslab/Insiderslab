"use client";

/**
 * Chips input for categories and tags: Enter or comma adds, × removes,
 * Backspace on an empty field removes the last one. Duplicates (ignoring
 * case) are skipped.
 */

import { useId, useState } from "react";

export default function LabelInput({
  label,
  values,
  onChange,
  placeholder,
  max = 30,
  maxLength = 60,
  disabled = false,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  maxLength?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const items = raw
      .split(",")
      .map((item) => item.trim().slice(0, maxLength))
      .filter(Boolean);
    if (items.length === 0) return;
    const next = [...values];
    for (const item of items) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLocaleLowerCase("it-IT") === item.toLocaleLowerCase("it-IT"))) next.push(item);
    }
    onChange(next);
    setDraft("");
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 focus-within:border-accent/40">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full bg-surface-hover py-0.5 pl-2.5 pr-1 text-sm">
            {value}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Rimuovi ${value}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-border hover:text-foreground disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={disabled || values.length >= max}
          onChange={(event) => {
            const value = event.target.value;
            if (value.includes(",")) add(value);
            else setDraft(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            } else if (event.key === "Backspace" && !draft && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
          maxLength={maxLength}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-foreground outline-none disabled:opacity-60"
        />
      </div>
      <p className="mt-1 text-xs text-muted">Premi Invio o la virgola per aggiungere.</p>
    </div>
  );
}
