/**
 * Email notifications for the review flow.
 *
 * Client side: review requests and reminders go to the client's active
 * reviewers, one email per reviewer listing every post, with their personal
 * link (reviewers without an email are skipped: the agency shares their link
 * by hand). Agency side: outcomes (changes requested, approved, scheduled,
 * failed) go to the workspace OWNER/ADMIN members.
 *
 * Every function catches and logs its own errors: a notification can never
 * break or roll back the action that triggered it.
 *
 * Wording follows the content kind: "un nuovo articolo da approvare",
 * "3 creatività da approvare" (ads count the variants of the sets), and
 * "contenuti" when one email lists several kinds.
 */

import type { Client, ClientReviewer, ContentKind, Post } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { KIND_CONFIG, NETWORK_LABELS, formatTimeRange, isNetwork, type Network } from "@/lib/domain";
import { renderEmail, sendEmail, type EmailListItem } from "@/lib/email";
import { getBaseUrl } from "@/lib/env";
import {
  APPROVED_LIKE,
  byPublishAsc,
  planHeading,
  planOutcomeSummary,
  planShortName,
} from "@/lib/plan-rules";
import { getReviewPlanUrl, getReviewUrl } from "@/lib/reviewers";
import { kindCountPhrase, productName } from "@/lib/variant";

// ─── Formatting (pure) ───────────────────────────────────────────────────────

export function formatPublishDate(date: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("it-IT", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("it-IT", { ...options, timeZone: "Europe/Rome" }).format(date);
  }
}

export function formatNetworks(networks: readonly string[]): string {
  return networks.map((n) => (isNetwork(n) ? NETWORK_LABELS[n as Network] : n)).join(", ");
}

// ─── Content kinds (pure) ────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const AD_PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google Ads",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

/** Variants (id, name) and platform of a stored AdContent, read leniently. */
export function readAdSummary(content: unknown): { variants: Array<{ id: string; name: string }>; platform: string | null } {
  const record = asRecord(content);
  const variants = (Array.isArray(record.variants) ? record.variants : []).flatMap((raw) => {
    const v = asRecord(raw);
    if (typeof v.id !== "string") return [];
    const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : `Variante ${v.id}`;
    return [{ id: v.id, name }];
  });
  const platform = asRecord(record.campaign).platform;
  return { variants, platform: typeof platform === "string" ? (AD_PLATFORM_LABELS[platform] ?? platform) : null };
}

export interface NotifiedPost {
  title: string;
  kind?: ContentKind;
  publishAt: Date;
  networks: string[];
  /** Content of the version being notified (ads: variant count and platform). */
  content?: unknown;
}

function kindOf(post: { kind?: ContentKind }): ContentKind {
  return post.kind ?? "SOCIAL_POST";
}

/** How many "creatività" an ads set counts for (its variants, at least 1). */
function unitsOf(post: NotifiedPost): number {
  return kindOf(post) === "AD_CREATIVE" ? Math.max(1, readAdSummary(post.content).variants.length) : 1;
}

export function postListItem(post: NotifiedPost, timeZone: string): EmailListItem {
  const kind = kindOf(post);
  const date = formatPublishDate(post.publishAt, timeZone);
  if (kind === "SOCIAL_POST") {
    const networks = formatNetworks(post.networks);
    return { title: post.title, detail: `${date}${networks ? ` · ${networks}` : ""}` };
  }
  const parts = [`${KIND_CONFIG[kind].dateLabel}: ${date}`];
  if (kind === "AD_CREATIVE") {
    const { variants, platform } = readAdSummary(post.content);
    parts.push(variants.length === 1 ? "1 variante" : `${variants.length} varianti`);
    if (platform) parts.push(platform);
  }
  return { title: post.title, detail: parts.join(" · ") };
}

type BatchKind = ContentKind | "MIXED";

const BATCH_WORDS: Record<
  BatchKind,
  {
    one: string;
    many: (n: number) => string;
    newOne: string;
    newMany: (n: number) => string;
    heading: string;
    howTo: string;
    cta: [one: string, many: string];
    /** "il post", "l'articolo"… with the verb agreement of the reminder. */
    reminderOne: (title: string) => string;
  }
