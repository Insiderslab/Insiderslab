"use server";

/**
 * Server actions for the agency's posts: create / edit, submit for review
 * (single and bulk), schedule now / retry on Metricool, cancel, comments.
 *
 * Actions are plain POST endpoints, so every one re-reads the workspace from
 * the session and hands it to the lib/ services, which match each id against
 * it. Shapes are checked with zod here; the services validate the content
 * again with their own schemas and throw Italian domain errors.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult, CommentInput, PostFormInput } from "@/components/posts/types";
import { userActor } from "@/lib/actor";
import { prisma } from "@/lib/db/client";
import type { MediaItem, Network } from "@/lib/domain";
import { isDomainError, parseOrThrow, publicErrorMessage } from "@/lib/errors";
import {
  addComment,
  cancelPost,
  createPost,
  resolveComment,
  submitForReview,
  updatePost,
  type PostInput,
} from "@/lib/posts";
import { requestScheduling } from "@/lib/scheduling";
import { getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

const idSchema = z.string().trim().min(1).max(64);

/** Shape only: lib/posts validates media, networks and limits in depth. */
const postFormSchema = z.object({
  clientId: idSchema,
  title: z.string().max(500),
  publishAt: z.iso.datetime({ error: "Data di pubblicazione non valida" }),
  networks: z.array(z.string().max(32)).max(20),
  networkOptions: z.record(z.string().max(64), z.record(z.string().max(64), z.unknown())),
  text: z.string().max(100_000),
  firstCommentText: z.string().max(20_000).nullable(),
  media: z.array(z.record(z.string(), z.unknown())).max(50),
  videoCoverMs: z.number().int().min(0).nullable(),
  changeNote: z.string().max(1000).optional(),
});

const submitSchema = z.object({
  postIds: z.array(idSchema).min(1, "Seleziona almeno un post").max(200),
  reviewDueAt: z.iso.datetime({ error: "Scadenza non valida" }).nullable().optional(),
});

const commentSchema = z.object({
  postId: idSchema,
  body: z.string().max(10_000),
  versionId: idSchema.optional(),
  mediaIndex: z.number().int().min(0).max(100).optional(),
  pinX: z.number().min(0).max(1).optional(),
  pinY: z.number().min(0).max(1).optional(),
  timeSec: z.number().min(0).optional(),
  timeEndSec: z.number().min(0).optional(),
});

const resolveSchema = z.object({
  commentIds: z.array(idSchema).min(1).max(50),
  resolved: z.boolean(),
});

const SESSION_EXPIRED = "Sessione scaduta: accedi di nuovo.";

/** Runs `fn` for the signed-in workspace, mapping domain errors to messages. */
async function withWorkspace<T>(
  fn: (context: WorkspaceContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: SESSION_EXPIRED };
  try {
    return await fn(context);
  } catch (error) {
    if (!isDomainError(error)) console.error("[posts] Action failed:", error);
    return { ok: false, error: publicErrorMessage(error) };
  }
}

/** Pages that show post statuses (the layout's counter refreshes with them). */
function revalidatePosts(postIds: string[] = []) {
  revalidatePath("/dashboard");
  revalidatePath("/posts");
  revalidatePath("/calendar");
  for (const id of postIds) revalidatePath(`/posts/${id}`);
}

function toServiceInput(data: z.output<typeof postFormSchema>): PostInput {
  return {
    clientId: data.clientId,
    title: data.title,
    publishAt: new Date(data.publishAt),
    // Narrowed by lib/posts' own schema (unknown networks and bad media are rejected there).
    networks: data.networks as Network[],
    networkOptions: data.networkOptions,
    text: data.text,
    firstCommentText: data.firstCommentText,
    media: data.media as unknown as MediaItem[],
    videoCoverMs: data.videoCoverMs,
  };
}

// ─── Create / edit ───────────────────────────────────────────────────────────

export async function createPostAction(input: PostFormInput): Promise<ActionResult<{ id: string }>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const data = parseOrThrow(postFormSchema, input);
    const post = await createPost(workspaceId, toServiceInput(data), userActor(userId));
    revalidatePosts();
    return { ok: true, data: { id: post.id }, message: "Bozza salvata." };
  });
}

