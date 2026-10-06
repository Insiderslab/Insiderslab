/**
 * Spec checks of a variant (lib/content/ads adSpecChecks), grouped by
 * placement, worst first. Errors block sending to the client; warnings
 * are advice. Plain markup: safe in server and client components.
 */

import {
  AD_CHECK_STATUS_LABELS,
  AD_PLATFORM_SHORT_LABELS,
  PLACEMENT_SPECS,
  describeSummary,
  summarizeChecks,
  type AdCheckStatus,
  type AdSpecCheck,
} from "@/lib/content/ads";

const STATUS_STYLES: Record<AdCheckStatus, string> = {
  ok: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  error: "border-error/40 text-error",
};

const RANK: Record<AdCheckStatus, number> = { error: 0, warning: 1, ok: 2 };

export function CheckStatusChip({ status }: { status: AdCheckStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border bg-surface px-1.5 text-[11px] font-semibold uppercase leading-5 ${STATUS_STYLES[status]}`}
    >
      {AD_CHECK_STATUS_LABELS[status]}
    </span>
  );
}

export default function AdSpecChecklist({
  checks,
  hideOk = false,
  className = "",
}: {
  checks: AdSpecCheck[];
  /** Show only warnings and errors (compact view). */
  hideOk?: boolean;
  className?: string;
}) {
  const summary = summarizeChecks(checks);
  const shown = hideOk ? checks.filter((c) => c.status !== "ok") : checks;

  // Copy/CTA/URL first (they apply everywhere), then each placement.
  const groups = new Map<string, { title: string; items: AdSpecCheck[] }>();
  for (const check of shown) {
    const key = check.placement ?? "general";
    const title = check.placement
      ? PLACEMENT_SPECS[check.placement].label
      : check.platform
        ? `Testi e link · ${AD_PLATFORM_SHORT_LABELS[check.platform]}`
        : "Testi e link";
    const group = groups.get(key) ?? { title, items: [] };
    group.items.push(check);
    groups.set(key, group);
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <p className="flex items-center gap-2 text-sm">
        <CheckStatusChip status={summary.worst} />
        <span className="text-foreground">{describeSummary(summary)}</span>
      </p>
      {[...groups.entries()].map(([key, group]) => (
        <section key={key} className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</h4>
          <ul className="space-y-1">
            {[...group.items]
              .sort((a, b) => RANK[a.status] - RANK[b.status])
              .map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-sm">
                  <CheckStatusChip status={check.status} />
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{check.label}:</span> {check.message}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
