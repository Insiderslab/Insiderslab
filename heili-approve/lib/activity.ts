/**
 * Activity feed: notifications and tasks accumulated for the agency
 * (docs/ATTIVITA.md). Every fact the client can trigger (a change request, a
 * comment, an approval, a failed schedule) is recorded as an AgencyActivity,
 * deduplicated by key, and becomes a task for the client's social media
 * manager.
 *
 * "mine" always means "assigned to me plus unassigned": a task without an
 * assignee is visible to every member of the workspace, so nobody loses it.
 *
 * Server only. Every function that acts on one activity scopes the lookup by
 * workspaceId (a member can act on all activities of their workspace).
 */

import type {
  ActivityKind,
  ActivityType,
  AgencyActivity,
  ContentKind,
  PostStatus,
  Prisma,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";

export const PAGE_SIZE = 30;
export const MAX_SUMMARY = 500;

/** Italian labels of the activity types, shared with the UI. */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CHANGES_REQUESTED: "Modifiche richieste",
  CLIENT_COMMENT: "Commento del cliente",
  PLAN_COMMENT: "Commento sul piano",
  WEBSITE_NOTES: "Note sul sito",
  SCHEDULE_FAILED: "Programmazione non riuscita",
  APPROVED: "Approvato",
  PLAN_APPROVED: "Piano approvato",
};

const INFO_TYPES = new Set<ActivityType>(["APPROVED", "PLAN_APPROVED"]);

/** Which types require an agency action (TASK) and which are pure info. */
export function activityKindOf(type: ActivityType): ActivityKind {
  return INFO_TYPES.has(type) ? "INFO" : "TASK";
}

// ─── Summary (pure) ──────────────────────────────────────────────────────────

/** Machine-readable markers the assistant/portale insert, e.g. "[punto media=0 …]". */
const INTERNAL_MARKER = /\[[^\]]*\]/g;

/** Plain, single-line text: drops internal markers and collapses whitespace. */
export function cleanSummary(value: string): string {
  return value.replace(INTERNAL_MARKER, " ").replace(/\s+/g, " ").trim();
}

/** Excerpt stored in AgencyActivity.summary: plain text, at most `max` chars. */
export function truncateSummary(value: string, max = MAX_SUMMARY): string {
  const cleaned = cleanSummary(value);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

// ─── Recording ───────────────────────────────────────────────────────────────

export interface RecordActivityInput {
  workspaceId: string;
  clientId: string;
  postId?: string | null;
  planId?: string | null;
  type: ActivityType;
  title: string;
  summary?: string;
  versionNumber?: number | null;
  /** Idempotency key: the same fact never creates two activities. */
  dedupeKey: string;
}

/**
 * Creates the activity, idempotently on (workspaceId, dedupeKey). The
 * assignee is copied from Client.ownerUserId at creation time; an existing
 * row (same key) is left untouched, so a repeat of the same fact never
 * reopens or reassigns anything.
 */
export async function recordActivity(input: RecordActivityInput): Promise<AgencyActivity> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, workspaceId: input.workspaceId },
    select: { ownerUserId: true },
  });
  if (!client) throw new NotFoundError("Cliente non trovato");

  const activity = await prisma.agencyActivity.upsert({
    where: { workspaceId_dedupeKey: { workspaceId: input.workspaceId, dedupeKey: input.dedupeKey } },
    create: {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      postId: input.postId ?? null,
      planId: input.planId ?? null,
      type: input.type,
      kind: activityKindOf(input.type),
      status: "OPEN",
      title: input.title,
      summary: truncateSummary(input.summary ?? ""),
      versionNumber: input.versionNumber ?? null,
      assigneeUserId: client.ownerUserId,
      dedupeKey: input.dedupeKey,
    },
    update: {},
  });

  // A change request already carries the comments the client saved before
  // sending it: their "Commento del cliente" tasks would only repeat it.
  if (input.postId && (input.type === "CHANGES_REQUESTED" || input.type === "WEBSITE_NOTES")) {
    await prisma.agencyActivity.deleteMany({
      where: { postId: input.postId, type: "CLIENT_COMMENT", status: "OPEN" },
    });
  }

  // The same fact came true again (an approval undone and then given again):
  // its notification, closed by the undo, comes back as a new one.
  if (activity.kind === "INFO" && activity.status === "DONE") {
    return prisma.agencyActivity.update({
      where: { id: activity.id },
      data: { status: "OPEN", doneAt: null, doneByUserId: null, readAt: null, createdAt: new Date() },
    });
  }
  return activity;
}

/**
 * Closes the OPEN tasks of a post: called when the agency sends a new version
 * in review (the problem was handled) or when the post is cancelled. Returns
 * how many tasks were closed.
 */
export async function closeTasksForPost(postId: string, userId?: string | null): Promise<number> {
  const { count } = await prisma.agencyActivity.updateMany({
    where: { postId, kind: "TASK", status: "OPEN" },
    data: { status: "DONE", doneAt: new Date(), doneByUserId: userId ?? null },
  });
  return count;
}

/**
 * Marks an INFO activity as DONE by its dedupeKey: called when the client
 * undoes an approval (`approved:<postId>:v<version>` is no longer true).
 * Returns how many rows were closed.
 */
