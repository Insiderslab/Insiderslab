/**
 * Email notifications for the review flow.
 *
 * Client side: review requests and reminders go to the client's active
 * reviewers, one email per reviewer listing every post, with their personal
 * link. Agency side: outcomes (changes requested, approved, scheduled,
 * failed) go to the workspace OWNER/ADMIN members.
 *
 * Every function catches and logs its own errors: a notification can never
 * break or roll back the action that triggered it.
 */

import type { Client, ClientReviewer, Post } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { NETWORK_LABELS, isNetwork, type Network } from "@/lib/domain";
import { renderEmail, sendEmail, type EmailListItem } from "@/lib/email";
import { getBaseUrl } from "@/lib/env";
import { getReviewUrl } from "@/lib/reviewers";

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

function postListItem(post: Pick<Post, "title" | "publishAt" | "networks">, timeZone: string): EmailListItem {
  const networks = formatNetworks(post.networks);
  return {
    title: post.title,
    detail: `${formatPublishDate(post.publishAt, timeZone)}${networks ? ` · ${networks}` : ""}`,
  };
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

async function sendToAgency(workspaceId: string, subject: string, content: Parameters<typeof renderEmail>[0]) {
  const to = await getAgencyRecipients(workspaceId);
  if (to.length === 0) return;
  const { html, text } = renderEmail(content);
  await sendEmail({ to, subject, html, text });
}

function logFailure(name: string, error: unknown) {
  console.error(`[notifications] ${name} failed:`, error);
}

// ─── Client side ─────────────────────────────────────────────────────────────

async function sendReviewEmail(
  reviewer: ClientReviewer,
  client: Client,
  agencyName: string,
  posts: Array<Pick<Post, "title" | "publishAt" | "networks" | "reviewDueAt">>,
  kind: "request" | "reminder"
): Promise<boolean> {
  const count = posts.length;
  const subject =
    kind === "request"
      ? count === 1
        ? `Nuovo post da approvare: ${posts[0].title}`
        : `${count} nuovi post da approvare per ${client.name}`
      : count === 1
        ? `Promemoria: il post "${posts[0].title}" aspetta la tua revisione`
        : `Promemoria: ${count} post aspettano la tua revisione`;

  const dueDates = posts.map((p) => p.reviewDueAt).filter((d): d is Date => !!d);
  const earliestDue = dueDates.length ? new Date(Math.min(...dueDates.map((d) => d.getTime()))) : null;

  const paragraphs = [
    `Ciao ${reviewer.name},`,
    kind === "request"
      ? `${agencyName} ha preparato ${count === 1 ? "un post" : `${count} post`} per ${client.name}. Puoi vedere l'anteprima, lasciare commenti e approvare oppure chiedere modifiche.`
      : `${count === 1 ? "C'è ancora un post" : `Ci sono ancora ${count} post`} di ${client.name} in attesa della tua revisione.`,
  ];
  if (earliestDue) {
    paragraphs.push(`Ti chiediamo una risposta entro ${formatPublishDate(earliestDue, client.timezone)}.`);
  }

  const { html, text } = renderEmail({
    heading: kind === "request" ? "Post da approvare" : "Promemoria revisione",
    paragraphs,
    items: posts.map((p) => postListItem(p, client.timezone)),
    cta: { label: count === 1 ? "Rivedi il post" : "Rivedi i post", url: getReviewUrl(reviewer) },
    footer: `Link personale per ${reviewer.name}: non inoltrarlo. Inviato da ${agencyName} con Approve by Heili.`,
  });
  const result = await sendEmail({ to: reviewer.email, subject, html, text });
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
        client: { include: { reviewers: { where: { active: true } } } },
        workspace: { select: { name: true } },
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

/** Reminder for one post still IN_REVIEW. Returns true if at least one email went out. */
export async function notifyReviewReminder(postId: string): Promise<boolean> {
  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        client: { include: { reviewers: { where: { active: true } } } },
        workspace: { select: { name: true } },
      },
    });
    if (!post || post.status !== "IN_REVIEW" || post.client.archivedAt) return false;

    let sent = false;
    for (const reviewer of post.client.reviewers) {
      try {
        if (await sendReviewEmail(reviewer, post.client, post.workspace.name, [post], "reminder")) sent = true;
      } catch (error) {
        logFailure(`notifyReviewReminder(reviewer ${reviewer.id})`, error);
      }
    }
    return sent;
  } catch (error) {
    logFailure("notifyReviewReminder", error);
    return false;
  }
}

// ─── Agency side ─────────────────────────────────────────────────────────────

interface AssistantActionItem {
  area?: unknown;
  mediaIndex?: unknown;
  request?: unknown;
  priority?: unknown;
}

/** "- [Immagine 2] Schiarire lo sfondo (alta)" lines from a review session. */
export function formatActionItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: AssistantActionItem) => {
    if (!raw || typeof raw !== "object" || typeof raw.request !== "string" || !raw.request.trim()) return [];
    const area = typeof raw.area === "string" && raw.area ? raw.area : null;
    const media = typeof raw.mediaIndex === "number" ? `media ${raw.mediaIndex + 1}` : null;
    const where = [area, media].filter(Boolean).join(", ");
    const priority = typeof raw.priority === "string" && raw.priority ? ` (priorità: ${raw.priority})` : "";
    return [`${where ? `[${where}] ` : ""}${raw.request.trim()}${priority}`];
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
    const metadata = (event?.metadata ?? {}) as { commentId?: unknown; reviewSessionId?: unknown };
    const comment =
      typeof metadata.commentId === "string"
        ? await prisma.postComment.findUnique({ where: { id: metadata.commentId }, select: { body: true } })
        : null;
    const session =
      typeof metadata.reviewSessionId === "string"
        ? await prisma.reviewSession.findUnique({
            where: { id: metadata.reviewSessionId },
            select: { summary: true, actionItems: true },
          })
        : null;

    const who = event?.reviewer?.name ?? post.client.name;
    const paragraphs = [
      `${who} (${post.client.name}) ha chiesto modifiche al post "${post.title}" (versione ${post.currentVersionNumber}).`,
    ];
    if (session) {
      paragraphs.push("La richiesta è stata raccolta con l'assistente di revisione: trovi la conversazione completa nel post.");
      if (session.summary) paragraphs.push(`Riepilogo: ${session.summary}`);
    }
    const actions = formatActionItems(session?.actionItems);

    await sendToAgency(post.workspaceId, `Modifiche richieste: ${post.title}`, {
      heading: "Il cliente ha chiesto modifiche",
      paragraphs,
      quote: comment?.body,
      items: actions.map((title) => ({ title })),
      cta: { label: "Apri il post", url: agencyPostUrl(post.id) },
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

    const next = post.client.autoSchedule
      ? post.client.metricoolBlogId
        ? "Verrà programmato automaticamente su Metricool."
        : "Il cliente non ha un brand Metricool collegato: collegalo per programmarlo."
      : "La programmazione automatica è disattivata per questo cliente: programmalo dal pannello.";

    await sendToAgency(post.workspaceId, `Approvato: ${post.title}`, {
      heading: "Post approvato",
      paragraphs: [
        `${reviewer?.name ?? post.client.name} (${post.client.name}) ha approvato la versione ${post.currentVersionNumber} di "${post.title}".`,
        next,
      ],
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
