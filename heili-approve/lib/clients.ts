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
 */

import { z } from "zod";
import type { Client, ClientReviewer } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { NETWORKS } from "@/lib/domain";
import { NotFoundError, parseOrThrow } from "@/lib/errors";
import { isValidTimeZone } from "@/lib/metricool/payload";
import { enabledKinds, isMetricoolEnabled } from "@/lib/variant";

// One time-zone check for the whole app (also used by the Metricool payload).
export { isValidTimeZone };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

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
  const social = isMetricoolEnabled();
  return prisma.client.create({
    data: {
      workspaceId,
      name: data.name,
      metricoolBlogId: social ? data.metricoolBlogId : null,
      timezone: data.timezone,
      logoUrl: data.logoUrl ?? null,
      networks: social ? data.networks : [],
      autoSchedule: data.autoSchedule,
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
  await assertClientInWorkspace(clientId, workspaceId);
  return prisma.client.update({
    where: { id: clientId },
    data: {
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
