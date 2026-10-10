/**
 * Segmented control of the month views: "Panoramica · Griglia · Sfoglia".
 * The choice lives in the URL (`?vista=`), so it survives a reload and the
 * way back from a post. Plain links: no client state.
 */

import Link from "next/link";
import { MONTH_VIEW_LABELS, viewPath, type MonthView } from "@/lib/month-rules";

export default function ViewSwitch({
  basePath,
  view,
  views,
}: {
  /** Path of the page without query. */
  basePath: string;
  view: MonthView;
  views: readonly MonthView[];
}) {
  return (
    <nav className="studio-view-tabs" aria-label="Vista del mese" data-testid="month-view-switch">
      {views.map((item) => (
        <Link
          key={item}
          href={viewPath(basePath, item)}
          scroll={false}
          prefetch={false}
          aria-current={item === view ? "page" : undefined}
          data-testid={`view-${item}`}
          className="studio-view-tab inline-flex items-center justify-center whitespace-nowrap"
        >
          {MONTH_VIEW_LABELS[item]}
        </Link>
      ))}
    </nav>
  );
}

/** Phones: the way into the fast review, prominent. */
export function QuickReviewLink({ basePath, label = "Rivedi in modalità veloce" }: { basePath: string; label?: string }) {
  // The wrapper hides it from tablets up: `.btn` sets its own display, so it cannot carry `sm:hidden`.
  return (
    <div className="sm:hidden">
      <Link href={viewPath(basePath, "sfoglia")} prefetch={false} className="btn btn-primary min-h-12 w-full" data-testid="quick-review">
        {label}
      </Link>
    </div>
  );
}
