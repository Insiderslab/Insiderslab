"use client";

/**
 * Import from Metricool
 *
 * One row per brand of the connected Metricool account: logo, name, networks,
 * time zone and a choice — create a new client, link an existing one, ignore.
 * Brands that already belong to a client are shown as such and left out. The
 * page starts from sensible defaults (a name match preselects "link"); one
 * button imports everything chosen, then the result lists the clients with a
 * link to each (where the reviewer's link is created).
 *
 * The browser only sends the choices (brand id + action + client id): the
 * server reads brands and clients again and decides what is allowed.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { importMetricoolClientsAction } from "@/app/(dashboard)/clients/import/actions";
import { BrandLogo, NetworkChips } from "@/components/clients/brand-parts";
import { NETWORK_LABELS } from "@/lib/domain";
import {
  defaultChoices,
  importButtonLabel,
  normalizeName,
  summaryHeadline,
  type ImportAction,
  type ImportRow,
  type ImportSummary,
} from "@/lib/metricool/import";

interface Props {
  rows: ImportRow[];
  /** Active clients without a Metricool brand. */
  candidates: Array<{ id: string; name: string }>;
  fake: boolean;
}

interface RowChoice {
  action: ImportAction;
  clientId: string;
}

const OPTIONS: Array<{ action: ImportAction; label: string }> = [
  { action: "create", label: "Crea nuovo cliente" },
  { action: "link", label: "Collega a cliente esistente" },
  { action: "skip", label: "Ignora" },
];

function initialChoices(rows: ImportRow[]): Record<string, RowChoice> {
  const result: Record<string, RowChoice> = {};
  for (const choice of defaultChoices(rows)) {
    result[choice.blogId] = { action: choice.action, clientId: choice.clientId ?? "" };
  }
  return result;
}

/** Text the search box looks in: name, networks, handles, time zone. */
function searchText(row: ImportRow): string {
  const networks = row.networks.map((n) => NETWORK_LABELS[n]).join(" ");
  const handles = Object.values(row.accounts).join(" ");
  return normalizeName(`${row.label} ${networks} ${handles} ${row.timezone ?? ""} ${row.linkedTo?.name ?? ""}`);
}

