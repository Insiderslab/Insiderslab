/**
 * Piano del mese — services.
 *
 * A ContentPlan groups the social posts of one client for one month
 * ("Piano social ottobre 2026"). The agency creates it (the month's posts are
 * attached), writes an intro for the client, and sends it in one go: every
 * draft / changes-requested post of the plan goes to review through
 * submitForReview, and each reviewer gets ONE email for the whole plan. The
 * client reviews it on /review/<token>/piani/<planId> and can approve every
 * post still waiting for them in one step ("Approva tutto il piano").
 *
 * Rules (docs/CONTRATTO.md still applies to every post):
 * - agency calls are scoped by workspaceId, client calls by reviewer.clientId;
 *   the client never sees a plan that was not sent, nor its drafts;
 * - "Approva tutto" approves each post with approvePost at the version the
 *   client saw on the plan page (version binding, state checks, Metricool
 *   scheduling exactly as for a single approval); posts with open client
 *   comments, changes requested or a newer version are left out and listed;
 * - plan membership is Post.planId; the month is "YYYY-MM" in the client's
 *   time zone (lib/plan-rules.ts);
 * - the plan status is derived from its posts; the column is kept in sync
 *   here (syncPlanStatus) whenever a plan is read or changed.
 */

import { z } from "zod";
import type { ContentKind, ContentPlan, PlanStatus, Prisma } from "@/app/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { clientHasService, serviceNotActiveMessage } from "@/lib/clients";
import { prisma } from "@/lib/db/client";
import { CLIENT_VISIBLE_STATUSES } from "@/lib/domain";
import {
  BulkApprovalFeedbackConflictError,
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  parseOrThrow,
} from "@/lib/errors";
import {
  notifyPlanApproved,
  notifyPlanComment,
  notifyPlanDecided,
  notifyPlanSent,
} from "@/lib/notifications";
import {
  APPROVED_LIKE,
  defaultPlanTitle,
  derivePlanStatus,
  isPlanDecided,
  parsePlanMonth,
  planMonthRange,
  selectApproveAll,
  type ApproveAllSkipReason,
} from "@/lib/plan-rules";
import { approvePost, submitForReview, type ReviewerRef } from "@/lib/posts";
import { isKindEnabled } from "@/lib/variant";

/** The UI is about social posts; the model is kind-agnostic. */
export const PLAN_KIND: ContentKind = "SOCIAL_POST";

const MAX_TITLE = 200;
const MAX_INTRO = 5000;
export const MAX_PLAN_COMMENT = 5000;
/** A stopped process cannot keep a completion notification forever. */
export const PLAN_NOTIFICATION_LEASE_MS = 5 * 60 * 1000;
/** Back off a known email failure until a later cron sweep. */
export const PLAN_NOTIFICATION_RETRY_MS = 5 * 60 * 1000;

function assertPlansEnabled(): void {
  if (!isKindEnabled(PLAN_KIND)) throw new NotFoundError("Piano non trovato");
}

function userIdOf(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}

// ─── Status ──────────────────────────────────────────────────────────────────

/** Recomputes the plan status from its posts and stores it when it changed. */
export async function syncPlanStatus(planId: string): Promise<PlanStatus | null> {
  const plan = await prisma.contentPlan.findUnique({
    where: { id: planId },
    select: { status: true, posts: { select: { status: true } } },
  });
  if (!plan) return null;
  const status = derivePlanStatus(plan.posts.map((p) => p.status));
  if (status !== plan.status) {
    await prisma.contentPlan.updateMany({ where: { id: planId }, data: { status } });
  }
  return status;
}

/**
 * After a client decision on one of the plan's posts (lib/posts calls this):
 * syncs the status and, once the client has answered on every post sent to
 * them, tells the agency — once per send. Returns true when that email went
 * out. Never throws.
 */