> = {
  SOCIAL_POST: {
    one: "un post",
    many: (n) => `${n} post`,
    newOne: "Nuovo post",
    newMany: (n) => `${n} nuovi post`,
    heading: "Post da approvare",
    howTo: "Puoi vedere l'anteprima, lasciare commenti e approvare oppure chiedere modifiche.",
    cta: ["Rivedi il post", "Rivedi i post"],
    reminderOne: (title) => `il post "${title}" aspetta la tua revisione`,
  },
  BLOG_ARTICLE: {
    one: "un articolo",
    many: (n) => `${n} articoli`,
    newOne: "Nuovo articolo",
    newMany: (n) => `${n} nuovi articoli`,
    heading: "Articoli da approvare",
    howTo: "Puoi leggere il testo, commentare le singole frasi e approvare oppure chiedere modifiche.",
    cta: ["Leggi l'articolo", "Leggi gli articoli"],
    reminderOne: (title) => `l'articolo "${title}" aspetta la tua revisione`,
  },
  AD_CREATIVE: {
    one: "una creatività",
    many: (n) => `${n} creatività`,
    newOne: "Nuova creatività",
    newMany: (n) => `${n} nuove creatività`,
    heading: "Creatività da approvare",
    howTo: "Puoi vedere le anteprime per posizionamento, approvare o scartare ogni variante e lasciare commenti.",
    cta: ["Rivedi le creatività", "Rivedi le creatività"],
    reminderOne: (title) => `le creatività "${title}" aspettano la tua revisione`,
  },
  MIXED: {
    one: "un contenuto",
    many: (n) => `${n} contenuti`,
    newOne: "Nuovo contenuto",
    newMany: (n) => `${n} nuovi contenuti`,
    heading: "Contenuti da approvare",
    howTo: "Puoi vedere le anteprime, lasciare commenti e approvare oppure chiedere modifiche.",
    cta: ["Rivedi il contenuto", "Rivedi i contenuti"],
    reminderOne: (title) => `"${title}" aspetta la tua revisione`,
  },
};

export interface ReviewEmailCopy {
  subject: string;
  heading: string;
  intro: string;
  ctaLabel: string;
}

/**
 * Subject and wording of a review request / reminder for the posts of one
 * client, by kind: "Nuovo articolo da approvare: …", "3 creatività da
 * approvare: …", and for a batch of several kinds "2 post social e 1
 * articolo da approvare per …" (pure).
 */
export function reviewEmailCopy(
  posts: NotifiedPost[],
  params: { kind: "request" | "reminder"; clientName: string; agencyName: string }
): ReviewEmailCopy {
  const kinds = new Set(posts.map(kindOf));
  const batch: BatchKind = kinds.size === 1 ? [...kinds][0] : "MIXED";
  const words = BATCH_WORDS[batch];
  const units = posts.reduce((sum, post) => sum + unitsOf(post), 0);
  // A mixed batch says what it holds: "2 post social e 1 articolo".
  const mixedPhrase =
    batch === "MIXED"
      ? kindCountPhrase(
          posts.reduce<Partial<Record<ContentKind, number>>>((counts, post) => {
            const kind = kindOf(post);
            counts[kind] = (counts[kind] ?? 0) + unitsOf(post);
            return counts;
          }, {})
        )
      : null;
  const phrase = mixedPhrase ?? (units === 1 ? words.one : words.many(units));
  const single = posts.length === 1 ? posts[0] : null;

  let subject: string;
  if (params.kind === "request") {
    if (single && batch === "AD_CREATIVE" && units > 1) subject = `${words.many(units)} da approvare: ${single.title}`;
    else if (single) subject = `${words.newOne} da approvare: ${single.title}`;
    else if (mixedPhrase) subject = `${mixedPhrase} da approvare per ${params.clientName}`;
    else subject = `${words.newMany(units)} da approvare per ${params.clientName}`;
  } else {
    subject = single
      ? `Promemoria: ${words.reminderOne(single.title)}`
      : `Promemoria: ${phrase} aspettano la tua revisione`;
  }

  const intro =
    params.kind === "request"
      ? `${params.agencyName} ha preparato ${phrase} per ${params.clientName}. ${words.howTo}`
      : `${units === 1 ? `C'è ancora ${phrase}` : `Ci sono ancora ${phrase}`} di ${params.clientName} in attesa della tua revisione.`;

  return {
    subject,
    heading: params.kind === "request" ? words.heading : "Promemoria revisione",
    intro,
    ctaLabel: words.cta[posts.length === 1 ? 0 : 1],
  };
}

