/**
 * Dashboard Page
 *
 * Where the agency starts the day: counters by stage (each opens the
 * filtered list), the items that need someone to act ("Da gestire": changes
 * requested, scheduling errors, approvals waiting for a manual schedule or,
 * for articles and ad sets, for the export and "Segna come pubblicato /
 * consegnato", reviews past their deadline) and what goes out next.
 *
 * Only the kinds this instance handles (APP_VARIANT) are counted. With
 * several kinds a card per kind splits the counts; published / delivered
 * items (DELIVERED) count as done, like the scheduled social posts.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ContentKind, PostStatus, Prisma } from "@/app/generated/prisma/client";
import {
  DEFAULT_TIME_ZONE,
  addDays,
  buildPostsHref,
  contentWords,
  dayKeyIn,
  formatDateTime,
  newContentHref,
  startOfDayUtc,
  startOfWeek,
} from "@/components/posts/helpers";
import { KindIcon, KindStatusBadge } from "@/components/posts/kind-badge";
import { getCurrentClientId } from "@/lib/current-client";
import { prisma } from "@/lib/db/client";
import { KIND_CONFIG, NETWORK_LABELS, isNetwork } from "@/lib/domain";
import { KIND_UI, enabledKinds, isMetricoolEnabled, kindParam, productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Dashboard - ${productName()}` };
}

const LIST_LIMIT = 10;

const postSelect = {
  id: true,
  title: true,
  kind: true,
  status: true,
  publishAt: true,
  networks: true,
  lastError: true,
  reviewDueAt: true,
  client: { select: { id: true, name: true, timezone: true, autoSchedule: true, metricoolBlogId: true } },
  _count: { select: { comments: { where: { authorType: "CLIENT" as const, resolvedAt: null } } } },
} as const;

/** Stages of the per-kind cards; "Fatti" = scheduled on Metricool or published / delivered. */
const KIND_STAGES: Array<{ label: string; statuses: PostStatus[]; tone: string }> = [
  { label: "In revisione", statuses: ["IN_REVIEW"], tone: "" },
  { label: "Modifiche richieste", statuses: ["CHANGES_REQUESTED"], tone: "text-warning" },
  { label: "Approvati", statuses: ["APPROVED", "SCHEDULING"], tone: "" },
  { label: "Fatti", statuses: ["SCHEDULED", "DELIVERED"], tone: "text-success" },
];

