import { prisma } from "@/lib/db/client";
import type { MediaItem } from "@/lib/domain";
import { storageKeyFromMediaUrl } from "@/lib/storage";
import type { AssistantPostContext } from "@/lib/review-assistant/prompt";
import { ANALYSIS_REVISION, analysisSchema, mediaAnalysisEnabled } from "./spec";
import { queueAssetAnalysis } from "./queue";

/** Only assets referenced by the exact, already-authorized review version. */
export function contextMedia(ctx: AssistantPostContext): Array<{ item: MediaItem; label: string }> {
  if (ctx.content?.kind === "AD_CREATIVE") return ctx.content.ads.variants.flatMap(v => v.media.map((item, i) => ({ item, label: `Variante ${v.id}, media ${i + 1}` })));
  return ctx.media.map((item, i) => ({ item, label: `Media ${i + 1}` }));
}

export interface MediaEvidencePreparation {
  status: "ready" | "pending" | "unavailable";
  total: number;
  ready: number;
}

const MAX_CONTEXT_MEDIA = 30;

/**
 * Attaches only cached evidence for the exact media references in this review.
 * The status lets callers wait for analysis instead of starting a voice call
 * with a permanently incomplete snapshot.
 */
export async function attachMediaEvidence(
  ctx: AssistantPostContext,
  workspaceId: string
): Promise<MediaEvidencePreparation> {
  const allRefs = contextMedia(ctx);
  const total = allRefs.length;
  if (total === 0) return { status: "ready", total: 0, ready: 0 };

  const blocks: string[] = [];
  if (!mediaAnalysisEnabled()) {
    for (const ref of allRefs.slice(0, MAX_CONTEXT_MEDIA)) {
      blocks.push(`${ref.label}: analisi non disponibile. Non dedurre il contenuto.`);
    }
    if (total > MAX_CONTEXT_MEDIA) blocks.push(`Altri ${total - MAX_CONTEXT_MEDIA} media: analisi non disponibile.`);
    ctx.mediaEvidence = blocks.join("\n").slice(0, 35_000);
    return { status: "unavailable", total, ready: 0 };
  }

  const refs = allRefs.slice(0, MAX_CONTEXT_MEDIA).map(ref => ({
    ...ref,
    // An explicit asset ID is authoritative. Never fall back to a different
    // asset merely because the supplied URL happens to resolve locally.
    key: ref.item.assetId ? null : storageKeyFromMediaUrl(ref.item.url),
  }));
  const assetIds = [...new Set(refs.flatMap(ref => ref.item.assetId ? [ref.item.assetId] : []))];
  const storageKeys = [...new Set(refs.flatMap(ref => ref.key ? [ref.key] : []))];
  const assets = assetIds.length || storageKeys.length
    ? await prisma.mediaAsset.findMany({
        where: {
          workspaceId,
          OR: [
            ...(assetIds.length ? [{ id: { in: assetIds } }] : []),
            ...(storageKeys.length ? [{ storageKey: { in: storageKeys } }] : []),
          ],
        },
        include: { analysis: true },
      })
    : [];
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const byKey = new Map(assets.map(asset => [asset.storageKey, asset]));
  let ready = 0;
  let pending = false;
  let unavailable = total > MAX_CONTEXT_MEDIA;

  for (const ref of refs) {
    const asset = ref.item.assetId ? byId.get(ref.item.assetId) : ref.key ? byKey.get(ref.key) : undefined;
    if (!asset) {
      unavailable = true;
      blocks.push(`${ref.label}: analisi non disponibile (media non risolvibile). Non dedurre il contenuto.`);
      continue;
    }

    const analysis = asset.analysis;
    const currentRevision = analysis?.revision === ANALYSIS_REVISION;
    if (currentRevision && analysis.status === "READY") {
      const result = analysisSchema.safeParse(analysis.result);
      if (!result.success) {
        unavailable = true;
        blocks.push(`${ref.label}: analisi non disponibile (risultato non valido). Non dedurre il contenuto.`);
        continue;
      }
      ready += 1;
      blocks.push(`${ref.label}: ${JSON.stringify(result.data)}`);
      continue;
    }

    if (!analysis || !currentRevision || analysis.status === "PENDING" || analysis.status === "PROCESSING") {
      pending = true;
      blocks.push(`${ref.label}: analisi in preparazione. Non dedurre il contenuto.`);
      // A current PROCESSING row already has a claimed provider attempt. A
      // stale PROCESSING row is also terminal for automatic requeueing until
      // the worker sweep resolves it, preventing a duplicate provider charge.
      if (!analysis || analysis.status === "PENDING" || (analysis.status !== "PROCESSING" && !currentRevision)) {
        await queueAssetAnalysis({ assetId: asset.id, workspaceId }).catch(() => {});
      }
      continue;
    }

    // A current FAILED row or any unknown/invalid terminal state is not
    // retried implicitly: provider outcomes and budget failures stay bounded.
    unavailable = true;
    blocks.push(`${ref.label}: analisi non disponibile. Non dedurre il contenuto.`);
  }
  if (total > MAX_CONTEXT_MEDIA) blocks.push(`Altri ${total - MAX_CONTEXT_MEDIA} media: analisi non disponibile.`);
  // Evidence remains on the server; it is not part of any portal DTO.
  ctx.mediaEvidence = blocks.join("\n").slice(0, 35_000);
  return {
    status: pending ? "pending" : unavailable ? "unavailable" : "ready",
    total,
    ready,
  };
}
