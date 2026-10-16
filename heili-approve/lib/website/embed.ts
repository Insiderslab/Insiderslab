/**
 * What the «Sul sito» iframe receives about its session: the post and round,
 * the pages, the numbered markers of the comments on the site, the comment to
 * focus («Apri nel punto», agency only) and the way back to the portal
 * (reviewer only, kept inside the iframe). Never the reviewer's link token
 * outside Approve's own origin: this JSON is read by the iframe only.
 */

import { anchorChip, coerceWebsiteContent, parseWebsiteAnchor, type LiveAnchor } from "@/lib/content/website";
import { prisma } from "@/lib/db/client";
import { isAssistantEnabled } from "@/lib/review-assistant";
import { getReviewPostUrl } from "@/lib/reviewers";
import type { SiteSessionView } from "./sessions";

export interface EmbedMarker {
  id: string;
  n: number;
  pageUrl: string;
  selector: string;
  textSnippet: string;
  resolved: boolean;
  mine: boolean;
  body: string;
  authorName: string;
  chip: string;
}

export interface EmbedContext {
  role: "REVIEWER" | "AGENCY";
  canComment: boolean;
  assistantEnabled: boolean;
  expiresAt: string;
  post: { id: string; title: string; versionNumber: number; round: number; roundNote: string; status: string };
  clientName: string;
  reviewerName: string | null;
  pages: Array<{ id: string; title: string; url: string; note: string }>;
  markers: EmbedMarker[];
  focus: (Pick<LiveAnchor, "pageUrl" | "selector" | "textSnippet" | "scrollY" | "offsetX" | "offsetY"> & {
    commentId: string;
    body: string;
    authorName: string;
    createdAt: string;
    chip: string;
  }) | null;
  /** Reviewer: the portal page to decide on (stays inside the iframe). */
  portalUrl: string | null;
}

export async function embedContext(view: SiteSessionView): Promise<EmbedContext> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: view.postId },
    include: {
      client: { select: { name: true } },
      versions: { where: { number: view.versionNumber }, take: 1 },
    },
  });
  const version = post.versions[0];
  const content = coerceWebsiteContent(version?.content);
  const comments = version
    ? await prisma.postComment.findMany({
        where: { postId: post.id, versionId: version.id },
        orderBy: { createdAt: "asc" },
        include: { reviewer: { select: { name: true } }, user: { select: { name: true } } },
        take: 200,
      })
    : [];

  const markers: EmbedMarker[] = [];
  let focus: EmbedContext["focus"] = null;
  for (const comment of comments) {
    const anchor = parseWebsiteAnchor(comment.anchor);
    const authorName =
      comment.authorType === "CLIENT" ? (comment.reviewer?.name ?? post.client.name) : (comment.user?.name ?? "Agenzia");
    if (anchor) {
      markers.push({
        id: comment.id,
        n: markers.length + 1,
        pageUrl: anchor.pageUrl,
        selector: anchor.selector,
        textSnippet: anchor.textSnippet,
        resolved: comment.resolvedAt !== null,
        mine: view.reviewer !== null && comment.reviewerId === view.reviewer.id,
        body: comment.body.slice(0, 2000),
        authorName,
        chip: anchorChip(anchor, content.pages),
      });
    }
    if (anchor && comment.id === view.focusCommentId && view.role === "AGENCY") {
      focus = {
        commentId: comment.id,
        pageUrl: anchor.pageUrl,
        selector: anchor.selector,
        textSnippet: anchor.textSnippet,
        scrollY: anchor.scrollY,
        offsetX: anchor.offsetX,
        offsetY: anchor.offsetY,
        body: comment.body.slice(0, 2000),
        authorName,
        createdAt: comment.createdAt.toISOString(),
        chip: anchorChip(anchor, content.pages),
      };
    }
  }

  let portalUrl: string | null = null;
  if (view.reviewer) {
    const reviewer = await prisma.clientReviewer.findUnique({ where: { id: view.reviewer.id }, select: { tokenEncrypted: true } });
    try {
      portalUrl = reviewer ? getReviewPostUrl(reviewer, post.id) : null;
    } catch {
      portalUrl = null;
    }
  }

  return {
    role: view.role,
    canComment: view.canComment,
    assistantEnabled: view.canComment && isAssistantEnabled(),
    expiresAt: view.expiresAt.toISOString(),
    post: {
      id: post.id,
      title: post.title,
      versionNumber: view.versionNumber,
      round: content.round,
      roundNote: content.roundNote,
      status: post.status,
    },
    clientName: post.client.name,
    reviewerName: view.reviewer?.name ?? null,
    pages: content.pages.filter((p) => p.url).map(({ id, title, url, note }) => ({ id, title, url, note })),
    markers,
    focus,
    portalUrl,
  };
}
