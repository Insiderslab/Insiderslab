import { z } from "zod";

export const ANALYSIS_REVISION = "qwen-scenes-v1";
export const MAX_ANALYSIS_SECONDS = 600;
export const MAX_FRAMES = 8;

export function validMediaDimensions(width: unknown, height: unknown): boolean {
  return typeof width === "number" && typeof height === "number" && Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 50_000_000;
}

export const visualSchema = z.object({
  summary: z.string().max(1600),
  frames: z.array(z.object({
    index: z.number().int().min(0).max(MAX_FRAMES - 1),
    description: z.string().max(1000),
    visibleText: z.string().max(1000),
  })).max(MAX_FRAMES),
  uncertainties: z.array(z.string().max(300)).max(8),
});

export const analysisSchema = z.object({
  revision: z.literal(ANALYSIS_REVISION),
  summary: z.string().max(1600),
  scenes: z.array(z.object({ timeSec: z.number().nonnegative().nullable(), description: z.string().max(1000), visibleText: z.string().max(1000) })).max(MAX_FRAMES),
  speech: z.array(z.object({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string().max(2000) })).max(400),
  audioStatus: z.enum(["transcribed", "no-audio", "unavailable", "not-applicable"]),
  durationSec: z.number().nonnegative().nullable(),
  uncertainties: z.array(z.string().max(300)).max(10),
});
export type MediaAnalysisResult = z.infer<typeof analysisSchema>;

/** Sampled frames are observations at exact times, never a claim of full coverage. */
export function frameTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_ANALYSIS_SECONDS) throw new Error("unsupported-duration");
  const count = Math.min(MAX_FRAMES, Math.max(2, Math.ceil(duration / 3)));
  return Array.from({ length: count }, (_, i) => Math.round(((duration - Math.min(0.1, duration / 10)) * i / (count - 1)) * 1000) / 1000);
}

export function positiveLimit(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : fallback;
}

export function withinAnalysisBudget(count: number, audioSeconds: number, nextAudioSeconds: number, maxCount: number, maxSeconds: number) {
  return count < maxCount && audioSeconds + nextAudioSeconds <= maxSeconds;
}

export function mediaAnalysisEnabled() {
  return process.env.MEDIA_ANALYSIS_ENABLED === "true";
}

export function mediaProviderEnabled() {
  return mediaAnalysisEnabled() && Boolean(process.env.QWEN_API_KEY?.trim());
}
