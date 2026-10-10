/* eslint-disable @next/next/no-img-element -- media are arbitrary public URLs (uploads or external), not next/image sources */

/**
 * Piano del mese (agency)
 *
 * One client's social posts for one month, presented together: status and
 * progress, the message for the client, due date and "Invia il piano al
 * cliente" (every draft / changes-requested post in one go, one email per
 * reviewer), the plan's link with WhatsApp, an Instagram profile-grid
 * preview (newest first), the month calendar and the list of posts with
 * their status. Posts of the month added after the plan was opened can be
 * added with "Aggiungi al piano". The client's general comments on the plan
 * are listed at the bottom.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import InstagramGrid, { type GridTile } from "@/components/plans/instagram-grid";
import { PlanProgressBar, PlanStatusChip, PlanViews } from "@/components/plans/plan-bits";
import PlanCalendar from "@/components/plans/plan-calendar";
import PlanEditor from "@/components/plans/plan-editor";
import { AddToPlanButton } from "@/components/plans/plan-post-buttons";
import PlanSharePanel from "@/components/plans/plan-share-panel";
import { dayKeyIn, formatDateTime, newContentHref, toLocalParts } from "@/components/posts/helpers";
import StatusBadge from "@/components/status-badge";
import QuickReviewLink from "@/components/share/quick-review-link";
import { NETWORK_LABELS, isNetwork, parseMediaItems, type MediaItem } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import {
  instagramGridOrder,
  isApprovedLike,
  planHeading,
  planMonthName,
  planMonthTitle,
  planProgress,
} from "@/lib/plan-rules";
import { getPlanForWorkspace, type WorkspacePlan, type WorkspacePlanPost } from "@/lib/plans";
import { productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Piano del mese - ${productName()}` };
}

async function loadPlan(id: string, workspaceId: string): Promise<WorkspacePlan> {
  if (id.length > 64) notFound();
  try {
    return await getPlanForWorkspace(id, workspaceId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function coverOf(post: WorkspacePlanPost): { cover: MediaItem | null; mediaCount: number; excerpt: string } {
  const version = post.versions[0];
  const media = parseMediaItems(version?.media);
  return { cover: media[0] ?? null, mediaCount: media.length, excerpt: (version?.text ?? "").slice(0, 140) };
}

function networksOf(post: WorkspacePlanPost): string {
  return post.networks.filter(isNetwork).map((n) => NETWORK_LABELS[n]).join(", ");
}

/** "Approvato" / "Da approvare"… on the grid tiles (agency words). */
function tileStatus(post: WorkspacePlanPost): GridTile["status"] {
  if (isApprovedLike(post.status)) return { label: "Approvato", tone: "fresh" };
  if (post.status === "IN_REVIEW") return { label: "In revisione", tone: "brand" };
  if (post.status === "CHANGES_REQUESTED") return { label: "Modifiche", tone: "stale" };
  return { label: "Bozza", tone: "offline" };
}

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const plan = await loadPlan(id, context.workspaceId);

  const zone = plan.client.timezone;
  const now = new Date();
  const progress = planProgress(plan.posts.map((p) => p.status));
  const monthName = planMonthName(plan.month);
  const heading = planHeading(plan.month, { kind: plan.kind, now, timeZone: zone });
  const planName = heading.charAt(0).toLowerCase() + heading.slice(1);
  const sendable = (p: WorkspacePlanPost) => p.status === "DRAFT" || p.status === "CHANGES_REQUESTED";
  const counts = {
    drafts: plan.posts.filter((p) => p.status === "DRAFT").length,
    changes: plan.posts.filter((p) => p.status === "CHANGES_REQUESTED").length,
    inReview: progress.inReview,
    approved: progress.approved,
    outside: plan.outside.filter(sendable).length,
    outsideTotal: plan.outside.length,
  };
  const tiles: GridTile[] = instagramGridOrder(plan.posts.filter((post) => post.networks.includes("instagram"))).map((post) => ({
    id: post.id,
    title: post.title,
    ...coverOf(post),
    dateLabel: formatDateTime(post.publishAt, zone, { year: false }),
    status: tileStatus(post),
    href: `/posts/${post.id}`,
  }));
  const calendarPosts = [...plan.posts, ...plan.outside].map((post) => ({
    id: post.id,
    title: post.title,
    status: post.status,
    publishAt: post.publishAt,
    cover: coverOf(post).cover,
    inPlan: plan.posts.some((p) => p.id === post.id),
  }));
  const dueDate = plan.reviewDueAt ? toLocalParts(plan.reviewDueAt, zone).date : "";
  // "Nuovo post" starts on the 1st of the month, or today when the month has begun.
  const today = dayKeyIn(now, zone);
  const newDay = today.startsWith(plan.month) ? today : `${plan.month}-01`;

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link href="/plans" className="text-muted hover:text-foreground">
          ← Tutti i piani
        </Link>
      </nav>

      <header className="panel space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="label-caps">
              {plan.client.name} · {planMonthTitle(plan.month)}
            </p>
            <h1 className="text-2xl font-semibold leading-tight" data-testid="plan-title">
              {plan.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <PlanStatusChip status={plan.status} sent={Boolean(plan.sentAt)} />
              <span>
                {plan.sentAt ? `Inviato ${formatDateTime(plan.sentAt, zone, { year: false })}` : "Non ancora inviato"}
              </span>
              {plan.reviewDueAt && <span>Risposta entro {formatDateTime(plan.reviewDueAt, zone, { year: false })}</span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {plan.sentAt && <QuickReviewLink kind="plan" id={plan.id} />}
            <Link href={`/calendar?clientId=${plan.client.id}&mese=${plan.month}`} className="btn btn-sm min-h-11">
              Calendario del mese
            </Link>
            <Link href={newContentHref("SOCIAL_POST", { clientId: plan.client.id, day: newDay })} className="btn btn-sm min-h-11">
              Crea un post del mese
            </Link>
          </div>
        </div>
        {progress.total > 0 ? (
          <div className="max-w-md" data-testid="plan-progress">
            <PlanProgressBar progress={progress} />
            <p className="mt-1 text-sm text-muted">
              {[
                progress.inReview > 0 ? `${progress.inReview} in revisione` : null,
                progress.changes > 0 ? `${progress.changes} con modifiche richieste` : null,
                progress.draft > 0 ? `${progress.draft} in bozza` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Nessun post social di {plan.client.name} a {monthName}. Preparali dal calendario: entrano nel piano quando lo
            invii.
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="min-w-0">
          <PlanViews
            list={
              <div className="space-y-6">
                <section className="space-y-3" aria-labelledby="plan-posts-title">
                  <div>
                    <h3 id="plan-posts-title" className="text-lg font-semibold">Post inclusi ({plan.posts.length})</h3>
                    <p className="text-sm text-muted">Questi contenuti fanno già parte del piano del cliente.</p>
                  </div>
                  {plan.posts.length === 0 ? (
                    <p className="panel p-5 text-sm text-muted">Il piano non ha ancora post.</p>
                  ) : (
                    <ol className="panel divide-y divide-border overflow-visible" data-testid="plan-posts">
                      {plan.posts.map((post) => <PlanPostRow key={post.id} post={post} zone={zone} />)}
                    </ol>
                  )}
                </section>

                {plan.outside.length > 0 && (
                  <section className="space-y-3" aria-labelledby="plan-outside-title">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 id="plan-outside-title" className="text-lg font-semibold">Da aggiungere ({plan.outside.length})</h3>
                        <p className="text-sm text-muted">Sono post dello stesso mese, ma non fanno ancora parte del piano.</p>
                      </div>
                      {plan.outside.length > 1 && (
                        <AddToPlanButton planId={plan.id} postIds={plan.outside.map((p) => p.id)} label="Aggiungi tutti" />
                      )}
                    </div>
                    <div className="rounded-xl bg-warning-soft p-3 text-sm text-foreground">
                      Aggiungerli serve a comporre il piano. Le bozze diventano visibili al cliente solo quando le invii in revisione.
                    </div>
                    <ol className="panel divide-y divide-border overflow-visible">
                      {plan.outside.map((post) => (
                        <PlanPostRow
                          key={post.id}
                          post={post}
                          zone={zone}
                          action={<AddToPlanButton planId={plan.id} postIds={[post.id]} label="Aggiungi" />}
                        />
                      ))}
                    </ol>
                  </section>
                )}
              </div>
            }
            calendar={
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  {plan.posts.length} nel piano e {plan.outside.length} da aggiungere. Il calendario è una vista: non invia contenuti.
                </p>
                <PlanCalendar month={plan.month} timeZone={zone} posts={calendarPosts} now={now} />
              </div>
            }
            instagram={
              <div className="space-y-3">
                <p className="text-sm text-muted">Solo i contenuti Instagram inclusi, dal più recente. Tocca una casella per aprire il post.</p>
                <InstagramGrid
                  tiles={tiles}
                  accountName={plan.client.name}
                  logoUrl={plan.client.logoUrl}
                  caption={`${tiles.length} contenuti Instagram del piano`}
                />
              </div>
            }
          />
        </div>

        <aside className="order-first min-w-0 space-y-6 lg:order-none">
          <PlanEditor
            planId={plan.id}
            title={plan.title}
            intro={plan.intro ?? ""}
            dueDate={dueDate}
            timeZone={zone}
            clientName={plan.client.name}
            monthName={monthName}
            counts={counts}
            sent={Boolean(plan.sentAt)}
          />

          <PlanSharePanel
            workspaceId={context.workspaceId}
            plan={plan}
            client={plan.client}
            planName={planName}
            toReview={progress.inReview}
          />

          {plan.comments.length > 0 && (
            <section className="panel space-y-3 p-4 sm:p-5" aria-labelledby="plan-comments-title">
              <h2 id="plan-comments-title" className="text-lg font-semibold">
                Commenti sul piano ({plan.comments.length})
              </h2>
              <ul className="space-y-2">
                {plan.comments.map((comment) => (
                  <li key={comment.id} className="inset space-y-1 p-3 text-sm">
                    <p className="text-xs text-muted">
                      {comment.authorType === "CLIENT"
                        ? (comment.reviewer?.name ?? plan.client.name)
                        : (comment.user?.name ?? "Agenzia")}{" "}
                      · {formatDateTime(comment.createdAt, zone, { year: false })}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{comment.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function PlanPostRow({ post, zone, action }: { post: WorkspacePlanPost; zone: string; action?: React.ReactNode }) {
  const { cover } = coverOf(post);
  const comments = post._count.comments;
  const clientVisible = post.status === "IN_REVIEW" || post.status === "CHANGES_REQUESTED";
  return (
    <li className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap" data-testid="plan-post-row">
      <span className="h-14 w-14 shrink-0 overflow-hidden rounded bg-surface-sunken">
        {cover?.type === "image" ? (
          <img src={cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : cover?.posterUrl ? (
          <img src={cover.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <Link href={`/posts/${post.id}`} className="block truncate font-semibold hover:underline">
          {post.title}
        </Link>
        <span className="block truncate text-sm text-muted">
          <span className="tabular">{formatDateTime(post.publishAt, zone, { year: false })}</span>
          {networksOf(post) ? ` · ${networksOf(post)}` : ""}
          {` · v${post.currentVersionNumber}`}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={post.status} />
          {comments > 0 && (
            <span className="chip chip-stale">{comments === 1 ? "1 commento del cliente" : `${comments} commenti del cliente`}</span>
          )}
        </span>
      </span>
      {(action || clientVisible) && (
        <div className="flex w-full flex-wrap items-start justify-end gap-2 pl-[4.25rem] sm:w-auto sm:pl-0">
          {action}
          {clientVisible && <QuickReviewLink kind="post" id={post.id} />}
        </div>
      )}
    </li>
  );
}