/** CTA of agency emails about one item. */
function openLabel(kind: ContentKind): string {
  if (kind === "BLOG_ARTICLE") return "Apri l'articolo";
  if (kind === "AD_CREATIVE") return "Apri le creatività";
  return "Apri il post";
}

/** "al post", "all'articolo", "alle creatività" + title. */
function aboutPost(kind: ContentKind, title: string): string {
  if (kind === "BLOG_ARTICLE") return `all'articolo "${title}"`;
  if (kind === "AD_CREATIVE") return `alle creatività "${title}"`;
  return `al post "${title}"`;
}

function agencyPostUrl(postId: string): string {
  return `${getBaseUrl()}/posts/${postId}`;
}

// ─── Recipients ──────────────────────────────────────────────────────────────

async function getAgencyRecipients(workspaceId: string): Promise<string[]> {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: { in: ["OWNER", "ADMIN"] } },
    select: { user: { select: { email: true } } },
  });
  return members.map((m) => m.user.email).filter((email): email is string => !!email);
}

async function loadPost(postId: string) {
  return prisma.post.findUnique({
    where: { id: postId },
    include: { client: true, workspace: { select: { id: true, name: true } } },
  });
}

async function sendToAgency(
  workspaceId: string,
  subject: string,
  content: Parameters<typeof renderEmail>[0]
): Promise<boolean> {
  const to = await getAgencyRecipients(workspaceId);
  if (to.length === 0) return false;
  const { html, text } = renderEmail(content);
  return (await sendEmail({ to, subject, html, text })).ok;
}

function logFailure(name: string, error: unknown) {
  console.error(`[notifications] ${name} failed:`, error);
}

// ─── Client side ─────────────────────────────────────────────────────────────

type ReviewEmailPost = Pick<Post, "title" | "kind" | "publishAt" | "networks" | "reviewDueAt"> & {
  versions: Array<{ content: unknown }>;
};

/** The latest version is the one sent: posts are listed only while IN_REVIEW. */
const latestVersionContent = { orderBy: { number: "desc" }, take: 1, select: { content: true } } as const;

async function sendReviewEmail(
  reviewer: ClientReviewer,
  client: Client,
  agencyName: string,
  posts: ReviewEmailPost[],
  kind: "request" | "reminder"
): Promise<boolean> {
  // No email: the agency shares the link itself (WhatsApp, message…).
  if (!reviewer.email) return false;
  const notified: NotifiedPost[] = posts.map((p) => ({ ...p, content: p.versions[0]?.content }));
  const copy = reviewEmailCopy(notified, { kind, clientName: client.name, agencyName });

  const dueDates = posts.map((p) => p.reviewDueAt).filter((d): d is Date => !!d);
  const earliestDue = dueDates.length ? new Date(Math.min(...dueDates.map((d) => d.getTime()))) : null;

  const paragraphs = [`Ciao ${reviewer.name},`, copy.intro];
  if (earliestDue) {
    paragraphs.push(`Ti chiediamo una risposta entro ${formatPublishDate(earliestDue, client.timezone)}.`);
  }

  const { html, text } = renderEmail({
    heading: copy.heading,
    paragraphs,
    items: notified.map((p) => postListItem(p, client.timezone)),
    cta: { label: copy.ctaLabel, url: getReviewUrl(reviewer) },
    footer: `Link personale per ${reviewer.name}: non inoltrarlo. Inviato da ${agencyName} con ${productName()}.`,
  });
  const result = await sendEmail({ to: reviewer.email, subject: copy.subject, html, text });
  return result.ok;
}

/**
 * One email per active reviewer, listing all of the given posts of their
 * client that are currently waiting for review.
 */
export async function notifyReviewRequested(postIds: string[]): Promise<void> {
  try {
    if (postIds.length === 0) return;
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds }, status: "IN_REVIEW" },
      orderBy: { publishAt: "asc" },
      include: {
        client: { include: { reviewers: { where: { active: true, email: { not: null } } } } },
        workspace: { select: { name: true } },
        versions: latestVersionContent,
      },
    });

    const byClient = new Map<string, typeof posts>();
    for (const post of posts) {
      const list = byClient.get(post.clientId) ?? [];
      list.push(post);
      byClient.set(post.clientId, list);
    }

    for (const clientPosts of byClient.values()) {
      const { client, workspace } = clientPosts[0];
      if (client.archivedAt) continue;
      for (const reviewer of client.reviewers) {
        try {
          await sendReviewEmail(reviewer, client, workspace.name, clientPosts, "request");
        } catch (error) {
          logFailure(`notifyReviewRequested(reviewer ${reviewer.id})`, error);
        }
      }
    }
  } catch (error) {
    logFailure("notifyReviewRequested", error);
  }
}

