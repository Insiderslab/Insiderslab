import { prisma } from "@/lib/db/client";
import { analyzeInspectedAsset, inspectAsset } from "./processor";
import { ANALYSIS_REVISION, mediaProviderEnabled, positiveLimit, withinAnalysisBudget } from "./spec";
import type { MediaAnalysisJob } from "./queue";

export async function processMediaAnalysis(job: MediaAnalysisJob) {
  if (!mediaProviderEnabled()) return { outcome: "disabled" };
  const asset = await prisma.mediaAsset.findFirst({ where: { id: job.assetId, workspaceId: job.workspaceId } });
  if (!asset) return { outcome: "missing" };
  const claimed = await prisma.mediaAnalysis.updateMany({ where: { assetId: asset.id, status: "PENDING", revision: ANALYSIS_REVISION }, data: { status: "PROCESSING", startedAt: new Date(), failureCode: null } });
  if (!claimed.count) return { outcome: "already-claimed" };
  try {
    const attempt = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`media-analysis:${asset.workspaceId}`}, 0))`;
      const usage = await tx.mediaAnalysisAttempt.aggregate({ where: { workspaceId: asset.workspaceId, createdAt: { gte: new Date(Date.now() - 86400_000) } }, _count: { id: true }, _sum: { audioSeconds: true } });
      if (!withinAnalysisBudget(usage._count.id, 0, 0, positiveLimit(process.env.MEDIA_ANALYSIS_DAILY_ASSETS, 100, 1000), 1)) return null;
      return tx.mediaAnalysisAttempt.create({ data: { workspaceId: asset.workspaceId, assetId: asset.id, audioSeconds: 0 } });
    });
    if (!attempt) {
      await prisma.mediaAnalysis.update({ where: { assetId: asset.id }, data: { status: "FAILED", failureCode: "daily-budget" } });
      return { outcome: "budget" };
    }
    // Invalid files also consume an attempt: decoding work is bounded per tenant.
    const source = await inspectAsset(asset);
    const audioSeconds = source.audio && process.env.OPENAI_API_KEY && process.env.MEDIA_TRANSCRIPTION_ENABLED === "true" ? Math.ceil(source.duration!) : 0;
    if (audioSeconds > 0) {
      const allowed = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`media-analysis:${asset.workspaceId}`}, 0))`;
        const usage = await tx.mediaAnalysisAttempt.aggregate({ where: { workspaceId: asset.workspaceId, createdAt: { gte: new Date(Date.now() - 86400_000) } }, _sum: { audioSeconds: true } });
        if ((usage._sum.audioSeconds ?? 0) + audioSeconds > positiveLimit(process.env.MEDIA_ANALYSIS_DAILY_AUDIO_SECONDS, 3600, 36000)) return false;
        await tx.mediaAnalysisAttempt.update({ where: { id: attempt.id }, data: { audioSeconds } });
        return true;
      });
      if (!allowed) {
        await prisma.mediaAnalysis.update({ where: { assetId: asset.id }, data: { status: "FAILED", failureCode: "daily-audio-budget" } });
        return { outcome: "budget" };
      }
    }
    const result = await analyzeInspectedAsset(source);
    await prisma.mediaAnalysis.update({ where: { assetId: asset.id }, data: { status: "READY", result, completedAt: new Date() } });
    return { outcome: "ready", audio: result.audioStatus };
  } catch (error) {
    const code = error instanceof Error && /^(unsupported-duration|unsupported-dimensions|vision-http-\d+|vision-incomplete)$/.test(error.message) ? error.message : "analysis-failed";
    await prisma.mediaAnalysis.updateMany({ where: { assetId: asset.id, status: "PROCESSING" }, data: { status: "FAILED", failureCode: code } });
    return { outcome: "failed", code };
  }
}