export default function MetricoolImport({ rows, candidates, fake }: Props) {
  const [choices, setChoices] = useState<Record<string, RowChoice>>(() => initialChoices(rows));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [pending, startTransition] = useTransition();

  const importable = rows.filter((row) => !row.linkedTo);
  const linkedCount = rows.length - importable.length;

  const visible = useMemo(() => {
    const wanted = normalizeName(query);
    return wanted ? rows.filter((row) => searchText(row).includes(wanted)) : rows;
  }, [rows, query]);

  const clientName = useMemo(() => new Map(candidates.map((c) => [c.id, c.name])), [candidates]);

  // What would be imported right now, and what is not ready yet.
  const picked = importable.filter((row) => {
    const choice = choices[row.blogId];
    return choice?.action === "create" || (choice?.action === "link" && choice.clientId);
  });
  const incomplete = importable.filter((row) => choices[row.blogId]?.action === "link" && !choices[row.blogId].clientId);
  const usedTwice = new Set<string>();
  {
    const seen = new Set<string>();
    for (const row of importable) {
      const choice = choices[row.blogId];
      if (choice?.action !== "link" || !choice.clientId) continue;
      if (seen.has(choice.clientId)) usedTwice.add(choice.clientId);
      seen.add(choice.clientId);
    }
  }
  const blocked = incomplete.length > 0 || usedTwice.size > 0;

  function setChoice(blogId: string, patch: Partial<RowChoice>) {
    setChoices((current) => ({ ...current, [blogId]: { ...current[blogId], ...patch } }));
    setError(null);
  }

  function chooseAction(row: ImportRow, action: ImportAction) {
    // Switching to "link": the name match if there is one, else the user picks.
    setChoice(row.blogId, {
      action,
      ...(action === "link" && !choices[row.blogId]?.clientId ? { clientId: row.suggestedClientId ?? "" } : {}),
    });
  }

  function selectAll(all: boolean) {
    const defaults = initialChoices(rows);
    setChoices((current) => {
      const next = { ...current };
      for (const row of visible) {
        if (row.linkedTo) continue;
        next[row.blogId] = all ? defaults[row.blogId] : { ...current[row.blogId], action: "skip" };
      }
      return next;
    });
    setError(null);
  }

  function submit() {
    setError(null);
    const payload = importable
      .map((row) => ({ blogId: row.blogId, ...choices[row.blogId] }))
      .filter((choice) => choice.action !== "skip")
      .map((choice) => ({
        blogId: choice.blogId,
        action: choice.action,
        clientId: choice.action === "link" ? choice.clientId : null,
      }));

    startTransition(async () => {
      try {
        const result = await importMetricoolClientsAction({ choices: payload });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSummary(result.data);
        window.scrollTo({ top: 0 });
      } catch {
        setError("Si è verificato un errore imprevisto. Riprova tra poco.");
      }
    });
  }

  if (summary) return <ImportResult summary={summary} />;

  return (
    <div className="space-y-4">
      <div className="panel flex flex-col gap-3 rounded p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          <p className="font-medium text-foreground">
            {rows.length} brand su Metricool
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {importable.length} da importare
            {linkedCount > 0 ? ` · ${linkedCount} già collegati` : ""}
            {fake ? " · modalità di prova: brand finti" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" onClick={() => selectAll(true)}>
            Seleziona tutti
          </button>
          <button type="button" className="btn btn-sm" onClick={() => selectAll(false)}>
            Seleziona nessuno
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="import-search" className="sr-only">
          Cerca un brand
        </label>
        <input
          id="import-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca per nome, rete o profilo…"
          autoComplete="off"
          className="field"
        />
      </div>

      {visible.length === 0 && (
        <p className="panel rounded p-4 text-sm text-muted">Nessun brand corrisponde alla ricerca.</p>
      )}

      <ul className="space-y-3" aria-label="Brand di Metricool">
        {visible.map((row) => {
          const choice = choices[row.blogId];
          const dupe = choice?.action === "link" && choice.clientId && usedTwice.has(choice.clientId);
          return (
            <li
              key={row.blogId}
              data-testid="import-row"
              data-blog-id={row.blogId}
              className={`panel rounded p-4 ${row.linkedTo ? "opacity-80" : ""}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
                <div className="flex min-w-0 items-start gap-3">
                  <BrandLogo src={row.image} label={row.label} className="h-11 w-11" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{row.label}</p>
                    <NetworkChips networks={row.networks} accounts={row.accounts as Record<string, string>} />
                    <p className="text-xs text-muted">
                      {row.timezone ? `Fuso orario ${row.timezone}` : "Fuso orario non indicato"}
                      {row.accounts.instagram ? ` · @${row.accounts.instagram.replace(/^@/, "")}` : ""}
                    </p>
                  </div>
                </div>

                <div className="min-w-0 lg:w-[28rem] lg:shrink-0">
                  {row.linkedTo ? (
                    <p className="text-sm">
                      <span className="chip chip-fresh">Già collegato</span>{" "}
                      <span className="text-muted">
                        a{" "}
                        <Link href={`/clients/${row.linkedTo.id}`} className="text-accent hover:underline">
                          {row.linkedTo.name}
                        </Link>
                        {row.linkedTo.archived ? " (archiviato)" : ""}
                      </span>
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div
                        role="radiogroup"
                        aria-label={`Cosa fare con ${row.label}`}
                        className="grid grid-cols-3 gap-1 rounded-lg border border-line-strong p-1"
                      >
                        {OPTIONS.map((option) => {
                          const disabled = option.action === "link" && candidates.length === 0;
                          const checked = choice?.action === option.action;
                          // Plain buttons (role="radio"), not visually hidden <input>s: focusing an
                          // off-screen input made Safari jump the page to the bottom.
                          return (
                            <button
                              key={option.action}
                              type="button"
                              role="radio"
                              aria-checked={checked}
                              disabled={disabled}
                              onClick={() => chooseAction(row, option.action)}
                              className={`flex min-h-11 items-center justify-center rounded-md px-1.5 text-center text-[13px] font-semibold leading-tight transition-colors ${
                                checked
                                  ? "bg-accent-soft text-accent"
                                  : disabled
                                    ? "cursor-not-allowed text-muted opacity-50"
                                    : "text-muted hover:text-foreground"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>

                      {choice?.action === "link" && (
                        <div className="space-y-1">
                          <select
                            aria-label={`Cliente da collegare a ${row.label}`}
                            value={choice.clientId}
                            onChange={(e) => setChoice(row.blogId, { clientId: e.target.value })}
                            className="field"
                          >
                            <option value="">Scegli il cliente…</option>
                            {candidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name}
                              </option>
                            ))}
                          </select>
                          {choice.clientId && choice.clientId === row.suggestedClientId && (
                            <p className="text-xs text-muted">
                              Stesso nome di {clientName.get(choice.clientId)?.trim() ?? "un cliente esistente"}: collegamento
                              suggerito.
                            </p>
                          )}
                          {dupe && (
                            <p className="text-xs text-error">
                              Questo cliente è scelto anche per un altro brand: ne serve uno diverso.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="panel sticky bottom-3 z-10 flex flex-col gap-3 rounded p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          {error ? (
            <p role="alert" className="text-error">
              {error}
            </p>
          ) : blocked ? (
            <p className="text-warning">
              {incomplete.length > 0
                ? "Scegli il cliente da collegare, oppure cambia la scelta."
                : "Ogni cliente può essere collegato a un solo brand."}
            </p>
          ) : (
            <p className="text-muted">
              {picked.length === 0
                ? "Non hai scelto nessun brand da importare."
                : "Puoi rifarlo quando vuoi: i brand già collegati vengono saltati."}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending || picked.length === 0 || blocked}
          className="btn btn-primary w-full sm:w-auto"
        >
          {pending ? "Importazione…" : importButtonLabel(picked.length)}
        </button>
      </div>
    </div>
  );
}

function ImportResult({ summary }: { summary: ImportSummary }) {
  const imported = [
    ...summary.created.map((c) => ({ ...c, how: "creato" })),
    ...summary.linked.map((c) => ({ ...c, how: "collegato" })),
  ];
  return (
    <div className="space-y-4" data-testid="import-result">
      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold" data-testid="import-headline">
          {summaryHeadline(summary)}
        </h2>
        {imported.length > 0 ? (
          <>
            <p className="mt-1 text-sm text-muted">
              Ora crea il link per chi approva: apri ogni cliente e aggiungi il referente, poi copia il suo link o
              mandalo su WhatsApp.
            </p>
            <ul className="mt-4 divide-y divide-border">
              {imported.map((client) => (
                <li key={client.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{client.name}</p>
                    <p className="text-xs capitalize text-muted">{client.how}</p>
                  </div>
                  <Link href={`/clients/${client.id}`} className="btn btn-sm shrink-0">
                    Crea il link
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">Non è cambiato nulla: i brand scelti erano già collegati.</p>
        )}
      </section>

      {summary.skipped.length > 0 && (
        <section className="panel rounded p-4 sm:p-6">
          <h3 className="text-sm font-semibold">Saltati</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {summary.skipped.map((item) => (
              <li key={item.blogId}>
                <span className="text-foreground">{item.label}</span>: {item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href="/clients" className="btn btn-primary">
          Vai ai clienti
        </Link>
      </div>
    </div>
  );
}
