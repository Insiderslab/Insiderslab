/**
 * «Sul sito» services (docs/SITO-WEB.md, Fase 2): the registered site behind a
 * WEBSITE post (key, exact origins, verification, revocation), the launch
 * codes for the portal («Apri il sito») and the agency («Apri nel punto»),
 * and the frame-ancestors policy of the site iframe.
 *
 * Agency calls are scoped by workspaceId; portal calls go through
 * getPostForReviewer (client, visibility, version). Nothing here changes a
 * post's status.
 */

import type { WebsiteSite } from "@/app/generated/prisma/client";
import { anchorChip, coerceWebsiteContent, parseWebsiteAnchor, sanitizePageUrl, type WebsiteContent } from "@/lib/content/website";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { getPostForReviewer, type ReviewerRef } from "@/lib/posts";
import { MAX_SITE_ORIGINS, isLocalHostname, needsTestMark, normalizeOrigin, originAllowed, originOf } from "./origins";
export { attachSite, frameAncestorsFor, siteOrigins } from "./sites";
import { createLaunch, newSiteKey } from "./sessions";
import { verifyInstallation } from "./verify";

/** The line the agency pastes in the site (and the WordPress plugin prints). */
export function siteSnippet(siteKey: string, baseUrl: string = getBaseUrl()): string {
  return `<script src="${baseUrl}/heili-review.js" data-site="${siteKey}" defer></script>`;
}

// ─── Agency ──────────────────────────────────────────────────────────────────

export interface AgencySiteView {
  id: string;
  siteKey: string;
  snippet: string;
  scriptUrl: string;
  origins: Array<{ origin: string; test: boolean }>;
  siteOrigin: string | null;
  siteOriginRegistered: boolean;
  verifiedAt: Date | null;
  verifyMessage: string | null;
  verifyWaivedAt: Date | null;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

async function loadWebsitePost(postId: string, workspaceId: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId, kind: "WEBSITE" },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!post) throw new NotFoundError("Sito non trovato");
  const content = coerceWebsiteContent(post.versions[0]?.content);
  const site = content.siteId
    ? await prisma.websiteSite.findFirst({ where: { id: content.siteId, workspaceId, clientId: post.clientId } })
    : null;
  return { post, content, site };
}

export function agencySiteView(site: WebsiteSite, content: WebsiteContent, baseUrl: string = getBaseUrl()): AgencySiteView {
  const siteOrigin = originOf(content.siteUrl);
  return {
    id: site.id,
    siteKey: site.siteKey,
    snippet: siteSnippet(site.siteKey, baseUrl),
    scriptUrl: `${baseUrl}/heili-review.js`,
    origins: site.origins.map((origin) => ({ origin, test: site.testOrigins.includes(origin) })),
    siteOrigin,
    siteOriginRegistered: originAllowed(siteOrigin, site.origins),
    verifiedAt: site.verifiedAt,
    verifyMessage: site.verifyMessage,
    verifyWaivedAt: site.verifyWaivedAt,
    revokedAt: site.revokedAt,
    lastSeenAt: site.lastSeenAt,
  };
}

/** The «Sul sito» panel of a post, or null while the content has no site address. */
export async function getAgencySite(postId: string, workspaceId: string): Promise<AgencySiteView | null> {
  const { content, site } = await loadWebsitePost(postId, workspaceId);
  return site ? agencySiteView(site, content) : null;
}

async function requireSite(postId: string, workspaceId: string) {
  const loaded = await loadWebsitePost(postId, workspaceId);
  if (!loaded.site) throw new ValidationError("Inserisci e salva prima l'indirizzo del sito di prova.");
  return { ...loaded, site: loaded.site };
}

export interface OriginEntry {
  origin: string;
  /** The agency marks it as a test site (the only way for a non-local http://). */
  test: boolean;
}

/** Normalises the agency's list (exact origins, http:// only for localhost or marked test sites). */
export function normalizeOriginEntries(entries: readonly OriginEntry[]): { origins: string[]; testOrigins: string[] } {
  if (entries.length > MAX_SITE_ORIGINS) throw new ValidationError(`Al massimo ${MAX_SITE_ORIGINS} indirizzi per sito.`);
  const origins: string[] = [];
  const testOrigins: string[] = [];
  for (const entry of entries) {
    const result = normalizeOrigin(entry.origin, { testOrigin: entry.test });
    if (!result.ok) throw new ValidationError(`${entry.origin.slice(0, 80)}: ${result.error}`);
    if (origins.includes(result.origin)) continue;
    origins.push(result.origin);
    if (entry.test || needsTestMark(result.origin)) testOrigins.push(result.origin);
  }
  return { origins, testOrigins };
}

export async function registerOrigins(postId: string, workspaceId: string, entries: readonly OriginEntry[]): Promise<AgencySiteView> {
  const { content, site } = await requireSite(postId, workspaceId);
  const { origins, testOrigins } = normalizeOriginEntries(entries);
  const updated = await prisma.websiteSite.update({ where: { id: site.id }, data: { origins, testOrigins } });
  return agencySiteView(updated, content);
}

/** «Verifica installazione» on the site's address (its origin must be registered). */
export async function verifySite(postId: string, workspaceId: string): Promise<AgencySiteView> {
  const { content, site } = await requireSite(postId, workspaceId);
  if (site.revokedAt) throw new ValidationError("La chiave è revocata: crea una nuova chiave prima di verificare.");
  if (!content.siteUrl || !originAllowed(originOf(content.siteUrl), site.origins)) {
    throw new ValidationError("Aggiungi prima l'indirizzo del sito agli indirizzi consentiti.");
  }
  const result = await verifyInstallation(content.siteUrl, site.siteKey);
  const updated = await prisma.websiteSite.update({
    where: { id: site.id },
    data: { verifyMessage: result.message, ...(result.found ? { verifiedAt: new Date() } : {}) },
  });
  return agencySiteView(updated, content);
}

