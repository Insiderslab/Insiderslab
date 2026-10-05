/**
 * Post Detail Page
 *
 * Header with status, publication date in the client's time zone, networks
 * and the actions the state machine allows; Metricool outcome (id or error).
 * Four tabs:
 * - Revisione: preview with pins and video markers, video notes by moment,
 *   comment threads (reply / resolve), assistant transcripts;
 * - Modifica: the editor (read-only once scheduled or cancelled);
 * - Versioni: history with the diff of the text;
 * - Attività: the audit log in Italian.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadEditorClients, toNetworkOptions } from "@/app/(dashboard)/posts/data";
import EventTimeline from "@/components/posts/event-timeline";
import {
  FORMAT_LABELS,
  formatDateTime,
  formatMoment,
  isEditable,
  personName,
  timeZoneAbbr,
  toLocalParts,
} from "@/components/posts/helpers";
import PostActions from "@/components/posts/post-actions";
import PostEditor from "@/components/posts/post-editor";
import PostReview, {
  type AssistantItemView,
  type ReviewCommentView,
  type ReviewSessionView,
} from "@/components/posts/post-review";
import VersionHistory, { type VersionHistoryEntry } from "@/components/posts/version-history";
import StatusBadge from "@/components/status-badge";
import { prisma } from "@/lib/db/client";
import { NETWORK_FORMATS, NETWORK_LABELS, isNetwork, parseMediaItems } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { getNetworkFormat, validateForNetworks } from "@/lib/metricool/payload";
import {
  diffVersions,
  effectiveLastSubmittedVersion,
  getPostForWorkspace,
  parseVersionSchedule,
  summarizeVersionDiff,
} from "@/lib/posts";
import { parseActionItems } from "@/lib/review-assistant/shared";
import { isClaim } from "@/lib/scheduling";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const metadata = { title: "Post - Approve by Heili" };

const TABS = [
  { id: "revisione", label: "Revisione" },
  { id: "modifica", label: "Modifica" },
  { id: "versioni", label: "Versioni" },
  { id: "attivita", label: "Attività" },
] as const;

type TabId = (typeof TABS)[number]["id"];

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
  const post = await loadPost(id, workspaceId);

  const client = post.client;
  const timezone = client.timezone;
  const networks = post.networks.filter(isNetwork);
  const versions = post.versions; // newest first
  const current = versions.find((v) => v.number === post.currentVersionNumber) ?? versions[0];
  const currentMedia = current ? parseMediaItems(current.media) : [];

  // Which versions the client has been sent / has approved (from the audit log).
  const submittedNumbers = post.events
    .filter((e) => e.type === "SUBMITTED_FOR_REVIEW" && e.versionNumber !== null)
    .map((e) => e.versionNumber as number);
  const lastSubmitted = effectiveLastSubmittedVersion(
    submittedNumbers.length > 0 ? Math.max(...submittedNumbers) : null,
    post.submittedAt,
    post.currentVersionNumber
  );
  const approvedNumbers = new Set(
    post.events.filter((e) => e.type === "APPROVED" && e.versionNumber !== null).map((e) => e.versionNumber as number)
  );
  const hasBeenSubmitted = lastSubmitted !== null;

  const requestedTab = first(query.tab);
  const tab: TabId = TABS.some((t) => t.id === requestedTab)
    ? (requestedTab as TabId)
    : post.status === "DRAFT" && !hasBeenSubmitted
      ? "modifica"
      : "revisione";

  const issues = current
    ? validateForNetworks({
        networks: post.networks,
        networkOptions: post.networkOptions,
        text: current.text,
        firstCommentText: current.firstCommentText,
        media: currentMedia,
        publishAt: post.publishAt,
        timezone,
      })
    : [];

  const activeReviewers = await prisma.clientReviewer.count({ where: { clientId: client.id, active: true } });

  const versionNumberById = new Map(versions.map((v) => [v.id, v.number]));
  const openClientComments = post.comments.filter(
    (c) => c.authorType === "CLIENT" && c.resolvedAt === null
  );

  const metricoolId = post.metricoolPostId && !isClaim(post.metricoolPostId) ? post.metricoolPostId : null;
  const notice =
    first(query.inviato) === "1"
      ? "Post creato e inviato in revisione."
      : first(query.inviato) === "errore"
        ? "Bozza salvata, ma l'invio al cliente non è riuscito: riprova con Invia in revisione."
        : first(query.salvato) === "1"
          ? "Bozza salvata."
          : null;

  return (
    <div className="space-y-5">
      <Link href="/posts" className="text-sm text-muted hover:text-foreground">
        ← Tutti i post
      </Link>

      {/* ── Header ── */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold">{post.title}</h2>
            <p className="mt-1 text-sm text-muted">
              <Link href={`/clients/${client.id}`} className="hover:text-foreground hover:underline">
                {client.name}
              </Link>
              {client.archivedAt ? " (archiviato)" : ""} · versione {post.currentVersionNumber}
              {post.createdBy ? ` · creato da ${personName(post.createdBy)}` : ""}
            </p>
          </div>
          <StatusBadge status={post.status} />
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Pubblicazione</dt>
            <dd>
              {formatDateTime(post.publishAt, timezone)}{" "}
              <span className="text-muted">
                ({timezone}, {timeZoneAbbr(timezone, post.publishAt)})
              </span>
            </dd>
          </div>
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
            <span className="text-warning">Il cliente ha chiesto modifiche.</span>{" "}
            <span className="text-muted">
              Leggi i commenti, prepara la nuova versione in Modifica e inviala di nuovo in revisione.
            </span>
          </div>
        )}
        {post.status === "APPROVED" && (
          <div className="panel rounded p-4 text-sm text-muted">
            {!client.metricoolBlogId
              ? "Approvato. Il cliente non ha un brand Metricool collegato: collegalo nella scheda del cliente, poi usa Programma ora."
              : client.autoSchedule
                ? "Approvato: verrà programmato su Metricool automaticamente entro pochi minuti."
                : "Approvato. Questo cliente ha la programmazione manuale: usa Programma ora."}
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
          issueCount={issues.length}
          activeReviewers={activeReviewers}
          hasMetricoolBrand={Boolean(client.metricoolBlogId)}
        />
        {notice && <p className="text-sm text-success">{notice}</p>}
      </header>

      {/* ── Tabs ── */}
      <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Sezioni del post">
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

  function renderReview() {
    const comments: ReviewCommentView[] = post.comments.map((c) => ({
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
    }));

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

    const sessions: ReviewSessionView[] = post.reviewSessions.map((s) => ({
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

    // Default to the version the client is looking at (or the draft if never sent).
    const initialVersion =
      lastSubmitted !== null ? Math.min(post.currentVersionNumber, lastSubmitted) : post.currentVersionNumber;

    return (
      <PostReview
        postId={post.id}
        networks={networks}
        networkOptions={post.networkOptions}
        accountName={client.name}
        accountAvatarUrl={client.logoUrl}
        publishAt={post.publishAt}
        timezone={timezone}
        versions={versions.map((v) => ({
          id: v.id,
          number: v.number,
          text: v.text,
          firstCommentText: v.firstCommentText,
          media: parseMediaItems(v.media),
          sent: lastSubmitted !== null && v.number <= lastSubmitted,
          createdAt: v.createdAt,
        }))}
        initialVersionNumber={initialVersion}
        comments={comments}
        assistantItems={assistantItems}
        sessions={sessions}
        canComment={post.status !== "CANCELLED"}
      />
    );
  }

  async function renderEditor() {
    const clients = await loadEditorClients(workspaceId, client.id);
    const local = toLocalParts(post.publishAt, timezone);
    const editable = isEditable(post.status);
    const readOnlyReason =
      post.status === "SCHEDULED"
        ? "Il post è già programmato su Metricool e non si può modificare da qui: modificalo su Metricool, oppure annullalo lì e crea un nuovo post."
        : post.status === "SCHEDULING"
          ? "Programmazione in corso: il post non si può modificare."
          : post.status === "CANCELLED"
            ? "Il post è annullato e non si può modificare."
            : undefined;

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
                  <li key={c.id} className="flex gap-2">
                    <span className="shrink-0 text-xs text-muted">
                      {c.timeSec !== null
                        ? formatMoment(c.timeSec, c.timeEndSec)
                        : c.mediaIndex !== null
                          ? `Media ${c.mediaIndex + 1}`
                          : "Generale"}
                      {c.versionId ? ` · v${versionNumberById.get(c.versionId) ?? "?"}` : ""}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words">{c.body}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
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
            // A note typed for a revision not sent yet is kept; a sent version's note is not reused.
            changeNote:
              current && lastSubmitted !== null && current.number > lastSubmitted ? (current.changeNote ?? "") : "",
          }}
        />
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
      };
      const diff = previous
        ? diffVersions(
            {
              text: previous.text,
              firstCommentText: previous.firstCommentText,
              media: parseMediaItems(previous.media),
              videoCoverMs: previous.videoCoverMs,
              schedule: parseVersionSchedule(previous.schedule),
            },
            content
          )
        : null;
      return {
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
    });
    return <VersionHistory versions={entries.reverse()} timezone={timezone} />;
  }
}
