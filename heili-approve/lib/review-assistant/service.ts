/**
 * Review assistant — server-side orchestration (DB + engine).
 *
 * Used by the public client-portal routes under /api/review/[token]/assistant.
 * The caller has already resolved the reviewer from the link token; every
 * function here re-loads the post through getPostForReviewer (client-scoped,
 * drafts hidden) and re-checks client, status and version before spending a
 * model call.
 *
 * Conversations are bound to (post, reviewer, version). The transcript is
 * append-only: each client message is stored before the model is called (so
 * a failed call loses nothing) and the reply is appended after. A completed
 * session is reopened by a new message on the same version; when the agency
 * sends a new version, the reviewer's open sessions on older versions are
 * marked ABANDONED.
 *
 * Cost control: every model call is preceded by a short transaction that
 * holds a per-reviewer advisory lock, re-reads the reviewer's sessions,
 * checks the limits, stores the client message and claims the session's turn
 * (ReviewSession.turnStartedAt). A second request while a turn is in flight is
 * refused with 409, so parallel retries, parallel first messages and parallel
 * finalize calls cannot multiply model calls or bypass the caps.
 */

import type { Prisma, ReviewInputMode } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getPostForReviewer, type ReviewerPost } from "@/lib/posts";
import { itemLabelsFor, itemTargetFor } from "./content";
import { AssistantError, getAssistantProvider, runAssistantFinalize, runAssistantTurn } from "./provider";
import { buildPostContext } from "./prompt";
import {
  checkMessageLimits,
  pickSessionForVersion,
  sanitizeActionItemsFor,
  sessionsLeft,
  sortMessages,
  toHistory,
  toSessionView,
  type SessionWithMessages,
} from "./rules";
import {
  formatChangesMessage,
  type ActionItemLabels,
  type AssistantFinalizeResponse,
  type AssistantStateResponse,
  type AssistantTurnResponse,
} from "./shared";

