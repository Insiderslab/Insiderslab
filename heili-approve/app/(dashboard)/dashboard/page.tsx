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
  TONE_BORDER,
  addDays,
  buildPostsHref,
  contentWords,
  dayKeyIn,
  formatDateTime,
  newContentHref,
  startOfDayUtc,
  startOfWeek,
  statusTone,
} from "@/components/posts/helpers";
import { KindBadge, KindIcon, KindStatusBadge } from "@/components/posts/kind-badge";
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

  const [grouped, doneThisWeek, clientCount, attention, upcoming] = await Promise.all([
    prisma.post.groupBy({
      by: ["kind", "status"],
      where: { workspaceId, kind: { in: kinds }, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
    // Done this week: scheduled social posts and published / delivered items, by planned date.
    prisma.post.count({
      where: {
        workspaceId,
        kind: { in: kinds },
        status: { in: ["SCHEDULED", "DELIVERED"] },
        publishAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    prisma.client.count({ where: { workspaceId, archivedAt: null } }),
    prisma.post.findMany({
      where: { workspaceId, kind: { in: kinds }, OR: attentionWhere },
      orderBy: { publishAt: "asc" },
      take: LIST_LIMIT + 1,
      select: postSelect,
    }),
    prisma.post.findMany({
      where: {
        workspaceId,
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
    { label: "In revisione", value: count(["IN_REVIEW"]), href: statusHref("IN_REVIEW"), tone: "" },
    {
      label: "Modifiche richieste",
      value: count(["CHANGES_REQUESTED"]),
      href: statusHref("CHANGES_REQUESTED"),
      tone: count(["CHANGES_REQUESTED"]) > 0 ? "text-warning" : "",
    },
    { label: approvedLabel, value: count(["APPROVED"]), href: statusHref("APPROVED"), tone: "" },
    { label: doneLabel, value: doneThisWeek, href: `/calendar?settimana=${monday}`, tone: "" },
    ...(social
      ? [
          {
            label: "Errori",
            value: count(["FAILED"]),
            href: statusHref("FAILED"),
            tone: count(["FAILED"]) > 0 ? "text-error" : "",
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
      <div className="panel rounded p-8 text-center sm:p-12">
        <h2 className="mb-2 text-lg font-semibold">Benvenuto in {productName()}</h2>
        <p className="mx-auto mb-6 max-w-md text-sm text-muted">
          {metricool && !multiKind
            ? "Aggiungi un cliente, collegalo al suo brand su Metricool e invita chi approva. Poi prepara i post: il cliente li rivede dal telefono e quelli approvati partono su Metricool da soli."
            : `Aggiungi un cliente e invita chi approva. Poi prepara ${words.the}: il cliente li rivede dal telefono, commenta e approva, e tu trovi tutto pronto da consegnare.`}
        </p>
        <Link
          href="/clients/new"
          className="inline-flex items-center rounded bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Aggiungi il primo cliente
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Link
          // Several kinds: /posts/new asks which one.
          href={newContentHref(multiKind ? null : kinds[0])}
          className="w-full rounded bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-hover sm:w-auto"
        >
          {multiKind ? "Nuovo contenuto" : KIND_UI[kinds[0]].newTitle}
        </Link>
      </div>

      <section className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${counters.length > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
        {counters.map((counter) => (
          <Link
            key={counter.label}
            href={counter.href}
            className="rounded border border-border bg-surface p-4 hover:bg-surface-hover"
          >
            <p className="text-sm text-muted">{counter.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${counter.tone || "text-foreground"}`}>{counter.value}</p>
          </Link>
        ))}
      </section>

      {multiKind && (
        <section className="space-y-3" aria-label="Per tipo di contenuto">
          <h2 className="text-base font-semibold">Per tipo</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {kinds.map((kind) => (
              <div key={kind} className="panel space-y-3 rounded p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={buildPostsHref({ kind: kindParam(kind) })}
                    className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold hover:underline"
                  >
                    <KindIcon kind={kind} />
                    <span className="truncate">{KIND_CONFIG[kind].plural}</span>
                  </Link>
                  <Link href={newContentHref(kind)} className="shrink-0 text-xs text-accent hover:underline">
                    + {KIND_UI[kind].newTitle}
                  </Link>
                </div>
                <dl className="grid grid-cols-4 gap-2">
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
                        className="min-w-0 rounded border border-border bg-background p-2 hover:border-border-hover"
                      >
                        <dt className="truncate text-[11px] text-muted" title={stage.label}>
                          {stage.label === "Fatti" && kind !== "SOCIAL_POST" ? KIND_CONFIG[kind].deliveredLabel : stage.label}
                        </dt>
                        <dd className={`text-lg font-semibold ${value > 0 && stage.tone ? stage.tone : "text-foreground"}`}>
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

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Da gestire</h2>
          <Link href="/posts?status=attention" className="text-sm text-accent hover:underline">
            Vedi tutti
          </Link>
        </div>
        {attention.length === 0 ? (
          <p className="panel rounded p-4 text-sm text-muted">Niente da gestire: nessuna richiesta in sospeso.</p>
        ) : (
          <ul className="space-y-2">
            {attention.slice(0, LIST_LIMIT).map((post) => (
              <PostRow key={post.id} post={post} detail={reason(post)} showKind={multiKind} />
            ))}
            {attention.length > LIST_LIMIT && (
              <li className="text-sm text-muted">
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

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">{social && !multiKind ? "Prossime pubblicazioni" : "In arrivo"}</h2>
          <Link href="/calendar" className="text-sm text-accent hover:underline">
            Calendario
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="panel rounded p-4 text-sm text-muted">
            {social && !multiKind
              ? "Nessun post approvato o programmato in arrivo."
              : `Nessun contenuto approvato in arrivo.`}
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((post) => (
              <PostRow key={post.id} post={post} detail={upcomingDetail(post)} showKind={multiKind} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PostRow({
  post,
  detail,
  showKind,
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
}) {
  return (
    <li>
      <Link
        href={`/posts/${post.id}`}
        className={`flex flex-col gap-1 rounded border border-l-4 border-border bg-surface p-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4 ${
          TONE_BORDER[statusTone(post.status)]
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            {showKind && <KindBadge kind={post.kind} iconOnly />}
            <span className="truncate">{post.title}</span>
          </p>
          <p className="truncate text-xs text-muted">
            {post.client.name} · {formatDateTime(post.publishAt, post.client.timezone, { year: false })}
          </p>
          {detail && <p className="line-clamp-2 text-xs text-muted">{detail}</p>}
        </div>
        <KindStatusBadge kind={post.kind} status={post.status} />
      </Link>
    </li>
  );
}
