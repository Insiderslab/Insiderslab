/**
 * BullMQ Queue Client
 *
 * One queue, "post-scheduling": approved posts are pushed to Metricool by the
 * worker (worker/approval-worker.ts), so a Metricool outage never blocks the
 * client's "Approve" click and failures are retried with backoff.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

export const SCHEDULING_QUEUE_NAME = "post-scheduling";
export const SCHEDULE_POST_JOB_NAME = "schedule-post";

export interface SchedulePostJob {
  postId: string;
  /** Version the client approved; the worker refuses to publish any other. */
  versionNumber: number;
  /** User (agency) or reviewer (client) that triggered the scheduling. */
  requestedBy?: { userId?: string; reviewerId?: string };
}

let schedulingQueue: Queue<SchedulePostJob> | null = null;

export function getSchedulingQueue(): Queue<SchedulePostJob> {
  if (!schedulingQueue) {
    schedulingQueue = new Queue<SchedulePostJob>(SCHEDULING_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 2000 },
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
      },
    });
  }
  return schedulingQueue;
}

/**
 * Deterministic job id per post+version: a double click on "Approve" or a
 * retry storm can never schedule the same content twice on Metricool.
 */
export function schedulePostJobId(postId: string, versionNumber: number, attempt = 0): string {
  return `schedule_${postId}_v${versionNumber}_${attempt}`;
}
