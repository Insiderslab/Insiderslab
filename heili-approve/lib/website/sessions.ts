/**
 * «Sul sito» launch codes and sessions (docs/SITO-WEB.md, «Scambio codice →
 * sessione»).
 *
 * - The portal («Apri il sito») or the agency («Apri nel punto») creates a
 *   one-time launch code, valid 10 minutes, bound to site + post + version +
 *   reviewer (or agency user). It travels in the URL fragment
 *   `#heili-review=<code>`: never the client's permanent link.
 * - The iframe served by Approve exchanges it, from the site's page origin,
 *   for a session: 32 random bytes, sliding 2 h, absolute 8 h. The exchange is
 *   one atomic UPDATE … WHERE launchUsedAt IS NULL: two parallel exchanges of
 *   the same code can never both succeed.
 * - Codes and sessions are stored only as SHA-256 hashes.
 * - A session can comment and talk with Heili; it can never approve or
 *   change a status (there is no route for it). After a new version it
 *   answers "stale"; after the decision it is read-only.
 */

import type { Prisma, WebsiteSessionRole } from "@/app/generated/prisma/client";
import { generateToken, hashToken } from "@/lib/crypto";
import { prisma } from "@/lib/db/client";
import { originAllowed } from "./origins";

export const LAUNCH_TTL_MS = 10 * 60_000;
export const SESSION_SLIDING_MS = 2 * 60 * 60_000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60_000;
/** Sliding renewals are written at most this often. */
const TOUCH_EVERY_MS = 60_000;

export const SITE_KEY_PATTERN = /^hs_[A-Za-z0-9_-]{16,64}$/;
const CODE_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** Statuses in which the client can still comment from the site. */
export const SITE_OPEN_STATUSES = ["IN_REVIEW", "CHANGES_REQUESTED"] as const;

/** A new public site key: "hs_" + 16 random bytes (base64url). */
export function newSiteKey(): string {
  return `hs_${generateToken(16)}`;
}

export function isSiteKey(value: unknown): value is string {
  return typeof value === "string" && SITE_KEY_PATTERN.test(value);
}

export type SiteAccessCode = "not_found" | "origin" | "code" | "expired" | "stale" | "closed" | "forbidden" | "rate";

const MESSAGES: Record<SiteAccessCode, string> = {
  not_found: "Questo sito non è collegato ad Approve o la chiave è stata revocata.",
  origin: "Questo indirizzo non è tra quelli consentiti per il sito.",
  code: "Il link per aprire il sito è scaduto o è già stato usato: riaprilo dal portale.",
  expired: "La sessione è scaduta: riapri il sito dal portale.",
  stale: "Il sito è stato aggiornato: riapri dal link del portale.",
  closed: "Questa revisione è chiusa: per altre modifiche scrivi all'agenzia.",
  forbidden: "Non puoi fare questa operazione da qui.",
  rate: "Troppe richieste: riprova tra un minuto.",
};

const STATUSES: Record<SiteAccessCode, number> = {
  not_found: 404,
  origin: 403,
  code: 401,
  expired: 401,
  stale: 409,
  closed: 409,
  forbidden: 403,
  rate: 429,
};

export class SiteAccessError extends Error {
  readonly status: number;
  constructor(readonly code: SiteAccessCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "SiteAccessError";
    this.status = STATUSES[code];
  }
}

/** Sliding expiry, never past the absolute one. */
export function slidingExpiry(now: Date, absolute: Date): Date {
  return new Date(Math.min(now.getTime() + SESSION_SLIDING_MS, absolute.getTime()));
}

type Db = Prisma.TransactionClient | typeof prisma;

// ─── Launch ──────────────────────────────────────────────────────────────────

export interface LaunchInput {
  siteId: string;
  postId: string;
  versionNumber: number;
  role: WebsiteSessionRole;
  reviewerId?: string | null;
  userId?: string | null;
  focusCommentId?: string | null;
}

/** Creates a one-time launch code (returned once, stored as a hash). */
export async function createLaunch(input: LaunchInput, db: Db = prisma, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  if (input.role === "REVIEWER" && !input.reviewerId) throw new Error("A reviewer launch needs the reviewer");
  if (input.role === "AGENCY" && !input.userId) throw new Error("An agency launch needs the user");
  const code = generateToken(24);
  const expiresAt = new Date(now.getTime() + LAUNCH_TTL_MS);
  await db.websiteSession.create({
    data: {
      siteId: input.siteId,
      postId: input.postId,
      versionNumber: input.versionNumber,
      role: input.role,
      reviewerId: input.role === "REVIEWER" ? input.reviewerId : null,
      userId: input.role === "AGENCY" ? input.userId : null,
      focusCommentId: input.focusCommentId ?? null,
      launchHash: hashToken(code),
      launchExpiresAt: expiresAt,
    },
  });
  return { code, expiresAt };
}

// ─── Exchange ────────────────────────────────────────────────────────────────

export interface ExchangeInput {
  siteKey: string;
  code: string;
  /** event.origin of the `hello` message, as the browser reported it to the iframe. */
  hostOrigin: string;
}

export interface SiteSessionView {
  id: string;
  role: WebsiteSessionRole;
  siteId: string;
  siteKey: string;
  origins: string[];
  postId: string;
  versionNumber: number;
  reviewer: { id: string; clientId: string; name: string } | null;
  userId: string | null;
  focusCommentId: string | null;
  /** The client can still comment and talk with Heili (else read-only). */
  canComment: boolean;
  origin: string | null;
  expiresAt: Date;
}

