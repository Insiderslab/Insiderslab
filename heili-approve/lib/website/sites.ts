/**
 * The registered site behind a WEBSITE post (WebsiteSite): attached to the
 * version content when it is saved, read by the review checks, the comment
 * checks and the frame-ancestors policy of the site iframe.
 *
 * Kept free of lib/posts imports (lib/posts uses it; lib/website/service.ts
 * uses both).
 */

import type { Prisma } from "@/app/generated/prisma/client";
import type { WebsiteContent, WebsiteSiteState } from "@/lib/content/website";
import { prisma } from "@/lib/db/client";
import { normalizeOrigin, originOf } from "./origins";
import { newSiteKey } from "./sessions";

type Db = Prisma.TransactionClient | typeof prisma;

/** Origins a new site starts with: the site's own, unless it is http:// on a public host (needs the test mark). */
export function initialOrigins(siteUrl: string): string[] {
  const origin = originOf(siteUrl);
  if (!origin) return [];
  const normalized = normalizeOrigin(origin);
  return normalized.ok ? [normalized.origin] : [];
}

/**
 * Attaches the review key to a WEBSITE content (inside the save
 * transaction): the given siteId if it is this client's, else an active site
 * of the client that already allows the address's origin, else a new one.
 * Without an address there is no site yet.
 */
export async function attachSite(db: Db, workspaceId: string, clientId: string, content: WebsiteContent): Promise<WebsiteContent> {
  if (content.siteId) {
    const own = await db.websiteSite.findFirst({ where: { id: content.siteId, workspaceId, clientId }, select: { id: true } });
    if (own) return content;
  }
  const origin = originOf(content.siteUrl);
  if (!origin) return { ...content, siteId: null };
  const existing = await db.websiteSite.findFirst({
    where: { workspaceId, clientId, revokedAt: null, origins: { has: origin } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return { ...content, siteId: existing.id };
  const site = await db.websiteSite.create({
    data: {
      workspaceId,
      clientId,
      siteKey: newSiteKey(),
      label: new URL(content.siteUrl).host,
      origins: initialOrigins(content.siteUrl),
    },
    select: { id: true },
  });
  return { ...content, siteId: site.id };
}

/** Origins of a site (null when there is none). */
export async function siteOrigins(db: Db, siteId: string | null): Promise<string[] | null> {
  if (!siteId) return null;
  const site = await db.websiteSite.findUnique({ where: { id: siteId }, select: { origins: true } });
  return site?.origins ?? null;
}

/** What validateWebsiteForReview needs about the site (null when there is none). */
export async function siteStateOf(db: Db, siteId: string | null): Promise<(WebsiteSiteState & { id: string }) | null> {
  if (!siteId) return null;
  return db.websiteSite.findUnique({
    where: { id: siteId },
    select: { id: true, origins: true, revokedAt: true, verifiedAt: true, verifyWaivedAt: true },
  });
}

// ─── frame-ancestors of /embed/site ──────────────────────────────────────────

const FRAME_CACHE_MS = 60_000;
const frameCache = new Map<string, { at: number; value: string }>();

/** CSP source list for the iframe of a site key: its exact origins, else 'none'. Cached 60 s. */
export async function frameAncestorsFor(siteKey: string | null, now = Date.now()): Promise<string> {
  if (!siteKey || !/^hs_[A-Za-z0-9_-]{16,64}$/.test(siteKey)) return "'none'";
  const cached = frameCache.get(siteKey);
  if (cached && now - cached.at < FRAME_CACHE_MS) return cached.value;
  const site = await prisma.websiteSite.findUnique({ where: { siteKey }, select: { origins: true, revokedAt: true } });
  const origins = site && !site.revokedAt ? site.origins.filter((o) => /^https?:\/\/[a-z0-9.\-[\]:]+$/.test(o)) : [];
  const value = origins.length > 0 ? origins.join(" ") : "'none'";
  if (frameCache.size > 1000) frameCache.clear();
  frameCache.set(siteKey, { at: now, value });
  return value;
}
