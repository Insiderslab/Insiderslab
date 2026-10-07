/**
 * Small pieces of the monthly plan shared by the agency pages and the client
 * portal: status chip (always with a word) and the progress bar
 * "8 di 12 approvati". Presentational, no hooks.
 */

import type { PlanStatus } from "@/app/generated/prisma/client";
import { ToneChip } from "@/components/status-badge";
import { planStatusLabel, planStatusTone, progressLabel, progressPercent, type PlanProgress } from "@/lib/plan-rules";

export function PlanStatusChip({ status, sent }: { status: PlanStatus; sent: boolean }) {
  return <ToneChip tone={planStatusTone(status)}>{planStatusLabel(status, sent)}</ToneChip>;
}

export function PlanProgressBar({
  progress,
  size = "md",
  label,
}: {
  progress: Pick<PlanProgress, "approved" | "total">;
  size?: "sm" | "md";
  /** Defaults to "8 di 12 approvati". */
  label?: string;
}) {
  const percent = progressPercent(progress);
  const text = label ?? progressLabel(progress);
  return (
    <div className="space-y-1.5">
      <p className={`tabular font-semibold ${size === "sm" ? "text-sm" : "text-base"}`}>{text}</p>
      <div
        className={`overflow-hidden rounded-full bg-surface-sunken ${size === "sm" ? "h-1.5" : "h-2.5"}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.approved}
        aria-label={text}
      >
        <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
