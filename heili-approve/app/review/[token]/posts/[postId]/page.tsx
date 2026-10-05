import { notFound } from "next/navigation";
import { after } from "next/server";
import {
  diffBaseline,
  formatPortalDate,
  formatShortDateTime,
  nextPostToReview,
} from "@/components/portal/helpers";
import OlderVersions from "@/components/portal/older-versions";
import PostReview from "@/components/portal/post-review";
import type {
  PortalComment,
  PortalOlderVersion,
  PortalPost,
  PortalQueue,
  PortalVersionChanges,
} from "@/components/portal/types";
import VersionChanges from "@/components/portal/version-changes";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import {
  diffVersions,
  getPostForReviewer,
  listPostsForReviewer,
  recordClientView,
  summarizeVersionDiff,
  type ReviewerPost,
  type ReviewerPostComment,
  type ReviewerPostVersion,
  type ReviewerRef,
} from "@/lib/posts";
import { isAssistantEnabled } from "@/lib/review-assistant";
import { getPortalReviewer } from "../../reviewer";

type ReviewPostPageProps = {
  params: Promise<{ token: string; postId: string }>;
};

async function loadPost(postId: string, reviewer: ReviewerRef): Promise<ReviewerPost> {
  if (postId.length > 64) notFound();
  try {
    return await getPostForReviewer(postId, reviewer);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function toPortalComment(comment: ReviewerPostComment, timeZone: string): PortalComment {
  return {
    id: comment.id,
    authorType: comment.authorType,
    authorName: comment.authorName,
    isMine: comment.isMine,
    body: comment.body,
    mediaIndex: comment.mediaIndex,
    pinX: comment.pinX,
    pinY: comment.pinY,
    timeSec: comment.timeSec,
    timeEndSec: comment.timeEndSec,
    resolved: comment.resolvedAt !== null,
    createdAt: comment.createdAt,
    createdLabel: formatShortDateTime(comment.createdAt, timeZone),
  };
}

function versionChanges(
  versions: ReviewerPostVersion[],
  current: ReviewerPostVersion,
  viewedVersions: number[],
  timeZone: string
): PortalVersionChanges | null {
  const baseline = diffBaseline(
    viewedVersions,
    current.number,
    versions.map((v) => v.number)
  );
  const from = baseline ? versions.find((v) => v.number === baseline.number) : undefined;
  if (!baseline || !from) return null;

  const diff = diffVersions(from, current);
  return {
    fromNumber: from.number,
    seenByReviewer: baseline.seenByReviewer,
    summary: summarizeVersionDiff(diff),
    text: diff.text,
    firstComment: diff.firstComment,
    addedMedia: diff.media.added,
    notes: versions
      .filter((v) => v.number > from.number && v.number <= current.number && v.changeNote?.trim())
      .map((v) => ({
        number: v.number,
        note: v.changeNote!.trim(),
        dateLabel: formatShortDateTime(v.createdAt, timeZone),
      })),
  };
}

/**
 * One post under review: preview per network, what changed since the client
 * last looked, comments (pins, video moments, agency replies) and the
 * approve / request-changes decision. Opening it logs CLIENT_VIEWED once per
 * version and reviewer.
 */
export default async function ReviewPostPage({ params }: ReviewPostPageProps) {
  const { token, postId } = await params;
  const reviewer = await getPortalReviewer(token);
  if (!reviewer) return null; // the layout shows the invalid-link page

  const ref: ReviewerRef = { id: reviewer.id, clientId: reviewer.clientId };
  const post = await loadPost(postId, ref);
  const current = post.versions.find((v) => v.number === post.currentVersionNumber);
  if (!current) notFound();

  // Versions this reviewer opened before (read before logging this view).
  const [summaries, viewEvents] = await Promise.all([
    listPostsForReviewer(ref),
    prisma.postEvent.findMany({
      where: { postId: post.id, reviewerId: reviewer.id, type: "CLIENT_VIEWED" },
      select: { versionNumber: true },
    }),
  ]);
  after(() => recordClientView(post.id, ref));

  const timeZone = post.client.timezone;
  const now = new Date();
  const viewedVersions = viewEvents.flatMap((e) => (e.versionNumber === null ? [] : [e.versionNumber]));

  // Comments without a version predate versioning: show them with the current one.
  const currentComments = post.comments
    .filter((c) => c.versionId === current.id || c.versionId === null)
    .map((c) => toPortalComment(c, timeZone));
  const olderVersions: PortalOlderVersion[] = post.versions
    .filter((v) => v.number < current.number)
    .map((v) => ({
      number: v.number,
      dateLabel: formatShortDateTime(v.createdAt, timeZone),
      changeNote: v.changeNote,
      comments: post.comments.filter((c) => c.versionId === v.id).map((c) => toPortalComment(c, timeZone)),
    }));

  const changes = versionChanges(post.versions, current, viewedVersions, timeZone);

  const toReview = summaries.filter((p) => p.canAct).map((p) => p.id);
  const index = toReview.indexOf(post.id);
  const queue: PortalQueue = {
    nextPostId: nextPostToReview(toReview, post.id),
    toReviewCount: toReview.length,
    position: index === -1 ? null : index + 1,
  };

  const portalPost: PortalPost = {
    id: post.id,
    title: post.title,
    status: post.status,
    canAct: post.canAct,
    networks: post.networks,
    networkOptions: post.networkOptions,
    versionNumber: current.number,
    versionId: current.id,
    text: current.text,
    firstCommentText: current.firstCommentText,
    media: current.media,
    publishAt: post.publishAt,
    publishLabel: formatPortalDate(post.publishAt, timeZone, { now }),
    reviewDueLabel: post.reviewDueAt ? formatPortalDate(post.reviewDueAt, timeZone, { withTime: false, now }) : null,
    approvedLabel: post.approvedAt ? formatPortalDate(post.approvedAt, timeZone, { now }) : null,
    timeZone,
    comments: currentComments,
  };

  return (
    <main>
      <PostReview
        token={token}
        post={portalPost}
        client={{
          name: post.client.name,
          logoUrl: post.client.logoUrl,
          autoSchedule: reviewer.client.autoSchedule,
        }}
        queue={queue}
        assistantEnabled={isAssistantEnabled()}
        publishInPast={post.publishAt.getTime() < now.getTime()}
        changesSlot={changes ? <VersionChanges changes={changes} currentNumber={current.number} /> : undefined}
        historySlot={olderVersions.length > 0 ? <OlderVersions versions={olderVersions} /> : undefined}
      />
    </main>
  );
}
