/**
 * Which button of the decision bar is the primary one (post, article and ads
 * review pages). Pure: no React, unit-tested in __tests__/portal-decision-bar.test.ts.
 *
 * Rule: «Approva» (ads: «Invia le mie decisioni») is primary as long as the
 * client has left no feedback on the version they are looking at; as soon as
 * there is some, the primary is «Chiedi modifiche». Only the emphasis moves:
 * what each button does, its confirmation and the server rules do not change,
 * and the order of the two buttons stays put so nothing jumps under the thumb.
 */

export type DecisionKey = "approve" | "changes";

export interface DecisionFeedback {
  /** Comments the reviewer saved on this version and has not resolved. */
  savedComments: number;
  /** The comment field holds text (or an edited moment) that was not sent yet. */
  hasDraft: boolean;
  /** Heili holds feedback that «Chiedi modifiche» would send (a conversation, a message, dictation). */
  heiliPending: boolean;
}

/** Is there anything the client wants changed, saved or not? */
export function hasDecisionFeedback(feedback: DecisionFeedback): boolean {
  return feedback.savedComments > 0 || feedback.hasDraft || feedback.heiliPending;
}

export function primaryDecision({ hasFeedback }: { hasFeedback: boolean }): DecisionKey {
  return hasFeedback ? "changes" : "approve";
}

const BUTTON_BASE =
  "min-h-12 whitespace-nowrap rounded-lg border px-2 text-base font-semibold disabled:opacity-50 sm:px-3";
const BUTTON_PRIMARY = "border-accent bg-accent text-white hover:bg-accent-hover hover:border-accent-hover";
const BUTTON_SECONDARY = "border-border bg-background text-foreground hover:border-border-hover";

/**
 * The row that holds the bar's buttons. When the labels do not fit side by
 * side (QA-04: «Chiedi modifiche» + «Invia le mie decisioni» need 372 px at
 * 16 px text, the bar has 358 at 390 px) the second button drops under the
 * first at full width instead of the text spilling over its neighbour.
 */
export const DECISION_ROW_CLASS = "flex flex-wrap gap-2";

/**
 * Classes of a decision-bar button: 48 px tall, 16 px text, a label that never
 * wraps and a button that never shrinks below its label (`min-w-fit`).
 * `width: "flex"` shares the row, `"natural"` starts from the label's own
 * width (the long «Invia le mie decisioni») and grows into the free space.
 */
export function decisionButtonClass(primary: boolean, width: "flex" | "natural" = "flex"): string {
  const sizing = width === "flex" ? "min-w-fit flex-1" : "min-w-fit flex-auto";
  return `${BUTTON_BASE} ${sizing} ${primary ? BUTTON_PRIMARY : BUTTON_SECONDARY}`;
}
