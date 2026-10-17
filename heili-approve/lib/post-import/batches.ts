/**
 * Long sheets in the panel's importer (QA-11): the browser reads the whole
 * sheet, then checks and creates the drafts in batches of MAX_IMPORT_ROWS,
 * each one a normal server action with the usual validation. These pure
 * helpers merge what the batches answered into one result. Nothing here
 * writes: the guarantees (drafts only, no duplicates) stay in service.ts.
 */

import type { ImportResult, PlanOutcome, RowOutcome } from "./service";

/** One batch's answer, with the position of its first row in the whole list. */
export interface BatchResult {
  offset: number;
  result: ImportResult;
}

/** Outcomes renumbered on the whole list; counts summed; one plan outcome. */
export function mergeImportResults(batches: readonly BatchResult[]): ImportResult {
  const outcomes: RowOutcome[] = batches.flatMap(({ offset, result }) =>
    result.outcomes.map((outcome) => ({ ...outcome, index: outcome.index + offset }))
  );
  return {
    outcomes,
    created: batches.reduce((sum, b) => sum + b.result.created, 0),
    existing: batches.reduce((sum, b) => sum + b.result.existing, 0),
    failed: batches.reduce((sum, b) => sum + b.result.failed, 0),
    plan: mergePlans(batches.map((b) => b.result.plan)),
  };
}

/**
 * Every batch opens (the first) or reuses (the others) the same month's plan.
 * It counts as "created" if any batch created it; an error is reported only
 * if no batch managed to use the plan.
 */
export function mergePlans(plans: ReadonlyArray<PlanOutcome | null>): PlanOutcome | null {
  const ok = plans.filter((p): p is Extract<PlanOutcome, { status: "ok" }> => p?.status === "ok");
  if (ok.length > 0) return { ...ok[0], created: ok.some((p) => p.created) };
  return plans.find((p): p is PlanOutcome => p !== null) ?? null;
}

/** "Creo le bozze: 200 di 500…" */
export function batchProgressLabel(done: number, total: number): string {
  return `Creo le bozze: ${done} di ${total}…`;
}