/**
 * Reminder for posts still IN_REVIEW: one email per active reviewer of each
 * client, listing all of that client's given posts (like the review request).
 * Returns the ids of the posts included in at least one email that went out.
 */
export async function notifyReviewReminder(postIds: string[]): Promise<Set<string>> {
  const reminded = new Set<string>();
  try {
    if (postIds.length === 0) return reminded;
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds }, status: "IN_REVIEW", client: { archivedAt: null } },
      orderBy: { publishAt: "asc" },
      include: {
        client: { include: { reviewers: { where: { active: true, email: { not: null } } } } },
        workspace: { select: { name: true } },
        versions: latestVersionContent,
      },
    });

    const byClient = new Map<string, typeof posts>();
    for (const post of posts) {
      const list = byClient.get(post.clientId) ?? [];
      list.push(post);
      byClient.set(post.clientId, list);
    }

    for (const clientPosts of byClient.values()) {
      const { client, workspace } = clientPosts[0];
      let sent = false;
      for (const reviewer of client.reviewers) {
        try {
          if (await sendReviewEmail(reviewer, client, workspace.name, clientPosts, "reminder")) sent = true;
        } catch (error) {
          logFailure(`notifyReviewReminder(reviewer ${reviewer.id})`, error);
        }
      }
      if (sent) for (const post of clientPosts) reminded.add(post.id);
    }
  } catch (error) {
    logFailure("notifyReviewReminder", error);
  }
  return reminded;
}

// ─── Agency side ─────────────────────────────────────────────────────────────

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** "0:07", "0:12–0:15", or null when there is no (valid) start time. */
export function formatMoment(timeSec: unknown, timeEndSec?: unknown): string | null {
  if (!isTime(timeSec)) return null;
  return formatTimeRange(timeSec, isTime(timeEndSec) ? timeEndSec : null);
}

interface AssistantActionItem {
  area?: unknown;
  mediaIndex?: unknown;
  timeSec?: unknown;
  timeEndSec?: unknown;
  request?: unknown;
  priority?: unknown;
}

/** True for items that point at a media or a moment of a video. */
function hasLocation(raw: AssistantActionItem): boolean {
  return typeof raw.mediaIndex === "number" || isTime(raw.timeSec);
}

/** "[immagine, media 2, 0:07] Schiarire lo sfondo (priorità: alta)" lines from a review session. */
export function formatActionItems(value: unknown, opts: { onlyUnlocated?: boolean } = {}): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: AssistantActionItem) => {
    if (!raw || typeof raw !== "object" || typeof raw.request !== "string" || !raw.request.trim()) return [];
    if (opts.onlyUnlocated && hasLocation(raw)) return [];
    const area = typeof raw.area === "string" && raw.area ? raw.area : null;
    const media = typeof raw.mediaIndex === "number" ? `media ${raw.mediaIndex + 1}` : null;
    const where = [area, media, formatMoment(raw.timeSec, raw.timeEndSec)].filter(Boolean).join(", ");
    const priority = typeof raw.priority === "string" && raw.priority ? ` (priorità: ${raw.priority})` : "";
    return [`${where ? `[${where}] ` : ""}${raw.request.trim()}${priority}`];
  });
}

export interface NotifiedComment {
  body: string;
  mediaIndex: number | null;
  pinX?: number | null;
  timeSec: number | null;
  timeEndSec: number | null;
  /** Blog: the commented passage ({ quote, … }). */
  anchor?: unknown;
  /** Ads: the commented variant. */
  variantId?: string | null;
}

const MAX_QUOTE_IN_EMAIL = 120;

function anchorQuote(anchor: unknown): string | null {
  const quote = asRecord(anchor).quote;
  if (typeof quote !== "string" || !quote.trim()) return null;
  const text = quote.trim().replace(/\s+/g, " ");
  return text.length > MAX_QUOTE_IN_EMAIL ? `${text.slice(0, MAX_QUOTE_IN_EMAIL - 1).trimEnd()}…` : text;
}

const MAX_COMMENT_IN_EMAIL = 500;

