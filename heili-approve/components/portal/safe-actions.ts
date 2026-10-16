/**
 * The portal's server actions, safe to await from the pages.
 *
 * A server action that cannot reach the server (a phone in a tunnel, a Wi-Fi
 * that drops) does not return {ok: false}: the call itself throws. The pages
 * await the result between «busy» and «not busy», so an exception left the
 * sheet on «Approvazione…» and the button on «Invio…» for good, with no
 * message and no way to retry (K-01). Each wrapper below turns that exception
 * into the same {ok: false, error} the server returns for a refusal, so every
 * page already knows how to show it and offers «Riprova» by staying usable.
 *
 * Same names and signatures as `app/review/[token]/actions.ts`; the real
 * action is looked up at call time.
 */

import * as actions from "@/app/review/[token]/actions";

/** Shown when the request never got an answer. Nothing is lost: the client can tap again. */
export const CONNECTION_LOST_MESSAGE =
  "Non riesco a collegarmi: controlla la connessione e riprova. Quello che hai scritto è ancora qui.";

type Actions = typeof actions;

function guard<K extends keyof Actions>(name: K): Actions[K] {
  const wrapped = async (...args: unknown[]) => {
    try {
      return await (actions[name] as (...a: unknown[]) => Promise<unknown>)(...args);
    } catch {
      return { ok: false, error: CONNECTION_LOST_MESSAGE };
    }
  };
  return wrapped as unknown as Actions[K];
}

export const addAssistantFeedbackAction = guard("addAssistantFeedbackAction");
export const addCommentAction = guard("addCommentAction");
export const addPlanCommentAction = guard("addPlanCommentAction");
export const approveMonthAction = guard("approveMonthAction");
export const approvePlanAction = guard("approvePlanAction");
export const approvePostAction = guard("approvePostAction");
export const decideVariantAction = guard("decideVariantAction");
export const finalizeDecisionsAction = guard("finalizeDecisionsAction");
export const requestChangesAction = guard("requestChangesAction");
export const undoApprovalAction = guard("undoApprovalAction");