export async function afterPlanPostDecided(planId: string, now: Date = new Date()): Promise<boolean> {
  try {
    await syncPlanStatus(planId);
    const plan = await prisma.contentPlan.findUnique({
      where: { id: planId },
      select: {
        sentAt: true,
        completedNotifiedAt: true,
        completedNotificationClaimedAt: true,
        completedNotificationRetryAt: true,
        posts: { select: { status: true } },
      },
    });
    if (!plan?.sentAt || plan.completedNotifiedAt) return false;
    if (!isPlanDecided(plan.posts.map((p) => p.status))) return false;

    const leaseExpiredBefore = new Date(now.getTime() - PLAN_NOTIFICATION_LEASE_MS);
    if (plan.completedNotificationRetryAt && plan.completedNotificationRetryAt > now) return false;
    if (plan.completedNotificationClaimedAt && plan.completedNotificationClaimedAt > leaseExpiredBefore) return false;

    // Compare the submission timestamp too: a notification belongs to the
    // exact send that was complete when it was claimed.
    const { count } = await prisma.contentPlan.updateMany({
      where: {
        id: planId,
        sentAt: plan.sentAt,
        completedNotifiedAt: null,
        AND: [
          {
            OR: [
              { completedNotificationClaimedAt: null },
              { completedNotificationClaimedAt: { lte: leaseExpiredBefore } },
            ],
          },
          {
            OR: [
              { completedNotificationRetryAt: null },
              { completedNotificationRetryAt: { lte: now } },
            ],
          },
        ],
      },
      data: { completedNotificationClaimedAt: now },
    });
    if (count !== 1) return false;

    // Never hold a database transaction while the email provider is called.
    // An unexpected throw leaves the lease in place; its expiry is the crash
    // recovery path. A confirmed failure is released with a short backoff.
    const sent = await notifyPlanDecided(planId);
    if (!sent) {
      await prisma.contentPlan.updateMany({
        where: {
          id: planId,
          sentAt: plan.sentAt,
          completedNotifiedAt: null,
          completedNotificationClaimedAt: now,
        },
        data: {
          completedNotificationClaimedAt: null,
          completedNotificationRetryAt: new Date(now.getTime() + PLAN_NOTIFICATION_RETRY_MS),
        },
      });
      return false;
    }

    // If the agency re-sent the plan while the email was in flight, this CAS
    // deliberately fails: the new submission still needs its own follow-up.
    const marked = await prisma.contentPlan.updateMany({
      where: {
        id: planId,
        sentAt: plan.sentAt,
        completedNotifiedAt: null,
        completedNotificationClaimedAt: now,
      },
      data: {
        completedNotifiedAt: now,
        completedNotificationClaimedAt: null,
        completedNotificationRetryAt: null,
      },
    });
    return marked.count === 1;
  } catch (error) {
    console.error(`[plans] Follow-up of plan ${planId} failed:`, error);
    return false;
  }
}

/** Retry recoverable completion notifications, including already completed plans. */
export async function sweepPlanCompletionNotifications(now: Date = new Date()): Promise<number> {
  const leaseExpiredBefore = new Date(now.getTime() - PLAN_NOTIFICATION_LEASE_MS);
  const plans = await prisma.contentPlan.findMany({
    where: {
      sentAt: { not: null },
      completedNotifiedAt: null,
      // Keep this predicate equivalent to isPlanDecided: no post is still
      // with the client, and at least one post has received a decision. The
      // denormalized plan status can be DRAFT when decided posts coexist with
      // newly added drafts.
      posts: {
        none: { status: "IN_REVIEW" },
        some: { status: { in: [...APPROVED_LIKE, "CHANGES_REQUESTED"] } },
      },
      AND: [
        {
          OR: [
            { completedNotificationClaimedAt: null },
            { completedNotificationClaimedAt: { lte: leaseExpiredBefore } },
          ],
        },
        {
          OR: [
            { completedNotificationRetryAt: null },
            { completedNotificationRetryAt: { lte: now } },
          ],
        },
      ],
    },
    select: { id: true },
    take: 100,
  });

  const results = await Promise.all(plans.map((plan) => afterPlanPostDecided(plan.id, now)));
  return results.filter(Boolean).length;
}