/**
 * Email list entries for client comments: video comments first, in timeline
 * order with their timecode ("Media 1 · 0:07–0:09"), then the others.
 */
export function formatClientComments(
  comments: NotifiedComment[],
  variantNames: ReadonlyMap<string, string> = new Map()
): EmailListItem[] {
  // Stable sort: untimed comments keep their (chronological) order.
  const sorted = [...comments].sort((a, b) => {
    const aTimed = isTime(a.timeSec);
    const bTimed = isTime(b.timeSec);
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    if (!aTimed || !bTimed) return 0;
    return (a.mediaIndex ?? 0) - (b.mediaIndex ?? 0) || (a.timeSec as number) - (b.timeSec as number);
  });
  return sorted.map((comment) => {
    const body = comment.body.trim();
    const quote = anchorQuote(comment.anchor);
    const where = [
      comment.variantId ? (variantNames.get(comment.variantId) ?? `Variante ${comment.variantId}`) : null,
      quote ? `Sul passaggio «${quote}»` : null,
      comment.mediaIndex !== null ? `Media ${comment.mediaIndex + 1}` : null,
      formatMoment(comment.timeSec, comment.timeEndSec),
      comment.timeSec === null && comment.pinX != null ? "punto sull'immagine" : null,
    ].filter(Boolean);
    return {
      title: body.length > MAX_COMMENT_IN_EMAIL ? `${body.slice(0, MAX_COMMENT_IN_EMAIL - 1).trimEnd()}…` : body,
      ...(where.length ? { detail: where.join(" · ") } : {}),
    };
  });
}

export async function notifyChangesRequested(postId: string): Promise<void> {
  try {
    const post = await loadPost(postId);
    if (!post) return;

    const event = await prisma.postEvent.findFirst({
      where: { postId, type: "CHANGES_REQUESTED" },
      orderBy: { createdAt: "desc" },
      include: { reviewer: { select: { name: true } } },
    });
    const metadata = (event?.metadata ?? {}) as {
      commentId?: unknown;
      reviewSessionId?: unknown;
      actionCommentIds?: unknown;
    };
    const comment =
      typeof metadata.commentId === "string"
        ? await prisma.postComment.findUnique({
            where: { id: metadata.commentId },
            select: { body: true, versionId: true, version: { select: { content: true } } },
          })
        : null;
    // Open client comments on the reviewed version (pins, video moments and
    // the assistant's located action items), shown with their timecode.
    const clientComments = comment?.versionId
      ? await prisma.postComment.findMany({
          where: {
            postId,
            versionId: comment.versionId,
            authorType: "CLIENT",
            resolvedAt: null,
            id: { not: metadata.commentId as string },
          },
          orderBy: { createdAt: "asc" },
          take: 50,
          select: {
            body: true,
            mediaIndex: true,
            pinX: true,
            timeSec: true,
            timeEndSec: true,
            anchor: true,
            variantId: true,
          },
        })
      : [];
    const variantNames = new Map(
      post.kind === "AD_CREATIVE"
        ? readAdSummary(comment?.version?.content).variants.map((v) => [v.id, v.name] as const)
        : []
    );
    const session =
      typeof metadata.reviewSessionId === "string"
        ? await prisma.reviewSession.findUnique({
            where: { id: metadata.reviewSessionId },
            select: { summary: true, actionItems: true },
          })
        : null;

    const who = event?.reviewer?.name ?? post.client.name;
    const paragraphs = [
      `${who} (${post.client.name}) ha chiesto modifiche ${aboutPost(post.kind, post.title)} (versione ${post.currentVersionNumber}).`,
    ];
    if (session) {
      paragraphs.push("La richiesta è stata raccolta con l'assistente di revisione: trovi la conversazione completa nel post.");
      if (session.summary) paragraphs.push(`Riepilogo: ${session.summary}`);
    }
    // Located action items already became comments when requestChanges got
    // them (actionCommentIds); list only the others to avoid duplicates.
    const actions = formatActionItems(session?.actionItems, {
      onlyUnlocated: Array.isArray(metadata.actionCommentIds),
    });

    await sendToAgency(post.workspaceId, `Modifiche richieste: ${post.title}`, {
      heading: "Il cliente ha chiesto modifiche",
      paragraphs,
      quote: comment?.body,
      items: [...formatClientComments(clientComments, variantNames), ...actions.map((title) => ({ title }))],
      cta: { label: openLabel(post.kind), url: agencyPostUrl(post.id) },
    });
  } catch (error) {
    logFailure("notifyChangesRequested", error);
  }
}

