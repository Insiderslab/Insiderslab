/**
 * Calendar Page
 *
 * Posts by publication day, coloured by status: a month grid on desktop and
 * a week list on phones. Filter by client; days are in the client's time
 * zone when one is selected, otherwise in the agency's (Europe/Rome).
 * Cancelled posts are left out. A click opens the post; "+" on a day starts
 * a new post on that date.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import CalendarFilter from "@/components/posts/calendar-filter";
import {
  DEFAULT_TIME_ZONE,
  POST_STATUSES,
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
  parseMonthParam,
  startOfDayUtc,
  startOfWeek,
  statusTone,
  timeZoneAbbr,
  weekDays,
} from "@/components/posts/helpers";
import { prisma } from "@/lib/db/client";
import { NETWORK_LABELS, STATUS_LABELS, isNetwork } from "@/lib/domain";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Calendario - Approve by Heili" };

type SearchParams = {
  mese?: string | string[];
  settimana?: string | string[];
  clientId?: string | string[];
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
  const client = clients.find((c) => c.id === first(params.clientId)) ?? null;
  const timezone = client?.timezone ?? DEFAULT_TIME_ZONE;

  const now = new Date();
  const today = dayKeyIn(now, timezone);
  const month = parseMonthParam(params.mese) ?? monthOfDay(today);
  const requestedWeek = first(params.settimana);
  const weekStart = startOfWeek(
    isDayKey(requestedWeek) ? requestedWeek : monthKey(monthOfDay(today)) === monthKey(month) ? today : `${monthKey(month)}-01`
  );
  const week = weekDays(weekStart);
  const grid = buildMonthGrid(month);

  // One query covers both the month grid and the week list.
  const rangeStart = grid[0][0] < weekStart ? grid[0][0] : weekStart;
  const gridEnd = grid[grid.length - 1][6];
  const rangeEnd = addDays(gridEnd > week[6] ? gridEnd : week[6], 1);

  const posts = await prisma.post.findMany({
    where: {
      workspaceId: context.workspaceId,
      status: { not: "CANCELLED" },
      ...(client ? { clientId: client.id } : {}),
      publishAt: { gte: startOfDayUtc(rangeStart, timezone), lt: startOfDayUtc(rangeEnd, timezone) },
    },
    orderBy: { publishAt: "asc" },
    take: 1000,
    select: {
      id: true,
      title: true,
      status: true,
      publishAt: true,
      networks: true,
      client: { select: { name: true } },
    },
  });
  const byDay = groupByDay(posts, (p) => p.publishAt, timezone);

  const keep = (extra: Record<string, string>) => {
    const query = new URLSearchParams({
      mese: monthKey(month),
      settimana: weekStart,
      ...(client ? { clientId: client.id } : {}),
      ...extra,
    });
    return `/calendar?${query.toString()}`;
  };
  const newPostHref = (day: string) => `/posts/new?data=${day}${client ? `&clientId=${client.id}` : ""}`;
  const usedStatuses = POST_STATUSES.filter((s) => s !== "CANCELLED");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CalendarFilter
          clients={clients.map((c) => ({ id: c.id, name: c.archivedAt ? `${c.name} (archiviato)` : c.name }))}
          clientId={client?.id ?? ""}
          keep={{ mese: monthKey(month), settimana: weekStart }}
        />
        <p className="text-xs text-muted">
          Orari in {timezone} ({timeZoneAbbr(timezone, now)})
          {client ? "" : " · scegli un cliente per vederli nel suo fuso"}
        </p>
      </div>

      {/* ── Month (desktop) ── */}
      <section className="hidden space-y-3 md:block">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold capitalize">{monthLabel(month)}</h2>
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
                const items = byDay.get(day) ?? [];
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
                        aria-label={`Nuovo post il ${dayLabel(day, true)}`}
                      >
                        +
                      </Link>
                    </div>
                    <ul className="space-y-1">
                      {items.slice(0, CELL_LIMIT).map((post) => (
                        <li key={post.id}>
                          <Link
                            href={`/posts/${post.id}`}
                            title={`${post.title} · ${post.client.name} · ${STATUS_LABELS[post.status]}`}
                            className={`block truncate rounded border-l-2 bg-surface px-1.5 py-0.5 text-xs hover:bg-surface-hover ${
                              TONE_BORDER[statusTone(post.status)]
                            }`}
                          >
                            <span className="text-muted">{formatTime(post.publishAt, timezone)}</span> {post.title}
                          </Link>
                        </li>
                      ))}
                      {items.length > CELL_LIMIT && (
                        <li>
                          <Link href={keep({ settimana: startOfWeek(day) })} className="px-1.5 text-xs text-muted hover:text-foreground">
                            +{items.length - CELL_LIMIT} altri
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
              className="rounded border border-border px-3 py-1.5 text-muted hover:text-foreground"
              aria-label="Settimana prima"
            >
              ←
            </Link>
            <Link href={keep({ settimana: startOfWeek(today), mese: monthKey(monthOfDay(today)) })} className="rounded border border-border px-3 py-1.5 text-muted hover:text-foreground">
              Oggi
            </Link>
            <Link
              href={keep({ settimana: addDays(weekStart, 7), mese: monthKey(monthOfDay(addDays(weekStart, 7))) })}
              className="rounded border border-border px-3 py-1.5 text-muted hover:text-foreground"
              aria-label="Settimana dopo"
            >
              →
            </Link>
          </div>
        </div>

        <ol className="space-y-2">
          {week.map((day) => {
            const items = byDay.get(day) ?? [];
            return (
              <li key={day} className="panel rounded p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`text-sm font-medium capitalize ${day === today ? "text-accent" : ""}`}>
                    {dayLabel(day, true)}
                    {day === today ? " · oggi" : ""}
                  </h3>
                  <Link href={newPostHref(day)} className="text-xs text-muted hover:text-foreground">
                    + Nuovo post
                  </Link>
                </div>
                {items.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">Nessun post</p>
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
                            <span className="min-w-0 truncate font-medium">{post.title}</span>
                            <span className="shrink-0 text-xs text-muted">{formatTime(post.publishAt, timezone)}</span>
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {post.client.name} · {STATUS_LABELS[post.status]}
                            {post.networks.length > 0
                              ? ` · ${post.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", ")}`
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
            {STATUS_LABELS[status]}
          </li>
        ))}
      </ul>
    </div>
  );
}
