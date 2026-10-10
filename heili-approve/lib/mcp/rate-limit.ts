/**
 * Per-identity request rate limit for /mcp.
 *
 * In memory, fixed one-minute window, one bucket per user / key. Approve runs a
 * single web process (docker-compose.prod.yml), so this is exact there; with
 * several replicas the limit would apply per replica (use the reverse proxy for
 * a global cap). The app uses Redis only for queues, not for limits.
 * Writes have their own durable cap: AUTOMATION_DAILY_DRAFT_LIMIT (lib/posts.ts).
 */

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 5_000;

const buckets = new Map<string, { windowStart: number; count: number }>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSec: number;
}

export function checkRateLimit(key: string, limit: number, now: number = Date.now()): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bucketKey, value] of buckets) {
        if (now - value.windowStart >= WINDOW_MS) buckets.delete(bucketKey);
      }
      // Still full of live buckets: drop the oldest rather than grow without bound.
      if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value as string);
    }
    bucket = { windowStart: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000));
  return { allowed: bucket.count <= limit, retryAfterSec };
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
