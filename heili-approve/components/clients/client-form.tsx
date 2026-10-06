"use client";

/**
 * Client Form
 *
 * Create / edit a client: name, logo, services (which kinds of content the
 * agency prepares for it), Metricool brand, time zone, networks and automatic
 * scheduling. Fields are controlled so a validation error from the server
 * never wipes what the user typed. The Metricool brand, networks and
 * automatic scheduling only show when "Post social" is among the services
 * and the instance handles social posts (`metricool`); otherwise the stored
 * values are sent back unchanged.
 *
 * Services: one checkbox per kind the instance enables (`kinds`). The stored
 * services of kinds this instance does not handle are kept by the server.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  createClientAction,
  updateClientAction,
} from "@/app/(dashboard)/clients/actions";
import type { BrandsState } from "@/components/clients/action-result";
import { isValidTimeZoneName, type TimeZoneOption } from "@/components/clients/helpers";
import type { ContentKind } from "@/app/generated/prisma/client";
import { KindIcon } from "@/components/posts/kind-badge";
import { NETWORKS, NETWORK_LABELS, isNetwork, type Network } from "@/lib/domain";
import { KIND_UI, sortKinds } from "@/lib/variant";

export interface ClientFormValues {
  name: string;
  logoUrl: string;
  timezone: string;
  metricoolBlogId: string;
  networks: string[];
  autoSchedule: boolean;
  /** The client's services among `kinds` (the enabled ones). */
  services: ContentKind[];
}

/** What each service means, next to its checkbox. */
const SERVICE_DESCRIPTIONS: Record<ContentKind, string> = {
  SOCIAL_POST: "Testi, foto, video e Reel. Dopo l'approvazione si programmano su Metricool.",
  BLOG_ARTICLE: "Articoli per il sito con controlli SEO; il cliente commenta le frasi, poi li esporti.",
  AD_CREATIVE: "Set di creatività per le campagne: il cliente approva o scarta ogni variante.",
};

interface ClientFormProps {
  mode: "create" | "edit";
  clientId?: string;
  initial: ClientFormValues;
  timeZoneOptions: TimeZoneOption[];
  brands: BrandsState;
  /** Archived clients are shown read-only until restored. */
  readOnly?: boolean;
  /** Social posts enabled: show the Metricool brand, networks and automatic scheduling. Default true. */
  metricool?: boolean;
  /** Kinds this instance handles (lib/variant enabledKinds): the services offered. */
  kinds?: ContentKind[];
}

const OTHER_ZONE = "__other__";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40 disabled:opacity-60";

