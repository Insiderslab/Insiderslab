/**
 * Importing clients from the Metricool brands (pure: no I/O, safe in client
 * components).
 *
 * One brand on Metricool = one client here. Given the brands of the connected
 * account and the clients of the workspace, this module decides for each brand
 * what an import does: create a new client, link an existing one, or skip it
 * (already linked, unknown, ignored). The server action re-fetches both lists
 * and plans with them: the browser only says what it wants per brand
 * (`ImportChoice`), never the brand's data.
 *
 * Idempotent by construction: a brand that already belongs to a client of the
 * workspace (archived ones included) is always skipped, so running an import
 * twice never creates a duplicate.
 */

import type { ContentKind } from "@/app/generated/prisma/client";
import type { Network } from "@/lib/domain";
import { isValidTimeZone } from "@/lib/metricool/payload";
import { sortKinds } from "@/lib/variant";

/** The brand fields an import needs (a subset of MetricoolBrand). */
export interface ImportBrand {
  blogId: string;
  label: string;
  timezone: string | null;
  avatarUrl: string | null;
  networks: readonly Network[];
}

/** The client fields an import looks at. */
export interface ImportClient {
  id: string;
  name: string;
  metricoolBlogId: string | null;
  archivedAt: Date | string | null;
  logoUrl: string | null;
  networks: readonly string[];
  services: readonly ContentKind[];
}

export const IMPORT_ACTIONS = ["create", "link", "skip"] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

/** What the user chose for one brand. `clientId` only for `link`. */
export interface ImportChoice {
  blogId: string;
  action: ImportAction;
  clientId?: string | null;
}

export const DEFAULT_TIME_ZONE = "Europe/Rome";

// ─── Names ───────────────────────────────────────────────────────────────────

/**
 * A name reduced to what identifies it: lower case, no accents, no spaces or
 * punctuation. "Caffè  Aurora " and "caffe aurora" are the same name.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Brand whose name matches `name`, when exactly one does (used by the client form). */
export function findBrandByName<T extends { label: string }>(name: string, brands: readonly T[]): T | null {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const matches = brands.filter((brand) => normalizeName(brand.label) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

// ─── Rows (what the import page shows) ───────────────────────────────────────

export interface ImportRow {
  blogId: string;
  label: string;
  image: string | null;
  timezone: string | null;
  networks: Network[];
  /** Instagram handle etc., for the search box and the row's detail line. */
  accounts: Partial<Record<Network, string>>;
  /** The client that already has this brand (archived ones included), if any. */
  linkedTo: { id: string; name: string; archived: boolean } | null;
  /** Existing unlinked client whose name matches the brand's. */
  suggestedClientId: string | null;
  /** `skip` for a linked brand; else `link` with a name match, else `create`. */
  defaultAction: ImportAction;
}

const isActive = (client: Pick<ImportClient, "archivedAt">) => !client.archivedAt;

/** Clients that can receive a brand: active and without a brand yet. */
export function linkableClients<T extends Pick<ImportClient, "metricoolBlogId" | "archivedAt">>(
  clients: readonly T[]
): T[] {
  return clients.filter((client) => isActive(client) && !client.metricoolBlogId);
}

/**
 * For each unlinked brand, the existing client with the same normalized name.
 * A client is suggested at most once (the first brand in list order wins) and
 * never when two clients share the name: better to ask than to guess.
 */
export function suggestMatches(
  brands: ReadonlyArray<Pick<ImportBrand, "blogId" | "label">>,
  clients: readonly ImportClient[]
): Map<string, string> {
  const byName = new Map<string, ImportClient[]>();
  for (const client of linkableClients(clients)) {
    const key = normalizeName(client.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), client]);
  }

  const linkedBrandIds = new Set(clients.map((client) => client.metricoolBlogId).filter(Boolean));
  const taken = new Set<string>();
  const suggestions = new Map<string, string>();
  for (const brand of brands) {
    if (linkedBrandIds.has(brand.blogId)) continue;
    const candidates = byName.get(normalizeName(brand.label));
    if (!candidates || candidates.length !== 1 || taken.has(candidates[0].id)) continue;
    taken.add(candidates[0].id);
    suggestions.set(brand.blogId, candidates[0].id);
  }
  return suggestions;
}

