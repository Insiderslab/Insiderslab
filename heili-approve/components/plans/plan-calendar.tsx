/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * Month grid of a plan (agency): each day of the month in the client's time
 * zone with its posts as small thumbnails, coloured by status. Desktop only;
 * on phones the list under it is already in calendar order.
 */

import Link from "next/link";
import type { PostStatus } from "@/app/generated/prisma/client";
import {
  TONE_BORDER,
  WEEKDAY_SHORT,
  buildMonthGrid,
  dayKeyIn,
  formatTime,
  groupByDay,
  statusTone,
} from "@/components/posts/helpers";
import { STATUS_LABELS, type MediaItem } from "@/lib/domain";

export interface CalendarPost {
  id: string;
  title: string;
  status: PostStatus;
  publishAt: Date;
  cover: MediaItem | null;
  inPlan: boolean;
}

export default function PlanCalendar({
  month,
  timeZone,
  posts,
  now = new Date(),
}: {
  month: string;
  timeZone: string;
  posts: CalendarPost[];
  now?: Date;
}) {
  const ref = { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
  const grid = buildMonthGrid(ref);
  const byDay = groupByDay(posts, (p) => p.publishAt, timeZone);
  const today = dayKeyIn(now, timeZone);

  return (
    <div className="panel overflow-x-auto" data-testid="plan-calendar">
      <div className="min-w-[760px] overflow-hidden rounded-[20px]">
      <div className="grid grid-cols-7 bg-surface-sunken text-xs font-semibold text-muted">
        {WEEKDAY_SHORT.map((label) => (
          <div key={label} className="px-2 py-1.5">
            {label}
          </div>
        ))}
      </div>
      {grid.map((days) => (
        <div key={days[0]} className="grid grid-cols-7 border-t border-border">
          {days.map((day) => {
            const inMonth = day.startsWith(month);
            const items = inMonth ? (byDay.get(day) ?? []) : [];
            return (
              <div
                key={day}
                className={`min-h-24 min-w-0 border-l border-border p-1.5 first:border-l-0 ${inMonth ? "bg-surface" : "bg-background"}`}
              >
                <span
                  className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${
                    day === today ? "bg-accent font-semibold text-white" : inMonth ? "text-foreground" : "text-muted/60"
                  }`}
                >
                  {Number(day.slice(8))}
                </span>
                <ul className="space-y-1">
                  {items.map((post) => (
                    <li key={post.id}>
                      <Link
                        href={`/posts/${post.id}`}
                        title={`${post.title} · ${STATUS_LABELS[post.status]}${post.inPlan ? "" : " · fuori dal piano"}`}
                        className={`block overflow-hidden rounded border-l-2 bg-background text-xs hover:bg-surface-hover ${
                          TONE_BORDER[statusTone(post.status)]
                        } ${post.inPlan ? "" : "opacity-60"}`}
                      >
                        <span className="relative block h-12 bg-surface-sunken">
                          {post.cover?.type === "image" ? (
                            <img src={post.cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : post.cover?.posterUrl ? (
                            <img src={post.cover.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : null}
                          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white tabular">
                            {formatTime(post.publishAt, timeZone)}
                          </span>
                        </span>
                        <span className="block truncate px-1.5 py-0.5">{post.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ))}
      </div>
    </div>
  );
}
