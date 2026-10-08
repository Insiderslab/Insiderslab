import "@/lib/load-env";
import { Worker } from "bullmq";
import { getRedisConnection } from "@/lib/queue/client";
import { MEDIA_ANALYSIS_QUEUE, sweepPendingAnalyses, type MediaAnalysisJob } from "@/lib/media-analysis/queue";
import { processMediaAnalysis } from "@/lib/media-analysis/service";

// Dedicated, unprivileged container: read-only upload volume, bounded CPU/RAM.
const worker = new Worker<MediaAnalysisJob>(MEDIA_ANALYSIS_QUEUE, job => processMediaAnalysis(job.data), {
  connection: getRedisConnection(), concurrency: 1,
});
worker.on("error", () => console.error("[media-analysis] Worker connection error"));
worker.on("failed", () => console.error("[media-analysis] Job failed"));
let sweeping = false;
async function maintain() {
  if (sweeping) return;
  sweeping = true;
  try {
    await getRedisConnection().set("health:media-analysis:approve", "running", "EX", 120);
    await sweepPendingAnalyses();
  } catch { console.error("[media-analysis] Sweep unavailable"); }
  finally { sweeping = false; }
}
void maintain();
const timer = setInterval(() => void maintain(), 30_000);
async function shutdown() {
  clearInterval(timer);
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log("[media-analysis] Dedicated worker started");
