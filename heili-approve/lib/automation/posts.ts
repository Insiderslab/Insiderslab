import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { userActor } from "@/lib/actor";
import { createPost, postInputSchema, stableStringify, validatePostDraft } from "@/lib/posts";
import { AutomationError, type AutomationContext } from "./auth";

const envelope = z.object({
  externalId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/),
  post: z.object({ publishAt: z.iso.datetime({ offset: true }) }).passthrough(),
}).strict();

export async function prepareAutomationDraft(context: AutomationContext, body: unknown) {
  const outer = envelope.safeParse(body);
  if (!outer.success) throw new AutomationError("INVALID_INPUT", outer.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const parsed = postInputSchema.strict().safeParse(outer.data.post);
  if (!parsed.success) throw new AutomationError("INVALID_INPUT", parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  // Imports reference uploaded assets, never arbitrary remote URLs or server-side file paths.
  if (parsed.data.kind && parsed.data.kind !== "SOCIAL_POST") {
    throw new AutomationError("UNSUPPORTED_KIND", "L'importazione v1 supporta i post social");
  }
  if (parsed.data.media?.some(m => !m.assetId)) {
    throw new AutomationError("MEDIA_ASSET_REQUIRED", "Carica prima i media con /media e usa gli assetId restituiti");
  }
  const post = await validatePostDraft(context.workspaceId, parsed.data);
  // Hash the submitted, validated payload (before asset normalization), so replay is
  // unaffected by changes to the app's public origin or normalization defaults.
  const hash = createHash("sha256").update(stableStringify({ ...parsed.data, publishAt: parsed.data.publishAt.toISOString() })).digest("hex");
  return { externalId: outer.data.externalId, post, hash };
}

export async function importAutomationDraft(context: AutomationContext, body: unknown) {
  const prepared = await prepareAutomationDraft(context, body);
  const where = { workspaceId_importKey: { workspaceId: context.workspaceId, importKey: prepared.externalId } };
  const replay = (existing: { id: string; status: string; importHash: string | null }) => {
    if (existing.importHash !== prepared.hash) {
      throw new AutomationError("IMPORT_CONFLICT", "Questo externalId esiste con dati diversi: non è stato modificato né duplicato", 409);
    }
    return { post: { id: existing.id, status: existing.status }, replayed: true };
  };
  const existing = await prisma.post.findUnique({ where });
  if (existing) return replay(existing);
  try {
    const post = await createPost(context.workspaceId, prepared.post, userActor(context.userId), {
      key: prepared.externalId, hash: prepared.hash, tokenId: context.tokenId,
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