// ─── Agency ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  month: z.string().refine((value) => parsePlanMonth(value) === value, "Mese non valido"),
  title: z.string().trim().max(MAX_TITLE).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1, "Scrivi un titolo").max(MAX_TITLE, "Titolo troppo lungo").optional(),
  intro: z.string().max(MAX_INTRO, "Messaggio troppo lungo (massimo 5.000 caratteri)").nullable().optional(),
  reviewDueAt: z.date().nullable().optional(),
});

/** Where clause of the posts of a client's month that make up its plan. */
function monthPostsWhere(
  client: { id: string; timezone: string },
  month: string,
  kind: ContentKind
): Prisma.PostWhereInput {
  const { start, end } = planMonthRange(month, client.timezone);
  return { clientId: client.id, kind, status: { not: "CANCELLED" }, publishAt: { gte: start, lt: end } };
}

/** Attaches the month's posts not in a plan yet. Returns how many were added. */
async function attachMonthPosts(
  plan: Pick<ContentPlan, "id" | "month" | "kind" | "workspaceId">,
  client: { id: string; timezone: string }
): Promise<number> {
  const { count } = await prisma.post.updateMany({
    where: { ...monthPostsWhere(client, plan.month, plan.kind), workspaceId: plan.workspaceId, planId: null },
    data: { planId: plan.id },
  });
  return count;
}

/**
 * Opens the plan of a client's month: creates it (title "Piano social
 * ottobre 2026", the month's posts attached) or returns the existing one.
 */
export async function createPlan(
  workspaceId: string,
  input: { clientId: string; month: string; title?: string },
  actor: Actor
): Promise<{ plan: ContentPlan; created: boolean }> {
  assertPlansEnabled();
  const data = parseOrThrow(createSchema, input);
  const client = await prisma.client.findFirst({ where: { id: data.clientId, workspaceId } });
  if (!client) throw new NotFoundError("Cliente non trovato");

  const existing = await prisma.contentPlan.findUnique({
    where: { clientId_kind_month: { clientId: client.id, kind: PLAN_KIND, month: data.month } },
  });
  if (existing) return { plan: existing, created: false };

  if (client.archivedAt) throw new ValidationError("Il cliente è archiviato");
  if (!clientHasService(client, PLAN_KIND)) throw new ValidationError(serviceNotActiveMessage(PLAN_KIND));

  let plan: ContentPlan;
  try {
    plan = await prisma.contentPlan.create({
      data: {
        workspaceId,
        clientId: client.id,
        kind: PLAN_KIND,
        month: data.month,
        title: data.title || defaultPlanTitle(data.month, PLAN_KIND),
        createdById: userIdOf(actor),
      },
    });
  } catch (error) {
    // Two clicks at once: the unique (client, kind, month) index keeps one.
    const again = await prisma.contentPlan.findUnique({
      where: { clientId_kind_month: { clientId: client.id, kind: PLAN_KIND, month: data.month } },
    });
    if (again) return { plan: again, created: false };
    throw error;
  }
  await attachMonthPosts(plan, client);
  await syncPlanStatus(plan.id);
  return { plan: await prisma.contentPlan.findUniqueOrThrow({ where: { id: plan.id } }), created: true };
}

async function findPlanForWorkspace(planId: string, workspaceId: string) {
  assertPlansEnabled();
  const plan = await prisma.contentPlan.findFirst({
    where: { id: planId, workspaceId },
    include: { client: true },
  });
  if (!plan) throw new NotFoundError("Piano non trovato");
  return plan;
}

