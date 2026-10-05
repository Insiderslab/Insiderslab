/**
 * Who performed an action. Agency staff are users, the client's people are
 * reviewers (link-authenticated), and the worker / cron act as "system".
 * Every event, comment and status change records its actor for the audit log.
 */

export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "reviewer"; reviewerId: string }
  | { kind: "system" };

export const SYSTEM_ACTOR: Actor = { kind: "system" };

export function userActor(userId: string): Actor {
  return { kind: "user", userId };
}

export function reviewerActor(reviewerId: string): Actor {
  return { kind: "reviewer", reviewerId };
}

/** Foreign-key columns for PostEvent / PostComment rows. */
export function actorColumns(actor: Actor): { userId: string | null; reviewerId: string | null } {
  switch (actor.kind) {
    case "user":
      return { userId: actor.userId, reviewerId: null };
    case "reviewer":
      return { userId: null, reviewerId: actor.reviewerId };
    case "system":
      return { userId: null, reviewerId: null };
  }
}