export async function closeInfoActivity(
  workspaceId: string,
  dedupeKey: string,
  userId?: string | null
): Promise<number> {
  const { count } = await prisma.agencyActivity.updateMany({
    where: { workspaceId, dedupeKey, kind: "INFO" },
    data: { status: "DONE", doneAt: new Date(), doneByUserId: userId ?? null },
  });
  return count;
}

// ─── Listing and counting ────────────────────────────────────────────────────

export interface ListActivitiesInput {
  workspaceId: string;
  userId: string;
  tab: "todo" | "notifications";
  scope?: "mine" | "all";
  clientId?: string;
  cursor?: string;
}

export type ActivityListItem = AgencyActivity & {
  client: { id: string; name: string };
  assignee: { id: string; name: string | null } | null;
  post: { id: string; title: string; kind: ContentKind; status: PostStatus } | null;
};

export interface ActivityPage {
  items: ActivityListItem[];
  nextCursor: string | null;
}

async function queryActivityPage(where: Prisma.AgencyActivityWhereInput, cursor?: string): Promise<ActivityPage> {
  const rows = await prisma.agencyActivity.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      client: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      post: { select: { id: true, title: true, kind: true, status: true } },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Paginated (30), most recent first. "mine" = assigned to me plus unassigned. */
export async function listActivities(input: ListActivitiesInput): Promise<ActivityPage> {
  const where: Prisma.AgencyActivityWhereInput = { workspaceId: input.workspaceId };
  if (input.tab === "notifications") {
    // OPEN only: an undone approval closes its notification, which is no longer true.
    where.kind = "INFO";
    where.status = "OPEN";
  } else {
    where.kind = "TASK";
    where.status = "OPEN";
  }
  if (input.clientId) where.clientId = input.clientId;
  if ((input.scope ?? "mine") === "mine") {
    where.OR = [{ assigneeUserId: input.userId }, { assigneeUserId: null }];
  }

  return queryActivityPage(where, input.cursor);
}

/** How far back "Mostra completate" looks (docs/ATTIVITA.md). */
export const COMPLETED_WINDOW_DAYS = 30;

export interface ListCompletedInput {
  workspaceId: string;
  userId: string;
  scope?: "mine" | "all";
  clientId?: string;
  cursor?: string;
}

/** Closed tasks of the last 30 days, most recent first ("Mostra completate"). */
export async function listCompletedTasks(input: ListCompletedInput): Promise<ActivityPage> {
  const since = new Date(Date.now() - COMPLETED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const where: Prisma.AgencyActivityWhereInput = {
    workspaceId: input.workspaceId,
    kind: "TASK",
    status: "DONE",
    doneAt: { gte: since },
  };
  if (input.clientId) where.clientId = input.clientId;
  if ((input.scope ?? "mine") === "mine") {
    where.OR = [{ assigneeUserId: input.userId }, { assigneeUserId: null }];
  }

  return queryActivityPage(where, input.cursor);
}

/** Open tasks for the menu counter (assigned to me plus unassigned). */
export async function countOpenTasks(workspaceId: string, userId: string): Promise<number> {
  return prisma.agencyActivity.count({
    where: {
      workspaceId,
      kind: "TASK",
      status: "OPEN",
      OR: [{ assigneeUserId: userId }, { assigneeUserId: null }],
    },
  });
}

/** Unread notifications for the tab label (assigned to me plus unassigned). */
export async function countUnreadNotifications(workspaceId: string, userId: string): Promise<number> {
  return prisma.agencyActivity.count({
    where: {
      workspaceId,
      kind: "INFO",
      status: "OPEN",
      readAt: null,
      OR: [{ assigneeUserId: userId }, { assigneeUserId: null }],
    },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

async function assertActivityInWorkspace(id: string, workspaceId: string): Promise<AgencyActivity> {
  const activity = await prisma.agencyActivity.findFirst({ where: { id, workspaceId } });
  if (!activity) throw new NotFoundError("Attività non trovata");
  return activity;
}

export async function markDone(workspaceId: string, id: string, userId: string): Promise<AgencyActivity> {
  await assertActivityInWorkspace(id, workspaceId);
  return prisma.agencyActivity.update({
    where: { id },
    data: { status: "DONE", doneAt: new Date(), doneByUserId: userId },
  });
}

export async function reopen(workspaceId: string, id: string): Promise<AgencyActivity> {
  await assertActivityInWorkspace(id, workspaceId);
  return prisma.agencyActivity.update({
    where: { id },
    data: { status: "OPEN", doneAt: null, doneByUserId: null },
  });
}

/** Assigns a task to a workspace member; null unassigns (everyone sees it). */
export async function assign(
  workspaceId: string,
  id: string,
  assigneeUserId: string | null
): Promise<AgencyActivity> {
  await assertActivityInWorkspace(id, workspaceId);
  if (assigneeUserId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: assigneeUserId },
      select: { id: true },
    });
    if (!member) throw new NotFoundError("Membro non trovato");
  }
  return prisma.agencyActivity.update({ where: { id }, data: { assigneeUserId } });
}

/** Marks the user's notifications (assigned to me plus unassigned) as read. */
export async function markAllNotificationsRead(workspaceId: string, userId: string): Promise<number> {
  const { count } = await prisma.agencyActivity.updateMany({
    where: {
      workspaceId,
      kind: "INFO",
      readAt: null,
      OR: [{ assigneeUserId: userId }, { assigneeUserId: null }],
    },
    data: { readAt: new Date() },
  });
  return count;
}
