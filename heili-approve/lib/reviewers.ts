/**
 * Client reviewers and their personal review links (/review/<token>).
 *
 * The token is the only credential a reviewer has, so it is random (32 bytes),
 * looked up by its SHA-256 hash (a DB leak does not leak working links) and
 * also stored AES-encrypted so the agency can copy or re-send the same link.
 * Rotating the link invalidates the old one immediately.
 */

import { z } from "zod";
import type { Client, ClientReviewer } from "@/app/generated/prisma/client";
import { Prisma } from "@/app/generated/prisma/client";
import { decryptSecret, encryptSecret, generateToken, hashToken } from "@/lib/crypto";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { renderEmail, sendEmail } from "@/lib/email";
import { ConflictError, NotFoundError, ValidationError, parseOrThrow } from "@/lib/errors";

/** lastSeenAt is refreshed at most this often, to avoid a write per page view. */
export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export const reviewerInputSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome del referente").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Indirizzo email non valido"))
    .pipe(z.string().max(254)),
});

export type ReviewerInput = z.input<typeof reviewerInputSchema>;

export type ReviewerWithClient = ClientReviewer & { client: Client };

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Fresh link token plus the two forms persisted in the DB. */
export function issueReviewerToken(): { token: string; tokenHash: string; tokenEncrypted: string } {
  const token = generateToken();
  return { token, tokenHash: hashToken(token), tokenEncrypted: encryptSecret(token) };
}

export function buildReviewUrl(token: string): string {
  return `${getBaseUrl()}/review/${encodeURIComponent(token)}`;
}

/**
 * Cheap shape check before hashing/querying: tokens are base64url from
 * generateToken(). Rejects junk from crawlers and over-long inputs.
 */
export function isPlausibleReviewToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function shouldTouchLastSeen(lastSeenAt: Date | null, now: Date = new Date()): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Decrypts the stored token into the full review URL. Server-side only. */
export function getReviewUrl(reviewer: Pick<ClientReviewer, "tokenEncrypted">): string {
  return buildReviewUrl(decryptSecret(reviewer.tokenEncrypted));
}

