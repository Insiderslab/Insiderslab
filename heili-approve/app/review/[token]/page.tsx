import Link from "next/link";
import {
  formatPortalDate,
  groupPortalPosts,
  parsePortalKind,
  portalKindTabs,
  portalKinds,
  portalNoun,
  portalPath,
} from "@/components/portal/helpers";
import KindTabs from "@/components/portal/kind-tabs";
import PostCard, { type PortalPostCardData } from "@/components/portal/post-card";
import { clientServices } from "@/lib/clients";
import { listPostsForReviewer } from "@/lib/posts";
import { enabledKinds, kindCountPhrase } from "@/lib/variant";
import { getPortalReviewer } from "./reviewer";

type ReviewHomeProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ tipo?: string | string[] }>;
};

/**
 * Portal home: what needs the client's review first (every kind together),
 * then what the agency is reworking, then what is already approved /
 * scheduled. Each card says what it is (social post, article, ads
 * creatives); the wording follows the kinds in the list ("post",
 * "articoli", "contenuti").
 *
 * One portal per client: when it shows more than one kind (the client's
 * services, plus kinds it already has items of), tabs "Tutti · Post social ·
 * Articoli · Creatività" filter the list (`?tipo=social|blog|ads`), each with
 * the number of items waiting for the client.
 */
export default async function ReviewHomePage({ params, searchParams }: ReviewHomeProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const reviewer = await getPortalReviewer(token);
  if (!reviewer) return null; // the layout shows the invalid-link page

  const timeZone = reviewer.client.timezone;
  const now = new Date();
  const allPosts = await listPostsForReviewer({ id: reviewer.id, clientId: reviewer.clientId });
  const kindsShown = portalKinds(clientServices(reviewer.client), allPosts);
  const selected = parsePortalKind(query.tipo, kindsShown);
  const tabs = portalKindTabs(token, kindsShown, allPosts, tabsSelected(selected, kindsShown));
  const posts = selected ? allPosts.filter((p) => p.kind === selected) : allPosts;
  const cards = posts.map(
    (p): PortalPostCardData & { publishAt: Date } => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      status: p.status,
      canAct: p.canAct,
      networks: p.networks,
      versionNumber: p.currentVersionNumber,
      cover: p.cover,
      mediaCount: p.mediaCount,
      variantCount: p.variantCount,
      excerpt: p.excerpt,
      publishAt: p.publishAt,
      publishLabel: formatPortalDate(p.publishAt, timeZone, { now }),
      reviewDueLabel: p.reviewDueAt ? formatPortalDate(p.reviewDueAt, timeZone, { withTime: false, now }) : null,
    })
  );
  const groups = groupPortalPosts(cards, now);
  // An empty list speaks of the tab, else of what the client gets here.
  const kinds =
    posts.length > 0 ? posts.map((p) => p.kind) : selected ? [selected] : kindsShown.length > 0 ? kindsShown : enabledKinds();
  const noun = portalNoun(kinds);
  const toReviewByKind = groups.toReview.reduce<Partial<Record<(typeof posts)[number]["kind"], number>>>(
    (counts, post) => ({ ...counts, [post.kind]: (counts[post.kind] ?? 0) + 1 }),
    {}
  );
  const mixedToReview = Object.keys(toReviewByKind).length > 1;
  const socialOnly = kinds.every((k) => k === "SOCIAL_POST");
  const adsOnly = kinds.every((k) => k === "AD_CREATIVE");
  const firstName = reviewer.name.trim().split(/\s+/)[0] || reviewer.name;

  return (
    <main className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Ciao {firstName}!</h1>
        <p className="text-base text-muted">
          {groups.toReview.length === 0
            ? `Non ci sono ${noun.many} da approvare in questo momento. Ti scriveremo quando ce ne saranno di nuovi.`
            : groups.toReview.length === 1
              ? `C'è un ${noun.one} che aspetta la tua approvazione.`
              : mixedToReview
                ? `Ci sono ${groups.toReview.length} ${noun.many} che aspettano la tua approvazione: ${kindCountPhrase(toReviewByKind, { adSets: true })}.`
                : `Ci sono ${groups.toReview.length} ${noun.many} che aspettano la tua approvazione.`}
        </p>
        {groups.toReview.length > 0 && (
          <Link
            href={portalPath(token, groups.toReview[0].id)}
            className="mt-2 flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover sm:w-auto sm:inline-flex"
          >
            {groups.toReview.length === 1 ? `Rivedi ${noun.theOne}` : "Inizia dal primo"}
          </Link>
        )}
      </section>

      {tabs.length > 0 && <KindTabs tabs={tabs} />}

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
          title={socialOnly ? "Approvati / programmati" : "Approvati"}
          count={groups.approvedUpcoming.length + groups.approvedPast.length}
        >
          {groups.approvedUpcoming.length === 0 && (
            <p className="text-sm text-muted">
              {adsOnly
                ? "Nessuna campagna in partenza nei prossimi giorni."
                : `Nessun ${noun.one} in uscita nei prossimi giorni.`}
            </p>
          )}
          {groups.approvedUpcoming.map((post) => (
            <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
          ))}
          {groups.approvedPast.length > 0 && (
            <details className="group rounded-lg border border-border">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-muted">
                {`${adsOnly ? "Campagne già partite" : socialOnly ? "Già pubblicati" : "Date già passate"} (${groups.approvedPast.length})`}
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
          Qui troverai {noun.theMany} che l&apos;agenzia prepara per {reviewer.client.name}, pronti da rivedere
          e approvare.
        </p>
      )}
    </main>
  );
}

/** The selected tab; "Tutti" when the portal shows a single kind. */
function tabsSelected<K>(selected: K | null, kinds: readonly K[]): K | null {
  return kinds.length > 1 ? selected : null;
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
