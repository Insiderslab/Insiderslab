import { notFound } from "next/navigation";
import { after } from "next/server";
import type { ContentKind } from "@/app/generated/prisma/client";
import BlogVersionDiff from "@/components/blog/blog-version-diff";
import { SerpPreview } from "@/components/blog/seo-panel";
import AdsReview from "@/components/portal/ads-review";
import BlogReview from "@/components/portal/blog-review";
import {
  dateLabelFor,
  diffBaseline,
  formatPortalDate,
  formatShortDateTime,
  nextPostToReview,
  numberPassageComments,
  portalPath,
  portalPlanPath,
} from "@/components/portal/helpers";
import OlderVersions from "@/components/portal/older-versions";
import PostReview from "@/components/portal/post-review";
import type {
  PortalAdsPost,
  PortalBlogPost,
  PortalComment,
  PortalItemBase,
  PortalOlderVersion,
  PortalPassageComment,
  PortalPlanNav,
  PortalPost,
  PortalQueue,
  PortalVariantDecision,
  PortalVersionChanges,
} from "@/components/portal/types";
import VersionChanges from "@/components/portal/version-changes";
import { PlanProgressBar } from "@/components/plans/plan-bits";
import { coerceAdContent } from "@/lib/content/ads";
import { coerceBlogContent, locateAnchors, renderMarkdownSafe } from "@/lib/content/blog";
import type { BlogContent } from "@/lib/content/types";
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
import { byPublishAsc, planHeading, planNeighbors, planProgress } from "@/lib/plan-rules";
import { getPlanForReviewer } from "@/lib/plans";
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
    anchor: comment.anchor,
    variantId: comment.variantId,
    resolved: comment.resolvedAt !== null,
    createdAt: comment.createdAt,
    createdLabel: formatShortDateTime(comment.createdAt, timeZone),
  };
}

/** Version to compare with (the last one this reviewer saw) and the agency's notes since. */
function changesBase(
  versions: ReviewerPostVersion[],
  current: ReviewerPostVersion,
  viewedVersions: number[],
  timeZone: string
): { from: ReviewerPostVersion; base: PortalVersionChanges } | null {
  const baseline = diffBaseline(
    viewedVersions,
    current.number,
    versions.map((v) => v.number)
  );
  const from = baseline ? versions.find((v) => v.number === baseline.number) : undefined;
  if (!baseline || !from) return null;
  return {
    from,
    base: {
      fromNumber: from.number,
      seenByReviewer: baseline.seenByReviewer,
      summary: [],
      text: [],
      firstComment: [],
      addedMedia: [],
      notes: versions
        .filter((v) => v.number > from.number && v.number <= current.number && v.changeNote?.trim())
        .map((v) => ({
          number: v.number,
          note: v.changeNote!.trim(),
          dateLabel: formatShortDateTime(v.createdAt, timeZone),
        })),
    },
  };
}

/** Social: word-level diff of caption and first comment, media changes. */
function socialChanges(found: NonNullable<ReturnType<typeof changesBase>>, current: ReviewerPostVersion): PortalVersionChanges {
  const diff = diffVersions(found.from, current);
  return {
    ...found.base,
    summary: summarizeVersionDiff(diff),
    text: diff.text,
    firstComment: diff.firstComment,
    addedMedia: diff.media.added,
  };
}

function blogContentOf(version: ReviewerPostVersion): BlogContent {
  return coerceBlogContent(version.content);
}

