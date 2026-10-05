/**
 * Client Detail Page
 *
 * Reviewers and their links, client settings (Metricool brand, time zone,
 * networks, automatic scheduling), post counts and latest posts, archive.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadBrandOptions } from "@/app/(dashboard)/clients/brands";
import ArchiveButton from "@/components/clients/archive-button";
import ClientForm from "@/components/clients/client-form";
import {
  buildTimeZoneOptions,
  clientInitials,
  formatDateTime,
  groupStatusCounts,
  statusCountEntries,
  totalPosts,
} from "@/components/clients/helpers";
import ReviewerList, { type ReviewerRow } from "@/components/clients/reviewer-list";
import StatusBadge from "@/components/status-badge";
import { getClient } from "@/lib/clients";
import { prisma } from "@/lib/db/client";
import {
  NETWORK_LABELS,
  STATUS_TONES,
  formatTimecode,
  isNetwork,
  parseMediaItems,
} from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { getReviewUrl } from "@/lib/reviewers";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Cliente - Approve by Heili" };

const RECENT_POSTS = 8;

const toneClass = {
  neutral: "text-muted",
  info: "text-accent",
  warning: "text-warning",
  success: "text-success",
  error: "text-error",
} as const;

function safeReviewUrl(reviewer: { tokenEncrypted: string }): string | null {
  try {
    return getReviewUrl(reviewer);
  } catch (error) {
    // ENCRYPTION_KEY rotated or row corrupted: "Nuovo link" fixes it.
    console.error("[clients] Could not decrypt a review link:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuovo?: string }>;
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const [{ id }, query] = await Promise.all([params, searchParams]);

  let client;
  try {
    client = await getClient(id, context.workspaceId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [brands, grouped, recentPosts] = await Promise.all([
    loadBrandOptions(context.workspaceId),
    prisma.post.groupBy({
      by: ["clientId", "status"],
      where: { workspaceId: context.workspaceId, clientId: client.id, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
    prisma.post.findMany({
      where: { workspaceId: context.workspaceId, clientId: client.id, status: { not: "CANCELLED" } },
      orderBy: { publishAt: "desc" },
      take: RECENT_POSTS,
      select: {
        id: true,
        title: true,
        status: true,
        publishAt: true,
        networks: true,
        versions: { orderBy: { number: "desc" }, take: 1, select: { media: true } },
      },
    }),
  ]);

  const counts = groupStatusCounts(
    grouped.map((row) => ({ clientId: row.clientId, status: row.status, count: row._count._all }))
  )[client.id];
  const entries = statusCountEntries(counts);
  const total = totalPosts(counts);
  const archived = Boolean(client.archivedAt);

  const reviewers: ReviewerRow[] = client.reviewers.map((reviewer) => ({
    id: reviewer.id,
    name: reviewer.name,
    email: reviewer.email,
    active: reviewer.active,
    reviewUrl: reviewer.active && !archived ? safeReviewUrl(reviewer) : null,
    lastSeenLabel: reviewer.lastSeenAt ? formatDateTime(reviewer.lastSeenAt) : null,
    createdLabel: formatDateTime(reviewer.createdAt),
  }));
  const activeReviewers = reviewers.filter((r) => r.active).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/clients" className="text-sm text-muted hover:text-foreground">
        ← Clienti
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        {client.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={client.logoUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded border border-border object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-border bg-surface text-base font-semibold text-muted">
            {clientInitials(client.name)}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{client.name}</h2>
          <p className="text-sm text-muted">
            {client.timezone}
            {client.metricoolBlogId ? " · brand Metricool collegato" : ""}
            {client.autoSchedule ? " · programmazione automatica" : " · programmazione manuale"}
          </p>
        </div>
      </div>

      {archived && (
        <div className="panel rounded p-4 text-sm">
          <p className="text-warning">
            Cliente archiviato il {formatDateTime(client.archivedAt!)}: i link dei referenti non funzionano.
          </p>
          <p className="mt-1 text-muted">Ripristinalo per modificarlo o inviare nuovi post.</p>
        </div>
      )}

      {query.nuovo === "1" && !archived && activeReviewers === 0 && (
        <div className="panel rounded p-4 text-sm">
          <span className="text-success">Cliente creato.</span>{" "}
          <span className="text-muted">Ora aggiungi chi deve approvare i post.</span>
        </div>
      )}

      {/* Posts */}
      <section className="panel rounded p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Post</h3>
          <div className="flex gap-2">
            {total > 0 && (
              <Link
                href={`/posts?clientId=${client.id}`}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
              >
                Tutti i post ({total})
              </Link>
            )}
            {!archived && (
              <Link
                href={`/posts/new?clientId=${client.id}`}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Nuovo post
              </Link>
            )}
          </div>
        </div>

        {entries.length > 0 ? (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {entries.map((entry) => (
              <Link
                key={entry.status}
                href={`/posts?clientId=${client.id}&status=${entry.status}`}
                className="rounded border border-border bg-background p-3 hover:border-border-hover"
              >
                <p className={`text-xs ${toneClass[STATUS_TONES[entry.status]]}`}>{entry.label}</p>
                <p className="mt-1 text-xl font-semibold">{entry.count}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Nessun post per questo cliente.</p>
        )}

        {recentPosts.length > 0 && (
          <ul className="divide-y divide-border rounded border border-border bg-background">
            {recentPosts.map((post) => {
              const media = parseMediaItems(post.versions[0]?.media);
              const video = media.find((item) => item.type === "video");
              const networks = post.networks.filter(isNetwork);
              return (
                <li key={post.id}>
                  <Link
                    href={`/posts/${post.id}`}
                    className="flex flex-col gap-1 p-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{post.title}</p>
                      <p className="truncate text-xs text-muted">
                        {formatDateTime(post.publishAt, client.timezone)}
                        {networks.length > 0 && ` · ${networks.map((n) => NETWORK_LABELS[n]).join(", ")}`}
                        {video &&
                          ` · video${video.durationSec ? ` ${formatTimecode(video.durationSec)}` : ""}`}
                      </p>
                    </div>
                    <StatusBadge status={post.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Reviewers */}
      <section className="panel rounded p-4 sm:p-6">
        <h3 className="mb-1 text-base font-semibold">Referenti</h3>
        <p className="mb-4 text-sm text-muted">
          Le persone di {client.name} che rivedono e approvano i post dal proprio link personale.
        </p>
        <ReviewerList
          clientId={client.id}
          clientName={client.name}
          reviewers={reviewers}
          archived={archived}
        />
      </section>

      {/* Settings */}
      <section className="panel rounded p-4 sm:p-6">
        <h3 className="mb-6 text-base font-semibold">Dati del cliente</h3>
        <ClientForm
          mode="edit"
          clientId={client.id}
          initial={{
            name: client.name,
            logoUrl: client.logoUrl ?? "",
            timezone: client.timezone,
            metricoolBlogId: client.metricoolBlogId ?? "",
            networks: client.networks.filter(isNetwork),
            autoSchedule: client.autoSchedule,
          }}
          timeZoneOptions={buildTimeZoneOptions()}
          brands={brands}
          readOnly={archived}
        />
      </section>

      {/* Archive */}
      <section className="panel rounded p-4 sm:p-6">
        <h3 className="mb-1 text-base font-semibold">{archived ? "Ripristina" : "Archivia"}</h3>
        <p className="mb-4 text-sm text-muted">
          {archived
            ? "Il cliente torna negli elenchi; i referenti attivi possono di nuovo usare il loro link."
            : "Il cliente sparisce dagli elenchi e i link dei referenti smettono di funzionare. Post e storico restano."}
        </p>
        <ArchiveButton clientId={client.id} clientName={client.name} archived={archived} />
      </section>
    </div>
  );
}
