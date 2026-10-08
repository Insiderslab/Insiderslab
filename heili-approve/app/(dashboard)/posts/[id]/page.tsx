/**
 * Post Detail Page
 *
 * Header with status, planned date in the client's time zone and the
 * actions the state machine allows. Per kind:
 * - social post: networks, Metricool outcome (id or error);
 * - blog article: address and length, export (Markdown / HTML for
 *   WordPress) and "Segna come pubblicato";
 * - ad set: campaign and variants, the client's decisions, the ZIP of the
 *   approved variants and "Segna come consegnato".
 * Four tabs:
 * - Revisione: the preview with every comment on it (pins and video markers,
 *   highlighted passages of an article, the variants of a set with the
 *   client's decisions), threads with reply / resolve, assistant transcripts;
 * - Modifica: the editor of the kind (read-only once scheduled, delivered or
 *   cancelled);
 * - Versioni: history with what changed (caption diff, article diff word by
 *   word, variant changes);
 * - Attività: the audit log in Italian.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ContentKind } from "@/app/generated/prisma/client";
import { loadEditorClients, toNetworkOptions } from "@/app/(dashboard)/posts/data";
import { BlogVersionDiff } from "@/components/blog";
import AdReview, { type AdDecisionView } from "@/components/posts/ad-review";
import BlogReview, { type PassageLocation } from "@/components/posts/blog-review";
import ContentEditor from "@/components/posts/content-editor";
import EventTimeline from "@/components/posts/event-timeline";
import { AdsExportButton, BlogExportButtons } from "@/components/posts/export-buttons";
import {
  FORMAT_LABELS,
  KIND_NOUNS,
  formatDateTime,
  formatMoment,
  isEditable,
  personName,
  timeZoneAbbr,
  toLocalParts,
} from "@/components/posts/helpers";
import { KindBadge, KindStatusBadge } from "@/components/posts/kind-badge";
import PostActions from "@/components/posts/post-actions";
import PostEditor from "@/components/posts/post-editor";
import PostReview, {
  type AssistantItemView,
  type ReviewCommentView,
  type ReviewSessionView,
} from "@/components/posts/post-review";
import VersionHistory, { type VersionHistoryEntry } from "@/components/posts/version-history";
import PostSharePanel from "@/components/share/post-share-panel";
import { AD_PLATFORM_LABELS, coerceAdContent, validateAdsForReview, variantDisplayName } from "@/lib/content/ads";
import {
  coerceBlogContent,
  formatReadingTime,
  locateAnchors,
  readingTime,
  renderMarkdownSafe,
  validateBlogForReview,
  wordCount,
} from "@/lib/content/blog";
import type { AdContent, BlogContent } from "@/lib/content/types";
import { prisma } from "@/lib/db/client";
import { KIND_CONFIG, NETWORK_FORMATS, NETWORK_LABELS, isNetwork, parseMediaItems } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { getNetworkFormat, validateForNetworks } from "@/lib/metricool/payload";
import {
  diffVersions,
  effectiveLastSubmittedVersion,
  getPostForWorkspace,
  parseVersionSchedule,
  readBlogAnchor,
  summarizeVersionDiff,
} from "@/lib/posts";
import { parseActionItems } from "@/lib/review-assistant/shared";
import { isClaim } from "@/lib/scheduling";
import { enabledKinds, postsHref, productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

const PAGE_TITLES: Record<ContentKind, string> = { SOCIAL_POST: "Post", BLOG_ARTICLE: "Articolo", AD_CREATIVE: "Creatività" };

export async function generateMetadata() {
  const kinds = enabledKinds();
  return { title: `${kinds.length === 1 ? PAGE_TITLES[kinds[0]] : "Contenuto"} - ${productName()}` };
}

const TABS = [
  { id: "revisione", label: "Revisione" },
  { id: "modifica", label: "Modifica" },
  { id: "versioni", label: "Versioni" },
  { id: "attivita", label: "Attività" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** "Tutti i post" / "Tutti gli articoli" / "Tutte le creatività", back to the kind's list. */
