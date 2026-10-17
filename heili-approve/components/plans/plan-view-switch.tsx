/**
 * Views of the agency's monthly plan: "Elenco · Calendario · Anteprima
 * Instagram". The choice lives in the URL (`?vista=`), so the server renders
 * only the active view (QA-09: rendering all three at once made a 300-post
 * plan weigh 1.9 MB with 900 images). Plain links, no client state.
 */

import Link from "next/link";
import { PLAN_VIEW_LABELS, PLAN_VIEWS, planViewHref, type PlanView } from "@/lib/plan-view";

export default function PlanViewSwitch({ planId, view }: { planId: string; view: PlanView }) {
  return (
    <nav className="studio-view-tabs max-w-full" aria-label="Vista del piano" data-testid="plan-view-switch">
      {PLAN_VIEWS.map((item) => (
        <Link
          key={item}
          href={planViewHref(planId, item)}
          scroll={false}
          prefetch={false}
          aria-current={item === view ? "page" : undefined}
          data-testid={`plan-view-${item}`}
          className="studio-view-tab inline-flex items-center justify-center whitespace-nowrap"
        >
          {PLAN_VIEW_LABELS[item]}
        </Link>
      ))}
    </nav>
  );
}