export async function notifyApproved(postId: string): Promise<void> {
  try {
    const post = await loadPost(postId);
    if (!post) return;
    const reviewer = post.approvedByReviewerId
      ? await prisma.clientReviewer.findUnique({ where: { id: post.approvedByReviewerId }, select: { name: true } })
      : null;

    const who = `${reviewer?.name ?? post.client.name} (${post.client.name})`;
    const approvedLine = `${who} ha approvato la versione ${post.currentVersionNumber} di "${post.title}".`;

    if (post.kind === "BLOG_ARTICLE") {
      await sendToAgency(post.workspaceId, `Approvato: ${post.title}`, {
        heading: "Articolo approvato",
        paragraphs: [
          approvedLine,
          "Esporta l'articolo dal pannello e, quando è online, segnalo come pubblicato.",
        ],
        items: [postListItem(post, post.client.timezone)],
        cta: { label: openLabel(post.kind), url: agencyPostUrl(post.id) },
      });
      return;
    }

    if (post.kind === "AD_CREATIVE") {
      const [version, decisions] = await Promise.all([
        prisma.postVersion.findUnique({
          where: { postId_number: { postId, number: post.currentVersionNumber } },
          select: { content: true },
        }),
        prisma.creativeDecision.findMany({ where: { postId, versionNumber: post.currentVersionNumber } }),
      ]);
      const { variants } = readAdSummary(version?.content);
      const byVariant = new Map(decisions.map((d) => [d.variantId, d]));
      await sendToAgency(post.workspaceId, `Approvato: ${post.title}`, {
        heading: "Creatività approvate",
        paragraphs: [
          `${who} ha deciso le varianti della versione ${post.currentVersionNumber} di "${post.title}".`,
          "Scarica dal pannello il pacchetto delle varianti approvate e, una volta caricate, segnale come consegnate.",
        ],
        items: variants.map((variant) => {
          const decision = byVariant.get(variant.id);
          const verdict =
            decision?.verdict === "APPROVED" ? "approvata" : decision?.verdict === "REJECTED" ? "scartata" : "senza decisione";
          return { title: `${variant.name} — ${verdict}`, ...(decision?.note ? { detail: decision.note } : {}) };
        }),
        cta: { label: openLabel(post.kind), url: agencyPostUrl(post.id) },
      });
      return;
    }

    const next = post.client.autoSchedule
      ? post.client.metricoolBlogId
        ? "Verrà programmato automaticamente su Metricool."
        : "Il cliente non ha un brand Metricool collegato: collegalo per programmarlo."
      : "La programmazione automatica è disattivata per questo cliente: programmalo dal pannello.";

    await sendToAgency(post.workspaceId, `Approvato: ${post.title}`, {
      heading: "Post approvato",
      paragraphs: [approvedLine, next],
      items: [postListItem(post, post.client.timezone)],
      cta: { label: "Apri il post", url: agencyPostUrl(post.id) },
    });
  } catch (error) {
    logFailure("notifyApproved", error);
  }
}

export async function notifyScheduled(postId: string): Promise<void> {
  try {
    const post = await loadPost(postId);
    if (!post) return;
    await sendToAgency(post.workspaceId, `Programmato: ${post.title}`, {
      heading: "Post programmato su Metricool",
      paragraphs: [
        `"${post.title}" di ${post.client.name} è programmato per ${formatPublishDate(post.publishAt, post.client.timezone)}.`,
      ],
      items: [postListItem(post, post.client.timezone)],
      cta: { label: "Apri il post", url: agencyPostUrl(post.id) },
    });
  } catch (error) {
    logFailure("notifyScheduled", error);
  }
}

export async function notifyScheduleFailed(postId: string): Promise<void> {
  try {
    const post = await loadPost(postId);
    if (!post) return;
    await sendToAgency(post.workspaceId, `Programmazione non riuscita: ${post.title}`, {
      heading: "Programmazione non riuscita",
      paragraphs: [
        `Non è stato possibile programmare su Metricool il post "${post.title}" di ${post.client.name}, già approvato dal cliente.`,
        "Controlla l'errore e riprova dal pannello.",
      ],
      quote: post.lastError ? post.lastError.slice(0, 1000) : undefined,
      cta: { label: "Apri il post", url: agencyPostUrl(post.id) },
    });
  } catch (error) {
    logFailure("notifyScheduleFailed", error);
  }
}

