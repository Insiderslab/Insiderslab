/**
 * Calendar of the agency (D-04): the month grid shows at most `perDay` items
 * per day and "+N altri", the week list every item of its seven days. It used
 * to load the whole range (about six weeks) with `take: 1000`, so past 1,000
 * items the later days looked empty and the "+N" counts stopped short.
 *
 * Now the grid asks the database for the first `perDay` items of each local
 * day plus the day's total (window functions, days in the calendar's time
 * zone), and the week is loaded on its own. Both stay scoped to the
 * workspace (and client, kinds) of the caller.
 */

import { Prisma, type ContentKind } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";

export interface CalendarScope {
  workspaceId: string;
  kinds: ContentKind[];
  clientId: string | null;
}

export interface DaySlice {
  /** Ids of the first items of the day, in publication order. */
  ids: string[];
  /** All the items of the day. */
  total: number;
}

/** Week list cap: far above a real week; past it the page says so. */
export const WEEK_LIMIT = 2000;

/**
 * Per local day ("YYYY-MM-DD" in `timeZone`) of [start, end): the first
 * `perDay` item ids and the day's total. Cancelled items are left out.
 */
export async function loadDaySlices(
  scope: CalendarScope,
  range: { start: Date; end: Date },
  timeZone: string,
  perDay: number
): Promise<Map<string, DaySlice>> {
  if (scope.kinds.length === 0) return new Map();
  const clientFilter = scope.clientId ? Prisma.sql`AND "clientId" = ${scope.clientId}` : Prisma.empty;
  // "publishAt" is a UTC timestamp without zone: read it as UTC, then as the calendar's local time.
  const rows = await prisma.$queryRaw<Array<{ id: string; day: string; total: bigint | number }>>`
    SELECT id, day, total FROM (
      SELECT id, day,
             row_number() OVER (PARTITION BY day ORDER BY "publishAt", id) AS rank,
             count(*) OVER (PARTITION BY day) AS total
      FROM (
        SELECT id, "publishAt",
               to_char(("publishAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day
        FROM "Post"
        WHERE "workspaceId" = ${scope.workspaceId}
          AND kind::text IN (${Prisma.join(scope.kinds)})
          AND status <> 'CANCELLED'
          ${clientFilter}
          AND "publishAt" >= ${range.start} AND "publishAt" < ${range.end}
      ) local
    ) ranked
    WHERE rank <= ${perDay}
    ORDER BY day, rank`;
  const byDay = new Map<string, DaySlice>();
  for (const row of rows) {
    const slice = byDay.get(row.day) ?? { ids: [], total: Number(row.total) };
    slice.ids.push(row.id);
    byDay.set(row.day, slice);
  }
  return byDay;
}