const BACK_LABELS: Record<ContentKind, string> = {
  SOCIAL_POST: "Tutti i post",
  BLOG_ARTICLE: "Tutti gli articoli",
  AD_CREATIVE: "Tutte le creatività",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function loadPost(id: string, workspaceId: string) {
  try {
    return await getPostForWorkspace(id, workspaceId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function meta(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** "7 ottobre 2026" in the client's zone (article header). */
function longDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone }).format(value);
}

function variantCountLabel(count: number): string {
  return count === 1 ? "1 variante" : `${count} varianti`;
}

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; inviato?: string | string[]; salvato?: string | string[] }>;
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const [{ id }, query] = await Promise.all([params, searchParams]);

  const workspaceId = context.workspaceId;
  // Kinds this instance does not handle are not found.
  const post = await loadPost(id, workspaceId);

  const kind = post.kind;
  const internal = KIND_CONFIG[kind].internal;
  const noun = KIND_NOUNS[kind];
  const multiKind = enabledKinds().length > 1;
  const client = post.client;
  const timezone = client.timezone;
  const networks = post.networks.filter(isNetwork);
  const versions = post.versions; // newest first
  const current = versions.find((v) => v.number === post.currentVersionNumber) ?? versions[0];
  const currentMedia = current ? parseMediaItems(current.media) : [];
  const blogContent: BlogContent | null = kind === "BLOG_ARTICLE" ? coerceBlogContent(current?.content) : null;
  const adContent: AdContent | null = kind === "AD_CREATIVE" ? coerceAdContent(current?.content) : null;

  // Which versions the client has been sent / has approved (from the audit log).
  const submittedNumbers = post.events
    .filter((e) => e.type === "SUBMITTED_FOR_REVIEW" && e.versionNumber !== null)
    .map((e) => e.versionNumber as number);
  const lastSubmitted = effectiveLastSubmittedVersion(
    submittedNumbers.length > 0 ? Math.max(...submittedNumbers) : null,
    post.submittedAt,
    post.currentVersionNumber
  );
  const approvedEvents = post.events.filter((e) => e.type === "APPROVED" && e.versionNumber !== null);
  const approvedNumbers = new Set(approvedEvents.map((e) => e.versionNumber as number));
  const lastApprovedVersion = approvedEvents.length > 0 ? (approvedEvents[approvedEvents.length - 1].versionNumber as number) : null;
  const hasBeenSubmitted = lastSubmitted !== null;
  const isApproved = post.status === "APPROVED" || post.status === "DELIVERED";
  const deliveredEvent = [...post.events].reverse().find((e) => e.type === "DELIVERED") ?? null;

  const requestedTab = first(query.tab);
  const tab: TabId = TABS.some((t) => t.id === requestedTab)
    ? (requestedTab as TabId)
    : post.status === "DRAFT" && !hasBeenSubmitted
      ? "modifica"
      : "revisione";

  // Open points that block sending to the client (the same checks lib/posts applies on submit).
  const issueCount = !current
    ? 0
    : blogContent
      ? validateBlogForReview(blogContent).length
      : adContent
        ? validateAdsForReview(adContent).length
        : validateForNetworks({
            networks: post.networks,
            networkOptions: post.networkOptions,
            text: current.text,
            firstCommentText: current.firstCommentText,
            media: currentMedia,
            publishAt: post.publishAt,
            timezone,
          }).length;

  const activeReviewers = await prisma.clientReviewer.count({ where: { clientId: client.id, active: true } });

  const versionNumberById = new Map(versions.map((v) => [v.id, v.number]));
  const openClientComments = post.comments.filter((c) => c.authorType === "CLIENT" && c.resolvedAt === null);

  // Ads: the client's decisions (every version) and how many variants of the approved version were approved.
  const decisions: AdDecisionView[] = post.creativeDecisions.map((d) => ({
    versionNumber: d.versionNumber,
    variantId: d.variantId,
    verdict: d.verdict,
    note: d.note,
    reviewerName: personName(d.reviewer, "Cliente"),
    decidedAt: d.updatedAt,
  }));
  const approvedVariantCount = (() => {
    if (kind !== "AD_CREATIVE") return 0;
    const number = lastApprovedVersion ?? post.currentVersionNumber;
    const version = versions.find((v) => v.number === number);
    const ids = new Set(coerceAdContent(version?.content).variants.map((v) => v.id));
    return decisions.filter((d) => d.versionNumber === number && d.verdict === "APPROVED" && ids.has(d.variantId)).length;
  })();
  const rejectedNow = adContent
    ? decisions.filter(
        (d) =>
          d.versionNumber === post.currentVersionNumber &&
          d.verdict === "REJECTED" &&
          adContent.variants.some((v) => v.id === d.variantId)
      ).length
    : 0;

  const metricoolId = post.metricoolPostId && !isClaim(post.metricoolPostId) ? post.metricoolPostId : null;
  const notice =
    first(query.inviato) === "1"
      ? kind === "SOCIAL_POST"
        ? "Post creato e pronto per il cliente: condividi il link qui sotto."
        : `${noun.It} è stato creato ed è pronto per il cliente: condividi il link qui sotto.`
      : first(query.inviato) === "errore"
        ? "Bozza salvata, ma l'invio al cliente non è riuscito: riprova con Invia in revisione."
        : first(query.salvato) === "1"
          ? "Bozza salvata."
          : null;
  const showSharePanel =
    !client.archivedAt &&
    (post.status === "DRAFT" || post.status === "IN_REVIEW" || post.status === "CHANGES_REQUESTED");

  return (
    <div className="space-y-5">
      <Link href={postsHref(kind)} className="text-sm text-muted hover:text-foreground">
        ← {BACK_LABELS[kind]}
      </Link>

      {/* ── Header ── */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {multiKind && <KindBadge kind={kind} className="mb-1" />}
            <h2 className="break-words text-xl font-semibold">{post.title}</h2>
            <p className="mt-1 text-sm text-muted">
              <Link href={`/clients/${client.id}`} className="hover:text-foreground hover:underline">
                {client.name}
              </Link>
              {client.archivedAt ? " (archiviato)" : ""} · versione {post.currentVersionNumber}
              {post.createdBy ? ` · creato da ${personName(post.createdBy)}` : ""}
            </p>
          </div>
          <KindStatusBadge kind={kind} status={post.status} />
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">{KIND_CONFIG[kind].dateLabel}</dt>
            <dd>
              {formatDateTime(post.publishAt, timezone)}{" "}
              <span className="text-muted">
                ({timezone}, {timeZoneAbbr(timezone, post.publishAt)})
              </span>
            </dd>
          </div>
          {kind === "SOCIAL_POST" && (
            <div>
              <dt className="text-xs text-muted">Reti</dt>
              <dd>
                {networks.length === 0
                  ? "—"
                  : networks
                      .map((n) => {
                        const format = NETWORK_FORMATS[n] ? getNetworkFormat(n, post.networkOptions) : undefined;
                        return format ? `${NETWORK_LABELS[n]} (${FORMAT_LABELS[format] ?? format})` : NETWORK_LABELS[n];
                      })
                      .join(", ")}
              </dd>
            </div>
          )}
          {blogContent && (
            <div>
              <dt className="text-xs text-muted">Articolo</dt>
              <dd className="break-words">
                {blogContent.slug ? <span className="font-mono text-xs">/{blogContent.slug}</span> : "Indirizzo da scegliere"}
                <span className="text-muted">
                  {" "}
                  · {wordCount(blogContent.bodyMarkdown)} parole · {formatReadingTime(readingTime(blogContent.bodyMarkdown))}
                </span>
              </dd>
            </div>
          )}
          {adContent && (
            <div>
              <dt className="text-xs text-muted">Campagna</dt>
              <dd className="break-words">
                {adContent.campaign.name || "—"}
                <span className="text-muted">
                  {" "}
                  · {AD_PLATFORM_LABELS[adContent.campaign.platform]} · {variantCountLabel(adContent.variants.length)}
                </span>
              </dd>
            </div>
          )}
          {post.reviewDueAt && post.status === "IN_REVIEW" && (
            <div>
              <dt className="text-xs text-muted">Risposta attesa entro</dt>
              <dd>{formatDateTime(post.reviewDueAt, timezone)}</dd>
            </div>
          )}
          {metricoolId && (
            <div>
              <dt className="text-xs text-muted">ID Metricool</dt>
              <dd className="font-mono text-xs">{metricoolId}</dd>
            </div>
          )}
          {post.scheduledAt && post.status === "SCHEDULED" && (
            <div>
              <dt className="text-xs text-muted">Programmato il</dt>
              <dd>{formatDateTime(post.scheduledAt, timezone)}</dd>
            </div>
          )}
          {post.status === "DELIVERED" && deliveredEvent && (
            <div>
              <dt className="text-xs text-muted">{KIND_CONFIG[kind].deliveredLabel} il</dt>
              <dd>
                {formatDateTime(deliveredEvent.createdAt, timezone)}
                {deliveredEvent.user ? <span className="text-muted"> · {personName(deliveredEvent.user)}</span> : null}
              </dd>
            </div>
          )}
        </dl>

        {post.status === "FAILED" && (
          <div className="panel rounded p-4 text-sm">
            <p className="font-medium text-error">Programmazione su Metricool non riuscita</p>
            {post.lastError && <p className="mt-1 whitespace-pre-wrap break-words">{post.lastError}</p>}
            <p className="mt-1 text-muted">
              Se il problema è nel contenuto, correggilo in Modifica (il cliente dovrà riapprovarlo); altrimenti usa Riprova.
            </p>
          </div>
        )}
        {post.status === "CHANGES_REQUESTED" && (
          <div className="panel rounded p-4 text-sm">
            <span className="text-warning">
              {kind === "AD_CREATIVE" && rejectedNow > 0
                ? `Il cliente ha scartato ${rejectedNow === 1 ? "una variante" : `${rejectedNow} varianti`}.`
                : "Il cliente ha chiesto modifiche."}
            </span>{" "}
            <span className="text-muted">
              {kind === "AD_CREATIVE"
                ? "Leggi le note e i commenti in Revisione, prepara la nuova versione in Modifica e inviala di nuovo."
                : "Leggi i commenti, prepara la nuova versione in Modifica e inviala di nuovo in revisione."}
            </span>
          </div>
        )}
        {post.status === "APPROVED" && kind === "SOCIAL_POST" && (
          <div className="panel rounded p-4 text-sm text-muted">
            {!client.metricoolBlogId
              ? "Approvato. Il cliente non ha un brand Metricool collegato: collegalo nella scheda del cliente, poi usa Programma ora."
              : client.autoSchedule
                ? "Approvato: verrà programmato su Metricool automaticamente entro pochi minuti."
                : "Approvato. Questo cliente ha la programmazione manuale: usa Programma ora."}
          </div>
        )}
        {post.status === "APPROVED" && kind === "BLOG_ARTICLE" && (
          <div className="panel rounded p-4 text-sm text-muted">
            <span className="text-success">Approvato dal cliente.</span> Scarica l&apos;articolo qui sotto, pubblicalo sul
            sito del cliente e poi usa «Segna come pubblicato».
          </div>
        )}
        {post.status === "APPROVED" && kind === "AD_CREATIVE" && (
          <div className="panel rounded p-4 text-sm text-muted">
            <span className="text-success">
              Approvato dal cliente: {variantCountLabel(approvedVariantCount)}{" "}
              {approvedVariantCount === 1 ? "approvata" : "approvate"}.
            </span>{" "}
            Scarica il pacchetto, carica le creatività nella campagna e poi usa «Segna come consegnato».
          </div>
        )}
        {post.status === "SCHEDULING" && (
          <div className="panel rounded p-4 text-sm text-muted">
            Programmazione su Metricool in corso: ricarica la pagina tra qualche secondo.
          </div>
        )}

        <PostActions
          postId={post.id}
          status={post.status}
          timezone={timezone}
          issueCount={issueCount}
          activeReviewers={activeReviewers}
          hasMetricoolBrand={Boolean(client.metricoolBlogId)}
          kind={kind}
        />
        {notice && <p className="text-sm text-success">{notice}</p>}

        {showSharePanel && (
          <PostSharePanel
            workspaceId={workspaceId}
            post={{ id: post.id, title: post.title, kind, status: post.status }}
            client={{ id: client.id, name: client.name, archivedAt: client.archivedAt }}
          />
        )}

        {internal && post.status !== "CANCELLED" && (blogContent ? hasBeenSubmitted || isApproved : true) && (
          <section className="panel space-y-2 rounded p-4" aria-label="Esporta">
            <h3 className="text-sm font-semibold">{kind === "BLOG_ARTICLE" ? "Esporta l'articolo" : "Pacchetto per la campagna"}</h3>
            {kind === "BLOG_ARTICLE" ? (
              <BlogExportButtons postId={post.id} approved={isApproved} approvedVersion={lastApprovedVersion} />
            ) : (
              <AdsExportButton postId={post.id} approved={isApproved} approvedVariants={approvedVariantCount} />
            )}
          </section>
        )}
      </header>

      {/* ── Tabs ── */}
      <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Sezioni">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/posts/${post.id}?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
            {t.id === "revisione" && openClientComments.length > 0 ? ` (${openClientComments.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "revisione" && renderReview()}
      {tab === "modifica" && (await renderEditor())}
      {tab === "versioni" && renderVersions()}
      {tab === "attivita" && (
        <EventTimeline
          timezone={timezone}
          kind={kind}
          events={post.events.map((e) => ({
            id: e.id,
            type: e.type,
            versionNumber: e.versionNumber,
            metadata: e.metadata,
            createdAt: e.createdAt,
            user: e.user,
            reviewer: e.reviewer,
          }))}
        />
      )}
    </div>
  );

  // ── Tab bodies ──

  function reviewComments(): ReviewCommentView[] {
    return post.comments.map((c) => ({
      id: c.id,
      versionId: c.versionId,
      versionNumber: c.versionId ? (versionNumberById.get(c.versionId) ?? null) : null,
      authorType: c.authorType,
      authorName: c.authorType === "CLIENT" ? personName(c.reviewer, "Cliente") : personName(c.user, "Agenzia"),
      body: c.body,
      mediaIndex: c.mediaIndex,
      pinX: c.pinX,
      pinY: c.pinY,
      timeSec: c.timeSec,
      timeEndSec: c.timeEndSec,
      resolvedAt: c.resolvedAt,
      createdAt: c.createdAt,
      anchor: readBlogAnchor(c.anchor),
      variantId: c.variantId,
    }));
  }

  function reviewSessions(): ReviewSessionView[] {
    return post.reviewSessions.map((s) => ({
      id: s.id,
      status: s.status,
      versionNumber: s.versionNumber,
      verdict: s.verdict,
      summary: s.summary,
      actionItems: s.actionItems,
      model: s.model,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      reviewerName: personName(s.reviewer, "Cliente"),
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        inputMode: m.inputMode,
        createdAt: m.createdAt,
      })),
    }));
  }

  function renderReview() {
    const comments = reviewComments();
    const sessions = reviewSessions();
    // Default to the version the client is looking at (or the draft if never sent).
    const initialVersion =
      lastSubmitted !== null ? Math.min(post.currentVersionNumber, lastSubmitted) : post.currentVersionNumber;
    const canComment = post.status !== "CANCELLED";
    const sent = (number: number) => lastSubmitted !== null && number <= lastSubmitted;

    if (kind === "BLOG_ARTICLE") {
      const blogVersions = versions.map((v) => {
        const content = coerceBlogContent(v.content);
        return { id: v.id, number: v.number, content, html: renderMarkdownSafe(content.bodyMarkdown), sent: sent(v.number) };
      });
      // Where each passage comment sits in each version from its own one on
      // (reading order, "testo cambiato"): open notes of an earlier version
      // are re-anchored on the later texts.
      const passages: Record<string, Record<string, PassageLocation>> = {};
      for (const version of blogVersions) {
        const located = locateAnchors(
          version.html,
          comments
            .filter((c) => c.anchor && c.versionNumber !== null && c.versionNumber <= version.number)
            .filter((c) => c.versionId === version.id || c.resolvedAt === null)
            .map((c) => ({ id: c.id, anchor: c.anchor ?? null }))
        );
        const forVersion: Record<string, PassageLocation> = {};
        for (const [commentId, place] of located) {
          forVersion[commentId] = { status: place.status, start: place.match?.start ?? null };
        }
        passages[version.id] = forVersion;
      }
      return (
        <BlogReview
          postId={post.id}
          timezone={timezone}
          versions={blogVersions}
          initialVersionNumber={initialVersion}
          comments={comments}
          passages={passages}
          sessions={sessions}
          dateLabel={longDate(post.publishAt, timezone)}
          canComment={canComment}
        />
      );
    }

    if (kind === "AD_CREATIVE") {
      return (
        <AdReview
          postId={post.id}
          timezone={timezone}
          accountName={client.name}
          accountAvatarUrl={client.logoUrl}
          versions={versions.map((v) => ({
            id: v.id,
            number: v.number,
            content: coerceAdContent(v.content),
            sent: sent(v.number),
          }))}
          initialVersionNumber={initialVersion}
          comments={comments}
          decisions={decisions}
          sessions={sessions}
          canComment={canComment}
        />
      );
    }

    // Timed action items already turned into client comments by requestChanges
    // (actionCommentIds) are shown as those comments, not twice.
    const convertedSessions = new Set(
      post.events
        .filter((e) => e.type === "CHANGES_REQUESTED")
        .map((e) => meta(e.metadata))
        .filter((m) => typeof m.reviewSessionId === "string" && Array.isArray(m.actionCommentIds))
        .map((m) => m.reviewSessionId as string)
    );
    const assistantItems: AssistantItemView[] = post.reviewSessions
      .filter((s) => !convertedSessions.has(s.id))
      .flatMap((s) =>
        parseActionItems(s.actionItems).flatMap((item, i) =>
          item.timeSec === null
            ? []
            : [
                {
                  id: `${s.id}-${i}`,
                  sessionId: s.id,
                  versionNumber: s.versionNumber,
                  mediaIndex: item.mediaIndex,
                  timeSec: item.timeSec,
                  timeEndSec: item.timeEndSec,
                  request: item.request,
                  reviewerName: personName(s.reviewer, "Cliente"),
                },
              ]
        )
      );

    return (
      <PostReview
        postId={post.id}
        networks={networks}
        networkOptions={post.networkOptions}
        accountName={client.name}
        accountAvatarUrl={client.logoUrl}
        publishAt={post.publishAt}
        timezone={timezone}
        versions={versions.map((v) => {
          const schedule = v.number === post.currentVersionNumber ? null : parseVersionSchedule(v.schedule);
          return {
            id: v.id,
            number: v.number,
            text: v.text,
            firstCommentText: v.firstCommentText,
            media: parseMediaItems(v.media),
            networks: schedule ? schedule.networks.filter(isNetwork) : networks,
            networkOptions: schedule?.networkOptions ?? post.networkOptions,
            publishAt: schedule?.publishAt ?? post.publishAt,
            sent: sent(v.number),
            createdAt: v.createdAt,
          };
        })}
        initialVersionNumber={initialVersion}
        comments={comments}
        assistantItems={assistantItems}
        sessions={sessions}
        canComment={canComment}
      />
    );
  }

  /** Where an open client comment points, for the list above the editor. */
  function commentPlace(c: (typeof openClientComments)[number]): string {
    const anchor = readBlogAnchor(c.anchor);
    const version = c.versionId ? ` · v${versionNumberById.get(c.versionId) ?? "?"}` : "";
    if (anchor) {
      const quote = anchor.quote.length > 60 ? `${anchor.quote.slice(0, 60)}…` : anchor.quote;
      return `«${quote}»${version}`;
    }
    const variant = c.variantId ? adContent?.variants.find((v) => v.id === c.variantId) : undefined;
    const variantName = c.variantId ? `${variant ? variantDisplayName(variant) : `Variante ${c.variantId}`} · ` : "";
    const spot =
      c.timeSec !== null
        ? formatMoment(c.timeSec, c.timeEndSec)
        : c.mediaIndex !== null
          ? `Media ${c.mediaIndex + 1}`
          : "Generale";
    return `${variantName}${spot}${version}`;
  }

  async function renderEditor() {
    // Other clients only when they have this kind's service; the post's own
    // client always (its service may have been removed since).
    const clients = (await loadEditorClients(workspaceId, client.id)).filter(
      (c) => c.id === client.id || c.services.includes(kind)
    );
    const local = toLocalParts(post.publishAt, timezone);
    const editable = isEditable(post.status);
    const readOnlyReason =
      post.status === "SCHEDULED"
        ? "Il post è già programmato su Metricool e non si può modificare da qui: modificalo su Metricool, oppure annullalo lì e crea un nuovo post."
        : post.status === "SCHEDULING"
          ? "Programmazione in corso: il post non si può modificare."
          : post.status === "DELIVERED"
            ? `${noun.It} è già stato segnato come ${KIND_CONFIG[kind].deliveredLabel.toLowerCase()} e non si può modificare.`
            : post.status === "CANCELLED"
              ? `${noun.It} è stato annullato e non si può modificare.`
              : undefined;
    // A note typed for a revision not sent yet is kept; a sent version's note is not reused.
    const changeNote =
      current && lastSubmitted !== null && current.number > lastSubmitted ? (current.changeNote ?? "") : "";

    return (
      <div className="space-y-5">
        {openClientComments.length > 0 && (
          <section className="panel rounded p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Commenti aperti del cliente ({openClientComments.length})</h3>
              <Link href={`/posts/${post.id}?tab=revisione`} className="text-xs text-accent hover:underline">
                Rispondi o segna come risolti
              </Link>
            </div>
            <ul className="mt-2 space-y-2 text-sm">
              {[...openClientComments]
                .sort((a, b) =>
                  a.timeSec !== null && b.timeSec !== null
                    ? a.timeSec - b.timeSec
                    : a.timeSec !== null
                      ? -1
                      : b.timeSec !== null
                        ? 1
                        : a.createdAt.getTime() - b.createdAt.getTime()
                )
                .map((c) => (
                  <li key={c.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <span className="shrink-0 text-xs text-muted sm:max-w-[45%] sm:truncate">{commentPlace(c)}</span>
                    <span className="min-w-0 whitespace-pre-wrap break-words">{c.body}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {kind === "BLOG_ARTICLE" || kind === "AD_CREATIVE" ? (
          <ContentEditor
            kind={kind}
            mode="edit"
            postId={post.id}
            status={post.status}
            hasBeenSubmitted={hasBeenSubmitted}
            clients={clients}
            readOnly={!editable}
            readOnlyReason={readOnlyReason}
            initial={{
              clientId: client.id,
              title: post.title,
              date: local.date,
              time: local.time,
              content: (blogContent ?? adContent) as BlogContent | AdContent,
              changeNote,
            }}
          />
        ) : (
          <PostEditor
            mode="edit"
            postId={post.id}
            status={post.status}
            hasBeenSubmitted={hasBeenSubmitted}
            clients={clients}
            readOnly={!editable}
            readOnlyReason={readOnlyReason}
            initial={{
              clientId: client.id,
              title: post.title,
              date: local.date,
              time: local.time,
              networks,
              networkOptions: toNetworkOptions(post.networkOptions),
              text: current?.text ?? "",
              firstCommentText: current?.firstCommentText ?? "",
              media: currentMedia,
              videoCoverMs: current?.videoCoverMs ?? null,
              changeNote,
            }}
          />
        )}
      </div>
    );
  }

  function renderVersions() {
    const ascending = [...versions].sort((a, b) => a.number - b.number);
    const entries: VersionHistoryEntry[] = ascending.map((v, i) => {
      const previous = i > 0 ? ascending[i - 1] : null;
      const content = {
        text: v.text,
        firstCommentText: v.firstCommentText,
        media: parseMediaItems(v.media),
        videoCoverMs: v.videoCoverMs,
        schedule: parseVersionSchedule(v.schedule),
        ...(internal ? { content: v.content ?? {} } : {}),
      };
      const diff = previous
        ? diffVersions(
            {
              text: previous.text,
              firstCommentText: previous.firstCommentText,
              media: parseMediaItems(previous.media),
              videoCoverMs: previous.videoCoverMs,
              schedule: parseVersionSchedule(previous.schedule),
              ...(internal ? { content: previous.content ?? {} } : {}),
            },
            content,
            kind
          )
        : null;

      const base: VersionHistoryEntry = {
        id: v.id,
        number: v.number,
        createdAt: v.createdAt,
        authorName: v.createdBy ? personName(v.createdBy) : null,
        changeNote: v.changeNote,
        sent: lastSubmitted !== null && v.number <= lastSubmitted,
        approved: approvedNumbers.has(v.number),
        isCurrent: v.number === post.currentVersionNumber,
        changes: diff ? summarizeVersionDiff(diff) : [],
        textDiff: diff?.text ?? [],
        firstCommentDiff: diff?.firstComment ?? [],
        text: v.text,
        mediaCount: content.media.length,
      };

      if (kind === "BLOG_ARTICLE") {
        const after = coerceBlogContent(v.content);
        return {
          ...base,
          // The body diff says it better than "Testo modificato".
          textDiff: [],
          summaryLabel: `${wordCount(after.bodyMarkdown)} parole`,
          ...(previous
            ? {
                detail: (
                  <BlogVersionDiff
                    before={coerceBlogContent(previous.content)}
                    after={after}
                    fromLabel={`versione ${previous.number}`}
                    toLabel={`versione ${v.number}`}
                    showMarkdown
                  />
                ),
                detailLabel: "Differenze parola per parola",
              }
            : {}),
        };
      }
      if (kind === "AD_CREATIVE") {
        const after = coerceAdContent(v.content);
        const versionDecisions = decisions.filter((d) => d.versionNumber === v.number);
        return {
          ...base,
          textDiff: [],
          summaryLabel: variantCountLabel(after.variants.length),
          ...(versionDecisions.length > 0
            ? {
                detail: (
                  <ul className="space-y-1 text-sm">
                    {after.variants.map((variant) => {
                      const decision = versionDecisions.find((d) => d.variantId === variant.id);
                      return (
                        <li key={variant.id} className="flex flex-wrap gap-x-2">
                          <span className="font-medium">{variantDisplayName(variant)}:</span>
                          <span
                            className={
                              decision?.verdict === "APPROVED"
                                ? "text-success"
                                : decision?.verdict === "REJECTED"
                                  ? "text-error"
                                  : "text-muted"
                            }
                          >
                            {decision?.verdict === "APPROVED"
                              ? "approvata"
                              : decision?.verdict === "REJECTED"
                                ? "scartata"
                                : "nessuna decisione"}
                          </span>
                          {decision?.note && <span className="min-w-0 break-words text-muted">«{decision.note}»</span>}
                        </li>
                      );
                    })}
                  </ul>
                ),
                detailLabel: "Decisioni del cliente su questa versione",
              }
            : {}),
        };
      }
      return base;
    });
    return <VersionHistory versions={entries.reverse()} timezone={timezone} />;
  }
}