/** The reviewer as resolved from the link token (ClientReviewer fields used here). */
export interface AssistantReviewer {
  id: string;
  clientId: string;
  name: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longer than the slowest model call (timeout × retries): an older claim is a dead process. */
const TURN_STALE_MS = 5 * 60 * 1000;
const TURN_BUSY_MESSAGE = "L'assistente sta ancora rispondendo: attendi qualche secondo e riprova.";

const NOT_ACTIONABLE_MESSAGE = "Questo post non è più in revisione: ricarica la pagina.";
const STALE_VERSION_MESSAGE = "Nel frattempo l'agenzia ha caricato una nuova versione del post: ricarica la pagina.";

// ─── Loading and checks ──────────────────────────────────────────────────────

async function loadPost(reviewer: AssistantReviewer, postId: string): Promise<ReviewerPost> {
  // Throws NotFoundError for other clients' posts and for drafts.
  const post = await getPostForReviewer(postId, { id: reviewer.id, clientId: reviewer.clientId });
  if (post.client.id !== reviewer.clientId) throw new AssistantError("Post non trovato", 404);
  return post;
}

/** The client may talk about this version only while it is the one under review. */
function assertActionable(post: ReviewerPost, versionNumber: number): void {
  if (post.status !== "IN_REVIEW" || !post.canAct) throw new AssistantError(NOT_ACTIONABLE_MESSAGE, 409);
  if (versionNumber !== post.currentVersionNumber) throw new AssistantError(STALE_VERSION_MESSAGE, 409);
}

/** Names of the ads variants of a version, for the ready-made message (empty for other kinds). */
function labelsFor(post: ReviewerPost, versionNumber: number): ActionItemLabels {
  const version = post.versions.find((v) => v.number === versionNumber);
  return version ? itemLabelsFor(post.kind, version.content) : {};
}

function requireEnabledProvider() {
  const provider = getAssistantProvider();
  if (!provider) throw new AssistantError("Assistente non disponibile", 404);
  return provider;
}

async function loadSession(sessionId: string): Promise<SessionWithMessages> {
  return prisma.reviewSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

/** Open sessions left on older versions will never be finished. */
async function abandonStaleSessions(post: ReviewerPost, reviewerId: string): Promise<void> {
  const stale = post.reviewSessions.filter(
    (s) => s.status === "OPEN" && s.versionNumber !== post.currentVersionNumber
  );
  if (stale.length === 0) return;
  await prisma.reviewSession.updateMany({
    where: { id: { in: stale.map((s) => s.id) }, reviewerId, status: "OPEN" },
    data: { status: "ABANDONED" },
  });
}

async function countClientMessagesLast24h(db: Prisma.TransactionClient, reviewerId: string): Promise<number> {
  return db.reviewMessage.count({
    where: { role: "CLIENT", createdAt: { gte: new Date(Date.now() - DAY_MS) }, session: { reviewerId } },
  });
}

/** Serialises this reviewer's limit checks, message inserts and turn claims. */
async function lockReviewer(tx: Prisma.TransactionClient, reviewerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review-assistant:${reviewerId}`}))`;
}

function turnInFlight(session: { turnStartedAt: Date | null }, now: Date): boolean {
  return session.turnStartedAt !== null && now.getTime() - session.turnStartedAt.getTime() < TURN_STALE_MS;
}

/** Frees the turn, unless it went stale and someone else claimed it since. */
async function releaseTurn(sessionId: string, claimedAt: Date): Promise<void> {
  try {
    await prisma.reviewSession.updateMany({
      where: { id: sessionId, turnStartedAt: claimedAt },
      data: { turnStartedAt: null },
    });
  } catch (error) {
    console.error(`[review-assistant] Could not release turn on session ${sessionId}:`, error);
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

/** What the panel shows when it (re)opens: the session to resume, if any. */
export async function getAssistantState(
  reviewer: AssistantReviewer,
  postId: string,
  versionNumber: number
): Promise<AssistantStateResponse> {
  const post = await loadPost(reviewer, postId);
  const session = pickSessionForVersion(post.reviewSessions, versionNumber);
  const canChat = post.status === "IN_REVIEW" && post.canAct && versionNumber === post.currentVersionNumber;
  return {
    session: session ? toSessionView(session, labelsFor(post, versionNumber)) : null,
    sessionsLeft: sessionsLeft(post.reviewSessions.length),
    canChat,
  };
}

// ─── Chat turn ───────────────────────────────────────────────────────────────

export interface SendMessageInput {
  postId: string;
  versionNumber: number;
  /** Omitted only with retry: re-run the turn for the last unanswered message. */
  message?: string;
  inputMode: ReviewInputMode;
  retry?: boolean;
}

/** Stores the client's message, asks the engine, stores and returns the reply. */
export async function sendAssistantMessage(
  reviewer: AssistantReviewer,
  input: SendMessageInput
): Promise<AssistantTurnResponse> {
  const provider = requireEnabledProvider();
  const post = await loadPost(reviewer, input.postId);
  assertActionable(post, input.versionNumber);
  await abandonStaleSessions(post, reviewer.id);

  const message = input.message?.trim() ?? "";

  // Checks, message insert and turn claim happen atomically under the
  // reviewer's lock, on a fresh read (the `post` snapshot may be stale).
  const claim = await prisma.$transaction(async (tx) => {
    await lockReviewer(tx, reviewer.id);
    const now = new Date();
    const sessions = await tx.reviewSession.findMany({
      where: { postId: post.id, reviewerId: reviewer.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    const existing = pickSessionForVersion(sessions, input.versionNumber);
    if (existing && turnInFlight(existing, now)) throw new AssistantError(TURN_BUSY_MESSAGE, 409);

    if (!message) {
      // Retry: only when the last stored message is an unanswered client
      // one. The claim makes it one model call at a time, and a successful
      // reply closes the retry for that message.
      const last = existing ? sortMessages(existing.messages).at(-1) : undefined;
      if (!existing || existing.status !== "OPEN" || !input.retry || last?.role !== "CLIENT") {
        throw new AssistantError("Scrivi un messaggio per l'assistente.", 400);
      }
      await tx.reviewSession.update({ where: { id: existing.id }, data: { turnStartedAt: now } });
      return { sessionId: existing.id, claimedAt: now, sessionsOnPost: sessions.length };
    }

    const limitError = checkMessageLimits({
      hasCurrentSession: existing !== null,
      sessionsOnPost: sessions.length,
      clientMessagesInSession: existing ? existing.messages.filter((m) => m.role === "CLIENT").length : 0,
      clientMessagesLast24h: await countClientMessagesLast24h(tx, reviewer.id),
    });
    if (limitError) throw new AssistantError(limitError, 429);

    let sessionId: string;
    if (!existing) {
      const created = await tx.reviewSession.create({
        data: {
          postId: post.id,
          reviewerId: reviewer.id,
          versionNumber: input.versionNumber,
          model: provider.model(),
          turnStartedAt: now,
        },
        select: { id: true },
      });
      sessionId = created.id;
    } else {
      sessionId = existing.id;
      await tx.reviewSession.update({
        where: { id: existing.id },
        data: {
          turnStartedAt: now,
          // New feedback after the summary: reopen; a fresh summary replaces the old one.
          ...(existing.status === "COMPLETED"
            ? { status: "OPEN" as const, completedAt: null, verdict: null, summary: null, actionItems: [] }
            : {}),
        },
      });
    }

    await tx.reviewMessage.create({
      data: { sessionId, role: "CLIENT", content: message, inputMode: input.inputMode },
    });
    return { sessionId, claimedAt: now, sessionsOnPost: sessions.length + (existing ? 0 : 1) };
  });

  const { sessionId } = claim;
  try {
    const session = await loadSession(sessionId);
    const ctx = buildPostContext(post, reviewer.name, input.versionNumber);
    const result = await runAssistantTurn(ctx, toHistory(sortMessages(session.messages)), provider);

    await prisma.$transaction([
      prisma.reviewMessage.create({
        data: { sessionId, role: "ASSISTANT", content: result.reply, inputMode: "TEXT" },
      }),
      prisma.reviewSession.update({ where: { id: sessionId }, data: { model: result.model } }),
    ]);

    return {
      session: toSessionView(await releaseAndLoad(sessionId, claim.claimedAt), labelsFor(post, input.versionNumber)),
      readiness: result.readiness,
      sessionsLeft: sessionsLeft(claim.sessionsOnPost),
    };
  } finally {
    await releaseTurn(sessionId, claim.claimedAt);
  }
}

async function releaseAndLoad(sessionId: string, claimedAt: Date): Promise<SessionWithMessages> {
  await releaseTurn(sessionId, claimedAt);
  return loadSession(sessionId);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface FinalizeInput {
  postId: string;
  versionNumber: number;
}

/**
 * Closes the conversation with a structured summary for the agency
 * (verdict, summary, action items with media and video times, ads variants
 * or article passages). Idempotent: a session already summarised is
 * returned as is, without a model call.
 * It never approves nor sends anything: the client clicks for that.
 */
export async function finalizeSession(
  reviewer: AssistantReviewer,
  input: FinalizeInput
): Promise<AssistantFinalizeResponse> {
  const provider = requireEnabledProvider();
  const post = await loadPost(reviewer, input.postId);
  assertActionable(post, input.versionNumber);

  const session = pickSessionForVersion(post.reviewSessions, input.versionNumber);
  if (!session) throw new AssistantError("Non c'è ancora nessuna conversazione da riassumere.", 400);

  const labels = labelsFor(post, input.versionNumber);
  if (session.status === "COMPLETED" && session.summary) return finalizeResponse(session, labels);

  // Claim the turn (same lock as the chat): a double click or a parallel
  // request gets 409 instead of a second, expensive summary call.
  const claim = await prisma.$transaction(async (tx) => {
    await lockReviewer(tx, reviewer.id);
    const now = new Date();
    const fresh = await tx.reviewSession.findUnique({
      where: { id: session.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!fresh) throw new AssistantError("Conversazione non trovata", 404);
    if (fresh.status === "COMPLETED" && fresh.summary) return null;
    if (fresh.status !== "OPEN") throw new AssistantError(NOT_ACTIONABLE_MESSAGE, 409);
    if (turnInFlight(fresh, now)) throw new AssistantError(TURN_BUSY_MESSAGE, 409);
    const messages = sortMessages(fresh.messages);
    if (!messages.some((m) => m.role === "CLIENT")) {
      throw new AssistantError("Scrivi almeno un messaggio all'assistente prima di preparare il riepilogo.", 400);
    }
    await tx.reviewSession.update({ where: { id: fresh.id }, data: { turnStartedAt: now } });
    return { claimedAt: now, messages };
  });
  // Summarised by a concurrent request in the meantime.
  if (!claim) return finalizeResponse(await loadSession(session.id), labels);

  try {
    const version = post.versions.find((v) => v.number === input.versionNumber);
    const ctx = buildPostContext(post, reviewer.name, input.versionNumber);
    const result = await runAssistantFinalize(ctx, toHistory(claim.messages), provider);
    // Kind-aware clean-up: social media/moments, blog passages that really
    // are in the article, ads variants (and their media/moments).
    const actionItems = sanitizeActionItemsFor(
      result.actionItems,
      itemTargetFor(post.kind, { media: version?.media ?? [], content: version?.content ?? null })
    );
    const summary = result.summary.trim() || "Riepilogo non disponibile.";

    // Guarded on OPEN so a double click cannot overwrite a newer summary.
    await prisma.reviewSession.updateMany({
      where: { id: session.id, status: "OPEN" },
      data: {
        status: "COMPLETED",
        verdict: result.verdict,
        summary,
        actionItems,
        model: result.model,
        completedAt: new Date(),
      },
    });

    return finalizeResponse(await releaseAndLoad(session.id, claim.claimedAt), labels);
  } finally {
    await releaseTurn(session.id, claim.claimedAt);
  }
}

function finalizeResponse(session: SessionWithMessages, labels: ActionItemLabels): AssistantFinalizeResponse {
  const view = toSessionView(session, labels);
  return {
    session: view,
    changesMessage: view.changesMessage ?? formatChangesMessage(view.summary ?? "", view.actionItems, undefined, labels),
  };
}
