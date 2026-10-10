/**
 * Page frame of the month views that are not the plan's Panoramica: the way
 * back, the view switch and, for Griglia, the heading with the progress.
 * Sfoglia ("compact") keeps only the top row, so the card gets the screen.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { PlanProgressBar } from "@/components/plans/plan-bits";
import { progressLabel, type PlanProgress } from "@/lib/plan-rules";

export default function MonthFrame({
  backHref,
  backLabel,
  eyebrow,
  heading,
  progress,
  switcher,
  quick,
  compact = false,
  children,
}: {
  backHref: string;
  backLabel: string;
  /** Client name. */
  eyebrow: string;
  /** "Piano social di ottobre" / "Post di ottobre". */
  heading: string;
  progress: PlanProgress;
  switcher: ReactNode;
  /** The phone shortcut into Sfoglia (Griglia only). */
  quick?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Link href={backHref} className={`min-h-11 items-center text-sm text-muted hover:text-foreground ${compact ? "hidden sm:inline-flex" : "inline-flex"}`}>
          ← {backLabel}
        </Link>
        {switcher}
      </div>
      {compact ? (
        <h1 className="sr-only" data-testid="month-heading">
          {heading}
        </h1>
      ) : (
        <header className="panel space-y-4 p-5 sm:p-6">
          <div className="space-y-1">
            <p className="label-caps">{eyebrow}</p>
            <h1 className="text-[26px] font-semibold leading-tight" data-testid="month-heading">
              {heading}
            </h1>
          </div>
          <PlanProgressBar progress={progress} size="sm" label={progressLabel(progress)} />
          {progress.inReview > 0 && quick}
        </header>
      )}
      {children}
    </div>
  );
}
