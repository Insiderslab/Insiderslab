import { Queue } from "bullmq";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";
import { ANALYSIS_REVISION, mediaAnalysisEnabled, mediaProviderEnabled } from "./spec";

export const MEDIA_ANALYSIS_QUEUE = "media-analysis";
/** Failures caused by the provider, not by the file: worth another (billed) attempt later. */
export const RETRYABLE_FAILURES = ["vision-http-404", "vision-http-408", "vision-http-429", "vision-http-500", "vision-http-502", "vision-http-503", "vision-http-504", "vision-incomplete"];
export const MAX_PROVIDER_ATTEMPTS = 3;
export interface MediaAnalysisJob { assetId: string; workspaceId: string }
let queue: Queue<MediaAnalysisJob> | null = null;
export function getMediaAnalysisQueue() {
  queue ??= new Queue<MediaAnalysisJob>(MEDIA_ANALYSIS_QUEUE, { connection: getRedisConnection(), defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true } });
  return queue;
}

/** Persist first, so a queue outage is recoverable by the worker's sweep. */
export async function queueAssetAnalysis(asset: MediaAnalysisJob) {
  if (!mediaAnalysisEnabled()) return;
  const owned = await prisma.mediaAsset.findFirst({ where: { id: asset.assetId, workspaceId: asset.workspaceId }, select: { id: true } });
  if (!owned) return;
  await prisma.mediaAnalysis.upsert({ where: { assetId: asset.assetId }, create: { assetId: asset.assetId, revision: ANALYSIS_REVISION }, update: {} });
  await prisma.mediaAnalysis.updateMany({ where: { assetId: asset.assetId, revision: { not: ANALYSIS_REVISION }, status: { not: "PROCESSING" } }, data: { revision: ANALYSIS_REVISION, status: "PENDING", result: Prisma.DbNull, failureCode: null, startedAt: null, completedAt: null } });
  // Only the background sweep touches Redis: offline Redis cannot hang an upload/chat.
}

export async function sweepPendingAnalyses() {
  if (!mediaProviderEnabled()) return;
  // Quota refusals never reached a provider: safely try again after a full window.
  await prisma.mediaAnalysis.updateMany({ where: { status: "FAILED", failureCode: { in: ["daily-budget", "daily-audio-budget"] }, startedAt: { lt: new Date(Date.now() - 86400_000) } }, data: { status: "PENDING", failureCode: null, startedAt: null } });
  // Provider-side failures (retired model, rate limit, outage, truncated answer) are not the file's fault:
  // retry after a pause, at most MAX_PROVIDER_ATTEMPTS billed attempts per asset.
  const retryable = await prisma.mediaAnalysis.findMany({
    where: { status: "FAILED", failureCode: { in: RETRYABLE_FAILURES }, startedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    take: 50,
    select: { assetId: true },
  });
  for (const row of retryable) {
    const attempts = await prisma.mediaAnalysisAttempt.count({ where: { assetId: row.assetId } });
    if (attempts >= MAX_PROVIDER_ATTEMPTS) continue;
    await prisma.mediaAnalysis.updateMany({ where: { assetId: row.assetId, status: "FAILED" }, data: { status: "PENDING", failureCode: null, startedAt: null } });
  }
  // Unknown provider outcome after a crash is terminal: do not bill a retry automatically.
  await prisma.mediaAnalysis.updateMany({ where: { status: "PROCESSING", startedAt: { lt: new Date(Date.now() - 20 * 60_000) } }, data: { status: "FAILED", failureCode: "interrupted" } });
  const pending = await prisma.mediaAnalysis.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 50, select: { assetId: true, asset: { select: { workspaceId: true } } } });
  for (const row of pending) await getMediaAnalysisQueue().add("analyze", { assetId: row.assetId, workspaceId: row.asset.workspaceId }, { jobId: `media_${row.assetId}_${ANALYSIS_REVISION}` });
}
