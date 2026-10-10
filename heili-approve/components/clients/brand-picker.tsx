"use client";

/**
 * Brand picker of the client form: a searchable list of the Metricool brands,
 * each with logo, name, networks and time zone. It replaces a plain <select>:
 * with 25 brands, finding the right one by scrolling is slow, and the logo and
 * the networks are what tell two similar names apart.
 *
 * Accessible combobox: the text field (labelled "Brand su Metricool" by the
 * form) filters the list; arrows move, Enter chooses, Escape closes.
 */

import { useId, useMemo, useRef, useState } from "react";
import { BrandLogo, NetworkChips } from "@/components/clients/brand-parts";
import type { MetricoolBrandOption } from "@/components/clients/action-result";
import { NETWORK_LABELS, isNetwork } from "@/lib/domain";
import { normalizeName } from "@/lib/metricool/import";

interface Props {
  /** Id of the text field (the form's <label htmlFor>). */
  id: string;
  brands: MetricoolBrandOption[];
  /** blogId of the chosen brand, "" for none. */
  value: string;
  onChange: (blogId: string) => void;
}

function searchText(brand: MetricoolBrandOption): string {
  const networks = brand.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(" ");
  return normalizeName(`${brand.label} ${networks} ${Object.values(brand.accounts).join(" ")}`);
}

export default function BrandPicker({ id, brands, value, onChange }: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = brands.find((brand) => brand.blogId === value) ?? null;

  const filtered = useMemo(() => {
    const wanted = normalizeName(query);
    return wanted ? brands.filter((brand) => searchText(brand).includes(wanted)) : brands;
  }, [brands, query]);

  // Entry 0 is "no brand"; the brands follow.
  const optionCount = filtered.length + 1;

  function choose(blogId: string) {
    onChange(blogId);
    setOpen(false);
    setQuery("");
  }

  function openList() {
    if (open) return;
    setOpen(true);
    setQuery("");
    const index = selected ? filtered.findIndex((b) => b.blogId === selected.blogId) + 1 : 0;
    setActive(Math.max(index, 0));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + optionCount) % optionCount);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(active === 0 ? "" : (filtered[active - 1]?.blogId ?? ""));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  const shown = open ? query : (selected?.label ?? (value ? `Brand ${value}` : ""));

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={shown}
        placeholder={open || !value ? "Cerca un brand per nome o rete…" : undefined}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
          setActive(event.target.value.trim() ? 1 : 0);
        }}
        onKeyDown={handleKeyDown}
        className="field"
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Brand disponibili"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line-strong bg-surface p-1 shadow-raised"
        >
          <li
            id={`${listId}-0`}
            role="option"
            aria-selected={!value}
            onMouseDown={(event) => {
              event.preventDefault();
              choose("");
            }}
            onMouseEnter={() => setActive(0)}
            className={`flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted ${
              active === 0 ? "bg-accent-soft" : ""
            }`}
          >
            Nessun brand collegato
          </li>
          {filtered.map((brand, index) => (
            <li
              key={brand.blogId}
              id={`${listId}-${index + 1}`}
              role="option"
              aria-selected={brand.blogId === value}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(brand.blogId);
              }}
              onMouseEnter={() => setActive(index + 1)}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${
                active === index + 1 ? "bg-accent-soft" : ""
              }`}
            >
              <BrandLogo src={brand.imageUrl} label={brand.label} className="h-8 w-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{brand.label}</span>
                <span className="block truncate text-xs text-muted">
                  {brand.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", ") || "Nessuna rete collegata"}
                  {brand.usedBy ? ` · già usato da ${brand.usedBy}` : ""}
                </span>
              </span>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-3 text-sm text-muted">Nessun brand corrisponde.</li>}
        </ul>
      )}
    </div>
  );
}

/** The chosen brand, below the field: logo, name, networks, time zone. */
export function SelectedBrand({
  brand,
  onClear,
  children,
}: {
  brand: MetricoolBrandOption;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="inset flex flex-col gap-3 p-3 sm:flex-row sm:items-center" data-testid="selected-brand">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <BrandLogo src={brand.imageUrl} label={brand.label} className="h-11 w-11" />
        <div className="min-w-0 space-y-1.5">
          <p className="truncate text-sm font-semibold text-foreground">{brand.label}</p>
          <NetworkChips networks={brand.networks} accounts={brand.accounts} />
          <p className="text-xs text-muted">
            {brand.timezone ? `Fuso orario ${brand.timezone}` : "Fuso orario non indicato"}
            {brand.usedBy ? ` · già collegato a ${brand.usedBy}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {children}
        <button type="button" onClick={onClear} className="btn btn-sm btn-quiet">
          Scollega il brand
        </button>
      </div>
    </div>
  );
}
