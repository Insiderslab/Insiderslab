/**
 * Clients (= brands on Metricool) of the agency. Every function is scoped to
 * a workspace: an id coming from the browser is only trusted after it has
 * been matched against the caller's workspaceId.
 *
 * Clients are archived, never deleted, so posts and their audit log survive.
 *
 * Metricool brand, networks and auto-scheduling only mean something for
 * social posts: on instances without SOCIAL_POST (blog / ads variants, see
 * lib/variant.ts) those fields are ignored on write and left empty.
 *
 * Services (Client.services): which content kinds the agency prepares for
 * the client — social posts, blog articles, ads creatives. Never empty. The
 * kinds a client can get on this instance are its services that APP_VARIANT
 * enables (clientServices). Content can only be created for an active
 * service (lib/posts.ts createPost); removing a service never hides the
 * content already made for it.
 */

import { z } from "zod";
import type { Client, ClientReviewer, ContentKind } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { CONTENT_KINDS, NETWORKS } from "@/lib/domain";
import { NotFoundError, ValidationError, parseOrThrow } from "@/lib/errors";
import { isValidTimeZone } from "@/lib/metricool/payload";
import { defaultKind, enabledKinds, isMetricoolEnabled, productName, serviceLabel, sortKinds } from "@/lib/variant";

// One time-zone check for the whole app (also used by the Metricool payload).
export { isValidTimeZone };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// ─── Services ────────────────────────────────────────────────────────────────

/** A list of content kinds, deduplicated and in menu order (social, blog, ads). */
export const servicesSchema = z
  .array(z.enum(CONTENT_KINDS as [ContentKind, ...ContentKind[]], { error: "Servizio non valido" }))
  .max(CONTENT_KINDS.length * 2)
  .transform((list) => sortKinds(list));

/** "Il servizio «Articoli» non è attivo per questo cliente". */
export function serviceNotActiveMessage(kind: ContentKind): string {
  return `Il servizio «${serviceLabel(kind)}» non è attivo per questo cliente`;
}

/**
 * Services chosen in the agency form, checked against the instance: at least
 * one (unless `allowEmpty`, see mergeServices) and only kinds APP_VARIANT
 * enables. Returns them sorted; throws ValidationError in Italian (pure).
 */
export function validateServices(
  services: readonly ContentKind[],
  enabled: readonly ContentKind[] = enabledKinds(),
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
): ContentKind[] {
  const sorted = sortKinds(services);
  const disabled = sorted.filter((kind) => !enabled.includes(kind));
  if (disabled.length > 0) {
    throw new ValidationError(
      `Il servizio «${serviceLabel(disabled[0])}» non è disponibile in ${productName()}`
    );
  }
  if (sorted.length === 0 && !allowEmpty) throw new ValidationError("Scegli almeno un servizio per il cliente");
  return sorted;
}

/**
 * Services after an edit: the form only shows the kinds this instance
 * enables, so the stored services of other kinds are kept as they are
 * (a blog instance never removes a client's social service). Never empty.
 */
export function mergeServices(
  stored: readonly ContentKind[],
  chosen: readonly ContentKind[],
  enabled: readonly ContentKind[] = enabledKinds()
): ContentKind[] {
  const valid = validateServices(chosen, enabled, { allowEmpty: true });
  const merged = sortKinds([...stored.filter((kind) => !enabled.includes(kind)), ...valid]);
  if (merged.length === 0) throw new ValidationError("Scegli almeno un servizio per il cliente");
  return merged;
}

/** The client's services this instance handles, in menu order (pure). */
export function clientServices(
  client: Pick<Client, "services">,
  enabled: readonly ContentKind[] = enabledKinds()
): ContentKind[] {
  return sortKinds((client.services ?? []).filter((kind) => enabled.includes(kind)));
}

/** True when content of `kind` can be created for the client (pure). */
export function clientHasService(
  client: Pick<Client, "services">,
  kind: ContentKind,
  enabled: readonly ContentKind[] = enabledKinds()
): boolean {
  return clientServices(client, enabled).includes(kind);
}

/**
 * Services of a client that existed before services did — the rule of the
 * `client_services` migration backfill: the kinds it already has content of,
 * plus social posts when it has social networks or a Metricool brand; social
 * posts when that leaves nothing (pure).
 */
export function inferClientServices(client: {
  postKinds: readonly ContentKind[];
  networks: readonly string[] | null;
  metricoolBlogId: string | null;
}): ContentKind[] {
  const kinds: ContentKind[] = [...client.postKinds];
  if ((client.networks?.length ?? 0) > 0 || client.metricoolBlogId) kinds.push("SOCIAL_POST");
  const sorted = sortKinds(kinds);
  return sorted.length > 0 ? sorted : ["SOCIAL_POST"];
}

