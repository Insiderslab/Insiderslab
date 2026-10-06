/**
 * A post the client cannot open: wrong id, another client's post, a draft, a
 * cancelled post or a kind this instance does not handle. Same message for
 * all of them, worded for the instance ("post", "articolo", "contenuto"),
 * with a way back to the list.
 */

import { portalNoun } from "@/components/portal/helpers";
import ReviewNotFoundView from "@/components/portal/review-not-found";
import { enabledKinds } from "@/lib/variant";

export default function ReviewNotFound() {
  return <ReviewNotFoundView noun={portalNoun(enabledKinds())} />;
}
