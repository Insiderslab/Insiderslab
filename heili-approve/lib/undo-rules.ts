/**
 * Pure rules of the "Annulla" window right after a client approval.
 *
 * An approval is recorded at once (status APPROVED, tied to the version), but
 * its side effects (the Metricool scheduling job, the email to the agency, the
 * monthly plan follow-up) wait UNDO_WINDOW_MS. Inside that window the reviewer
 * who approved can take it back; afterwards only the agency can. No I/O and no
 * React: used by lib/approval-undo (services), the cron sweep and the portal
 * (the toast), unit-tested in __tests__/approval-undo.test.ts.
 */

import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";

/** The server accepts an undo for this long after the approval. */
export const UNDO_WINDOW_MS = 15_000;
/** Scheduling and the agency email are held back for exactly the undo window. */
export const APPROVAL_FINALIZE_DELAY_MS = UNDO_WINDOW_MS;
/**
 * How long the portal shows «Approvato · Annulla». Shorter than the server
 * window on purpose: the button is gone before the server could refuse it, so
 * a slow network never turns a visible button into «Troppo tardi».
 */
export const UNDO_TOAST_MS = 10_000;
/** Time kept for the «Annulla» request itself to reach a busy server. */
export const UNDO_SAFETY_MS = 2_000;
/** Below this the toast is not worth showing: there would be no time to press it. */
export const UNDO_TOAST_MIN_MS = 1_500;

/**
 * How long the toast may offer «Annulla» after an approval whose request took
 * `roundTripMs` (click → answer). The server's clock starts somewhere inside
 * that round trip, at worst at the click: under load the answer can take 6–8 s
 * (QA 2026-10-16), and a fixed 10-second toast then showed «Annulla» after the
 * server window had closed. Never longer than UNDO_TOAST_MS; 0 when there is
 * no time left (no toast).
 */
export function undoToastDurationMs(roundTripMs: number): number {
  const left = UNDO_WINDOW_MS - Math.max(0, roundTripMs) - UNDO_SAFETY_MS;
  if (left < UNDO_TOAST_MIN_MS) return 0;
  return Math.min(UNDO_TOAST_MS, left);
}
/** The cron sweep never touches an approval younger than this (see sweepApprovedPosts). */
export const SWEEP_FRESH_APPROVAL_MS = 20_000;

/**
 * A client approval schedules through its delayed job once the undo window is
 * closed (lib/approval-undo); the cron sweep gives that job this long before it
 * steps in. Never less than SWEEP_FRESH_APPROVAL_MS: an approval still inside
 * the undo window is not the sweep's to schedule.
 */
export const SWEEP_APPROVED_GRACE_MS = Math.max(2 * 60_000, SWEEP_FRESH_APPROVAL_MS);

/** The sweep only schedules approvals made before this instant. */
export function sweepApprovedCutoff(now: Date): Date {
  return new Date(now.getTime() - SWEEP_APPROVED_GRACE_MS);
}

export const UNDO_TOO_LATE_MESSAGE = "Troppo tardi per annullare: scrivi all'agenzia";
export const UNDO_NOT_APPROVED_MESSAGE = "Questo contenuto non risulta più approvato: ricarica la pagina.";
export const UNDO_NOT_YOURS_MESSAGE = "Puoi annullare soltanto un'approvazione data da te.";

export type UndoRefusal =
  | "not_found"
  | "stale_version"
  | "not_approved"
  | "not_yours"
  | "not_undoable"
  | "too_late";

export type UndoVerdict = { ok: true } | { ok: false; reason: UndoRefusal };

export interface UndoSubject {
  clientId: string;
  status: PostStatus;
  currentVersionNumber: number;
  approvedAt: Date | null;
  approvedByReviewerId: string | null;
  /** The APPROVED event carried `undoable: true` (single approvals, not plan-wide ones). */
  undoable: boolean;
}

/**
 * May `reviewer` take back the approval of `versionNumber` right now?
 *
 * Every condition must hold: the post belongs to the reviewer's client, the
 * version is still the current one, the post is still APPROVED (scheduling has
 * not started: SCHEDULING / SCHEDULED / FAILED / DELIVERED are all "too late"),
 * the same reviewer approved it, it was a single (undoable) approval and it
 * happened less than UNDO_WINDOW_MS ago.
 */
export function evaluateUndo(
  subject: UndoSubject | null,
  request: { reviewerId: string; clientId: string; versionNumber: number; now: Date }
): UndoVerdict {
  if (!subject || subject.clientId !== request.clientId) return { ok: false, reason: "not_found" };
  if (subject.currentVersionNumber !== request.versionNumber) return { ok: false, reason: "stale_version" };

  const approvedFamily: PostStatus[] = ["APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "DELIVERED"];
  if (!approvedFamily.includes(subject.status)) return { ok: false, reason: "not_approved" };
  if (subject.approvedByReviewerId !== request.reviewerId) return { ok: false, reason: "not_yours" };
  if (subject.status !== "APPROVED") return { ok: false, reason: "too_late" };
  if (!subject.undoable) return { ok: false, reason: "not_undoable" };
  if (!subject.approvedAt) return { ok: false, reason: "not_approved" };

  const age = request.now.getTime() - subject.approvedAt.getTime();
  if (age >= UNDO_WINDOW_MS) return { ok: false, reason: "too_late" };
  return { ok: true };
}

/** Italian message for a refusal (safe to show to the client as it is). */
export function undoRefusalMessage(reason: UndoRefusal): string {
  switch (reason) {
    case "not_found":
      return "Post non trovato";
    case "stale_version":
      return "Il post è stato aggiornato dall'agenzia nel frattempo: ricarica la pagina per vedere la versione più recente";
    case "not_approved":
      return UNDO_NOT_APPROVED_MESSAGE;
    case "not_yours":
      return UNDO_NOT_YOURS_MESSAGE;
    case "not_undoable":
    case "too_late":
      return UNDO_TOO_LATE_MESSAGE;
  }
}

export interface FinalizeSubject {
  status: PostStatus;
  kind: ContentKind;
  currentVersionNumber: number;
  approvedAt: Date | null;
  autoSchedule: boolean;
}

export type FinalizeVerdict =
  | { proceed: true; schedule: boolean }
  | { proceed: false; reason: "undone" | "stale_version" | "changed" | "too_early" };

/**
 * What the delayed job does once the window has closed. The job carries the
 * approval it belongs to (version and exact `approvedAt`): anything else, an
 * undone approval, a second approval, a newer version or a post the agency
 * took back to draft, means this job has nothing to do.
 */
export function evaluateFinalize(
  subject: FinalizeSubject | null,
  job: { versionNumber: number; approvedAtMs: number },
  now: Date
): FinalizeVerdict {
  if (!subject || !subject.approvedAt || subject.approvedAt.getTime() !== job.approvedAtMs) {
    return { proceed: false, reason: "undone" };
  }
  if (subject.currentVersionNumber !== job.versionNumber) return { proceed: false, reason: "stale_version" };
  const stillApproved: PostStatus[] = ["APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "DELIVERED"];
  if (!stillApproved.includes(subject.status)) return { proceed: false, reason: "changed" };
  if (now.getTime() - subject.approvedAt.getTime() < UNDO_WINDOW_MS) return { proceed: false, reason: "too_early" };
  // Blog and ads are internal: nothing to schedule, ever (the agency delivers them).
  const schedule = subject.status === "APPROVED" && subject.kind === "SOCIAL_POST" && subject.autoSchedule;
  return { proceed: true, schedule };
}