// ─── Input ───────────────────────────────────────────────────────────────────

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome del cliente").max(120),
  metricoolBlogId: optionalText(64),
  timezone: z
    .string()
    .trim()
    .refine(isValidTimeZone, "Fuso orario non valido")
    .default("Europe/Rome"),
  logoUrl: z
    .string()
    .trim()
    .url("URL del logo non valido")
    .refine((url) => /^https?:\/\//i.test(url), "Il logo deve essere un URL http(s)")
    .nullish()
    .or(z.literal("").transform(() => null)),
  networks: z
    .array(z.enum(NETWORKS))
    .default([])
    .transform((list) => [...new Set(list)]),
  autoSchedule: z.boolean().default(true),
  /** Absent = the instance's first kind (social posts on social / all). */
  services: servicesSchema.optional(),
});

export type ClientInput = z.input<typeof clientInputSchema>;

/** Same fields, all optional, without defaults (absent = unchanged). */
export const clientUpdateSchema = z.object({
  name: clientInputSchema.shape.name.optional(),
  metricoolBlogId: optionalText(64).optional(),
  timezone: z.string().trim().refine(isValidTimeZone, "Fuso orario non valido").optional(),
  logoUrl: clientInputSchema.shape.logoUrl.optional(),
  networks: z
    .array(z.enum(NETWORKS))
    .transform((list) => [...new Set(list)])
    .optional(),
  autoSchedule: z.boolean().optional(),
  /** Kinds this instance enables; stored services of other kinds are kept. */
  services: servicesSchema.optional(),
});

export type ClientUpdateInput = z.input<typeof clientUpdateSchema>;

export type ClientListItem = Client & {
  _count: { posts: number; reviewers: number };
};

export async function listClients(
  workspaceId: string,
  options: { includeArchived?: boolean } = {}
): Promise<ClientListItem[]> {
  return prisma.client.findMany({
    where: {
      workspaceId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    include: {
      _count: {
        select: {
          posts: { where: { status: { not: "CANCELLED" }, kind: { in: enabledKinds() } } },
          reviewers: { where: { active: true } },
        },
      },
    },
  });
}

export type ClientWithReviewers = Client & { reviewers: ClientReviewer[] };

/** Throws NotFoundError when the client is not in this workspace. */
export async function getClient(clientId: string, workspaceId: string): Promise<ClientWithReviewers> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    include: { reviewers: { orderBy: [{ active: "desc" }, { createdAt: "asc" }] } },
  });
  if (!client) throw new NotFoundError("Cliente non trovato");
  return client;
}

export async function createClient(workspaceId: string, input: ClientInput): Promise<Client> {
  const data = parseOrThrow(clientInputSchema, input);
  const services = validateServices(data.services ?? [defaultKind()]);
  // Metricool brand and networks only for clients with social posts.
  const social = isMetricoolEnabled() && services.includes("SOCIAL_POST");
  return prisma.client.create({
    data: {
      workspaceId,
      name: data.name,
      metricoolBlogId: social ? data.metricoolBlogId : null,
      timezone: data.timezone,
      logoUrl: data.logoUrl ?? null,
      networks: social ? data.networks : [],
      autoSchedule: data.autoSchedule,
      services,
    },
  });
}

export async function updateClient(
  clientId: string,
  workspaceId: string,
  input: ClientUpdateInput
): Promise<Client> {
  const parsed = parseOrThrow(clientUpdateSchema, input);
  const data = isMetricoolEnabled()
    ? parsed
    : { ...parsed, metricoolBlogId: undefined, networks: undefined, autoSchedule: undefined };
  const current = await assertClientInWorkspace(clientId, workspaceId);
  const services = data.services !== undefined ? mergeServices(current.services, data.services) : undefined;
  return prisma.client.update({
    where: { id: clientId },
    data: {
      ...(services !== undefined ? { services } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.metricoolBlogId !== undefined ? { metricoolBlogId: data.metricoolBlogId } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
      ...(data.networks !== undefined ? { networks: data.networks } : {}),
      ...(data.autoSchedule !== undefined ? { autoSchedule: data.autoSchedule } : {}),
    },
  });
}

/** Archived clients disappear from lists and their review links stop working. */
export async function archiveClient(clientId: string, workspaceId: string): Promise<Client> {
  await assertClientInWorkspace(clientId, workspaceId);
  return prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } });
}

export async function restoreClient(clientId: string, workspaceId: string): Promise<Client> {
  await assertClientInWorkspace(clientId, workspaceId);
  return prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } });
}

export async function assertClientInWorkspace(
  clientId: string,
  workspaceId: string,
  options: { allowArchived?: boolean } = { allowArchived: true }
): Promise<Client> {
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId } });
  if (!client || (!options.allowArchived && client.archivedAt)) {
    throw new NotFoundError("Cliente non trovato");
  }
  return client;
}
