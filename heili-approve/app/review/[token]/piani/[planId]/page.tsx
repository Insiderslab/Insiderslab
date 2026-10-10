import { notFound } from "next/navigation";
import InstagramGrid, { type GridTile } from "@/components/plans/instagram-grid";
import Browse from "@/components/portal/month/browse";
import { loadBrowsePosts } from "@/components/portal/month/browse-data";
import MonthFrame from "@/components/portal/month/month-frame";
import MonthGrid, { monthGridTiles } from "@/components/portal/month/month-grid";
import ViewSwitch, { QuickReviewLink } from "@/components/portal/month/view-switch";
import {
  formatPlanSlot,
  formatPortalDate,
  formatShortDateTime,
  portalPath,
  portalPlanPath,
  portalStatusLabel,
  portalTone,
} from "@/components/portal/helpers";
import PlanReview from "@/components/portal/plan-review";
import type { PortalPlan } from "@/components/portal/types";
import { NotFoundError } from "@/lib/errors";
import { parseMonthView, parsePosition, type MonthView } from "@/lib/month-rules";
import { byPublishAsc, instagramGridOrder, planHeading, planMonthName, planProgress } from "@/lib/plan-rules";
import { getPlanForReviewer, openClientCommentCounts, type ReviewerPlan } from "@/lib/plans";
import { listPostsForReviewer, type ReviewerRef } from "@/lib/posts";
import { getPortalReviewer } from "../../reviewer";

type PlanSearch = { vista?: string | string[]; i?: string | string[] };

type ReviewPlanPageProps = {
  params: Promise<{ token: string; planId: string }>;
  searchParams?: Promise<PlanSearch>;
};

const PLAN_VIEWS: readonly MonthView[] = ["panoramica", "griglia", "sfoglia"];

async function loadPlan(planId: string, reviewer: ReviewerRef): Promise<ReviewerPlan> {
  try {
    return await getPlanForReviewer(planId, reviewer);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

const TILE_TONE = { action: "brand", waiting: "stale", done: "fresh" } as const;

/**
 * A monthly plan in the client portal: only plans of the reviewer's client
 * that the agency sent (never a draft plan, never another client's: both are
 * "not found"), and of its posts only those visible to the client, at the
 * version they were sent with (listPostsForReviewer).
 */
export default async function ReviewPlanPage({ params, searchParams }: ReviewPlanPageProps) {
  const [{ token, planId }, query] = await Promise.all([params, searchParams ?? ({} as PlanSearch)]);
  const view = parseMonthView(query.vista, { allowed: PLAN_VIEWS });
  const reviewer = await getPortalReviewer(token);
  if (!reviewer) return null; // the layout shows the invalid-link page

  const ref: ReviewerRef = { id: reviewer.id, clientId: reviewer.clientId };
  const plan = await loadPlan(planId, ref);
  const summaries = await listPostsForReviewer(ref);
  const posts = byPublishAsc(summaries.filter((p) => p.planId === plan.id && p.kind === plan.kind));
  const comments = await openClientCommentCounts(posts.filter((p) => p.canAct).map((p) => p.id));

  const timeZone = reviewer.client.timezone;
  const now = new Date();
  const due = plan.reviewDueAt ?? posts.find((p) => p.canAct && p.reviewDueAt)?.reviewDueAt ?? null;

  const portalPlan: PortalPlan = {
    id: plan.id,
    heading: planHeading(plan.month, { kind: plan.kind, now, timeZone }),
    monthName: planMonthName(plan.month),
    intro: plan.intro,
    clientName: reviewer.client.name,
    logoUrl: reviewer.client.logoUrl,
    dueLabel: due ? formatPortalDate(due, timeZone, { withTime: false, now }) : null,
    autoSchedule: reviewer.client.autoSchedule,
    posts: posts.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      canAct: p.canAct,
      versionNumber: p.currentVersionNumber,
      dateLabel: formatPlanSlot(p.publishAt, timeZone),
      networks: p.networks,
      cover: p.cover,
      mediaCount: p.mediaCount,
      excerpt: p.excerpt,
      openComments: comments.get(p.id) ?? 0,
      href: portalPath(token, p.id),
    })),
    comments: plan.comments.map((c) => ({
      id: c.id,
      authorName: c.authorType === "CLIENT" ? (c.reviewer?.name ?? reviewer.client.name) : (c.user?.name ?? "Agenzia"),
      isMine: c.reviewerId === reviewer.id,
      fromAgency: c.authorType === "AGENCY",
      body: c.body,
      createdLabel: formatShortDateTime(c.createdAt, timeZone),
    })),
  };

  const planPath = portalPlanPath(token, plan.id);
  const switcher = <ViewSwitch basePath={planPath} view={view} views={PLAN_VIEWS} />;

  // Griglia and Sfoglia: every post of the month, same data and rules as the overview.
  if (view !== "panoramica") {
    const progress = planProgress(posts.map((p) => p.status));
    const sfoglia = view === "sfoglia";
    return (
      <main>
        <MonthFrame
          backHref={planPath}
          backLabel="Piano del mese"
          eyebrow={reviewer.client.name}
          heading={portalPlan.heading}
          progress={progress}
          switcher={switcher}
          quick={<QuickReviewLink basePath={planPath} />}
          compact={sfoglia}
        >
          {sfoglia ? (
            <Browse
              token={token}
              scope={{ kind: "plan", planId: plan.id }}
              posts={await loadBrowsePosts({ token, reviewer: ref, summaries: posts, timeZone, now })}
              backHref={planPath}
              backLabel="Torna al piano"
              startPosition={parsePosition(query.i)}
              autoSchedule={reviewer.client.autoSchedule}
              clientName={reviewer.client.name}
              logoUrl={reviewer.client.logoUrl}
              timeZone={timeZone}
            />
          ) : (
            <MonthGrid
              tiles={monthGridTiles({ token, posts, timeZone })}
              accountName={reviewer.client.name}
              logoUrl={reviewer.client.logoUrl}
              monthLabel={portalPlan.monthName}
            />
          )}
        </MonthFrame>
      </main>
    );
  }

  const tiles: GridTile[] = instagramGridOrder(posts.filter((p) => p.networks.includes("instagram"))).map((p) => {
    const tone = portalTone(p.status, p.canAct);
    return {
      id: p.id,
      title: p.title,
      cover: p.cover,
      mediaCount: p.mediaCount,
      excerpt: p.excerpt,
      dateLabel: formatPlanSlot(p.publishAt, timeZone),
      status: { label: portalStatusLabel(p.kind, p.status), tone: TILE_TONE[tone] },
      href: portalPath(token, p.id),
    };
  });

  return (
    <main>
      <PlanReview
        token={token}
        plan={portalPlan}
        homeHref={portalPath(token)}
        modeSlot={switcher}
        quickReviewSlot={<QuickReviewLink basePath={planPath} />}
        gridSlot={
          <InstagramGrid
            tiles={tiles}
            accountName={reviewer.client.name}
            logoUrl={reviewer.client.logoUrl}
            caption={`${tiles.length} post Instagram del piano`}
          />
        }
      />
    </main>
  );
}
