/**
 * Dashboard Page
 *
 * Where the agency starts the day: counters by stage (each opens the
 * filtered list), the posts that need someone to act ("Da gestire": changes
 * requested, scheduling errors, approvals waiting for a manual schedule,
 * reviews past their deadline) and what goes out next.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DEFAULT_TIME_ZONE,
  TONE_BORDER,
  addDays,
  dayKeyIn,
  formatDateTime,
  startOfDayUtc,
  startOfWeek,
  statusTone,
} from "@/components/posts/helpers";
import StatusBadge from "@/components/status-badge";
import { prisma } from "@/lib/db/client";
import { NETWORK_LABELS, isNetwork } from "@/lib/domain";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Dashboard - Approve by Heili" };

const LIST_LIMIT = 10;

const postSelect = {
  id: true,
  title: true,
  status: true,
  publishAt: true,
  networks: true,
  lastError: true,
  reviewDueAt: true,
  client: { select: { id: true, name: true, timezone: true, autoSchedule: true, metricoolBlogId: true } },
  _count: { select: { comments: { where: { authorType: "CLIENT" as const, resolvedAt: null } } } },
} as const;

export default async function DashboardPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  const workspaceId = context.workspaceId;

  // "Questa settimana" = Monday to Sunday in the agency's zone.
  const now = new Date();
  const monday = startOfWeek(dayKeyIn(now, DEFAULT_TIME_ZONE));
  const weekStart = startOfDayUtc(monday, DEFAULT_TIME_ZONE);
  const weekEnd = startOfDayUtc(addDays(monday, 7), DEFAULT_TIME_ZONE);

  const [grouped, scheduledThisWeek, clientCount, attention, upcoming] = await Promise.all([
    prisma.post.groupBy({
      by: ["status"],
      where: { workspaceId, status: { in: ["IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "FAILED"] } },
      _count: { _all: true },
    }),
    prisma.post.count({
      where: { workspaceId, status: "SCHEDULED", publishAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.client.count({ where: { workspaceId, archivedAt: null } }),
    prisma.post.findMany({
      where: {
        workspaceId,
        OR: [
          { status: { in: ["CHANGES_REQUESTED", "FAILED"] } },
          // Approved but nobody will schedule it unless the agency does.
          { status: "APPROVED", OR: [{ client: { autoSchedule: false } }, { client: { metricoolBlogId: null } }] },
          // The client is late.
          { status: "IN_REVIEW", reviewDueAt: { lt: now } },
        ],
      },
      orderBy: { publishAt: "asc" },
      take: LIST_LIMIT + 1,
      select: postSelect,
    }),
    prisma.post.findMany({
      where: {
        workspaceId,
        status: { in: ["SCHEDULED", "SCHEDULING", "APPROVED"] },
        publishAt: { gte: now },
      },
      orderBy: { publishAt: "asc" },
      take: 8,
      select: postSelect,
    }),
  ]);

  const count = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0;
  const counters = [
    { label: "In revisione", value: count("IN_REVIEW"), href: "/posts?status=IN_REVIEW", tone: "" },
    {
      label: "Modifiche richieste",
      value: count("CHANGES_REQUESTED"),
      href: "/posts?status=CHANGES_REQUESTED",
      tone: count("CHANGES_REQUESTED") > 0 ? "text-warning" : "",
    },
    { label: "Approvati da programmare", value: count("APPROVED"), href: "/posts?status=APPROVED", tone: "" },
    {
      label: "Programmati questa settimana",
      value: scheduledThisWeek,
      href: `/calendar?settimana=${monday}`,
      tone: "",
    },
    {
      label: "Errori",
      value: count("FAILED"),
      href: "/posts?status=FAILED",
      tone: count("FAILED") > 0 ? "text-error" : "",
    },
  ];

  function reason(post: (typeof attention)[number]): string {
    switch (post.status) {
      case "CHANGES_REQUESTED":
        return post._count.comments > 0
          ? `Il cliente ha chiesto modifiche (${post._count.comments} ${post._count.comments === 1 ? "commento aperto" : "commenti aperti"})`
          : "Il cliente ha chiesto modifiche";
      case "FAILED":
        return post.lastError ? `Errore Metricool: ${post.lastError}` : "Programmazione su Metricool non riuscita";
      case "APPROVED":
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

  if (clientCount === 0 && grouped.length === 0) {
    return (
      <div className="panel rounded p-8 text-center sm:p-12">
        <h2 className="mb-2 text-lg font-semibold">Benvenuto in Approve by Heili</h2>
        <p className="mx-auto mb-6 max-w-md text-sm text-muted">
          Aggiungi un cliente, collegalo al suo brand su Metricool e invita chi approva. Poi prepara i post: il
          cliente li rivede dal telefono e quelli approvati partono su Metricool da soli.
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
          href="/posts/new"
          className="w-full rounded bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-hover sm:w-auto"
        >
          Nuovo post
        </Link>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
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
              <PostRow key={post.id} post={post} detail={reason(post)} />
            ))}
            {attention.length > LIST_LIMIT && (
              <li className="text-sm text-muted">
                Altri post da gestire nella{" "}
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
          <h2 className="text-base font-semibold">Prossime pubblicazioni</h2>
          <Link href="/calendar" className="text-sm text-accent hover:underline">
            Calendario
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="panel rounded p-4 text-sm text-muted">Nessun post approvato o programmato in arrivo.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                detail={post.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", ")}
              />
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
}: {
  post: {
    id: string;
    title: string;
    status: Parameters<typeof StatusBadge>[0]["status"];
    publishAt: Date;
    client: { name: string; timezone: string };
  };
  detail: string;
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
          <p className="truncate text-sm font-medium">{post.title}</p>
          <p className="truncate text-xs text-muted">
            {post.client.name} · {formatDateTime(post.publishAt, post.client.timezone, { year: false })}
          </p>
          {detail && <p className="line-clamp-2 text-xs text-muted">{detail}</p>}
        </div>
        <StatusBadge status={post.status} />
      </Link>
    </li>
  );
}
