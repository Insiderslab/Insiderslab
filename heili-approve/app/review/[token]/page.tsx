import Link from "next/link";
import {
  formatPortalDate,
  groupPortalPosts,
  portalMonthPath,
  portalPlanPath,
  parsePortalKind,
  portalKindTabs,
  portalKinds,
  portalNoun,
  portalPath,
} from "@/components/portal/helpers";
import KindTabs from "@/components/portal/kind-tabs";
import PostCard, { type PortalPostCardData } from "@/components/portal/post-card";
import { clientServices } from "@/lib/clients";
import { PlanProgressBar } from "@/components/plans/plan-bits";
import { monthOffers, type MonthOffer } from "@/lib/month-rules";
import { planHeading, planMonthName, planMonthOf, planProgress, type PlanProgress } from "@/lib/plan-rules";
import { listPlansForReviewer } from "@/lib/plans";
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
  const ref = { id: reviewer.id, clientId: reviewer.clientId };
  const [allPosts, plans] = await Promise.all([listPostsForReviewer(ref), listPlansForReviewer(ref)]);
  const kindsShown = portalKinds(clientServices(reviewer.client), allPosts);
  const selected = parsePortalKind(query.tipo, kindsShown);
  const planCards = !selected || selected === "SOCIAL_POST" ? portalPlanCards(plans, { token, now, timeZone }) : [];
  const visiblePlanIds = new Set(planCards.map((plan) => plan.id));
  const firstWaitingPlan = planCards.find((plan) => plan.waiting > 0);
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
  const standaloneIds = new Set(posts.filter((p) => !p.planId || !visiblePlanIds.has(p.planId)).map((p) => p.id));
  const standaloneGroups = groupPortalPosts(cards.filter((p) => standaloneIds.has(p.id)), now);
  // Several posts of one month waiting outside any plan: review them together.
  const offers = monthOffers(
    posts.filter((p) => standaloneIds.has(p.id)),
    timeZone
  );
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
  const reviewProgress = planProgress(posts.map((post) => post.status));

  return (
    <main className="space-y-8">
      <section className="space-y-4 py-3 sm:py-5">
        <p className="label-caps">Il tuo spazio di revisione</p>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <h1 className="text-[30px] font-semibold leading-tight">Ciao {firstName}.<br /><span className="text-muted">Un contenuto alla volta.</span></h1>
          {reviewProgress.total > 0 && <div className="w-full sm:w-64"><PlanProgressBar progress={reviewProgress} label={`${reviewProgress.approved + reviewProgress.changes} di ${reviewProgress.total} contenuti revisionati`} /></div>}
        </div>
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
            href={firstWaitingPlan?.href ?? portalPath(token, groups.toReview[0].id)}
            className="btn btn-primary !min-h-12 w-full !text-base sm:w-auto"
          >
            {firstWaitingPlan ? "Rivedi il piano del mese" : groups.toReview.length === 1 ? `Rivedi ${noun.theOne}` : "Inizia dal primo"}
          </Link>
        )}
        {groups.toReview.length > 0 && (
          <ol className="grid gap-2 pt-1 text-sm text-muted sm:grid-cols-3" aria-label="Come funziona">
            {[
              ["Guarda", `Apri ${noun.theOne} come apparirà davvero.`],
              ["Commenta", "Tocca un punto o un secondo del video; puoi anche dettare a voce."],
              ["Concludi", "Approva oppure invia le modifiche. Il tuo feedback fa avanzare il lavoro."],
            ].map(([title, text], index) => (
              <li key={title} className="flex gap-2.5 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {index + 1}
                </span>
                <span>
                  <span className="block font-semibold text-foreground">{title}</span>
                  {text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {planCards.length > 0 && (
        <section className="space-y-3" aria-label="Piani del mese">
          <h2 className="text-lg font-semibold">Piani del mese</h2>
          <p className="text-sm text-muted">Apri un piano per rivedere i suoi post. Gli altri contenuti sono elencati separatamente qui sotto.</p>
          {planCards.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </section>
      )}

      {offers.length > 0 && (
        <section className="space-y-3" aria-label="Rivedi un mese insieme">
          {offers.map((offer) => (
            <MonthOfferCard key={offer.month} offer={offer} href={portalMonthPath(token, offer.month)} now={now} timeZone={timeZone} />
          ))}
        </section>
      )}

      {tabs.length > 0 && <KindTabs tabs={tabs} />}

      {standaloneGroups.toReview.length > 0 && (
        <Section title={planCards.length > 0 ? "Contenuti singoli da approvare" : "Da approvare"} count={standaloneGroups.toReview.length} highlight>
          {standaloneGroups.toReview.map((post) => (
            <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
          ))}
        </Section>
      )}

      {standaloneGroups.inProgress.length > 0 && (
        <Section
          title="Modifiche richieste"
          subtitle="In lavorazione dall'agenzia: riceverai un'email quando la nuova versione sarà pronta."
          count={standaloneGroups.inProgress.length}
        >
          {standaloneGroups.inProgress.map((post) => (
            <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
          ))}
        </Section>
      )}

      {(standaloneGroups.approvedUpcoming.length > 0 || standaloneGroups.approvedPast.length > 0) && (
        <Section
          title={socialOnly ? "Approvati / programmati" : "Approvati"}
          count={standaloneGroups.approvedUpcoming.length + standaloneGroups.approvedPast.length}
        >
          {standaloneGroups.approvedUpcoming.length === 0 && (
            <p className="text-sm text-muted">
              {adsOnly
                ? "Nessuna campagna in partenza nei prossimi giorni."
                : `Nessun ${noun.one} in uscita nei prossimi giorni.`}
            </p>
          )}
          {standaloneGroups.approvedUpcoming.map((post) => (
            <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
          ))}
          {standaloneGroups.approvedPast.length > 0 && (
            <details className="group rounded-lg border border-border">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-muted">
                {`${adsOnly ? "Campagne già partite" : socialOnly ? "Già pubblicati" : "Date già passate"} (${standaloneGroups.approvedPast.length})`}
              </summary>
              <div className="space-y-3 p-3 pt-0">
                {standaloneGroups.approvedPast.map((post) => (
                  <PostCard key={post.id} post={post} href={portalPath(token, post.id)} />
                ))}
              </div>
            </details>
          )}
        </Section>
      )}

      {posts.length === 0 && (
        <p className="panel p-4 text-sm text-muted">
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
          <span className={highlight ? "chip chip-brand" : "chip chip-offline"}>{count}</span>
        </h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** "ottobre", with the year when it is not the current one in the client's zone. */
function offerMonthName(month: string, now: Date, timeZone: string): string {
  const year = month.slice(0, 4);
  return `${planMonthName(month)}${year !== planMonthOf(now, timeZone).slice(0, 4) ? ` ${year}` : ""}`;
}

function MonthOfferCard({ offer, href, now, timeZone }: { offer: MonthOffer; href: string; now: Date; timeZone: string }) {
  const name = offerMonthName(offer.month, now, timeZone);
  return (
    <Link
      href={href}
      className="panel block space-y-3 p-4 transition-colors hover:border-line-strong sm:p-5"
      data-testid="portal-month-offer"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="label-caps">Tutti insieme</span>
        <span className="chip chip-brand">{offer.count} post da approvare</span>
      </span>
      <span className="block text-xl font-semibold leading-tight">Rivedi tutto {name} insieme</span>
      <span className="block text-sm text-muted">
        I {offer.count} post di {name} in una griglia e uno dopo l&apos;altro, con Approva e Commenta.
      </span>
      <span className="flex min-h-12 w-full items-center justify-center rounded-lg border border-border px-4 text-base font-semibold sm:inline-flex sm:w-auto">
        Rivedi tutto {name} insieme
      </span>
    </Link>
  );
}

interface PlanCardData {
  id: string;
  heading: string;
  href: string;
  progress: PlanProgress;
  waiting: number;
}

/**
 * Monthly plans on the portal home: every sent plan with posts still waiting
 * for the client (highlighted), plus the plan of the current and next months
 * once done (quiet), newest first.
 */
function portalPlanCards(
  plans: Awaited<ReturnType<typeof listPlansForReviewer>>,
  { token, now, timeZone }: { token: string; now: Date; timeZone: string }
): PlanCardData[] {
  const current = planMonthOf(now, timeZone);
  return plans
    .map((plan) => {
      const progress = planProgress(plan.posts.map((p) => p.status));
      return {
        id: plan.id,
        month: plan.month,
        heading: planHeading(plan.month, { kind: plan.kind, now, timeZone }),
        href: portalPlanPath(token, plan.id),
        progress,
        waiting: progress.inReview,
      };
    })
    .filter((plan) => plan.progress.total > 0 && (plan.waiting > 0 || plan.month >= current));
}

function PlanCard({ plan }: { plan: PlanCardData }) {
  const highlight = plan.waiting > 0;
  return (
    <Link
      href={plan.href}
      className={`panel block space-y-3 p-4 transition-colors hover:border-line-strong sm:p-5 ${highlight ? "!border-2 !border-accent" : ""}`}
      data-testid="portal-plan-card"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="label-caps">Piano del mese</span>
        <span className={highlight ? "chip chip-brand" : "chip chip-fresh"}>
          {highlight ? (plan.waiting === 1 ? "1 post da approvare" : `${plan.waiting} post da approvare`) : "Rivisto"}
        </span>
      </span>
      <span className="block text-xl font-semibold leading-tight">{plan.heading}</span>
      <span className="block text-sm text-muted">
        {plan.progress.total === 1 ? "1 post" : `${plan.progress.total} post`} · i post inclusi nel piano, con anteprima Instagram
      </span>
      <PlanProgressBar progress={plan.progress} size="sm" />
      <span
        className={`flex min-h-12 w-full items-center justify-center rounded-lg px-4 text-base font-semibold sm:w-auto sm:inline-flex ${
          highlight ? "bg-accent text-white" : "border border-border"
        }`}
      >
        {highlight ? "Rivedi il piano" : "Apri il piano"}
      </span>
    </Link>
  );
}
