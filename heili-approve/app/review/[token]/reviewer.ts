/**
 * Token → reviewer for the client portal pages. Memoized per request with
 * React's cache(), so the layout, generateMetadata and the page resolve the
 * link once (one DB lookup, one lastSeenAt touch). Server-only: it reaches
 * Prisma through lib/reviewers.
 */

import { cache } from "react";
import { resolveReviewerToken, type ReviewerWithClient } from "@/lib/reviewers";

export const getPortalReviewer = cache(
  async (token: string): Promise<ReviewerWithClient | null> => resolveReviewerToken(token)
);