export async function listReviewers(clientId: string, workspaceId: string): Promise<ClientReviewer[]> {
  await findClientOrThrow(clientId, workspaceId);
  return prisma.clientReviewer.findMany({
    where: { clientId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Adds a reviewer to a client. Re-adding a deactivated reviewer with the same
 * email reactivates them with a brand new link.
 */
export async function createReviewer(
  clientId: string,
  workspaceId: string,
  input: ReviewerInput
): Promise<{ reviewer: ClientReviewer; reviewUrl: string }> {
  const data = parseOrThrow(reviewerInputSchema, input);
  const client = await findClientOrThrow(clientId, workspaceId);
  if (client.archivedAt) throw new ValidationError("Il cliente è archiviato");

  const issued = issueReviewerToken();
  const existing = await prisma.clientReviewer.findUnique({
    where: { clientId_email: { clientId, email: data.email } },
  });

  if (existing?.active) {
    throw new ConflictError("Esiste già un referente con questa email per il cliente");
  }

  try {
    const reviewer = existing
      ? await prisma.clientReviewer.update({
          where: { id: existing.id },
          data: {
            name: data.name,
            active: true,
            tokenHash: issued.tokenHash,
            tokenEncrypted: issued.tokenEncrypted,
          },
        })
      : await prisma.clientReviewer.create({
          data: {
            clientId,
            name: data.name,
            email: data.email,
            tokenHash: issued.tokenHash,
            tokenEncrypted: issued.tokenEncrypted,
          },
        });
    return { reviewer, reviewUrl: buildReviewUrl(issued.token) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Esiste già un referente con questa email per il cliente");
    }
    throw error;
  }
}

export async function updateReviewer(
  reviewerId: string,
  workspaceId: string,
  input: Partial<ReviewerInput>
): Promise<ClientReviewer> {
  const data = parseOrThrow(reviewerInputSchema.partial(), input);
  await findReviewerOrThrow(reviewerId, workspaceId);
  try {
    return await prisma.clientReviewer.update({
      where: { id: reviewerId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Esiste già un referente con questa email per il cliente");
    }
    throw error;
  }
}

/** New link for the reviewer; the previous one stops working immediately. */
export async function rotateReviewerLink(
  reviewerId: string,
  workspaceId: string
): Promise<{ reviewer: ClientReviewer; reviewUrl: string }> {
  await findReviewerOrThrow(reviewerId, workspaceId);
  const issued = issueReviewerToken();
  const reviewer = await prisma.clientReviewer.update({
    where: { id: reviewerId },
    data: { tokenHash: issued.tokenHash, tokenEncrypted: issued.tokenEncrypted },
  });
  return { reviewer, reviewUrl: buildReviewUrl(issued.token) };
}

/** Disables the link and stops emails. The row stays for the audit log. */
export async function deactivateReviewer(reviewerId: string, workspaceId: string): Promise<ClientReviewer> {
  await findReviewerOrThrow(reviewerId, workspaceId);
  return prisma.clientReviewer.update({ where: { id: reviewerId }, data: { active: false } });
}

/**
 * Emails the reviewer their personal link ("Reinvia link").
 * Returns false when the email could not be sent.
 */
export async function sendReviewerLink(reviewerId: string, workspaceId: string): Promise<boolean> {
  const reviewer = await findReviewerOrThrow(reviewerId, workspaceId);
  if (!reviewer.active) throw new ValidationError("Il referente è disattivato");

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  });
  const { html, text } = renderEmail({
    heading: `Il tuo link per approvare i post di ${reviewer.client.name}`,
    paragraphs: [
      `Ciao ${reviewer.name},`,
      `${workspace?.name ?? "L'agenzia"} usa Approve by Heili per farti rivedere i post prima della pubblicazione. Da questo link personale puoi vedere le anteprime, commentare e approvare, senza password.`,
      "Il link è personale: non inoltrarlo.",
    ],
    cta: { label: "Apri i post da rivedere", url: getReviewUrl(reviewer) },
  });
  const result = await sendEmail({
    to: reviewer.email,
    subject: `Link per la revisione dei post di ${reviewer.client.name}`,
    html,
    text,
  });
  return result.ok;
}

/**
 * Authenticates a client portal request. Returns null for unknown, rotated or
 * deactivated links and for archived clients — callers answer 404 without
 * saying which.
 */
export async function resolveReviewerToken(token: string): Promise<ReviewerWithClient | null> {
  if (!isPlausibleReviewToken(token)) return null;

  const reviewer = await prisma.clientReviewer.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { client: true },
  });
  if (!reviewer || !reviewer.active || reviewer.client.archivedAt) return null;

  const now = new Date();
  if (shouldTouchLastSeen(reviewer.lastSeenAt, now)) {
    // Best effort: a failed bookkeeping write must not lock the client out.
    try {
      await prisma.clientReviewer.updateMany({
        where: {
          id: reviewer.id,
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_THROTTLE_MS) } }],
        },
        data: { lastSeenAt: now },
      });
      reviewer.lastSeenAt = now;
    } catch (error) {
      console.error("[reviewers] Failed to update lastSeenAt:", error);
    }
  }

  return reviewer;
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function findClientOrThrow(clientId: string, workspaceId: string): Promise<Client> {
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId } });
  if (!client) throw new NotFoundError("Cliente non trovato");
  return client;
}

async function findReviewerOrThrow(reviewerId: string, workspaceId: string): Promise<ReviewerWithClient> {
  const reviewer = await prisma.clientReviewer.findFirst({
    where: { id: reviewerId, client: { workspaceId } },
    include: { client: true },
  });
  if (!reviewer) throw new NotFoundError("Referente non trovato");
  return reviewer;
}