export default function ClientForm({
  mode,
  clientId,
  initial,
  timeZoneOptions,
  brands,
  readOnly = false,
  metricool = true,
  kinds = ["SOCIAL_POST"],
}: ClientFormProps) {
  const [values, setValues] = useState<ClientFormValues>(initial);
  const knownZone = timeZoneOptions.some((option) => option.value === initial.timezone);
  const [zoneChoice, setZoneChoice] = useState(knownZone ? initial.timezone : OTHER_ZONE);
  const [customZone, setCustomZone] = useState(knownZone ? "" : initial.timezone);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const [pending, startTransition] = useTransition();

  const timezone = zoneChoice === OTHER_ZONE ? customZone.trim() : zoneChoice;
  const zoneInvalid = zoneChoice === OTHER_ZONE && customZone.trim() !== "" && !isValidTimeZoneName(customZone);

  const brandList = brands.status === "ok" ? brands.brands : [];
  const selectedBrand = brandList.find((brand) => brand.blogId === values.metricoolBlogId) ?? null;
  const brandMissing = Boolean(values.metricoolBlogId) && brands.status === "ok" && !selectedBrand;

  function update<K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function setTimezone(value: string) {
    if (timeZoneOptions.some((option) => option.value === value)) {
      setZoneChoice(value);
    } else {
      setZoneChoice(OTHER_ZONE);
      setCustomZone(value);
    }
  }

  // One kind and the client already has it (or is new): nothing to choose.
  const showServices = kinds.length > 1 || (mode === "edit" && !initial.services.includes(kinds[0]));
  const socialService = metricool && (showServices ? values.services.includes("SOCIAL_POST") : kinds.includes("SOCIAL_POST"));

  function toggleService(kind: ContentKind) {
    update(
      "services",
      values.services.includes(kind) ? values.services.filter((k) => k !== kind) : sortKinds([...values.services, kind])
    );
  }

  function toggleNetwork(network: Network) {
    update(
      "networks",
      values.networks.includes(network)
        ? values.networks.filter((n) => n !== network)
        : [...values.networks, network]
    );
  }

  /** Copies time zone and connected networks from the selected brand. */
  function applyBrandSettings() {
    if (!selectedBrand) return;
    if (selectedBrand.timezone && isValidTimeZoneName(selectedBrand.timezone)) {
      setTimezone(selectedBrand.timezone);
    }
    const brandNetworks = selectedBrand.networks.filter(isNetwork);
    if (brandNetworks.length > 0) update("networks", brandNetworks);
    if (!values.name.trim()) update("name", selectedBrand.label);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setError(null);
    setNotice(null);

    if (!values.name.trim()) {
      setError("Inserisci il nome del cliente.");
      return;
    }
    if (!timezone || !isValidTimeZoneName(timezone)) {
      setError("Fuso orario non valido: usa un nome IANA, ad esempio Europe/Rome.");
      return;
    }
    if (showServices && mode === "create" && values.services.length === 0) {
      setError("Scegli almeno un servizio per il cliente.");
      return;
    }

    const input = {
      name: values.name,
      logoUrl: values.logoUrl.trim() || null,
      timezone,
      metricoolBlogId: values.metricoolBlogId || null,
      networks: values.networks.filter(isNetwork),
      autoSchedule: values.autoSchedule,
      // Hidden choice: a new client gets the instance's only kind, an edit
      // leaves the services as they are.
      services: showServices ? values.services : mode === "create" ? kinds.slice(0, 1) : undefined,
    };

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createClientAction(input)
          : await updateClientAction(clientId ?? "", input);
      // On success createClientAction redirects and never returns here.
      if (!result.ok) setError(result.error);
      else setNotice(result.message ?? "Salvato.");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset disabled={readOnly || pending} className="space-y-6">
        {/* Name + logo */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="client-name" className="block text-sm font-medium">
              Nome del cliente
            </label>
            <input
              id="client-name"
              value={values.name}
              onChange={(e) => update("name", e.target.value)}
              maxLength={120}
              required
              placeholder="Es. Pasticceria Rossi"
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="client-logo" className="block text-sm font-medium">
              URL del logo <span className="font-normal text-muted">(facoltativo)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                id="client-logo"
                type="url"
                inputMode="url"
                value={values.logoUrl}
                onChange={(e) => {
                  setLogoBroken(false);
                  update("logoUrl", e.target.value);
                }}
                placeholder="https://…"
                className={inputClass}
              />
              {values.logoUrl.trim() && !logoBroken && /^https?:\/\//i.test(values.logoUrl.trim()) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={values.logoUrl.trim()}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded border border-border object-cover"
                  onError={() => setLogoBroken(true)}
                />
              )}
            </div>
            <p className="text-xs text-muted">
              {metricool
                ? "Compare nel portale del cliente e nelle anteprime dei post."
                : "Compare nel portale del cliente e nelle anteprime."}
            </p>
          </div>
        </div>

        {/* Services */}
        {showServices && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Servizi</legend>
            <p className="text-xs text-muted">
              Cosa prepari per questo cliente. Il cliente vede tutto nello stesso portale.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {kinds.map((kind) => {
                const checked = values.services.includes(kind);
                return (
                  <label
                    key={kind}
                    className={`flex min-h-11 cursor-pointer items-start gap-2 rounded border px-3 py-2 text-sm ${
                      checked ? "border-accent/50 bg-background" : "border-border"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleService(kind)}
                      className="mt-0.5 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium">
                        <KindIcon kind={kind} className="h-4 w-4 text-muted" />
                        {KIND_UI[kind].serviceLabel}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{SERVICE_DESCRIPTIONS[kind]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {mode === "edit" && initial.services.some((kind) => !values.services.includes(kind)) && (
              <p className="text-xs text-muted">
                I contenuti già creati per un servizio tolto restano visibili a te e al cliente.
              </p>
            )}
          </fieldset>
        )}

        {/* Metricool brand */}
        {socialService && (
          <div className="space-y-1.5">
            <label htmlFor="client-brand" className="block text-sm font-medium">
              Brand su Metricool
            </label>
            {brands.status === "ok" ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    id="client-brand"
                    value={values.metricoolBlogId}
                    onChange={(e) => update("metricoolBlogId", e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Nessun brand collegato</option>
                    {brandList.map((brand) => (
                      <option key={brand.blogId} value={brand.blogId}>
                        {brand.label}
                      </option>
                    ))}
                    {brandMissing && (
                      <option value={values.metricoolBlogId}>
                        Brand {values.metricoolBlogId} (non trovato su Metricool)
                      </option>
                    )}
                  </select>
                  {selectedBrand && (selectedBrand.timezone || selectedBrand.networks.length > 0) && (
                    <button
                      type="button"
                      onClick={applyBrandSettings}
                      className="shrink-0 rounded border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
                    >
                      Usa fuso e reti del brand
                    </button>
                  )}
                </div>
                {brandList.length === 0 && (
                  <p className="text-xs text-warning">
                    Nessun brand trovato sull&apos;account Metricool collegato.
                  </p>
                )}
                {brandMissing && (
                  <p className="text-xs text-warning">
                    Il brand salvato non risulta più tra quelli dell&apos;account Metricool: scegline un altro.
                  </p>
                )}
                {brands.fake && (
                  <p className="text-xs text-muted">Modalità di prova: brand finti, nessuna chiamata a Metricool.</p>
                )}
              </>
            ) : (
              <div className="rounded border border-border bg-background p-3 text-sm">
                {brands.status === "not_configured" ? (
                  <p className="text-muted">
                    Metricool non è collegato.{" "}
                    <Link href="/settings" className="text-accent hover:underline">
                      Collegalo nelle Impostazioni
                    </Link>{" "}
                    per scegliere il brand: senza brand i post approvati non possono essere programmati.
                  </p>
                ) : (
                  <p className="text-warning">
                    {brands.message}{" "}
                    <Link href="/settings" className="text-accent hover:underline">
                      Controlla le Impostazioni
                    </Link>
                    .
                  </p>
                )}
                {values.metricoolBlogId && (
                  <p className="mt-1 text-xs text-muted">
                    Brand attualmente collegato: {values.metricoolBlogId} (resta invariato).
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted">
              I post approvati vengono programmati su questo brand.
            </p>
          </div>
        )}

        {/* Time zone */}
        <div className="space-y-1.5">
          <label htmlFor="client-timezone" className="block text-sm font-medium">
            Fuso orario
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              id="client-timezone"
              value={zoneChoice}
              onChange={(e) => setZoneChoice(e.target.value)}
              className={inputClass}
            >
              {timeZoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value={OTHER_ZONE}>Altro fuso orario…</option>
            </select>
            {zoneChoice === OTHER_ZONE && (
              <input
                aria-label="Nome del fuso orario"
                value={customZone}
                onChange={(e) => setCustomZone(e.target.value)}
                placeholder="Es. America/Montevideo"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={`${inputClass} ${zoneInvalid ? "border-error" : ""}`}
              />
            )}
          </div>
          {zoneInvalid ? (
            <p className="text-xs text-error">
              Fuso orario non riconosciuto. Usa il nome IANA, ad esempio Europe/Rome o America/Bogota.
            </p>
          ) : (
            <p className="text-xs text-muted">
              {metricool
                ? "Gli orari di pubblicazione dei post di questo cliente sono in questo fuso."
                : "Le date dei contenuti di questo cliente sono in questo fuso."}
            </p>
          )}
        </div>

        {/* Networks */}
        {socialService && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Reti social</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {NETWORKS.map((network) => {
                const checked = values.networks.includes(network);
                const connected = selectedBrand?.networks.includes(network);
                return (
                  <label
                    key={network}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ${
                      checked ? "border-accent/50 bg-background" : "border-border"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleNetwork(network)}
                      className="accent-accent"
                    />
                    <span className="min-w-0 truncate">{NETWORK_LABELS[network]}</span>
                    {selectedBrand && connected && (
                      <span className="ml-auto text-xs text-success" title="Account collegato al brand su Metricool">
                        ✓
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted">
              Le reti su cui si possono preparare post per questo cliente. Nessuna selezionata = tutte.
            </p>
          </fieldset>
        )}

        {/* Auto scheduling */}
        {socialService && (
          <label className="flex cursor-pointer items-start gap-3 rounded border border-border p-3">
            <input
              type="checkbox"
              checked={values.autoSchedule}
              onChange={(e) => update("autoSchedule", e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block text-sm font-medium">Programma automaticamente dopo l&apos;approvazione</span>
              <span className="block text-xs text-muted mt-0.5">
                Appena il cliente approva, il post viene programmato su Metricool. Se disattivato, resta
                &quot;Approvato&quot; finché qualcuno dell&apos;agenzia non lo programma.
              </span>
            </span>
          </label>
        )}
      </fieldset>

      {error && <p className="text-sm text-error">{error}</p>}
      {notice && <p className="text-sm text-success">{notice}</p>}

      {!readOnly && (
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={pending || zoneInvalid}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? "Salvataggio…" : mode === "create" ? "Crea cliente" : "Salva modifiche"}
          </button>
          {mode === "create" && (
            <Link
              href="/clients"
              className="rounded border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
            >
              Annulla
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
