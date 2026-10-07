/**
 * Client Detail Page
 *
 * First, "Link per il cliente": the personal link of each active reviewer,
 * ready to copy or send on WhatsApp (or a quick "Chi approva?" form that
 * creates one). Then
 * One overview per service of the client (social posts, articles, ads
 * creatives: how many wait for the client, have changes requested, are
 * approved, are scheduled / published / delivered, with links to the
 * filtered list and a "Nuovo …" button), latest items, reviewers and their
 * links, client settings (services, Metricool brand, time zone, networks,
 * automatic scheduling — Metricool parts only for clients with social posts
 * on instances that handle them), archive.
 */

import Link from "next/link";
import type { ContentKind } from "@/app/generated/prisma/client";
import { notFound, redirect } from "next/navigation";
import { loadBrandOptions } from "@/app/(dashboard)/clients/brands";
import ArchiveButton from "@/components/clients/archive-button";
import ClientForm from "@/components/clients/client-form";
import {
  buildTimeZoneOptions,
  clientInitials,
  formatDateTime,
  groupKindStatusCounts,
  serviceOverview,
} from "@/components/clients/helpers";
import ReviewerList, { type ReviewerRow } from "@/components/clients/reviewer-list";
import ClientLinksPanel from "@/components/share/client-links-panel";
import { buildPostsHref, contentWords, newContentHref } from "@/components/posts/helpers";
import { KindBadge, KindIcon, KindStatusBadge } from "@/components/posts/kind-badge";
import { clientServices, getClient } from "@/lib/clients";
import { prisma } from "@/lib/db/client";
import { NETWORK_LABELS, formatTimecode, isNetwork, parseMediaItems } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { summarizeVersionForList } from "@/lib/posts";
import { getReviewUrl } from "@/lib/reviewers";
import { KIND_UI, enabledKinds, isMetricoolEnabled, kindParam, productName, servicesSentence, sortKinds } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Cliente - ${productName()}` };
}

const RECENT_POSTS = 8;

const toneClass = {
  neutral: "text-muted",
  info: "text-accent",
  warning: "text-warning",
  success: "text-success",
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

  const kinds = enabledKinds();
  const services = clientServices(client, kinds);
  const metricool = isMetricoolEnabled();
  const social = metricool && services.includes("SOCIAL_POST");
  const singleKind = kinds.length === 1 ? kinds[0] : null;
  const words = contentWords(services.length > 0 ? services : kinds);
  const postWhere = {
    workspaceId: context.workspaceId,
    clientId: client.id,
    kind: { in: kinds },
    status: { not: "CANCELLED" as const },
  };

  const [brands, grouped, recentPosts] = await Promise.all([
    // No Metricool call at all on blog / ads instances.
    metricool ? loadBrandOptions(context.workspaceId) : Promise.resolve({ status: "not_configured" as const }),
    prisma.post.groupBy({
      by: ["kind", "status"],
      where: postWhere,
      _count: { _all: true },
    }),
    prisma.post.findMany({
      where: postWhere,
      orderBy: { publishAt: "desc" },
      take: RECENT_POSTS,
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        publishAt: true,
        networks: true,
        versions: { orderBy: { number: "desc" }, take: 1, select: { text: true, media: true, content: true } },
      },
    }),
  ]);

  const countsByKind = groupKindStatusCounts(
    grouped.map((row) => ({ kind: row.kind, status: row.status, count: row._count._all }))
  );
  // Active services first; a removed service with content keeps its card (history).
  const shownKinds = sortKinds([...services, ...kinds.filter((kind) => countsByKind[kind])]);
  const total = shownKinds.reduce((sum, kind) => sum + serviceOverview(kind, countsByKind[kind]).total, 0);
  const archived = Boolean(client.archivedAt);
  const listHref = (kind: ContentKind, status?: string) =>
    buildPostsHref({ kind: singleKind ? "" : kindParam(kind), clientId: client.id, status: status ?? "" });

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
  const linkRows = reviewers
    .filter((r) => r.active)
    .map(({ id, name, email, reviewUrl, lastSeenLabel }) => ({ id, name, email, reviewUrl, lastSeenLabel }));

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
            className="h-14 w-14 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-base font-semibold text-accent">
            {clientInitials(client.name)}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="break-words text-2xl font-semibold">{client.name}</h2>
          <p className="text-sm text-muted">
            {client.timezone}
            {social && client.metricoolBlogId ? " · brand Metricool collegato" : ""}
            {social ? (client.autoSchedule ? " · programmazione automatica" : " · programmazione manuale") : ""}
          </p>
          {kinds.length > 1 && (
            <p className="text-sm text-muted">
              {services.length > 0 ? `Servizi: ${servicesSentence(services)}` : "Nessun servizio attivo"}
            </p>
          )}
        </div>
      </div>

      {archived && (
        <div className="panel p-4 text-sm">
          <p className="text-warning">
            Cliente archiviato il {formatDateTime(client.archivedAt!)}: i link dei referenti non funzionano.
          </p>
          <p className="mt-1 text-muted">Ripristinalo per modificarlo o inviare nuovi {words.plural}.</p>
        </div>
      )}

      {query.nuovo === "1" && !archived && activeReviewers === 0 && (
        <p className="text-sm">
          <span className="text-success">Cliente creato.</span>{" "}
          <span className="text-muted">Ora crea il link per chi deve approvare {words.the}.</span>
        </p>
      )}

      {/* Links to send to the client (never for archived clients: their links do not work) */}
      {!archived && (
        <ClientLinksPanel
          clientId={client.id}
          clientName={client.name}
          reviewers={linkRows}
          contentsThe={words.the}
        />
      )}

      {/* Services */}
      <section className="panel p-4 sm:p-6" aria-labelledby="client-services">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 id="client-services" className="text-lg font-semibold">
            {kinds.length > 1 ? "Servizi" : words.Plural}
          </h3>
          {total > 0 && (
            <Link href={`/posts?clientId=${client.id}`} className="btn btn-sm btn-quiet">
              {words.all} ({total})
            </Link>
          )}
        </div>

        {shownKinds.length === 0 ? (
          <p className="mb-4 text-sm text-muted">
            Nessun servizio attivo per questo cliente in {productName()}: sceglilo nei dati del cliente qui sotto.
          </p>
        ) : (
          <div className="mb-4 space-y-3">
            {shownKinds.map((kind) => {
              const overview = serviceOverview(kind, countsByKind[kind]);
              const active = services.includes(kind);
              return (
                <div
                  key={kind}
                  className="inset p-3 sm:p-4"
                  data-testid={`service-${kindParam(kind)}`}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <KindIcon kind={kind} className="h-4 w-4 text-accent" />
                      {KIND_UI[kind].serviceLabel}
                      {!active && <span className="text-xs font-normal text-muted">· servizio non attivo</span>}
                    </h4>
                    <div className="flex gap-2">
                      {overview.total > 0 && (
                        <Link href={listHref(kind)} className="btn btn-sm btn-quiet">
                          Vedi tutti ({overview.total})
                        </Link>
                      )}
                      {active && !archived && (
                        <Link href={newContentHref(kind, { clientId: client.id })} className="btn btn-sm">
                          {KIND_UI[kind].newTitle}
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {overview.entries.map((entry) => (
                      <Link
                        key={entry.key}
                        href={listHref(kind, entry.status)}
                        className="rounded-lg bg-surface p-2.5 transition-colors hover:bg-surface-hover"
                      >
                        <p className={`text-xs ${toneClass[entry.tone]}`}>{entry.label}</p>
                        <p className="tabular mt-0.5 text-lg font-semibold">{entry.count}</p>
                      </Link>
                    ))}
                  </div>
                  {(overview.drafts > 0 || overview.failed > 0 || !active) && (
                    <p className="mt-2 text-xs text-muted">
                      {overview.drafts > 0 && (
                        <Link href={listHref(kind, "DRAFT")} className="hover:underline">
                          {overview.drafts === 1 ? "1 bozza" : `${overview.drafts} bozze`}
                        </Link>
                      )}
                      {overview.drafts > 0 && overview.failed > 0 && " · "}
                      {overview.failed > 0 && (
                        <Link href={listHref(kind, "FAILED")} className="text-error hover:underline">
                          {overview.failed === 1 ? "1 errore di programmazione" : `${overview.failed} errori di programmazione`}
                        </Link>
                      )}
                      {!active && (
                        <span>
                          {overview.drafts > 0 || overview.failed > 0 ? " · " : ""}I contenuti già creati restano
                          visibili; per prepararne di nuovi riattiva il servizio.
                        </span>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {recentPosts.length > 0 && (
          <ul className="divide-y divide-border">
            {recentPosts.map((post) => {
              const social = post.kind === "SOCIAL_POST";
              const media = social ? parseMediaItems(post.versions[0]?.media) : [];
              const video = media.find((item) => item.type === "video");
              const networks = social ? post.networks.filter(isNetwork) : [];
              const summary = post.kind === "AD_CREATIVE" ? summarizeVersionForList(post.kind, post.versions[0]) : null;
              return (
                <li key={post.id}>
                  <Link
                    href={`/posts/${post.id}`}
                    className="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        {!singleKind && <KindBadge kind={post.kind} iconOnly />}
                        <span className="truncate">{post.title}</span>
                      </p>
                      <p className="truncate text-xs text-muted">
                        {formatDateTime(post.publishAt, client.timezone)}
                        {networks.length > 0 && ` · ${networks.map((n) => NETWORK_LABELS[n]).join(", ")}`}
                        {video &&
                          ` · video${video.durationSec ? ` ${formatTimecode(video.durationSec)}` : ""}`}
                        {summary?.variantCount
                          ? ` · ${summary.variantCount === 1 ? "1 variante" : `${summary.variantCount} varianti`}`
                          : ""}
                      </p>
                    </div>
                    <KindStatusBadge kind={post.kind} status={post.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Reviewers */}
      <section id="referenti" className="panel scroll-mt-4 p-4 sm:p-6">
        <h3 className="mb-1 text-lg font-semibold">Referenti</h3>
        <p className="mb-4 text-sm text-muted">
          Le persone di {client.name} che rivedono e approvano {words.the} dal proprio link personale.
        </p>
        <ReviewerList
          clientId={client.id}
          clientName={client.name}
          reviewers={reviewers}
          archived={archived}
          contentsThe={words.the}
        />
      </section>

      {/* Settings */}
      <section className="panel p-4 sm:p-6">
        <h3 className="mb-6 text-lg font-semibold">Dati del cliente</h3>
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
            services,
          }}
          timeZoneOptions={buildTimeZoneOptions()}
          brands={brands}
          readOnly={archived}
          metricool={metricool}
          kinds={kinds}
        />
      </section>

      {/* Archive */}
      <section className="panel p-4 sm:p-6">
        <h3 className="mb-1 text-lg font-semibold">{archived ? "Ripristina" : "Archivia"}</h3>
        <p className="mb-4 text-sm text-muted">
          {archived
            ? "Il cliente torna negli elenchi; i referenti attivi possono di nuovo usare il loro link."
            : `Il cliente sparisce dagli elenchi e i link dei referenti smettono di funzionare. ${words.Plural} e storico restano.`}
        </p>
        <ArchiveButton clientId={client.id} clientName={client.name} archived={archived} />
      </section>
    </div>
  );
}
