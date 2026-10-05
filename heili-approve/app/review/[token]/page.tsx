import Link from "next/link";
import { formatPortalDate, groupPortalPosts, portalPath } from "@/components/portal/helpers";
import PostCard, { type PortalPostCardData } from "@/components/portal/post-card";
import { listPostsForReviewer } from "@/lib/posts";
import { getPortalReviewer } from "./reviewer";

type ReviewHomeProps = {
  params: Promise<{ token: string }>;
};

/**
 * Portal home: what needs the client's review first, then what the agency
 * is reworking, then what is already approved / scheduled.
 */
export default async function ReviewHomePage({ params }: ReviewHomeProps) {
  const { token } = await params;
  const reviewer = await getPortalReviewer(token);
  if (!reviewer) return null; // the layout shows the invalid-link page

  const timeZone = reviewer.client.timezone;
  const now = new Date();
  const posts = await listPostsForReviewer({ id: reviewer.id, clientId: reviewer.clientId });
  const cards = posts.map(
    (p): PortalPostCardData & { publishAt: Date } => ({
      id: p.id,
      title: p.title,
      status: p.status,
      canAct: p.canAct,
      networks: p.networks,
      versionNumber: p.currentVersionNumber,
      cover: p.cover,
      mediaCount: p.mediaCount,
      excerpt: p.excerpt,
      publishAt: p.publishAt,
      publishLabel: formatPortalDate(p.publishAt, timeZone, { now }),
      reviewDueLabel: p.reviewDueAt ? formatPortalDate(p.reviewDueAt, timeZone, { withTime: false, now }) : null,
    })
  );
  const groups = groupPortalPosts(cards, now);
  const firstName = reviewer.name.trim().split(/\s+/)[0] || reviewer.name;

  return (
    <main className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Ciao {firstName}!</h1>
        <p className="text-base text-muted">
          {groups.toReview.length === 0
            ? "Non ci sono post da approvare in questo momento. Ti scriveremo quando ce ne saranno di nuovi."
            : groups.toReview.length === 1
              ? "C'è un post che aspetta la tua approvazione."
              : `Ci sono ${groups.toReview.length} post che aspettano la tua approvazione.`}
        </p>
        {groups.toReview.length > 0 && (
          <Link
            href={portalPath(token, groups.toReview[0].id)}
            className="mt-2 flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover sm:w-auto sm:inline-flex"
          >
            {groups.toReview.length === 1 ? "Rivedi il post" : "Inizia dal primo"}
          </Link>
        )}
      </section>

      {groups.toReview.length > 0 && (
        <Section title="Da approvare" count={groups.toReview.length} highlight>
          {groups.toReview.map((post) => (
            <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
          ))}
        </Section>
      )}

      {groups.inProgress.length > 0 && (
        <Section
          title="Modifiche richieste"
          subtitle="In lavorazione dall'agenzia: riceverai un'email quando la nuova versione sarà pronta."
          count={groups.inProgress.length}
        >
          {groups.inProgress.map((post) => (
            <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
          ))}
        </Section>
      )}

      {(groups.approvedUpcoming.length > 0 || groups.approvedPast.length > 0) && (
        <Section
          title="Approvati / programmati"
          count={groups.approvedUpcoming.length + groups.approvedPast.length}
        >
          {groups.approvedUpcoming.length === 0 && (
            <p className="text-sm text-muted">Nessun post in uscita nei prossimi giorni.</p>
          )}
          {groups.approvedUpcoming.map((post) => (
            <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
          ))}
          {groups.approvedPast.length > 0 && (
            <details className="group rounded-lg border border-border">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-muted">
                Già pubblicati ({groups.approvedPast.length})
              </summary>
              <div className="space-y-3 p-3 pt-0">
                {groups.approvedPast.map((post) => (
                  <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
                ))}
              </div>
            </details>
          )}
        </Section>
      )}

      {posts.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Qui troverai i post che l&apos;agenzia prepara per {reviewer.client.name}, pronti da rivedere e
          approvare.
        </p>
      )}
    </main>
  );
}

function Section({
  title,
  subtitle,
  count,
  highlight = false,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {title}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              highlight ? "bg-accent text-white" : "bg-surface text-muted"
            }`}
          >
            {count}
          </span>
        </h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