/**
 * Exchanges a launch code for a session. Checks, in order: the site exists
 * and is not revoked; the page's origin is one of its exact origins; the code
 * exists for this site, is not expired and not used (atomic); then the post
 * and the person (resolveSessionRow). Throws SiteAccessError.
 */
export async function exchangeLaunch(input: ExchangeInput, now = new Date()): Promise<{ session: string; view: SiteSessionView }> {
  if (!isSiteKey(input.siteKey)) throw new SiteAccessError("not_found");
  if (!CODE_PATTERN.test(input.code)) throw new SiteAccessError("code");
  const site = await prisma.websiteSite.findUnique({ where: { siteKey: input.siteKey } });
  if (!site || site.revokedAt) throw new SiteAccessError("not_found");
  if (!originAllowed(input.hostOrigin, site.origins)) throw new SiteAccessError("origin");

  const session = generateToken(32);
  const absolute = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  const launchHash = hashToken(input.code);
  const { count } = await prisma.websiteSession.updateMany({
    where: { launchHash, siteId: site.id, launchUsedAt: null, launchExpiresAt: { gt: now } },
    data: {
      launchUsedAt: now,
      sessionHash: hashToken(session),
      origin: input.hostOrigin.toLowerCase(),
      expiresAt: slidingExpiry(now, absolute),
      absoluteExpiresAt: absolute,
      lastUsedAt: now,
    },
  });
  if (count !== 1) throw new SiteAccessError("code");

  const row = await prisma.websiteSession.findUnique({ where: { launchHash }, include: { site: true } });
  if (!row) throw new SiteAccessError("code");
  const view = await checkSessionRow(row, now, { exchange: true });
  try {
    await prisma.websiteSite.update({ where: { id: site.id }, data: { lastSeenAt: now } });
  } catch {
    // Bookkeeping only.
  }
  return { session, view };
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

type SessionRow = Prisma.WebsiteSessionGetPayload<{ include: { site: true } }>;

/** The session behind a Bearer value, renewed (sliding); throws SiteAccessError. */
export async function resolveSiteSession(bearer: string | null | undefined, now = new Date()): Promise<SiteSessionView> {
  if (!bearer || !SESSION_PATTERN.test(bearer)) throw new SiteAccessError("expired");
  const row = await prisma.websiteSession.findUnique({ where: { sessionHash: hashToken(bearer) }, include: { site: true } });
  if (!row) throw new SiteAccessError("expired");
  const view = await checkSessionRow(row, now, { exchange: false });
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
    const expiresAt = slidingExpiry(now, row.absoluteExpiresAt!);
    try {
      await prisma.websiteSession.update({ where: { id: row.id }, data: { lastUsedAt: now, expiresAt } });
      view.expiresAt = expiresAt;
    } catch {
      // A failed renewal only shortens the session.
    }
  }
  return view;
}

/**
 * Everything a session must still satisfy: site active, not expired, the
 * person still allowed (active reviewer of a non-archived client of the post,
 * or a member of the post's workspace), the post visible and at the version
 * of the session.
 */
export async function checkSessionRow(row: SessionRow, now: Date, opts: { exchange: boolean }): Promise<SiteSessionView> {
  if (row.site.revokedAt) throw new SiteAccessError("not_found");
  if (!row.expiresAt || !row.absoluteExpiresAt || row.expiresAt <= now || row.absoluteExpiresAt <= now) {
    throw new SiteAccessError("expired");
  }
  const post = await prisma.post.findUnique({
    where: { id: row.postId },
    select: { id: true, status: true, currentVersionNumber: true, clientId: true, workspaceId: true, kind: true },
  });
  if (!post || post.kind !== "WEBSITE" || post.status === "CANCELLED" || post.status === "DRAFT") {
    throw new SiteAccessError("closed");
  }
  if (post.workspaceId !== row.site.workspaceId) throw new SiteAccessError("not_found");

  let reviewer: SiteSessionView["reviewer"] = null;
  if (row.role === "REVIEWER") {
    const person = row.reviewerId
      ? await prisma.clientReviewer.findUnique({ where: { id: row.reviewerId }, include: { client: true } })
      : null;
    if (!person || !person.active || person.client.archivedAt || person.clientId !== post.clientId) {
      throw new SiteAccessError("expired");
    }
    reviewer = { id: person.id, clientId: person.clientId, name: person.name };
  } else {
    const member = row.userId
      ? await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: post.workspaceId, userId: row.userId } },
          select: { id: true },
        })
      : null;
    if (!member) throw new SiteAccessError("expired");
  }

  const open = (SITE_OPEN_STATUSES as readonly string[]).includes(post.status);
  if (row.role === "REVIEWER") {
    if (post.currentVersionNumber !== row.versionNumber) throw new SiteAccessError("stale");
    if (opts.exchange && !open) throw new SiteAccessError("closed");
  }
  return {
    id: row.id,
    role: row.role,
    siteId: row.siteId,
    siteKey: row.site.siteKey,
    origins: row.site.origins,
    postId: row.postId,
    versionNumber: row.versionNumber,
    reviewer,
    userId: row.userId,
    focusCommentId: row.focusCommentId,
    canComment: row.role === "REVIEWER" && open,
    origin: row.origin,
    expiresAt: row.expiresAt,
  };
}

/** Cron: deletes used-up and expired rows (codes after 1 day, sessions after their absolute expiry). */
export async function sweepWebsiteSessions(now = new Date()): Promise<number> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const { count } = await prisma.websiteSession.deleteMany({
    where: {
      OR: [
        { launchUsedAt: null, launchExpiresAt: { lt: dayAgo } },
        { absoluteExpiresAt: { lt: now } },
      ],
    },
  });
  return count;
}
