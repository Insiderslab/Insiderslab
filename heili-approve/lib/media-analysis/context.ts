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

export async function attachMediaEvidence(ctx: AssistantPostContext, workspaceId: string) {
  if (!mediaAnalysisEnabled()) return;
  const refs = contextMedia(ctx).slice(0, 30).map(ref => ({ ...ref, key: storageKeyFromMediaUrl(ref.item.url) })).filter(ref => ref.key);
  if (!refs.length) return;
  const assets = await prisma.mediaAsset.findMany({ where: { workspaceId, storageKey: { in: refs.map(r => r.key!) } }, include: { analysis: true } });
  const blocks: string[] = [];
  for (const ref of refs) {
    const asset = assets.find(a => a.storageKey === ref.key);
    if (!asset) continue;
    const result = asset.analysis?.status === "READY" ? analysisSchema.safeParse(asset.analysis.result) : null;
    if (result?.success) {
      blocks.push(`${ref.label}: ${JSON.stringify(result.data)}`);
    } else {
      blocks.push(`${ref.label}: analisi ${asset.analysis?.status === "FAILED" ? "non disponibile" : "in preparazione"}. Non dedurre il contenuto.`);
      if (!asset.analysis || asset.analysis.status === "PENDING" || asset.analysis.revision !== ANALYSIS_REVISION) await queueAssetAnalysis({ assetId: asset.id, workspaceId }).catch(() => {});
    }
  }
  // Evidence remains on the server; it is not part of any portal DTO.
  ctx.mediaEvidence = blocks.join("\n").slice(0, 35_000);
}