// ─── Monthly plans ───────────────────────────────────────────────────────────

/**
 * Wording of the plan email to the client (pure): "Piano social di ottobre
 * per Caffè Aurora: 12 post da approvare".
 */
export function planEmailCopy(params: {
  heading: string;
  clientName: string;
  agencyName: string;
  toReview: number;
}): ReviewEmailCopy {
  const posts = params.toReview === 1 ? "1 post" : `${params.toReview} post`;
  const lower = params.heading.charAt(0).toLowerCase() + params.heading.slice(1);
  return {
    subject: `${params.heading} per ${params.clientName}: ${posts} da approvare`,
    heading: params.heading,
    intro:
      `${params.agencyName} ha preparato il ${lower} per ${params.clientName}: ${posts} da rivedere. ` +
      "Li vedi tutti insieme, anche come appariranno sul profilo Instagram, e puoi approvarli uno per uno o tutti in una volta.",
    ctaLabel: "Rivedi il piano",
  };
}

function agencyPlanUrl(planId: string): string {
  return `${getBaseUrl()}/plans/${planId}`;
}

async function loadPlan(planId: string) {
  return prisma.contentPlan.findUnique({
    where: { id: planId },
    include: {
      client: { include: { reviewers: { where: { active: true, email: { not: null } } } } },
      workspace: { select: { id: true, name: true } },
      posts: {
        where: { status: { not: "CANCELLED" } },
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          publishAt: true,
          networks: true,
          reviewDueAt: true,
          versions: latestVersionContent,
        },
      },
    },
  });
}

/**
 * "Invia il piano al cliente": ONE email per active reviewer with an email
 * for the whole plan (never one per post), listing the posts waiting for
 * them and linking to the plan page of their portal. Reviewers without an
 * email are skipped (the agency shares the plan link by hand). Returns how
 * many emails went out. Never throws.
 */
export async function notifyPlanSent(planId: string): Promise<number> {
  let sent = 0;
  try {
    const plan = await loadPlan(planId);
    if (!plan || plan.client.archivedAt) return 0;
    const toReview = byPublishAsc(plan.posts.filter((p) => p.status === "IN_REVIEW"));
    if (toReview.length === 0) return 0;
    const timeZone = plan.client.timezone;
    const copy = planEmailCopy({
      heading: planHeading(plan.month, { kind: plan.kind, timeZone }),
      clientName: plan.client.name,
      agencyName: plan.workspace.name,
      toReview: toReview.length,
    });
    const due = plan.reviewDueAt ?? toReview.map((p) => p.reviewDueAt).find((d): d is Date => !!d) ?? null;
    const items = toReview.map((p) => postListItem({ ...p, content: p.versions[0]?.content }, timeZone));

    for (const reviewer of plan.client.reviewers) {
      if (!reviewer.email) continue;
      try {
        const paragraphs = [`Ciao ${reviewer.name},`, copy.intro];
        if (due) paragraphs.push(`Ti chiediamo una risposta entro ${formatPublishDate(due, timeZone)}.`);
        const { html, text } = renderEmail({
          heading: copy.heading,
          paragraphs,
          ...(plan.intro?.trim() ? { quote: plan.intro.trim().slice(0, 2000) } : {}),
          items,
          cta: { label: copy.ctaLabel, url: getReviewPlanUrl(reviewer, plan.id) },
          footer: `Link personale per ${reviewer.name}: non inoltrarlo. Inviato da ${plan.workspace.name} con ${productName()}.`,
        });
        const result = await sendEmail({ to: reviewer.email, subject: copy.subject, html, text });
        if (result.ok) sent += 1;
      } catch (error) {
        logFailure(`notifyPlanSent(reviewer ${reviewer.id})`, error);
      }
    }
  } catch (error) {
    logFailure("notifyPlanSent", error);
  }
  return sent;
}

/**
 * "Approva tutto il piano" without finishing the plan: one email to the
 * agency instead of one "Approvato" per post. Never throws.
 */