/** Title, intro for the client and due date. */
export async function updatePlan(
  planId: string,
  workspaceId: string,
  input: { title?: string; intro?: string | null; reviewDueAt?: Date | null }
): Promise<ContentPlan> {
  const data = parseOrThrow(updateSchema, input);
  await findPlanForWorkspace(planId, workspaceId);
  if (data.reviewDueAt && Number.isNaN(data.reviewDueAt.getTime())) throw new ValidationError("Scadenza non valida");
  return prisma.contentPlan.update({
    where: { id: planId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.intro !== undefined ? { intro: data.intro?.trim() ? data.intro.trim() : null } : {}),
      ...(data.reviewDueAt !== undefined ? { reviewDueAt: data.reviewDueAt } : {}),
    },
  });
}

/** "Aggiungi al piano": posts of the same client and kind, not cancelled, not in another plan. */
export async function addPostsToPlan(planId: string, workspaceId: string, postIds: string[]): Promise<number> {
  const ids = [...new Set(postIds)];
  if (ids.length === 0) throw new ValidationError("Scegli almeno un post");
  if (ids.length > 200) throw new ValidationError("Puoi aggiungere al massimo 200 post alla volta");
  const plan = await findPlanForWorkspace(planId, workspaceId);
  const posts = await prisma.post.findMany({
    where: { id: { in: ids }, workspaceId, clientId: plan.clientId, kind: plan.kind },
    select: { id: true, status: true, planId: true },
  });
  if (posts.length !== ids.length) throw new NotFoundError("Uno o più post non sono stati trovati");
  if (posts.some((p) => p.status === "CANCELLED")) throw new ValidationError("Un post annullato non può entrare nel piano");
  if (posts.some((p) => p.planId && p.planId !== plan.id)) {
    throw new ValidationError("Uno dei post è già in un altro piano");
  }
  const { count } = await prisma.post.updateMany({
    where: { id: { in: ids }, workspaceId, planId: null },
    data: { planId: plan.id },
  });
  await syncPlanStatus(plan.id);
  return count;
}

export interface SendPlanResult {
  plan: ContentPlan;
  /** Posts sent to review now. */
  submitted: string[];
  /** Posts of the month attached right before sending. */
  attached: number;
  /** Review emails that went out (one per reviewer with an email). */
  emailed: number;
  clientsWithoutReviewers: string[];
  clientsWithoutEmail: string[];
}

/**
 * "Invia il piano al cliente": attaches the month's posts still outside the
 * plan, sends every DRAFT / CHANGES_REQUESTED post of the plan to review in
 * one submitForReview (same checks as a single send: Metricool rules, client
 * not archived…), and emails each reviewer ONCE for the whole plan.
 */
export async function sendPlan(
  planId: string,
  workspaceId: string,
  actor: Actor,
  opts: { reviewDueAt?: Date | null } = {}
): Promise<SendPlanResult> {
  const plan = await findPlanForWorkspace(planId, workspaceId);
  if (plan.client.archivedAt) throw new ValidationError(`Il cliente ${plan.client.name} è archiviato`);
  const reviewDueAt = opts.reviewDueAt === undefined ? plan.reviewDueAt : opts.reviewDueAt;
  if (reviewDueAt && Number.isNaN(reviewDueAt.getTime())) throw new ValidationError("Scadenza non valida");
  if (reviewDueAt && reviewDueAt.getTime() <= Date.now()) {
    throw new ValidationError("La scadenza per la risposta è già passata.");
  }

  const attached = await attachMonthPosts(plan, plan.client);
  const posts = await prisma.post.findMany({
    where: { planId: plan.id, workspaceId, status: { not: "CANCELLED" } },
    select: { id: true, status: true },
  });
  if (posts.length === 0) throw new ValidationError("Il piano non ha ancora post: preparali nel calendario del mese.");
  const toSubmit = posts.filter((p) => p.status === "DRAFT" || p.status === "CHANGES_REQUESTED").map((p) => p.id);
  if (toSubmit.length === 0) {
    throw new ValidationError(
      posts.some((p) => p.status === "IN_REVIEW")
        ? "Tutti i post del piano sono già dal cliente: niente di nuovo da inviare."
        : "Non ci sono post da inviare: sono già tutti approvati."
    );
  }

  const result = await submitForReview(toSubmit, workspaceId, actor, {
    ...(reviewDueAt ? { reviewDueAt } : {}),
    notify: false,
  });
  await prisma.contentPlan.update({
    where: { id: plan.id },
    data: {
      sentAt: new Date(),
      reviewDueAt: reviewDueAt ?? null,
      completedNotifiedAt: null,
      completedNotificationClaimedAt: null,
      completedNotificationRetryAt: null,
    },
  });
  await syncPlanStatus(plan.id);
  const emailed = await notifyPlanSent(plan.id);
  return {
    plan: await prisma.contentPlan.findUniqueOrThrow({ where: { id: plan.id } }),
    submitted: result.submitted,
    attached,
    emailed,
    clientsWithoutReviewers: result.clientsWithoutReviewers,
    clientsWithoutEmail: result.clientsWithoutEmail,
  };
}