export default async function DashboardPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  const workspaceId = context.workspaceId;
  // The client picked in the menu scopes the whole page; none = all clients.
  const currentClientId = await getCurrentClientId(workspaceId);
  const scope = currentClientId ? { clientId: currentClientId } : {};

  const kinds = enabledKinds();
  const social = kinds.includes("SOCIAL_POST");
  const internalKinds = kinds.filter((kind) => KIND_CONFIG[kind].internal);
  const multiKind = kinds.length > 1;
  const words = contentWords(kinds);
  const metricool = isMetricoolEnabled();

  // "Questa settimana" = Monday to Sunday in the agency's zone.
  const now = new Date();
  const monday = startOfWeek(dayKeyIn(now, DEFAULT_TIME_ZONE));
  const weekStart = startOfDayUtc(monday, DEFAULT_TIME_ZONE);
  const weekEnd = startOfDayUtc(addDays(monday, 7), DEFAULT_TIME_ZONE);

  const attentionWhere: Prisma.PostWhereInput[] = [
    { status: { in: ["CHANGES_REQUESTED", "FAILED"] } },
    // The client is late.
    { status: "IN_REVIEW", reviewDueAt: { lt: now } },
  ];
  if (social) {
    // Approved but nobody will schedule it unless the agency does.
    attentionWhere.push({
      kind: "SOCIAL_POST",
      status: "APPROVED",
      OR: [{ client: { autoSchedule: false } }, { client: { metricoolBlogId: null } }],
    });
  }
  if (internalKinds.length > 0) {
    // Approved articles / ad sets wait for the export and "Segna come pubblicato / consegnato".
    attentionWhere.push({ kind: { in: internalKinds }, status: "APPROVED" });
  }

  const [grouped, doneThisWeek, clientCount, currentClient, attention, upcoming] = await Promise.all([
    prisma.post.groupBy({
      by: ["kind", "status"],
      where: { workspaceId, ...scope, kind: { in: kinds }, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
    // Done this week: scheduled social posts and published / delivered items, by planned date.
    prisma.post.count({
      where: {
        workspaceId,
        ...scope,
        kind: { in: kinds },
        status: { in: ["SCHEDULED", "DELIVERED"] },
        publishAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    prisma.client.count({ where: { workspaceId, archivedAt: null } }),
    currentClientId
      ? prisma.client.findFirst({
          where: { id: currentClientId, workspaceId },
          select: { id: true, name: true, _count: { select: { reviewers: { where: { active: true } } } } },
        })
      : Promise.resolve(null),
    prisma.post.findMany({
      where: { workspaceId, ...scope, kind: { in: kinds }, OR: attentionWhere },
      orderBy: { publishAt: "asc" },
      take: LIST_LIMIT + 1,
      select: postSelect,
    }),
    prisma.post.findMany({
      where: {
        workspaceId,
        ...scope,
        kind: { in: kinds },
        status: { in: ["SCHEDULED", "SCHEDULING", "APPROVED", "DELIVERED"] },
        publishAt: { gte: now },
      },
      orderBy: { publishAt: "asc" },
      take: 8,
      select: postSelect,
    }),
  ]);

  const count = (statuses: PostStatus[], kind?: ContentKind) =>
    grouped
      .filter((g) => statuses.includes(g.status) && (!kind || g.kind === kind))
      .reduce((sum, g) => sum + g._count._all, 0);
  const statusHref = (status: string) => buildPostsHref({ status });

  const approvedLabel = !social
    ? kinds[0] === "BLOG_ARTICLE"
      ? "Approvati da pubblicare"
      : "Approvati da consegnare"
    : multiKind
      ? "Approvati"
      : "Approvati da programmare";
  const doneLabel = !social
    ? kinds[0] === "BLOG_ARTICLE"
      ? "Pubblicati questa settimana"
      : "Consegnati questa settimana"
    : multiKind
      ? "Fatti questa settimana"
      : "Programmati questa settimana";

  const counters = [
    { label: "In revisione", value: count(["IN_REVIEW"]), href: statusHref("IN_REVIEW"), tone: "", hint: "dal cliente" },
    {
      label: "Modifiche richieste",
      value: count(["CHANGES_REQUESTED"]),
      href: statusHref("CHANGES_REQUESTED"),
      tone: count(["CHANGES_REQUESTED"]) > 0 ? "text-warning" : "",
      hint: "da sistemare",
    },
    { label: approvedLabel, value: count(["APPROVED"]), href: statusHref("APPROVED"), tone: "", hint: "pronti" },
    { label: doneLabel, value: doneThisWeek, href: `/calendar?settimana=${monday}`, tone: "", hint: "da lunedì a domenica" },
    ...(social
      ? [
          {
            label: "Errori",
            value: count(["FAILED"]),
            href: statusHref("FAILED"),
            tone: count(["FAILED"]) > 0 ? "text-error" : "",
            hint: "su Metricool",
          },
        ]
      : []),
  ];

  function reason(post: (typeof attention)[number]): string {
    const internal = KIND_CONFIG[post.kind].internal;
    switch (post.status) {
      case "CHANGES_REQUESTED":
        return post._count.comments > 0
          ? `Il cliente ha chiesto modifiche (${post._count.comments} ${post._count.comments === 1 ? "commento aperto" : "commenti aperti"})`
          : "Il cliente ha chiesto modifiche";
      case "FAILED":
        return post.lastError ? `Errore Metricool: ${post.lastError}` : "Programmazione su Metricool non riuscita";
      case "APPROVED":
        if (internal) {
          return post.kind === "BLOG_ARTICLE"
            ? "Approvato: esportalo, pubblicalo sul sito e segnalo come pubblicato"
            : "Approvato: scarica il pacchetto, carica le creatività e segnalo come consegnato";
        }
        return post.client.metricoolBlogId
          ? "Approvato: da programmare a mano"
          : "Approvato, ma il cliente non ha un brand Metricool collegato";
      case "IN_REVIEW":
        return post.reviewDueAt
          ? `Il cliente non ha ancora risposto (scadenza ${formatDateTime(post.reviewDueAt, post.client.timezone, { year: false })})`
          : "Il cliente non ha ancora risposto";
      default:
        return "";
    }
  }

  function upcomingDetail(post: (typeof upcoming)[number]): string {
    if (post.kind === "SOCIAL_POST") return post.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", ");
    return KIND_CONFIG[post.kind].dateLabel;
  }

  if (clientCount === 0 && grouped.length === 0) {
    return (
      <div className="panel mx-auto max-w-2xl p-8 text-center sm:p-12">
        <h2 className="mb-2 text-2xl font-semibold">Benvenuto in {productName()}</h2>
        <p className="mx-auto mb-6 max-w-md text-muted">
          {metricool && !multiKind
            ? "Aggiungi un cliente, collegalo al suo brand su Metricool e crea il link per chi approva. Poi prepara i post: il cliente li rivede dal telefono e quelli approvati partono su Metricool da soli."
            : `Aggiungi un cliente e crea il link per chi approva. Poi prepara ${words.the}: il cliente li rivede dal telefono, commenta e approva, e tu trovi tutto pronto da consegnare.`}
        </p>
        <Link href="/clients/new" className="btn btn-primary">
          Aggiungi il primo cliente
        </Link>
      </div>
    );
  }

  const newHref = newContentHref(multiKind ? null : kinds[0], { clientId: currentClientId });

  return (
    <div className="space-y-8">
      {/* Scope: the client picked in the menu, or all clients. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="label-caps">{currentClient ? "Cliente" : "Panoramica"}</p>
          <h2 className="truncate text-2xl font-semibold">{currentClient ? currentClient.name : "Tutti i clienti"}</h2>
          {currentClient ? (
            <p className="text-sm text-muted">
              <Link href={`/clients/${currentClient.id}`} className="text-accent hover:underline">
                Scheda cliente e link di revisione
              </Link>
              {currentClient._count.reviewers === 0 && (
                <span className="text-warning"> · nessuno approva ancora per questo cliente</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted">
              {clientCount === 1 ? "1 cliente attivo" : `${clientCount} clienti attivi`} · scegli un cliente dal menu per
              lavorare solo su di lui
            </p>
          )}
        </div>
        <Link href={newHref} className="btn btn-primary w-full sm:w-auto">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {multiKind ? "Nuovo contenuto" : KIND_UI[kinds[0]].newTitle}
        </Link>
      </div>

      <section
        aria-label="Riepilogo"
        className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${counters.length > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}
      >
        {counters.map((counter) => (
          <Link
            key={counter.label}
            href={counter.href}
            className="panel p-4 transition-colors hover:border-line-strong"
          >
            <p className="text-sm font-semibold text-muted">{counter.label}</p>
            <p className={`tabular mt-1 font-display text-3xl font-semibold ${counter.tone || "text-foreground"}`}>
              {counter.value}
            </p>
            <p className="text-xs text-muted">{counter.hint}</p>
          </Link>
        ))}
      </section>

      {multiKind && (
        <section className="space-y-3" aria-labelledby="by-kind">
          <h2 id="by-kind" className="text-lg font-semibold">
            Per tipo
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {kinds.map((kind) => (
              <div key={kind} className="panel space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={buildPostsHref({ kind: kindParam(kind) })}
                    className="inline-flex min-w-0 items-center gap-2 font-display text-base font-semibold hover:underline"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <KindIcon kind={kind} />
                    </span>
                    <span className="truncate">{KIND_CONFIG[kind].plural}</span>
                  </Link>
                  <Link href={newContentHref(kind, { clientId: currentClientId })} className="btn btn-quiet btn-sm shrink-0">
                    + Nuovo
                  </Link>
                </div>
                <dl className="inset grid grid-cols-2 gap-x-3 gap-y-1 p-2">
                  {KIND_STAGES.map((stage) => {
                    const value = count(stage.statuses, kind);
                    return (
                      <Link
                        key={stage.label}
                        href={
                          stage.statuses.length === 1
                            ? buildPostsHref({ kind: kindParam(kind), status: stage.statuses[0] })
                            : buildPostsHref({ kind: kindParam(kind) })
                        }
                        className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface"
                      >
                        <dt className="text-sm text-muted">
                          {stage.label === "Fatti" && kind !== "SOCIAL_POST" ? KIND_CONFIG[kind].deliveredLabel : stage.label}
                        </dt>
                        <dd className={`tabular text-base font-semibold ${value > 0 && stage.tone ? stage.tone : "text-foreground"}`}>
                          {value}
                        </dd>
                      </Link>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-3" aria-labelledby="attention">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="attention" className="text-lg font-semibold">
              Da gestire
            </h2>
            <Link href="/posts?status=attention" className="text-sm font-semibold text-accent hover:underline">
              Vedi tutti
            </Link>
          </div>
          {attention.length === 0 ? (
            <p className="panel p-4 text-sm text-muted">Niente da gestire: nessuna richiesta in sospeso.</p>
          ) : (
            <ul className="panel divide-y divide-border overflow-hidden">
              {attention.slice(0, LIST_LIMIT).map((post) => (
                <PostRow key={post.id} post={post} detail={reason(post)} showKind={multiKind} showClient={!currentClientId} />
              ))}
              {attention.length > LIST_LIMIT && (
                <li className="p-3 text-sm text-muted">
                  Altri {words.plural} da gestire nella{" "}
                  <Link href="/posts?status=attention" className="text-accent hover:underline">
                    lista completa
                  </Link>
                  .
                </li>
              )}
            </ul>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="upcoming">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="upcoming" className="text-lg font-semibold">
              {social && !multiKind ? "Prossime pubblicazioni" : "In arrivo"}
            </h2>
            <Link href="/calendar" className="text-sm font-semibold text-accent hover:underline">
              Calendario
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="panel p-4 text-sm text-muted">
              {social && !multiKind ? "Nessun post approvato o programmato in arrivo." : `Nessun contenuto approvato in arrivo.`}
            </p>
          ) : (
            <ul className="panel divide-y divide-border overflow-hidden">
              {upcoming.map((post) => (
                <PostRow key={post.id} post={post} detail={upcomingDetail(post)} showKind={multiKind} showClient={!currentClientId} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PostRow({
  post,
  detail,
  showKind,
  showClient,
}: {
  post: {
    id: string;
    title: string;
    kind: ContentKind;
    status: PostStatus;
    publishAt: Date;
    client: { name: string; timezone: string };
  };
  detail: string;
  showKind: boolean;
  showClient: boolean;
}) {
  return (
    <li>
      <Link
        href={`/posts/${post.id}`}
        className="flex items-start gap-3 p-3 transition-colors hover:bg-surface-sunken sm:items-center sm:p-4"
      >
        {showKind && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-muted sm:mt-0">
            <KindIcon kind={post.kind} />
            <span className="sr-only">{KIND_CONFIG[post.kind].label}</span>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{post.title}</p>
          <p className="tabular truncate text-sm text-muted">
            {showClient ? `${post.client.name} · ` : ""}
            {formatDateTime(post.publishAt, post.client.timezone, { year: false })}
          </p>
          {detail && <p className="line-clamp-2 text-sm text-muted">{detail}</p>}
          <div className="mt-1.5 sm:hidden">
            <KindStatusBadge kind={post.kind} status={post.status} />
          </div>
        </div>
        <div className="hidden sm:block">
          <KindStatusBadge kind={post.kind} status={post.status} />
        </div>
      </Link>
    </li>
  );
}
