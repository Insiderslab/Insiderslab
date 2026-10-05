import { timingSafeEqual } from "crypto";

/**
 * Bearer check for the cron routes and the detailed health report. Same
 * secret scheme as heili-dm's crons, but an unset secret never matches
 * (heili-dm would accept the literal "Bearer undefined").
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