/** One row per brand, in alphabetical order, with the default choice. */
export function buildImportRows(
  brands: ReadonlyArray<ImportBrand & { accounts?: Partial<Record<Network, string>> }>,
  clients: readonly ImportClient[]
): ImportRow[] {
  const linked = new Map<string, ImportClient>();
  for (const client of clients) {
    if (client.metricoolBlogId && !linked.has(client.metricoolBlogId)) linked.set(client.metricoolBlogId, client);
  }
  const sorted = [...brands].sort((a, b) => a.label.localeCompare(b.label, "it"));
  const suggestions = suggestMatches(sorted, clients);

  return sorted.map((brand) => {
    const owner = linked.get(brand.blogId);
    const suggestedClientId = suggestions.get(brand.blogId) ?? null;
    return {
      blogId: brand.blogId,
      label: brand.label,
      image: brand.avatarUrl,
      timezone: brand.timezone,
      networks: [...brand.networks],
      accounts: brand.accounts ?? {},
      linkedTo: owner ? { id: owner.id, name: owner.name, archived: !isActive(owner) } : null,
      suggestedClientId,
      defaultAction: owner ? "skip" : suggestedClientId ? "link" : "create",
    };
  });
}

/** The choices the page starts from (one per brand that can be imported). */
export function defaultChoices(rows: readonly ImportRow[]): ImportChoice[] {
  return rows
    .filter((row) => !row.linkedTo)
    .map((row) => ({
      blogId: row.blogId,
      action: row.defaultAction,
      clientId: row.defaultAction === "link" ? row.suggestedClientId : null,
    }));
}

// ─── Planning ────────────────────────────────────────────────────────────────

export type SkipReason =
  | "unknown_brand"
  | "already_linked"
  | "client_not_found"
  | "client_has_brand"
  | "client_already_used";

export type ImportStep =
  | { kind: "create"; brand: ImportBrand }
  | { kind: "link"; brand: ImportBrand; client: ImportClient }
  | { kind: "skip"; blogId: string; label: string; reason: SkipReason; detail: string | null };

/** Italian text of a skip, for the result screen. */
export function skipMessage(step: Extract<ImportStep, { kind: "skip" }>): string {
  switch (step.reason) {
    case "unknown_brand":
      return "Brand non più presente su Metricool";
    case "already_linked":
      return step.detail ? `Già collegato a ${step.detail}` : "Già collegato a un cliente";
    case "client_not_found":
      return "Cliente non trovato (archiviato o eliminato)";
    case "client_has_brand":
      return `${step.detail ?? "Il cliente"} è già collegato a un altro brand`;
    case "client_already_used":
      return `${step.detail ?? "Il cliente"} è già stato usato per un altro brand in questa importazione`;
  }
}

/**
 * What an import of `choices` does now, given the brands on Metricool and the
 * clients of the workspace (both read just before, by the server). Choices to
 * `skip` produce no step; a duplicated brand counts once (the first choice).
 * Steps come in the order of the brand list.
 */
