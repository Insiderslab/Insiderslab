import { prisma } from "@/lib/db/client";
import { googleAssetsOf } from "@/lib/content/ads";
import type { MediaItem } from "@/lib/domain";
import { storageKeyFromMediaUrl } from "@/lib/storage";
import type { AssistantPostContext } from "@/lib/review-assistant/prompt";
import { ANALYSIS_REVISION, analysisSchema, mediaAnalysisEnabled, type MediaAnalysisResult } from "./spec";
import { queueAssetAnalysis } from "./queue";

/** Only assets referenced by the exact, already-authorized review version. */
export function contextMedia(ctx: AssistantPostContext): Array<{ item: MediaItem; label: string }> {
  if (ctx.content?.kind === "AD_CREATIVE") {
    return ctx.content.ads.variants.flatMap(v => [
      ...v.media.map((item, i) => ({ item, label: `Variante ${v.id}, media ${i + 1}` })),
      ...googleAssetsOf(v).logos.map((item, i) => ({ item, label: `Variante ${v.id}, logo ${i + 1}` })),
    ]);
  }
  return ctx.media.map((item, i) => ({ item, label: `Media ${i + 1}` }));
}

export interface MediaEvidencePreparation {
  status: "ready" | "pending" | "unavailable";
  total: number;
  ready: number;
}

const MAX_CONTEXT_MEDIA = 30;
const MAX_EVIDENCE_CHARS = 35_000;
const TRUNCATED = "… [troncato]";

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= TRUNCATED.length) return TRUNCATED.slice(0, limit);
  return `${value.slice(0, limit - TRUNCATED.length)}${TRUNCATED}`;
}

function boundedItems<T, R>(items: T[], budget: number, map: (item: T) => R): { items: R[]; omitted: number } {
  const kept: R[] = [];
  let used = 2;
  for (const item of items) {
    const compact = map(item);
    const size = JSON.stringify(compact).length + (kept.length ? 1 : 0);
    if (used + size > budget) break;
    kept.push(compact);
    used += size;
  }
  return { items: kept, omitted: items.length - kept.length };
}

/** Keep every media's label and summary while sharing the prompt budget fairly. */
function readyEvidenceBlock(label: string, result: MediaAnalysisResult, budget: number): string {
  const prefix = `${label}: `;
  const full = `${prefix}${JSON.stringify(result)}`;
  if (full.length <= budget) return full;
  const jsonBudget = Math.max(800, budget - prefix.length);
  let summaryLimit = Math.max(120, Math.min(1600, Math.floor(jsonBudget * 0.2)));
  const scenesBudget = Math.max(160, Math.floor(jsonBudget * 0.25));
  const speechBudget = Math.max(160, Math.floor(jsonBudget * 0.27));
  const uncertaintiesBudget = Math.max(80, Math.floor(jsonBudget * 0.07));
  const sceneTextLimit = Math.max(50, Math.min(300, Math.floor(scenesBudget / Math.max(1, Math.min(4, result.scenes.length))) - 90));
  const speechTextLimit = Math.max(50, Math.min(400, Math.floor(speechBudget / Math.max(1, Math.min(6, result.speech.length))) - 55));
  const uncertaintyTextLimit = Math.max(40, Math.min(160, Math.floor(uncertaintiesBudget / Math.max(1, Math.min(3, result.uncertainties.length)))));
  const scenes = boundedItems(result.scenes, scenesBudget, scene => ({
    timeSec: scene.timeSec,
    description: truncateText(scene.description, sceneTextLimit),
    visibleText: truncateText(scene.visibleText, sceneTextLimit),
  }));
  const speech = boundedItems(result.speech, speechBudget, part => ({
    start: part.start,
    end: part.end,
    text: truncateText(part.text, speechTextLimit),
  }));
  const uncertainties = boundedItems(result.uncertainties, uncertaintiesBudget, value => truncateText(value, uncertaintyTextLimit));
  const itemTextWasTruncated =
    result.scenes.some(scene => scene.description.length > sceneTextLimit || scene.visibleText.length > sceneTextLimit) ||
    result.speech.some(part => part.text.length > speechTextLimit) ||
    result.uncertainties.some(value => value.length > uncertaintyTextLimit);
  const sceneItems = [...scenes.items];
  const speechItems = [...speech.items];
  const uncertaintyItems = [...uncertainties.items];
  const render = () => {
    const scenesOmitted = result.scenes.length - sceneItems.length;
    const speechOmitted = result.speech.length - speechItems.length;
    const uncertaintiesOmitted = result.uncertainties.length - uncertaintyItems.length;
    const wasTruncated = result.summary.length > summaryLimit || itemTextWasTruncated || scenesOmitted > 0 || speechOmitted > 0 || uncertaintiesOmitted > 0;
    return `${prefix}${JSON.stringify({
      summary: truncateText(result.summary, summaryLimit),
      scenes: sceneItems,
      ...(scenesOmitted ? { scenesOmitted } : {}),
      speech: speechItems,
      ...(speechOmitted ? { speechOmitted } : {}),
      audioStatus: result.audioStatus,
      durationSec: result.durationSec,
      uncertainties: uncertaintyItems,
      ...(uncertaintiesOmitted ? { uncertaintiesOmitted } : {}),
      ...(wasTruncated ? { truncated: true } : {}),
    })}`;
  };
  let rendered = render();
  while (rendered.length > budget) {
    if (speechItems.length) speechItems.pop();
    else if (sceneItems.length) sceneItems.pop();
    else if (uncertaintyItems.length) uncertaintyItems.pop();
    else if (summaryLimit > 40) summaryLimit = Math.max(40, summaryLimit - Math.max(20, rendered.length - budget));
    else break;
    rendered = render();
  }
  if (rendered.length > budget) {
    let minimalSummaryLimit = Math.max(1, Math.min(40, budget - prefix.length - 160));
    const minimal = () => `${prefix}${JSON.stringify({
      summary: truncateText(result.summary, minimalSummaryLimit),
      scenesOmitted: result.scenes.length,
      speechOmitted: result.speech.length,
      uncertaintiesOmitted: result.uncertainties.length,
      truncated: true,
    })}`;
    rendered = minimal();
    while (rendered.length > budget && minimalSummaryLimit > 1) {
      minimalSummaryLimit = Math.max(1, minimalSummaryLimit - Math.max(1, rendered.length - budget));
      rendered = minimal();
    }
  }
  return rendered;
}

function evidenceBlockBudget(total: number): number {
  const renderedBlocks = Math.min(total, MAX_CONTEXT_MEDIA) + (total > MAX_CONTEXT_MEDIA ? 1 : 0);
  return Math.floor((MAX_EVIDENCE_CHARS - Math.max(0, renderedBlocks - 1)) / Math.max(1, renderedBlocks));
}

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
  const blockBudget = evidenceBlockBudget(total);
  if (!mediaAnalysisEnabled()) {
    for (const ref of allRefs.slice(0, MAX_CONTEXT_MEDIA)) {
      blocks.push(`${ref.label}: analisi non disponibile. Non dedurre il contenuto.`);
    }
    if (total > MAX_CONTEXT_MEDIA) blocks.push(`Altri ${total - MAX_CONTEXT_MEDIA} media: analisi non disponibile.`);
    ctx.mediaEvidence = blocks.join("\n");
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
      blocks.push(readyEvidenceBlock(ref.label, result.data, blockBudget));
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
  ctx.mediaEvidence = blocks.join("\n");
  return {
    status: pending ? "pending" : unavailable ? "unavailable" : "ready",
    total,
    ready,
  };
}
