"use client";

/**
 * Client selector in the main menu ("Cliente attivo").
 *
 * The agency picks the client it works on once, and dashboard, content
 * lists, calendar and "Nuovo contenuto" follow it (lib/current-client.ts).
 * "Tutti i clienti" shows everything. Clients are created in Clienti; the
 * menu offers the shortcut. On a page about one item (a content or a client)
 * switching goes to the matching page of the new client.
 */

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { setCurrentClientAction } from "@/app/(dashboard)/current-client-actions";
import { hrefAfterSwitch } from "@/lib/client-switch";

export interface SwitcherClient {
  id: string;
  name: string;
  logoUrl: string | null;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "?";
}

function ClientAvatar({ client, size = "h-8 w-8" }: { client: SwitcherClient | null; size?: string }) {
  if (!client) {
    return (
      <span
        className={`${size} flex shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      </span>
    );
  }
  if (client.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={client.logoUrl} alt="" className={`${size} shrink-0 rounded-lg border border-border object-cover`} />
    );
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-xs font-semibold text-muted`}
      aria-hidden="true"
    >
      {initials(client.name)}
    </span>
  );
}

export default function ClientSwitcher({
  clients,
  currentClientId,
  onNavigate,
}: {
  clients: SwitcherClient[];
  currentClientId: string | null;
  /** Closes the mobile drawer after a choice. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [optimisticId, setOptimisticId] = useState<string | null | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedId = optimisticId === undefined ? currentClientId : optimisticId;
  const current = clients.find((c) => c.id === selectedId) ?? null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, query]);

  useEffect(() => {
    if (!open) return;
    function onDocument(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(clientId: string | null) {
    setOpen(false);
    setQuery("");
    setError(null);
    if (clientId === selectedId) return;
    setOptimisticId(clientId);
    startTransition(async () => {
      const result = await setCurrentClientAction(clientId);
      if (!result.ok) {
        setOptimisticId(undefined);
        setError(result.error);
        return;
      }
      const target = hrefAfterSwitch(pathname, new URLSearchParams(searchParams.toString()), clientId);
      if (target) router.push(target);
      else router.refresh();
      setOptimisticId(undefined);
      onNavigate?.();
    });
  }

  return (
    <div ref={rootRef} className="relative" data-testid="client-switcher">
      <p className="label-caps mb-1.5 px-1">Cliente</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={pending}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface p-2 text-left shadow-[var(--shadow-raised)] transition-colors hover:border-line-strong disabled:opacity-70"
      >
        <ClientAvatar client={current} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {current ? current.name : "Tutti i clienti"}
          </span>
          <span className="block truncate text-xs text-muted">
            {pending ? "Cambio cliente…" : current ? "Cliente attivo · cambia" : `${clients.length} ${clients.length === 1 ? "cliente" : "clienti"}`}
          </span>
        </span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m7 10 5-5 5 5M7 14l5 5 5-5" />
        </svg>
      </button>
      {error && <p className="mt-1 px-1 text-xs text-error">{error}</p>}

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-overlay)]">
          {clients.length > 6 && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca cliente"
                aria-label="Cerca cliente"
                className="field !min-h-9 !py-1.5"
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-label="Scegli il cliente" className="max-h-72 overflow-y-auto p-1.5">
            <li role="option" aria-selected={selectedId === null}>
              <button
                type="button"
                onClick={() => choose(null)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-sunken ${selectedId === null ? "bg-accent-soft font-semibold text-accent" : ""}`}
              >
                <ClientAvatar client={null} size="h-7 w-7" />
                Tutti i clienti
              </button>
            </li>
            {shown.map((client) => (
              <li key={client.id} role="option" aria-selected={client.id === selectedId}>
                <button
                  type="button"
                  onClick={() => choose(client.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-sunken ${client.id === selectedId ? "bg-accent-soft font-semibold text-accent" : "text-foreground"}`}
                >
                  <ClientAvatar client={client} size="h-7 w-7" />
                  <span className="truncate">{client.name}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-2 text-sm text-muted">Nessun cliente con questo nome.</li>}
          </ul>
          <div className="flex gap-1 border-t border-border p-1.5">
            <Link
              href="/clients/new"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="btn btn-quiet btn-sm flex-1 !px-2"
            >
              + Nuovo cliente
            </Link>
            <Link
              href="/clients"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="btn btn-quiet btn-sm flex-1 !px-2"
            >
              Gestisci
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
