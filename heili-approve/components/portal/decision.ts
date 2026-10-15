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
 * Classes of a decision-bar button: 48 px tall, 16 px text, never wrapping
 * (the bar stays on one line at 390 px). `width: "flex"` shares the row,
 * `"natural"` keeps the label's own width (the long «Invia le mie decisioni»).
 */
export function decisionButtonClass(primary: boolean, width: "flex" | "natural" = "flex"): string {
  const sizing = width === "flex" ? "min-w-0 flex-1" : "shrink-0";
  return `${BUTTON_BASE} ${sizing} ${primary ? BUTTON_PRIMARY : BUTTON_SECONDARY}`;
}