export async function updatePostAction(
  postId: string,
  input: PostFormInput
): Promise<ActionResult<{ status: string; versionNumber: number }>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const id = parseOrThrow(idSchema, postId);
    const data = parseOrThrow(postFormSchema, input);
    const before = await prisma.post.findFirst({
      where: { id, workspaceId },
      select: { status: true, currentVersionNumber: true },
    });
    const post = await updatePost(
      id,
      workspaceId,
      { ...toServiceInput(data), ...(data.changeNote !== undefined ? { changeNote: data.changeNote } : {}) },
      userActor(userId)
    );
    revalidatePosts([id]);

    let message = "Modifiche salvate.";
    if (before && post.currentVersionNumber > before.currentVersionNumber) {
      message = `Salvato come versione ${post.currentVersionNumber}.`;
    }
    if (before && before.status !== post.status && post.status === "DRAFT") {
      message += " Il post è tornato in bozza: invialo di nuovo in revisione.";
    }
    return { ok: true, data: { status: post.status, versionNumber: post.currentVersionNumber }, message };
  });
}

// ─── Status changes ──────────────────────────────────────────────────────────

/** Sends one or more posts to the client (one email per reviewer). */
export async function submitForReviewAction(
  postIds: string[],
  options: { reviewDueAt?: string | null } = {}
): Promise<ActionResult<{ submitted: number }>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const data = parseOrThrow(submitSchema, { postIds, reviewDueAt: options?.reviewDueAt });
    const reviewDueAt = data.reviewDueAt ? new Date(data.reviewDueAt) : undefined;
    if (reviewDueAt && reviewDueAt.getTime() <= Date.now()) {
      return { ok: false, error: "La scadenza per la risposta è già passata." };
    }

    const result = await submitForReview(data.postIds, workspaceId, userActor(userId), { reviewDueAt });
    revalidatePosts(result.submitted);

    const count = result.submitted.length;
    let message = count === 1 ? "Post inviato in revisione." : `${count} post inviati in revisione.`;
    if (result.clientsWithoutReviewers.length > 0) {
      message += ` Attenzione: ${result.clientsWithoutReviewers.join(", ")} non ha referenti attivi, quindi nessuno riceverà l'email. Aggiungili nella scheda del cliente.`;
    }
    return { ok: true, data: { submitted: count }, message };
  });
}

/** "Programma ora" on an APPROVED post, "Riprova" on a FAILED one. */
export async function schedulePostAction(postId: string): Promise<ActionResult<{ status: string }>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const id = parseOrThrow(idSchema, postId);
    const result = await requestScheduling(id, userActor(userId), { workspaceId });
    revalidatePosts([id]);

    if (result.queued) {
      return {
        ok: true,
        data: { status: result.status },
        message: "Programmazione su Metricool avviata: lo stato si aggiorna tra pochi secondi.",
      };
    }
    switch (result.reason) {
      case "already_scheduled":
        return { ok: true, data: { status: result.status }, message: "Il post è già programmato su Metricool." };
      case "already_in_progress":
        return { ok: true, data: { status: result.status }, message: "La programmazione è già in corso." };
      case "enqueue_failed":
        return {
          ok: true,
          data: { status: result.status },
          message: "La coda di programmazione non risponde: il post verrà ripreso automaticamente entro pochi minuti.",
        };
    }
  });
}

export async function cancelPostAction(postId: string): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const id = parseOrThrow(idSchema, postId);
    await cancelPost(id, workspaceId, userActor(userId));
    revalidatePosts([id]);
    return { ok: true, data: undefined, message: "Post annullato: il cliente non lo vede più." };
  });
}

// ─── Comments ────────────────────────────────────────────────────────────────

/** Agency comment or reply (a reply copies the anchor of the comment it answers). */
export async function addCommentAction(input: CommentInput): Promise<ActionResult<{ id: string }>> {
  return withWorkspace(async ({ workspaceId, userId }) => {
    const data = parseOrThrow(commentSchema, input);
    const comment = await addComment({ ...data, actor: userActor(userId), workspaceId });
    revalidatePath(`/posts/${data.postId}`);
    return { ok: true, data: { id: comment.id }, message: "Commento aggiunto." };
  });
}

/** Resolves (or reopens) every comment of a thread. */
export async function resolveCommentsAction(
  postId: string,
  commentIds: string[],
  resolved: boolean
): Promise<ActionResult> {
  return withWorkspace(async ({ workspaceId }) => {
    const id = parseOrThrow(idSchema, postId);
    const data = parseOrThrow(resolveSchema, { commentIds, resolved });
    for (const commentId of data.commentIds) {
      await resolveComment(commentId, workspaceId, data.resolved);
    }
    revalidatePath(`/posts/${id}`);
    return { ok: true, data: undefined, message: data.resolved ? "Segnato come risolto." : "Riaperto." };
  });
}