/**
 * One item under review — a social post, a blog article or an ads set — with
 * what changed since the client last looked, the comments and the decision.
 * Opening it logs CLIENT_VIEWED once per version and reviewer.
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
  const currentComments = post.comments.filter((c) => c.versionId === current.id || c.versionId === null);
  const olderVersions: PortalOlderVersion[] = post.versions
    .filter((v) => v.number < current.number)
    .map((v) => ({
      number: v.number,
      dateLabel: formatShortDateTime(v.createdAt, timeZone),
      changeNote: v.changeNote,
      comments: post.comments.filter((c) => c.versionId === v.id).map((c) => toPortalComment(c, timeZone)),
    }));
  const historySlot = olderVersions.length > 0 ? <OlderVersions versions={olderVersions} /> : undefined;

  const found = changesBase(post.versions, current, viewedVersions, timeZone);

  // A post of a monthly plan the client can see: navigation stays inside the plan.
  const plan = post.kind === "SOCIAL_POST" && post.planId ? await planOf(post.planId, ref) : null;
  const planPosts = plan
    ? byPublishAsc(summaries.filter((p) => p.planId === plan.id && p.kind === post.kind)).map((p) => ({ id: p.id, canAct: p.canAct }))
    : [];
  let planNav: PortalPlanNav | undefined;
  if (plan) {
    const around = planNeighbors(
      planPosts.map((p) => p.id),
      post.id
    );
    if (around.position !== null) {
      planNav = {
        href: portalPlanPath(token, plan.id),
        heading: planHeading(plan.month, { kind: plan.kind, now, timeZone }),
        position: around.position,
        total: around.total,
        prevHref: around.prevId ? portalPath(token, around.prevId) : null,
        nextHref: around.nextId ? portalPath(token, around.nextId) : null,
      };
    }
  }

  const toReview = (planNav ? planPosts : summaries).filter((p) => p.canAct).map((p) => p.id);
  const index = toReview.indexOf(post.id);
  const queue: PortalQueue = {
    nextPostId: nextPostToReview(toReview, post.id),
    toReviewCount: toReview.length,
    position: index === -1 ? null : index + 1,
  };
  const listKinds: ContentKind[] = [...new Set([post.kind, ...summaries.map((p) => p.kind)])];
  const assistantEnabled = isAssistantEnabled();
  const progress = planProgress(summaries.filter(item => !planNav || item.planId === plan?.id).map(item => item.status));
  const progressSlot = progress.total > 0 ? (
    <div className="mb-5 ml-auto max-w-sm" aria-label={planNav ? "Avanzamento del piano" : "Avanzamento dei contenuti"}>
      <PlanProgressBar progress={progress} size="sm" label={`${progress.approved + progress.changes} di ${progress.total} contenuti revisionati`} />
    </div>
  ) : null;

  const base: PortalItemBase = {
    id: post.id,
    kind: post.kind,
    title: post.title,
    status: post.status,
    canAct: post.canAct,
    versionNumber: current.number,
    versionId: current.id,
    dateLabel: dateLabelFor(post.kind),
    publishLabel: formatPortalDate(post.publishAt, timeZone, { now }),
    reviewDueLabel: post.reviewDueAt ? formatPortalDate(post.reviewDueAt, timeZone, { withTime: false, now }) : null,
    approvedLabel: post.approvedAt ? formatPortalDate(post.approvedAt, timeZone, { now }) : null,
    timeZone,
    comments: currentComments.map((c) => toPortalComment(c, timeZone)),
  };

  // ─── Blog article ──────────────────────────────────────────────────────────

  if (post.kind === "BLOG_ARTICLE") {
    const content = blogContentOf(current);
    const html = renderMarkdownSafe(content.bodyMarkdown);
    // Open passage notes of earlier versions are re-anchored on this text:
    // highlighted where the passage still is, else under "testo modificato".
    const versionNumberById = new Map(post.versions.map((v) => [v.id, v.number] as const));
    const carried = post.comments.filter((c) => {
      const from = c.versionId === null ? undefined : versionNumberById.get(c.versionId);
      return c.anchor !== null && c.resolvedAt === null && from !== undefined && from < current.number;
    });
    const passageCandidates = [...currentComments, ...carried];
    const located = locateAnchors(html, passageCandidates);
    const numbers = numberPassageComments(
      passageCandidates,
      new Map(
        [...located].map(([id, place]) => [id, { status: place.status, start: place.match?.start ?? null }] as const)
      )
    );
    const comments: PortalPassageComment[] = [
      ...base.comments.map((c) => ({ ...c, fromVersion: null })),
      ...carried.map((c) => ({
        ...toPortalComment(c, timeZone),
        fromVersion: (c.versionId && versionNumberById.get(c.versionId)) || null,
      })),
    ].map((c) => ({
      ...c,
      number: numbers.get(c.id) ?? null,
      placement: located.get(c.id)?.status ?? null,
    }));
    const blogPost: PortalBlogPost = {
      ...base,
      kind: "BLOG_ARTICLE",
      content,
      html,
      articleDateLabel: formatPortalDate(post.publishAt, timeZone, { withTime: false, now }),
      comments,
    };

    let changesSlot: React.ReactNode;
    if (found) {
      const scheduleChanged = diffVersions(found.from, current, "BLOG_ARTICLE").schedule.publishAtChanged;
      changesSlot = (
        <VersionChanges
          changes={{ ...found.base, summary: scheduleChanged ? ["Data di pubblicazione prevista cambiata"] : [] }}
          currentNumber={current.number}
        >
          <BlogVersionDiff
            before={blogContentOf(found.from)}
            after={content}
            fromLabel={`la versione ${found.from.number}`}
            toLabel={`la versione ${current.number}`}
          />
        </VersionChanges>
      );
    }

    return (
      <main>
        {progressSlot}
        <BlogReview
          token={token}
          post={blogPost}
          queue={queue}
          listKinds={listKinds}
          assistantEnabled={assistantEnabled}
          changesSlot={changesSlot}
          seoSlot={<SeoDetails content={content} />}
          historySlot={historySlot}
        />
      </main>
    );
  }

  // ─── Ads creatives ─────────────────────────────────────────────────────────

  if (post.kind === "AD_CREATIVE") {
    const content = coerceAdContent(current.content);
    const decisions: Record<string, PortalVariantDecision> = {};
    for (const d of post.decisions) {
      decisions[d.variantId] = { verdict: d.verdict, note: d.note, isMine: d.isMine, reviewerName: d.reviewerName };
    }
    const adsPost: PortalAdsPost = { ...base, kind: "AD_CREATIVE", content, decisions };

    let changesSlot: React.ReactNode;
    if (found) {
      const summary = summarizeVersionDiff(diffVersions(found.from, current, "AD_CREATIVE")).map((line) =>
        line === "Data di pubblicazione cambiata" ? "Data di inizio della campagna cambiata" : line
      );
      changesSlot = <VersionChanges changes={{ ...found.base, summary }} currentNumber={current.number} />;
    }

    return (
      <main>
        {progressSlot}
        <AdsReview
          token={token}
          post={adsPost}
          client={{ name: post.client.name, logoUrl: post.client.logoUrl }}
          queue={queue}
          listKinds={listKinds}
          assistantEnabled={assistantEnabled}
          changesSlot={changesSlot}
          historySlot={historySlot}
        />
      </main>
    );
  }

  // ─── Social post (unchanged flow) ──────────────────────────────────────────

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
    publishLabel: base.publishLabel,
    reviewDueLabel: base.reviewDueLabel,
    approvedLabel: base.approvedLabel,
    timeZone,
    comments: base.comments,
  };
  const changes = found ? socialChanges(found, current) : null;

  return (
    <main>
      {progressSlot}
      <PostReview
        token={token}
        post={portalPost}
        client={{
          name: post.client.name,
          logoUrl: post.client.logoUrl,
          autoSchedule: reviewer.client.autoSchedule,
        }}
        queue={queue}
        assistantEnabled={assistantEnabled}
        publishInPast={post.publishAt.getTime() < now.getTime()}
        changesSlot={changes ? <VersionChanges changes={changes} currentNumber={current.number} /> : undefined}
        historySlot={historySlot}
        listKinds={listKinds}
        plan={planNav}
      />
    </main>
  );
}

/** The post's plan when the client may see it (sent, of their client); null otherwise. */
async function planOf(planId: string, reviewer: ReviewerRef) {
  try {
    return await getPlanForReviewer(planId, reviewer);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/**
 * "Dettagli per i motori di ricerca": what Google will show, secondary to the
 * article (collapsed). The agency's SEO checks stay in the agency panel.
 */
function SeoDetails({ content }: { content: BlogContent }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Titolo per Google", value: content.metaTitle.trim() },
    { label: "Descrizione per Google (meta description)", value: content.metaDescription.trim() },
    { label: "Parola chiave principale", value: content.focusKeyword.trim() },
    { label: "Indirizzo della pagina", value: content.slug.trim() ? `/${content.slug.trim()}` : "" },
    { label: "Categorie", value: content.categories.join(", ") },
    { label: "Tag", value: content.tags.join(", ") },
  ].filter((row) => row.value);

  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
        Dettagli per i motori di ricerca
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        <p className="text-sm text-muted">
          Non si vedono nell&apos;articolo: servono a Google per mostrarlo nei risultati di ricerca. Se qualcosa non
          ti torna, scrivilo in un commento.
        </p>
        <SerpPreview content={content} />
        {rows.length > 0 && (
          <dl className="space-y-3">
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="text-xs text-muted">{row.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-sm">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}