const planPostSelect = {
  id: true,
  title: true,
  kind: true,
  status: true,
  publishAt: true,
  networks: true,
  networkOptions: true,
  currentVersionNumber: true,
  reviewDueAt: true,
  submittedAt: true,
  approvedAt: true,
  lastError: true,
  versions: { orderBy: { number: "desc" }, take: 1, select: { id: true, text: true, media: true, content: true } },
  _count: { select: { comments: { where: { authorType: "CLIENT", resolvedAt: null } } } },
} satisfies Prisma.PostSelect;

export type WorkspacePlanPost = Prisma.PostGetPayload<{ select: typeof planPostSelect }>;

/** The plan with its posts (current versions), the month's posts outside it and the plan comments. */
export async function getPlanForWorkspace(planId: string, workspaceId: string) {
  const found = await findPlanForWorkspace(planId, workspaceId);
  await syncPlanStatus(found.id);
  const [plan, outside] = await Promise.all([
    prisma.contentPlan.findUniqueOrThrow({
      where: { id: found.id },
      include: {
        client: true,
        createdBy: { select: { name: true, email: true } },
        posts: { where: { status: { not: "CANCELLED" } }, orderBy: { publishAt: "asc" }, select: planPostSelect },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { reviewer: { select: { name: true } }, user: { select: { name: true } } },
        },
      },
    }),
    prisma.post.findMany({
      where: { ...monthPostsWhere(found.client, found.month, found.kind), workspaceId, planId: null },
      orderBy: { publishAt: "asc" },
      select: planPostSelect,
    }),
  ]);
  return { ...plan, outside };
}

export type WorkspacePlan = Awaited<ReturnType<typeof getPlanForWorkspace>>;

/** Plans of the workspace (optionally one client), newest month first, with their posts' statuses. */
export async function listPlansForWorkspace(workspaceId: string, opts: { clientId?: string | null } = {}) {
  if (!isKindEnabled(PLAN_KIND)) return [];
  const plans = await prisma.contentPlan.findMany({
    // One client: all of its plans; all clients: archived clients' plans left out.
    where: {
      workspaceId,
      kind: PLAN_KIND,
      ...(opts.clientId ? { clientId: opts.clientId } : { client: { archivedAt: null } }),
    },
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      client: { select: { id: true, name: true, timezone: true, archivedAt: true } },
      posts: { where: { status: { not: "CANCELLED" } }, select: { status: true } },
    },
  });
  // Keep the stored status in step with the posts (edits elsewhere change them).
  const stale = plans.filter((p) => derivePlanStatus(p.posts.map((x) => x.status)) !== p.status);
  for (const plan of stale) await syncPlanStatus(plan.id);
  return plans.map((p) => ({ ...p, status: derivePlanStatus(p.posts.map((x) => x.status)) }));
}