export function planImport(input: {
  brands: readonly ImportBrand[];
  clients: readonly ImportClient[];
  choices: readonly ImportChoice[];
}): ImportStep[] {
  const brandsById = new Map(input.brands.map((brand) => [brand.blogId, brand]));
  const clientsById = new Map(input.clients.map((client) => [client.id, client]));
  const ownerOf = new Map<string, ImportClient>();
  for (const client of input.clients) {
    if (client.metricoolBlogId && !ownerOf.has(client.metricoolBlogId)) ownerOf.set(client.metricoolBlogId, client);
  }

  const chosen = new Map<string, ImportChoice>();
  for (const choice of input.choices) {
    if (!chosen.has(choice.blogId)) chosen.set(choice.blogId, choice);
  }

  const steps: ImportStep[] = [];
  const usedClients = new Set<string>();
  // Unknown ids (not in the brand list) come last, as skips.
  const ordered = [...input.brands.map((b) => b.blogId), ...[...chosen.keys()].filter((id) => !brandsById.has(id))];

  for (const blogId of ordered) {
    const choice = chosen.get(blogId);
    if (!choice || choice.action === "skip") continue;

    const brand = brandsById.get(blogId);
    if (!brand) {
      steps.push({ kind: "skip", blogId, label: blogId, reason: "unknown_brand", detail: null });
      continue;
    }
    const owner = ownerOf.get(blogId);
    if (owner) {
      const detail = isActive(owner) ? owner.name : `${owner.name} (archiviato)`;
      steps.push({ kind: "skip", blogId, label: brand.label, reason: "already_linked", detail });
      continue;
    }

    if (choice.action === "create") {
      steps.push({ kind: "create", brand });
      continue;
    }

    const client = choice.clientId ? clientsById.get(choice.clientId) : undefined;
    if (!client || !isActive(client)) {
      steps.push({ kind: "skip", blogId, label: brand.label, reason: "client_not_found", detail: null });
    } else if (client.metricoolBlogId) {
      steps.push({ kind: "skip", blogId, label: brand.label, reason: "client_has_brand", detail: client.name });
    } else if (usedClients.has(client.id)) {
      steps.push({ kind: "skip", blogId, label: brand.label, reason: "client_already_used", detail: client.name });
    } else {
      usedClients.add(client.id);
      steps.push({ kind: "link", brand, client });
    }
  }
  return steps;
}

// ─── What gets written ───────────────────────────────────────────────────────

/** The brand's logo when it is a usable http(s) URL, else null. */
export function usableLogoUrl(image: string | null): string | null {
  if (!image) return null;
  try {
    const url = new URL(image.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Input for createClient from a brand: social posts, automatic scheduling. */
export function newClientInput(brand: ImportBrand) {
  const timezone = brand.timezone && isValidTimeZone(brand.timezone) ? brand.timezone : DEFAULT_TIME_ZONE;
  return {
    name: brand.label.trim().slice(0, 120),
    metricoolBlogId: brand.blogId,
    timezone,
    logoUrl: usableLogoUrl(brand.avatarUrl),
    networks: [...brand.networks],
    autoSchedule: true,
    services: ["SOCIAL_POST"] as ContentKind[],
  };
}

/**
 * Patch for updateClient when linking an existing client to a brand: the
 * brand id, plus the logo and networks only where the client has none. The
 * time zone is never touched (it always has a value and decides publication
 * times: the agency's choice stays). A client without the social service gets
 * it, since it now has a brand to publish on. `enabled` = kinds the instance
 * handles (the form never sends others).
 */
export function linkClientPatch(brand: ImportBrand, client: ImportClient, enabled: readonly ContentKind[]) {
  const logoUrl = usableLogoUrl(brand.avatarUrl);
  const services = client.services.filter((kind) => enabled.includes(kind));
  return {
    metricoolBlogId: brand.blogId,
    ...(!client.logoUrl && logoUrl ? { logoUrl } : {}),
    ...(client.networks.length === 0 && brand.networks.length > 0 ? { networks: [...brand.networks] } : {}),
    ...(!client.services.includes("SOCIAL_POST") ? { services: sortKinds([...services, "SOCIAL_POST"]) } : {}),
  };
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface ImportedClient {
  id: string;
  name: string;
  blogId: string;
}

export interface ImportSummary {
  created: ImportedClient[];
  linked: ImportedClient[];
  skipped: Array<{ blogId: string; label: string; reason: string }>;
}

/** "12 clienti creati, 3 collegati" (zero parts left out). */
export function summaryHeadline(summary: Pick<ImportSummary, "created" | "linked">): string {
  const parts: string[] = [];
  const created = summary.created.length;
  const linked = summary.linked.length;
  if (created > 0) parts.push(`${created} ${created === 1 ? "cliente creato" : "clienti creati"}`);
  if (linked > 0) parts.push(`${linked} ${linked === 1 ? "collegato" : "collegati"}`);
  return parts.length > 0 ? parts.join(", ") : "Nessun cliente importato";
}

/** Label of the import button: "Importa 12 clienti". */
export function importButtonLabel(count: number): string {
  if (count === 0) return "Importa clienti";
  return count === 1 ? "Importa 1 cliente" : `Importa ${count} clienti`;
}
