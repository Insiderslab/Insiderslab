/**
 * Calendar Page
 *
 * Items by planned day (publication, campaign start), coloured by status: a
 * month grid on desktop and a week list on phones. Filter by client and,
 * when the instance handles several kinds, by kind (each item shows its
 * kind's icon); days are in the client's time zone when one is selected,
 * otherwise in the agency's (Europe/Rome). Cancelled items and kinds not
 * enabled are left out. A click opens the item; "+" on a day starts a new
 * one on that date (asking the kind when several are enabled).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import CalendarFilter from "@/components/posts/calendar-filter";
import {
  DEFAULT_TIME_ZONE,
  TONE_BORDER,
  TONE_DOT,
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  buildMonthGrid,
  dayKeyIn,
  dayLabel,
  formatTime,
  groupByDay,
  isDayKey,
  monthKey,
  monthLabel,
  monthOfDay,
  newContentHref,
  parseMonthParam,
  startOfDayUtc,
  startOfWeek,
  statusTone,
  statusesForKinds,
  timeZoneAbbr,
  ucFirst,
  weekDays,
} from "@/components/posts/helpers";
import { KindBadge, KindIcon } from "@/components/posts/kind-badge";
import { WEEK_LIMIT, loadDaySlices } from "@/lib/calendar-query";
import { getCurrentClientId, resolveClientScope } from "@/lib/current-client";
import { prisma } from "@/lib/db/client";
import { KIND_CONFIG, NETWORK_LABELS, STATUS_LABELS, isNetwork, statusLabelFor } from "@/lib/domain";
import { planMonthName } from "@/lib/plan-rules";
import { findPlanForMonth } from "@/lib/plans";
import { KIND_UI, enabledKinds, isKindEnabled, kindParam, productName, resolveKindFilter } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Calendario - ${productName()}` };
}

type SearchParams = {
  mese?: string | string[];
  settimana?: string | string[];
  clientId?: string | string[];
  kind?: string | string[];
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Max posts listed in a month cell before "+N". */
const CELL_LIMIT = 4;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const clients = await prisma.client.findMany({
    where: { workspaceId: context.workspaceId },
    select: { id: true, name: true, timezone: true, archivedAt: true },
    orderBy: { name: "asc" },
  });
  // The client in the URL, else the one picked in the menu.
  const scopedId = resolveClientScope(
    first(params.clientId),
    clients.map((c) => c.id),
    await getCurrentClientId(context.workspaceId)
  );
  const client = clients.find((c) => c.id === scopedId) ?? null;
  const timezone = client?.timezone ?? DEFAULT_TIME_ZONE;

  const kinds = enabledKinds();
  const multiKind = kinds.length > 1;
  // The only kind on single-kind instances; the requested enabled one, or null (all), otherwise.
  const kindFilter = resolveKindFilter(params.kind);
  const kindValue = multiKind && kindFilter ? kindParam(kindFilter) : "";
  const newKind = kindFilter ?? (multiKind ? null : kinds[0]);

  const now = new Date();
  const today = dayKeyIn(now, timezone);
  const month = parseMonthParam(params.mese) ?? monthOfDay(today);
  const requestedWeek = first(params.settimana);
  const weekStart = startOfWeek(
    isDayKey(requestedWeek) ? requestedWeek : monthKey(monthOfDay(today)) === monthKey(month) ? today : `${monthKey(month)}-01`
  );
  const week = weekDays(weekStart);
  const grid = buildMonthGrid(month);

  // D-04: the month grid gets the first CELL_LIMIT items of each day and the
  // day's total from the database; the week list loads its seven days. (One
  // query with `take: 1000` over six weeks hid the later days past 1,000.)
  const gridEnd = grid[grid.length - 1][6];
  const scope = { workspaceId: context.workspaceId, kinds: kindFilter ? [kindFilter] : kinds, clientId: client?.id ?? null };
  const select = {
    id: true,
    title: true,
    kind: true,
    status: true,
    publishAt: true,
    networks: true,
    client: { select: { name: true } },
  } as const;
  const [slices, weekPosts] = await Promise.all([
    loadDaySlices(
      scope,
      { start: startOfDayUtc(grid[0][0], timezone), end: startOfDayUtc(addDays(gridEnd, 1), timezone) },
      timezone,
      CELL_LIMIT
    ),
    prisma.post.findMany({
      where: {
        workspaceId: context.workspaceId,
        kind: { in: scope.kinds },
        status: { not: "CANCELLED" },
        ...(client ? { clientId: client.id } : {}),
        publishAt: { gte: startOfDayUtc(week[0], timezone), lt: startOfDayUtc(addDays(week[6], 1), timezone) },
      },
      orderBy: [{ publishAt: "asc" }, { id: "asc" }],
      take: WEEK_LIMIT + 1,
      select,
    }),
  ]);
  const weekTruncated = weekPosts.length > WEEK_LIMIT;
  const byDay = groupByDay(weekPosts.slice(0, WEEK_LIMIT), (p) => p.publishAt, timezone);
  const gridIds = [...slices.values()].flatMap((slice) => slice.ids);
  const gridPosts = new Map(
    (gridIds.length > 0
      ? await prisma.post.findMany({ where: { id: { in: gridIds }, workspaceId: context.workspaceId }, select })
      : []
    ).map((post) => [post.id, post])
  );
  type CalendarPost = (typeof weekPosts)[number];
  const cellOf = (day: string): { items: CalendarPost[]; total: number } => {
    const slice = slices.get(day);
    if (!slice) return { items: [], total: 0 };
    return { items: slice.ids.flatMap((id) => (gridPosts.has(id) ? [gridPosts.get(id) as CalendarPost] : [])), total: slice.total };
  };

  // "Piano di ottobre": the monthly social plan of the selected client and month.
  const planMonth = monthKey(month);
  const monthPlan =
    client && isKindEnabled("SOCIAL_POST") ? await findPlanForMonth(context.workspaceId, client.id, planMonth) : null;
  const planHref = monthPlan
    ? `/plans/${monthPlan.id}`
    : `/plans?${new URLSearchParams({ nuovo: "1", ...(client ? { clientId: client.id } : {}), mese: planMonth }).toString()}`;

  const keep = (extra: Record<string, string>) => {
    const query = new URLSearchParams({
      mese: monthKey(month),
      settimana: weekStart,
      ...(client ? { clientId: client.id } : {}),
      ...(kindValue ? { kind: kindValue } : {}),
      ...extra,
    });
    return `/calendar?${query.toString()}`;
  };
  const newPostHref = (day: string) => newContentHref(newKind, { clientId: client?.id ?? null, day });
  const newLabel = newKind ? KIND_UI[newKind].newTitle : "Nuovo contenuto";
  const legendKinds = kindFilter ? [kindFilter] : kinds;
  const usedStatuses = statusesForKinds(legendKinds).filter((s) => s !== "CANCELLED");
  // A single kind words the statuses its own way ("Pubblicato" for articles).
  const statusLabel = (status: CalendarPost["status"], kind: CalendarPost["kind"]) =>
    statusLabelFor(kind, status);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CalendarFilter
          clients={clients.map((c) => ({ id: c.id, name: c.archivedAt ? `${c.name} (archiviato)` : c.name }))}
          clientId={client?.id ?? ""}
          kinds={multiKind ? kinds.map((k) => ({ value: kindParam(k), label: KIND_CONFIG[k].plural })) : []}
          kind={kindValue}
          keep={{ mese: monthKey(month), settimana: weekStart }}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-end">
          {client && isKindEnabled("SOCIAL_POST") && (
            <Link href={planHref} className="btn btn-sm" data-testid="calendar-plan-link">
              {monthPlan ? `Piano di ${planMonthName(planMonth)}` : `Prepara il piano di ${planMonthName(planMonth)}`}
            </Link>
          )}
          <p className="text-xs text-muted">
            Orari in {timezone} ({timeZoneAbbr(timezone, now)})
            {client ? "" : " · scegli un cliente per vederli nel suo fuso"}
          </p>
        </div>
      </div>

      {/* ── Month (desktop) ── */}
      <section className="hidden space-y-3 md:block">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{ucFirst(monthLabel(month))}</h2>
          <div className="flex items-center gap-2 text-sm">
            <Link href={keep({ mese: monthKey(addMonths(month, -1)), settimana: "" })} className="rounded border border-border px-3 py-1.5 text-muted hover:text-foreground">
              ← Mese prima
            </Link>
            <Link href={keep({ mese: monthKey(monthOfDay(today)), settimana: startOfWeek(today) })} className="rounded border border-border px-3 py-1.5 text-muted hover:text-foreground">
              Oggi
            </Link>
            <Link href={keep({ mese: monthKey(addMonths(month, 1)), settimana: "" })} className="rounded border border-border px-3 py-1.5 text-muted hover:text-foreground">
              Mese dopo →
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded border border-border">
          <div className="grid grid-cols-7 bg-surface text-xs text-muted">
            {WEEKDAY_SHORT.map((label) => (
              <div key={label} className="px-2 py-1.5">
                {label}
              </div>
            ))}
          </div>
          {grid.map((days) => (
            <div key={days[0]} className="grid grid-cols-7 border-t border-border">
              {days.map((day) => {
                const inMonth = day.startsWith(monthKey(month));
                const { items, total } = cellOf(day);
                const isToday = day === today;
                return (
                  <div
                    key={day}
                    className={`group min-h-28 min-w-0 border-l border-border p-1.5 first:border-l-0 ${
                      inMonth ? "bg-background" : "bg-surface"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${
                          isToday ? "bg-accent font-semibold text-white" : inMonth ? "text-foreground" : "text-muted"
                        }`}
                      >
                        {Number(day.slice(8))}
                      </span>
                      <Link
                        href={newPostHref(day)}
                        className="rounded px-1.5 text-sm text-muted opacity-0 hover:bg-surface-hover hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                        aria-label={`${newLabel} il ${dayLabel(day, true)}`}
                      >
                        +
                      </Link>
                    </div>
                    <ul className="space-y-1">
                      {items.slice(0, CELL_LIMIT).map((post) => (
                        <li key={post.id}>
                          <Link
                            href={`/posts/${post.id}`}
                            title={`${post.title} · ${post.client.name} · ${KIND_CONFIG[post.kind].label} · ${statusLabel(post.status, post.kind)}`}
                            className={`flex min-w-0 items-center gap-1 rounded border-l-2 bg-surface px-1.5 py-0.5 text-xs hover:bg-surface-hover ${
                              TONE_BORDER[statusTone(post.status)]
                            }`}
                          >
                            {multiKind && <KindIcon kind={post.kind} className="h-3 w-3 text-muted" />}
                            <span className="shrink-0 text-muted">{formatTime(post.publishAt, timezone)}</span>
                            <span className="truncate">{post.title}</span>
                          </Link>
                        </li>
                      ))}
                      {total > CELL_LIMIT && (
                        <li>
                          <Link href={keep({ settimana: startOfWeek(day) })} className="px-1.5 text-xs text-muted hover:text-foreground" data-testid={`calendar-more-${day}`}>
                            +{total - CELL_LIMIT} altri
                          </Link>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* ── Week (phones; on desktop below the month) ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            Settimana {dayLabel(week[0])} – {dayLabel(week[6])}
          </h2>
          <div className="flex items-center gap-1 text-sm">
            <Link
              href={keep({ settimana: addDays(weekStart, -7), mese: monthKey(monthOfDay(addDays(weekStart, -7))) })}
              className="touch-target rounded border border-border px-3 text-muted hover:text-foreground"
              aria-label="Settimana prima"
            >
              ←
            </Link>
            <Link href={keep({ settimana: startOfWeek(today), mese: monthKey(monthOfDay(today)) })} className="touch-target rounded border border-border px-3 text-muted hover:text-foreground">
              Oggi
            </Link>
            <Link
              href={keep({ settimana: addDays(weekStart, 7), mese: monthKey(monthOfDay(addDays(weekStart, 7))) })}
              className="touch-target rounded border border-border px-3 text-muted hover:text-foreground"
              aria-label="Settimana dopo"
            >
              →
            </Link>
          </div>
        </div>

        {weekTruncated && (
          <p className="rounded-xl bg-warning-soft p-3 text-sm" role="status">
            Questa settimana ha più di {WEEK_LIMIT} contenuti: ne mostro i primi {WEEK_LIMIT}, in ordine di orario. Filtra per cliente o per tipo per vedere gli altri.
          </p>
        )}
        <ol className="space-y-2">
          {week.map((day) => {
            const items = byDay.get(day) ?? [];
            return (
              <li key={day} className="panel rounded p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`text-sm font-medium ${day === today ? "text-accent" : ""}`}>
                    {ucFirst(dayLabel(day, true))}
                    {day === today ? " · oggi" : ""}
                  </h3>
                  <Link href={newPostHref(day)} className="touch-target -my-3 -mr-2 rounded px-2 text-xs text-muted hover:text-foreground">
                    + {newLabel}
                  </Link>
                </div>
                {items.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">Niente in programma</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {items.map((post) => (
                      <li key={post.id}>
                        <Link
                          href={`/posts/${post.id}`}
                          className={`block rounded border-l-4 bg-background px-3 py-2 hover:bg-surface-hover ${
                            TONE_BORDER[statusTone(post.status)]
                          }`}
                        >
                          <span className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {multiKind && <KindBadge kind={post.kind} iconOnly className="self-center" />}
                              <span className="min-w-0 truncate font-medium">{post.title}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted">{formatTime(post.publishAt, timezone)}</span>
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {post.client.name} · {statusLabel(post.status, post.kind)}
                            {post.kind === "SOCIAL_POST" && post.networks.length > 0
                              ? ` · ${post.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", ")}`
                              : post.kind !== "SOCIAL_POST"
                                ? ` · ${KIND_CONFIG[post.kind].dateLabel}`
                                : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
        {usedStatuses.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${TONE_DOT[statusTone(status)]}`} aria-hidden />
            {legendKinds.length === 1 ? statusLabelFor(legendKinds[0], status) : STATUS_LABELS[status]}
          </li>
        ))}
        {multiKind &&
          legendKinds.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <KindIcon kind={kind} className="h-3.5 w-3.5" />
              {KIND_CONFIG[kind].plural}
            </li>
          ))}
      </ul>
    </div>
  );
}