/** The plan of a client's month, if there is one (calendar and post list links). */
export async function findPlanForMonth(workspaceId: string, clientId: string, month: string) {
  if (!isKindEnabled(PLAN_KIND) || !parsePlanMonth(month)) return null;
  return prisma.contentPlan.findFirst({
    where: { workspaceId, clientId, kind: PLAN_KIND, month },
    select: { id: true, title: true, status: true, sentAt: true },
  });
}

// ─── Client portal ───────────────────────────────────────────────────────────

/**
 * A plan as the client may see it: of the reviewer's client, already sent,
 * of a kind this instance handles. Anything else is "not found" (another
 * client's plan, a plan never sent, a wrong id).
 */
export async function getPlanForReviewer(planId: string, reviewer: ReviewerRef) {
  if (!isKindEnabled(PLAN_KIND) || planId.length > 64) throw new NotFoundError("Piano non trovato");
  const plan = await prisma.contentPlan.findFirst({
    where: { id: planId, clientId: reviewer.clientId, sentAt: { not: null }, kind: PLAN_KIND },
    include: {
      comments: {
        orderBy: { createdAt: "asc" },
        include: { reviewer: { select: { name: true } }, user: { select: { name: true } } },
      },
    },
  });
  if (!plan || plan.clientId !== reviewer.clientId) throw new NotFoundError("Piano non trovato");
  return plan;
}

export type ReviewerPlan = Awaited<ReturnType<typeof getPlanForReviewer>>;

/** Sent plans of the reviewer's client with the statuses of their client-visible posts (portal home). */
export async function listPlansForReviewer(reviewer: ReviewerRef) {
  if (!isKindEnabled(PLAN_KIND)) return [];
  return prisma.contentPlan.findMany({
    where: { clientId: reviewer.clientId, sentAt: { not: null }, kind: PLAN_KIND },
    orderBy: { month: "desc" },
    take: 24,
    select: {
      id: true,
      month: true,
      kind: true,
      title: true,
      reviewDueAt: true,
      posts: { where: { status: { in: CLIENT_VISIBLE_STATUSES } }, select: { id: true, status: true } },
    },
  });
}

/**
 * Feedback that excludes a post from one-click plan approval, on each post's
 * latest version. The historical name remains because the portal consumes the
 * count as an eligibility signal.
 *
 * Includes unresolved client comments (and legacy null-version comments), a
 * conversation with at least one CLIENT message, active voice calls, and
 * authenticated user speech fragments not projected yet. An assistant-only
 * greeting is not client feedback.
 */
