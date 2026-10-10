/**
 * Server side of Sfoglia: the cards for a list of posts, at the version the
 * client is sent (getPostForReviewer through getReviewerPosts), with the
 * client's open feedback counted like "Approva tutto il piano" does.
 */

import { formatPlanSlot, formatPortalDate, portalPath } from "@/components/portal/helpers";
import { getReviewerPosts } from "@/lib/month-review";
import { openClientCommentCounts } from "@/lib/plans";
import type { ReviewerPostSummary, ReviewerRef } from "@/lib/posts";
import type { BrowsePost } from "./types";

/** `summaries` in the order the cards must follow (calendar order). */
export async function loadBrowsePosts({
  token,
  reviewer,
  summaries,
  timeZone,
  now = new Date(),
}: {
  token: string;
  reviewer: ReviewerRef;
  summaries: readonly ReviewerPostSummary[];
  timeZone: string;
  now?: Date;
}): Promise<BrowsePost[]> {
  const [loaded, comments] = await Promise.all([
    getReviewerPosts(
      reviewer,
      summaries.map((p) => p.id)
    ),
    openClientCommentCounts(summaries.filter((p) => p.canAct).map((p) => p.id)),
  ]);
  const byId = new Map(loaded.map((post) => [post.id, post]));
  return summaries.flatMap((summary) => {
    const post = byId.get(summary.id);
    const version = post?.versions.find((v) => v.number === post.currentVersionNumber);
    if (!post || !version) return [];
    return [
      {
        id: post.id,
        title: post.title,
        status: post.status,
        canAct: post.canAct,
        versionNumber: version.number,
        networks: post.networks,
        networkOptions: post.networkOptions,
        text: version.text,
        firstCommentText: version.firstCommentText,
        media: version.media,
        publishAt: post.publishAt,
        slotLabel: formatPlanSlot(post.publishAt, timeZone),
        publishLabel: formatPortalDate(post.publishAt, timeZone, { now }),
        openComments: comments.get(post.id) ?? 0,
        href: portalPath(token, post.id),
      },
    ];
  });
}
