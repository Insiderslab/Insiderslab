import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { userActor } from "@/lib/actor";
import { createPost, postInputSchema, stableStringify, validatePostDraft } from "@/lib/posts";
import { AutomationError } from "./auth";

/**
 * Shared core of the draft importers: the automation API (Codex / Claude,
 * lib/automation/posts.ts) and the agency panel ("Importa post",
 * lib/post-import/service.ts) both prepare and create imported drafts here, so
 * strict input checks, domain validation (validatePostDraft), the content hash
 * and the idempotency rules (importKey / importHash) cannot drift apart.
 *
 * The MCP server (lib/mcp, tool create_draft_posts) is a third caller of the same
 * functions (source "mcp").
 *
 * Imported posts are always DRAFTs: nothing here submits, approves or schedules.
 */

export type DraftContext = {
  workspaceId: string;
  userId: string;
  /** Set when the import comes from an automation key; the panel has none. */
  tokenId?: string | null;
};

export type PreparedDraft = {
  post: Awaited<ReturnType<typeof validatePostDraft>>;
  /** sha256 of the submitted payload; replays with another hash are conflicts. */
  hash: string;
};

/** Strict parse + domain validation of one post, with no writes. */
export async function prepareDraft(workspaceId: string, raw: unknown): Promise<PreparedDraft> {
  const parsed = postInputSchema.strict().safeParse(raw);
  if (!parsed.success) throw new AutomationError("INVALID_INPUT", parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  // Imports reference uploaded assets, never arbitrary remote URLs or server-side file paths.
  if (parsed.data.kind && parsed.data.kind !== "SOCIAL_POST") {
    throw new AutomationError("UNSUPPORTED_KIND", "L'importazione v1 supporta i post social");
  }
  if (parsed.data.media?.some(m => !m.assetId)) {
    throw new AutomationError("MEDIA_ASSET_REQUIRED", "Carica prima i media con /media e usa gli assetId restituiti");
  }
  const post = await validatePostDraft(workspaceId, parsed.data);
  // Hash the submitted, validated payload (before asset normalization), so replay is
  // unaffected by changes to the app's public origin or normalization defaults.
  const hash = createHash("sha256").update(stableStringify({ ...parsed.data, publishAt: parsed.data.publishAt.toISOString() })).digest("hex");
  return { post, hash };
}

/**
 * Creates the draft for `externalId`, or returns the one already created for
 * it. Same key and hash replay; same key with other data is a 409 conflict.
 * `hash` overrides the payload hash: the panel derives its key from the row's
 * content, so re-uploading the same picture (a new assetId) is still a replay.
 */
export async function importPreparedDraft(
  context: DraftContext,
  prepared: PreparedDraft,
  externalId: string,
  options: { hash?: string; source?: "automation" | "panel" | "mcp"; via?: string | null } = {}
) {
  const hash = options.hash ?? prepared.hash;
  const where = { workspaceId_importKey: { workspaceId: context.workspaceId, importKey: externalId } };
  const replay = (existing: { id: string; status: string; importHash: string | null }) => {
    if (existing.importHash !== hash) {
      throw new AutomationError("IMPORT_CONFLICT", "Questo externalId esiste con dati diversi: non è stato modificato né duplicato", 409);
    }
    return { post: { id: existing.id, status: existing.status }, replayed: true };
  };
  const existing = await prisma.post.findUnique({ where });
  if (existing) return replay(existing);
  try {
    const post = await createPost(context.workspaceId, prepared.post, userActor(context.userId), {
      key: externalId, hash, tokenId: context.tokenId ?? null, source: options.source ?? "automation",
      ...(options.via ? { via: options.via } : {}),
    });
    return { post: { id: post.id, status: post.status }, replayed: false };
  } catch (error) {
    // A competing request can win the DB unique constraint. Never retry creation.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const winner = await prisma.post.findUnique({ where });
      if (winner) return replay(winner);
    }
    throw error;
  }
}