/** «Non riesco a verificare (sito protetto): invia comunque». Recorded on the site and in the submit event. */
export async function setVerificationWaived(postId: string, workspaceId: string, waived: boolean): Promise<AgencySiteView> {
  const { content, site } = await requireSite(postId, workspaceId);
  const updated = await prisma.websiteSite.update({
    where: { id: site.id },
    data: { verifyWaivedAt: waived ? new Date() : null },
  });
  return agencySiteView(updated, content);
}

/** Revokes the key: from now on the script does nothing and every session stops. */
export async function revokeSite(postId: string, workspaceId: string): Promise<AgencySiteView> {
  const { content, site } = await requireSite(postId, workspaceId);
  const updated = await prisma.websiteSite.update({ where: { id: site.id }, data: { revokedAt: site.revokedAt ?? new Date() } });
  return agencySiteView(updated, content);
}

/** A new key (to reinstall): clears revocation and verification. */
export async function renewSiteKey(postId: string, workspaceId: string): Promise<AgencySiteView> {
  const { content, site } = await requireSite(postId, workspaceId);
  const updated = await prisma.websiteSite.update({
    where: { id: site.id },
    data: { siteKey: newSiteKey(), revokedAt: null, verifiedAt: null, verifyMessage: null, verifyWaivedAt: null },
  });
  await prisma.websiteSession.deleteMany({ where: { siteId: site.id } });
  return agencySiteView(updated, content);
}

/**
 * «Apri nel punto»: a read-only agency session focused on one comment,
 * opened at the comment's page. Returns the URL with the one-time code in
 * the fragment and the client's window size (for a phone comment).
 */
export async function openOnSite(
  commentId: string,
  workspaceId: string,
  userId: string
): Promise<{ url: string; viewport: { w: number; h: number }; device: "desktop" | "phone"; label: string }> {
  const comment = await prisma.postComment.findFirst({
    where: { id: commentId, post: { workspaceId, kind: "WEBSITE" } },
    include: { version: { select: { number: true, content: true } }, post: { select: { id: true, clientId: true, status: true } } },
  });
  if (!comment) throw new NotFoundError("Commento non trovato");
  if (comment.post.status === "CANCELLED") throw new ConflictError("Questa revisione è annullata.");
  const anchor = parseWebsiteAnchor(comment.anchor);
  if (!anchor) throw new ValidationError("Questo commento non indica un punto del sito.");
  const content = coerceWebsiteContent(comment.version?.content);
  const site = content.siteId
    ? await prisma.websiteSite.findFirst({ where: { id: content.siteId, workspaceId, clientId: comment.post.clientId } })
    : null;
  if (!site || site.revokedAt) throw new ValidationError("La chiave del sito non è attiva: crea una nuova chiave in «Sul sito».");
  const pageUrl = sanitizePageUrl(anchor.pageUrl);
  if (!pageUrl || !originAllowed(originOf(pageUrl), site.origins)) {
    throw new ValidationError("La pagina del commento non è più tra gli indirizzi consentiti del sito.");
  }
  const { code } = await createLaunch({
    siteId: site.id,
    postId: comment.post.id,
    versionNumber: comment.version?.number ?? 1,
    role: "AGENCY",
    userId,
    focusCommentId: comment.id,
  });
  return {
    url: `${pageUrl.split("#")[0]}#heili-review=${code}`,
    viewport: anchor.viewport,
    device: anchor.device,
    label: anchorChip(anchor, content.pages),
  };
}

// ─── Portal ──────────────────────────────────────────────────────────────────

/** Can the client open this round with Heili («Apri il sito» with the script)? */
export async function portalLiveReady(content: WebsiteContent): Promise<boolean> {
  if (!content.siteId) return false;
  const site = await prisma.websiteSite.findUnique({ where: { id: content.siteId } });
  return Boolean(site && !site.revokedAt && originAllowed(originOf(content.siteUrl), site.origins));
}

/**
 * «Apri il sito» from the portal: a one-time code for this reviewer, post and
 * version, on the site's address or one page of the round.
 */
export async function createWebsiteLaunch(reviewer: ReviewerRef, postId: string, pageUrl?: string | null): Promise<{ url: string }> {
  const post = await getPostForReviewer(postId, reviewer);
  if (post.kind !== "WEBSITE") throw new NotFoundError("Sito non trovato");
  if (!post.canAct && post.status !== "CHANGES_REQUESTED") {
    throw new ConflictError("Questo sito è già stato deciso: per altre modifiche scrivi all'agenzia.");
  }
  const version = post.versions.find((v) => v.number === post.currentVersionNumber);
  if (!version) throw new NotFoundError("Versione non trovata");
  const content = coerceWebsiteContent(version.content);
  const site = content.siteId ? await prisma.websiteSite.findUnique({ where: { id: content.siteId } }) : null;
  if (!site || site.revokedAt) throw new ConflictError("Il sito non è ancora pronto per i commenti: scrivi le note qui nel portale.");
  const target = sanitizePageUrl(pageUrl || content.siteUrl);
  if (!target || !originAllowed(originOf(target), site.origins)) throw new ValidationError("Pagina non valida");
  const { code } = await createLaunch({
    siteId: site.id,
    postId: post.id,
    versionNumber: post.currentVersionNumber,
    role: "REVIEWER",
    reviewerId: reviewer.id,
  });
  return { url: `${target.split("#")[0]}#heili-review=${code}` };
}

/** True when an origin may be registered without the test mark (https, or the agency's own machine). */
export function originNeedsNoMark(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}