export async function notifyPlanApproved(planId: string, reviewerId: string, approvedPostIds: string[]): Promise<void> {
  try {
    if (approvedPostIds.length === 0) return;
    const plan = await loadPlan(planId);
    if (!plan) return;
    const reviewer = await prisma.clientReviewer.findUnique({ where: { id: reviewerId }, select: { name: true } });
    const who = `${reviewer?.name ?? plan.client.name} (${plan.client.name})`;
    const name = planShortName(plan.month);
    const approved = byPublishAsc(plan.posts.filter((p) => approvedPostIds.includes(p.id)));
    const count = approved.length === 1 ? "1 post" : `${approved.length} post`;
    const autoSchedule = plan.client.autoSchedule
      ? plan.client.metricoolBlogId
        ? "I post approvati vengono programmati automaticamente su Metricool."
        : "Il cliente non ha un brand Metricool collegato: collegalo per programmarli."
      : "La programmazione automatica è disattivata per questo cliente: programmali dal pannello.";
    await sendToAgency(plan.workspaceId, `${name}: ${count} approvati da ${plan.client.name}`, {
      heading: "Post del piano approvati",
      paragraphs: [
        `${who} ha approvato in un solo passaggio ${count} del ${name.charAt(0).toLowerCase()}${name.slice(1)}.`,
        `Situazione del piano: ${planOutcomeSummary(plan.posts.map((p) => p.status))}.`,
        autoSchedule,
      ],
      items: approved.map((p) => postListItem(p, plan.client.timezone)),
      cta: { label: "Apri il piano", url: agencyPlanUrl(plan.id) },
    });
  } catch (error) {
    logFailure("notifyPlanApproved", error);
  }
}

/**
 * The client has decided every post of the plan that was sent to them:
 * "Piano di ottobre: 10 approvati, 2 con modifiche". The caller makes sure
 * it goes out once per send (ContentPlan.completedNotifiedAt). Returns true
 * only after the email transport confirms the send. Never throws.
 */
export async function notifyPlanDecided(planId: string): Promise<boolean> {
  try {
    const plan = await loadPlan(planId);
    if (!plan) return false;
    const summary = planOutcomeSummary(plan.posts.map((p) => p.status));
    const name = planShortName(plan.month);
    const changes = byPublishAsc(plan.posts.filter((p) => p.status === "CHANGES_REQUESTED"));
    const approved = byPublishAsc(plan.posts.filter((p) => APPROVED_LIKE.includes(p.status)));
    const label = (p: (typeof plan.posts)[number], verdict: string) => {
      const item = postListItem(p, plan.client.timezone);
      return { title: `${item.title} — ${verdict}`, ...(item.detail ? { detail: item.detail } : {}) };
    };
    return await sendToAgency(plan.workspaceId, `${name} di ${plan.client.name}: ${summary}`, {
      heading: "Il cliente ha rivisto il piano",
      paragraphs: [
        `${plan.client.name} ha dato una risposta su tutti i post del ${name.charAt(0).toLowerCase()}${name.slice(1)}: ${summary}.`,
        changes.length > 0
          ? "Apri i post con modifiche richieste, prepara le nuove versioni e reinvia il piano."
          : "Tutti i post inviati sono approvati.",
      ],
      items: [...changes.map((p) => label(p, "modifiche richieste")), ...approved.map((p) => label(p, "approvato"))],
      cta: { label: "Apri il piano", url: agencyPlanUrl(plan.id) },
    });
  } catch (error) {
    logFailure("notifyPlanDecided", error);
    return false;
  }
}

/** A general comment of the client on the whole plan ("Commento sul piano"). Never throws. */
export async function notifyPlanComment(commentId: string): Promise<void> {
  try {
    const comment = await prisma.contentPlanComment.findUnique({
      where: { id: commentId },
      include: {
        reviewer: { select: { name: true } },
        plan: { include: { client: { select: { name: true } } } },
      },
    });
    if (!comment || comment.authorType !== "CLIENT") return;
    const plan = comment.plan;
    const name = planShortName(plan.month);
    const who = comment.reviewer?.name ?? plan.client.name;
    await sendToAgency(plan.workspaceId, `Commento sul ${name.charAt(0).toLowerCase()}${name.slice(1)}: ${plan.client.name}`, {
      heading: "Commento sul piano",
      paragraphs: [`${who} (${plan.client.name}) ha scritto un commento sul ${name.charAt(0).toLowerCase()}${name.slice(1)}.`],
      quote: comment.body.slice(0, 2000),
      cta: { label: "Apri il piano", url: agencyPlanUrl(plan.id) },
    });
  } catch (error) {
    logFailure("notifyPlanComment", error);
  }
}
