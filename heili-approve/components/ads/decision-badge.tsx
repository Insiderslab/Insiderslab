/**
 * The client's decision on a variant: "Approvata", "Scartata" or
 * "Da decidere". Plain markup: safe in server and client components.
 */

export type AdVerdict = "APPROVED" | "REJECTED";

/** Current decision on a variant (the note is required when discarded). */
export interface AdVariantDecisionState {
  verdict: AdVerdict;
  note: string | null;
}

const STYLES = {
  APPROVED: "border-success/40 bg-success/10 text-success",
  REJECTED: "border-error/40 bg-error/10 text-error",
  PENDING: "border-border bg-surface text-muted",
} as const;

export const DECISION_LABELS = {
  APPROVED: "Approvata",
  REJECTED: "Scartata",
  PENDING: "Da decidere",
} as const;

export default function AdDecisionBadge({
  verdict,
  className = "",
}: {
  verdict: AdVerdict | null | undefined;
  className?: string;
}) {
  const key = verdict ?? "PENDING";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLES[key]} ${className}`}
    >
      <span aria-hidden="true">{key === "APPROVED" ? "✓" : key === "REJECTED" ? "✕" : "•"}</span>
      {DECISION_LABELS[key]}
    </span>
  );
}
