/**
 * Attività Page
 *
 * Where the agency's tasks and notifications accumulate: what the client
 * asked for becomes a task for the client's social media manager. Two tabs —
 * "Da fare" (open tasks) and "Notifiche" (pure info) — a "mine / all" toggle,
 * a client filter, and per-row actions (open, mark done, assign).
 *
 * Filters are plain query parameters so the page stays a server component;
 * the interactive parts (Fatto/Riapri, Assegna a…, Segna tutte come lette,
 * client filter) are small client components that call the server actions.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ActivityType } from "@/app/generated/prisma/client";
import { AssignSelect, MarkAllReadButton, TaskButtons } from "@/components/attivita/activity-actions";
import ClientFilter from "@/components/attivita/client-filter";
import {
  ACTIVITY_TYPE_ICONS,
  ACTIVITY_TYPE_TONE_CLASS,
  activityHref,
  memberLabel,
  relativeTimeLabel,
} from "@/components/attivita/helpers";
import {
  ACTIVITY_TYPE_LABELS,
  countOpenTasks,
  countUnreadNotifications,
  listActivities,
  listCompletedTasks,
  type ActivityListItem,
} from "@/lib/activity";
import { prisma } from "@/lib/db/client";
import { productName } from "@/lib/variant";
import { listWorkspaceMembers } from "@/lib/workspace";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Attività - ${productName()}` };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function TypeIcon({ type }: { type: ActivityType }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken ${ACTIVITY_TYPE_TONE_CLASS[type]}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        {ACTIVITY_TYPE_ICONS[type].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

const tabBaseClass =
  "inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm";
const tabClass = (active: boolean) =>
  `${tabBaseClass} ${active ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`;

const bottomLinkClass = "inline-flex min-h-11 items-center text-accent hover:underline";

const scopeClass = (active: boolean) =>
  `inline-flex min-h-11 items-center rounded-md px-3 text-sm ${active ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted hover:text-foreground"}`;

export default async function AttivitaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; scope?: string | string[]; clientId?: string | string[]; chiuse?: string | string[]; dopo?: string | string[] }>;
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const { workspaceId, userId } = context;

  const isNotifications = first(params.tab) === "notifiche";
  const scope: "mine" | "all" = first(params.scope) === "all" ? "all" : "mine";
  const clientId = first(params.clientId);
  const showCompleted = first(params.chiuse) === "1";
  // Cursor of the next page of 30 (the list is long when nobody closes tasks).
  const cursor = first(params.dopo)?.slice(0, 64) || undefined;

  const [clients, members, openTasks, unread] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listWorkspaceMembers(workspaceId),
    countOpenTasks(workspaceId, userId),
    countUnreadNotifications(workspaceId, userId),
  ]);

  const listInput = {
    workspaceId,
    userId,
    scope,
    cursor,
    clientId: clientId && clients.some((c) => c.id === clientId) ? clientId : undefined,
  };
  const page = isNotifications
    ? await listActivities({ ...listInput, tab: "notifications" })
    : showCompleted
      ? await listCompletedTasks(listInput)
      : await listActivities({ ...listInput, tab: "todo" });
  const items: ActivityListItem[] = page.items;

  // Build the same page with different query params, dropping ones that no
  // longer apply (a tab or scope switch resets the "completed" view).
  function href(overrides: Record<string, string | undefined>): string {
    const merged: Record<string, string> = {};
    const source: Record<string, string | undefined> = {
      tab: isNotifications ? "notifiche" : undefined,
      scope: scope === "all" ? "all" : undefined,
      clientId: listInput.clientId,
      chiuse: showCompleted && !isNotifications ? "1" : undefined,
      dopo: undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(source)) {
      if (value) merged[key] = value;
    }
    const query = new URLSearchParams(merged).toString();
    return query ? `/attivita?${query}` : "/attivita";
  }

  const emptyMessage = isNotifications
    ? "Nessuna notifica."
    : showCompleted
      ? "Nessun compito completato negli ultimi 30 giorni."
      : "Nessun compito aperto. Quando un cliente chiede modifiche, lo trovi qui.";

  return (
    <div className="space-y-5">
      {/* Tabs + scope toggle + client filter */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Attività">
          <Link href={href({ tab: undefined, chiuse: undefined })} className={tabClass(!isNotifications)}>
            Da fare ({openTasks})
          </Link>
          <Link href={href({ tab: "notifiche", chiuse: undefined })} className={tabClass(isNotifications)}>
            Notifiche ({unread})
          </Link>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isNotifications && unread > 0 && <MarkAllReadButton />}
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Ambito">
            <Link href={href({ scope: undefined, chiuse: undefined })} className={scopeClass(scope === "mine")}>
              Solo i miei
            </Link>
            <Link href={href({ scope: "all", chiuse: undefined })} className={scopeClass(scope === "all")}>
              Tutti
            </Link>
          </div>
          <Suspense fallback={null}>
            <ClientFilter clients={clients} current={listInput.clientId ?? null} />
          </Suspense>
        </div>
      </div>

      {/* Rows */}
      {items.length === 0 ? (
        <p className="panel p-6 text-center text-sm text-muted">{emptyMessage}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const href = activityHref(item);
            const done = item.status === "DONE";
            const assigneeLabel = item.assignee ? memberLabel(item.assignee) : null;
            return (
              <li key={item.id} className="panel p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <TypeIcon type={item.type} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted">
                        <span className="font-semibold text-foreground">{item.client.name}</span>
                        {" · "}
                        {ACTIVITY_TYPE_LABELS[item.type]}
                        {isNotifications && item.readAt === null && (
                          <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">Nuova</span>
                        )}
                      </p>
                      <p className="mt-0.5 leading-snug font-semibold [overflow-wrap:anywhere]">{item.title}</p>
                      {item.summary && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted [overflow-wrap:anywhere]">{item.summary}</p>
                      )}
                      <p className="mt-1 text-xs text-muted">
                        {assigneeLabel ? `Assegnato a ${assigneeLabel}` : "Non assegnato"}
                        {" · "}
                        {relativeTimeLabel(item.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
                    {href && (
                      <Link href={href} className="btn btn-sm">
                        Apri
                      </Link>
                    )}
                    {!isNotifications && (
                      <TaskButtons id={item.id} done={done} />
                    )}
                    {!isNotifications && !done && (
                      <AssignSelect id={item.id} members={members} current={item.assigneeUserId} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Next page (30 at a time) and back to the start */}
      {(page.nextCursor || cursor) && (
        <p className="flex flex-wrap items-center gap-x-4 text-sm">
          {page.nextCursor && (
            <Link href={href({ dopo: page.nextCursor })} className={bottomLinkClass}>
              Mostra altre
            </Link>
          )}
          {cursor && (
            <Link href={href({})} className={bottomLinkClass}>
              Torna all&apos;inizio
            </Link>
          )}
        </p>
      )}

      {/* "Mostra completate" at the bottom of the todo list */}
      {!isNotifications && (
        <p className="text-sm text-muted">
          {showCompleted ? (
            <Link href={href({ chiuse: undefined })} className={bottomLinkClass}>
              Torna ai compiti aperti
            </Link>
          ) : (
            <Link href={href({ chiuse: "1" })} className={bottomLinkClass}>
              Mostra completate
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
