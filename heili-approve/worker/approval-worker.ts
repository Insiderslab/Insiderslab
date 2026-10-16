import "@/lib/load-env";
import os from "node:os";
import { Worker, type Job } from "bullmq";
import {
  APPROVAL_QUEUE_NAME,
  SCHEDULING_QUEUE_NAME,
  getRedisConnection,
  type FinalizeApprovalJob,
  type SchedulePostJob,
} from "@/lib/queue/client";
import { finalizeApproval } from "@/lib/approval-undo";
import { recordWorkerAlert, recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { processSchedulePost, sweepApprovedPosts } from "@/lib/scheduling";
import { isMetricoolFake } from "@/lib/metricool/client";
import { getAppVariant } from "@/lib/variant";

// Fails at boot on an invalid APP_VARIANT, like the web process. Blog and ads
// never reach the scheduling queue: on those instances the worker idles.
const VARIANT = getAppVariant();

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

// Delayed follow-up of client approvals: runs once the «Annulla» window is
// closed (scheduling, agency email, plan update; lib/approval-undo).
const approvalWorker = new Worker<FinalizeApprovalJob>(
  APPROVAL_QUEUE_NAME,
  async (job: Job<FinalizeApprovalJob>) => {
    const result = await finalizeApproval(job.data);
    if (result.outcome === "skipped") {
      console.log(`[Approve Worker] Approval job ${job.id} skipped: ${result.reason}`);
    }
    return result;
  },
  {
    connection: getRedisConnection(),
    concurrency: CONCURRENCY,
  }
);

console.log(
  `[Approve Worker] Started (variant ${VARIANT}, concurrency ${CONCURRENCY}${isMetricoolFake() ? ", METRICOOL_FAKE" : ""})`
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

approvalWorker.on("failed", (job, err) => {
  console.error(`[Approve Worker] Approval job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  // The undo window was still open: the retry is expected, not an alert.
  if (err.name === "ApprovalWindowOpenError") return;
  void recordWorkerAlert({
    level: "error",
    message: err.message,
    jobId: job?.id,
    postId: job?.data.postId,
  }).catch((recordError) => {
    console.error("[Approve Worker] Failed to record alert:", errorMessage(recordError));
  });
});

approvalWorker.on("error", (err) => {
  console.error("[Approve Worker] Approval worker error:", err.message);
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
  await Promise.all([worker.close(), approvalWorker.close()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
