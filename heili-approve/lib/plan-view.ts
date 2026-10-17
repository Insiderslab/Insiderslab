/**
 * Pure rules of the agency plan page views (QA-09): which view is active
 * (`?vista=`), how many rows of the list are shown (`?mostra=`) and the links
 * between them. Only the active view is rendered on the server.
 */

export const PLAN_VIEWS = ["elenco", "calendario", "instagram"] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

export const PLAN_VIEW_LABELS: Record<PlanView, string> = {
  elenco: "Elenco",
  calendario: "Calendario",
  instagram: "Anteprima Instagram",
};

/** Rows of the list rendered at first, and added by every "Mostra altri". */
export const PLAN_LIST_PAGE = 50;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePlanView(value: string | string[] | undefined): PlanView {
  const raw = first(value);
  return (PLAN_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as PlanView) : "elenco";
}

/** Rows to show: a positive multiple of the page size, never below one page. */
export function parsePlanListLimit(value: string | string[] | undefined): number {
  const n = Number.parseInt(first(value) ?? "", 10);
  if (!Number.isFinite(n) || n <= PLAN_LIST_PAGE) return PLAN_LIST_PAGE;
  return Math.min(Math.ceil(n / PLAN_LIST_PAGE) * PLAN_LIST_PAGE, 5000);
}

export function planViewHref(planId: string, view: PlanView, opts: { show?: number } = {}): string {
  const params = new URLSearchParams();
  if (view !== "elenco") params.set("vista", view);
  if (opts.show && opts.show > PLAN_LIST_PAGE) params.set("mostra", String(opts.show));
  const query = params.toString();
  return `/plans/${planId}${query ? `?${query}` : ""}`;
}

/** "Mostra altri 50 (ne restano 250)" — null when everything is shown. */
export function showMoreLabel(total: number, shown: number): string | null {
  const left = total - shown;
  if (left <= 0) return null;
  const next = Math.min(left, PLAN_LIST_PAGE);
  return left === next ? `Mostra gli altri ${left}` : `Mostra altri ${next} (ne restano ${left})`;
}
