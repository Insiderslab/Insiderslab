import "@/lib/load-env";
import os from "node:os";
import { Worker, type Job } from "bullmq";
import {
  SCHEDULING_QUEUE_NAME,
  getRedisConnection,
  type SchedulePostJob,
} from "@/lib/queue/client";
import { recordWorkerAlert, recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { processSchedulePost, sweepApprovedPosts } from "@/lib/scheduling";
import { isMetricoolFake } from "@/lib/metricool/client";

const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Metricool calls are cheap but rate limited per account: a handful in
// parallel keeps a bulk approval moving without tripping 429s.
const CONCURRENCY = Number(process.env.SCHEDULING_CONCURRENCY ?? 3);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const worker = new Worker<SchedulePostJob>(
  SCHEDULING_QUEUE_NAME,
  async (job: Job<SchedulePostJob>) => {
    const result = await processSchedulePost(job);
    if (result.outcome === "skipped") {
      console.log(`[Approve Worker] Job ${job.id} skipped: ${result.reason}`);
    }
    return result;
  },
  {
    connection: getRedisConnection(),
    concurrency: CONCURRENCY,
  }
);

console.log(
  `[Approve Worker] Started (concurrency ${CONCURRENCY}${isMetricoolFake() ? ", METRICOOL_FAKE" : ""})`
);

worker.on("completed", (job) => {
  console.log(`[Approve Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(
    `[Approve Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
    err.message
  );
  void recordWorkerAlert({
    level: "error",
    message: err.message,
    jobId: job?.id,
    postId: job?.data.postId,
  }).catch((recordError) => {
    console.error("[Approve Worker] Failed to record alert:", errorMessage(recordError));
  });
});

worker.on("error", (err) => {
  console.error("[Approve Worker] Worker error:", err.message);
});

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    console.error("[Approve Worker] Heartbeat failed:", errorMessage(error));
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

// One sweep shortly after boot recovers anything approved while the worker
// was down; afterwards the cron (/api/cron/sweep) runs it every 5 minutes.
const bootSweep = setTimeout(() => {
  sweepApprovedPosts()
    .then((result) => console.log("[Approve Worker] Boot sweep:", JSON.stringify(result)))
    .catch((error) => console.error("[Approve Worker] Boot sweep failed:", errorMessage(error)));
}, 10_000);

async function shutdown(signal: string) {
  console.log(`[Approve Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearTimeout(bootSweep);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