export async function openClientCommentCounts(postIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (postIds.length === 0) return counts;
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: {
      id: true,
      currentVersionNumber: true,
      versions: { orderBy: { number: "desc" }, take: 1, select: { id: true } },
      comments: { where: { authorType: "CLIENT", resolvedAt: null }, select: { versionId: true } },
      reviewSessions: {
        select: {
          versionNumber: true,
          messages: { where: { role: "CLIENT" }, take: 1, select: { id: true } },
          voiceCalls: {
            where: {
              OR: [
                { status: { in: ["STARTING", "ACTIVE", "CLOSING"] } },
                { fragments: { some: { speaker: "user" } } },
              ],
            },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  for (const post of posts) {
    const current = post.versions[0]?.id;
    // Comments without a version predate versioning: they count for the current one.
    const comments = post.comments.filter((c) => c.versionId === null || c.versionId === current).length;
    const conversations = post.reviewSessions.filter(
      (session) =>
        session.versionNumber === post.currentVersionNumber &&
        (session.messages.length > 0 || session.voiceCalls.length > 0)
    ).length;
    counts.set(post.id, comments + conversations);
  }
  return counts;
}

export interface ApprovePlanResult {
  approved: string[];
  skipped: Array<{ id: string; title: string; reason: ApproveAllSkipReason }>;
  /** The plan is now fully decided (the agency got the summary). */
  completed: boolean;
}

const seenSchema = z
  .array(z.object({ postId: z.string().trim().min(1).max(64), versionNumber: z.number().int().min(1).max(100_000) }))
  .max(500);

/**
 * "Approva tutto il piano": approves every post still waiting for the client
 * at the version shown on the plan page (`seen`). Posts with open client
 * comments, changes requested or another version are left out and returned
 * in `skipped`. Each approval is approvePost's (version binding, transition
 * check, Metricool scheduling through the queue); the agency gets one email.
 */
export async function approvePlan(
  planId: string,
  reviewer: ReviewerRef,
  seen: Array<{ postId: string; versionNumber: number }>
): Promise<ApprovePlanResult> {
  const shown = parseOrThrow(seenSchema, seen);
  const plan = await getPlanForReviewer(planId, reviewer);

  const posts = await prisma.post.findMany({
    where: {
      planId: plan.id,
      clientId: reviewer.clientId,
      kind: plan.kind,
      status: { in: CLIENT_VISIBLE_STATUSES },
    },
    orderBy: { publishAt: "asc" },
    select: { id: true, title: true, status: true, currentVersionNumber: true, submittedAt: true },
  });
  const comments = await openClientCommentCounts(posts.map((p) => p.id));
  const selection = selectApproveAll(
    posts.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      versionNumber: p.currentVersionNumber,
      // IN_REVIEW always carries the version that was sent (an edit sends it back to draft).
      canAct: p.status === "IN_REVIEW",
      openClientComments: comments.get(p.id) ?? 0,
    })),
    new Map(shown.map((s) => [s.postId, s.versionNumber]))
  );
  if (selection.approve.length === 0) {
    throw new ValidationError(
      selection.skipped.length > 0
        ? "Nessun post da approvare in blocco: apri quelli rimasti e decidili uno per uno."
        : "Non ci sono post che aspettano la tua approvazione in questo piano."
    );
  }

  const approved: string[] = [];
  const skipped = [...selection.skipped];
  const titles = new Map(posts.map((p) => [p.id, p.title]));
  for (const item of selection.approve) {
    try {
      await approvePost(item.id, reviewer, item.versionNumber, { notify: false, bulkSafety: true });
      approved.push(item.id);
    } catch (error) {
      if (error instanceof BulkApprovalFeedbackConflictError) {
        skipped.push({ id: item.id, title: titles.get(item.id) ?? "", reason: "comments" });
        continue;
      }
      if (error instanceof ConflictError || error instanceof InvalidTransitionError || error instanceof NotFoundError) {
        skipped.push({ id: item.id, title: titles.get(item.id) ?? "", reason: "stale" });
        continue;
      }
      // Something else broke: what is approved stays approved; report and stop.
      console.error(`[plans] Approving post ${item.id} of plan ${plan.id} failed:`, error);
      if (approved.length === 0) throw error;
      skipped.push({ id: item.id, title: titles.get(item.id) ?? "", reason: "stale" });
    }
  }

  const completed = await afterPlanPostDecided(plan.id);
  if (!completed && approved.length > 0) await notifyPlanApproved(plan.id, reviewer.id, approved);
  return { approved, skipped, completed };
}

const commentSchema = z
  .string()
  .trim()
  .min(1, "Scrivi il commento")
  .max(MAX_PLAN_COMMENT, "Commento troppo lungo (massimo 5.000 caratteri)");

/** "Commento sul piano": a general note of the client on the whole plan. */
export async function addPlanComment(planId: string, reviewer: ReviewerRef, body: string) {
  const text = parseOrThrow(commentSchema, body);
  const plan = await getPlanForReviewer(planId, reviewer);
  const comment = await prisma.contentPlanComment.create({
    data: { planId: plan.id, authorType: "CLIENT", reviewerId: reviewer.id, body: text },
  });
  await notifyPlanComment(comment.id);
  return comment;
}
