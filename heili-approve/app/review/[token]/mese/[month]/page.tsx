import { notFound } from "next/navigation";
import Browse from "@/components/portal/month/browse";
import { loadBrowsePosts } from "@/components/portal/month/browse-data";
import MonthFrame from "@/components/portal/month/month-frame";
import MonthGrid, { monthGridTiles } from "@/components/portal/month/month-grid";
import ViewSwitch, { QuickReviewLink } from "@/components/portal/month/view-switch";
import { portalMonthPath, portalPath } from "@/components/portal/helpers";
import { monthRouteAllowed, parseMonthView, parsePosition, selectMonthPosts, type MonthView } from "@/lib/month-rules";
import { isPlanMonth, planMonthName, planMonthOf, planProgress } from "@/lib/plan-rules";
import { listPostsForReviewer, type ReviewerRef } from "@/lib/posts";
import { isKindEnabled } from "@/lib/variant";
import { getPortalReviewer } from "../../reviewer";

type ReviewMonthPageProps = {
  params: Promise<{ token: string; month: string }>;
  searchParams: Promise<{ vista?: string | string[]; i?: string | string[] }>;
};

const MONTH_VIEWS: readonly MonthView[] = ["griglia", "sfoglia"];

/**
 * "Rivedi tutto <mese> insieme": the social posts of one month of the
 * reviewer's client, seen as a profile grid or reviewed one after another
 * (Sfoglia), for posts that are not in a plan. Same security as the plan
 * route: the reviewer is resolved from the link, only that client's posts are
 * read, only the ones clients can see (never drafts or cancelled) at the
 * version they were sent with; a month with nothing to show — malformed, or
 * another client's — is "not found".
 */
export default async function ReviewMonthPage({ params, searchParams }: ReviewMonthPageProps) {
  const [{ token, month }, query] = await Promise.all([params, searchParams]);
  const reviewer = await getPortalReviewer(token);
  if (!reviewer) return null; // the layout shows the invalid-link page
  if (!isPlanMonth(month) || !isKindEnabled("SOCIAL_POST")) notFound();

  const ref: ReviewerRef = { id: reviewer.id, clientId: reviewer.clientId };
  const timeZone = reviewer.client.timezone;
  const now = new Date();
  const posts = selectMonthPosts(await listPostsForReviewer(ref), month, timeZone);
  if (!monthRouteAllowed(month, posts.length)) notFound();

  const view = parseMonthView(query.vista, { allowed: MONTH_VIEWS, fallback: "griglia" });
  const monthPath = portalMonthPath(token, month);
  const monthName = planMonthName(month);
  const year = month.slice(0, 4);
  const heading = `Post di ${monthName}${year !== planMonthOf(now, timeZone).slice(0, 4) ? ` ${year}` : ""}`;
  const sfoglia = view === "sfoglia";

  return (
    <main>
      <MonthFrame
        backHref={portalPath(token)}
        backLabel="Tutti i post"
        eyebrow={reviewer.client.name}
        heading={heading}
        progress={planProgress(posts.map((p) => p.status))}
        switcher={<ViewSwitch basePath={monthPath} view={view} views={MONTH_VIEWS} />}
        quick={<QuickReviewLink basePath={monthPath} />}
        compact={sfoglia}
      >
        {sfoglia ? (
          <Browse
            token={token}
            scope={{ kind: "month", month }}
            posts={await loadBrowsePosts({ token, reviewer: ref, summaries: posts, timeZone, now })}
            backHref={portalPath(token)}
            backLabel="Torna ai post"
            startPosition={parsePosition(query.i)}
            autoSchedule={reviewer.client.autoSchedule}
            clientName={reviewer.client.name}
            logoUrl={reviewer.client.logoUrl}
            timeZone={timeZone}
          />
        ) : (
          <MonthGrid
            tiles={monthGridTiles({ token, posts, timeZone, month })}
            accountName={reviewer.client.name}
            logoUrl={reviewer.client.logoUrl}
            monthLabel={monthName}
          />
        )}
      </MonthFrame>
    </main>
  );
}
