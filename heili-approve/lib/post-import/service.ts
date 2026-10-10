/**
 * "Importa post" — server side of the agency panel's importer.
 *
 * `checkImportRows` is the preview: every row goes through the same pure
 * evaluation the browser shows (lib/post-import/rows.ts) and then through the
 * domain validation the automation API uses (lib/automation/drafts.ts →
 * validatePostDraft), with no writes. `createImportedDrafts` runs both again —
 * nothing the browser says is trusted — and creates the drafts with
 * `importPreparedDraft`, so a row imported twice (same content, same
 * pictures) is the same post, never a copy.
 *
 * Only DRAFTs are created: nothing here submits, approves or schedules. The
 * optional plan only groups the new drafts (lib/plans.ts).
 */

import { createHash } from "node:crypto";
import { userActor } from "@/lib/actor";
import { AutomationError } from "@/lib/automation/auth";
import { importPreparedDraft, prepareDraft, type DraftContext } from "@/lib/automation/drafts";
import { clientHasService, serviceNotActiveMessage } from "@/lib/clients";
import { prisma } from "@/lib/db/client";
import type { MediaItem } from "@/lib/domain";
import { NotFoundError, RateLimitError, ValidationError, isDomainError, publicErrorMessage } from "@/lib/errors";
import { validateForNetworks } from "@/lib/metricool/payload";
import { addPostsToPlan, createPlan } from "@/lib/plans";
import { assertKindEnabled } from "@/lib/variant";
import {
  MAX_IMPORT_ROWS,
  draftFingerprint,
  draftMonth,
  evaluateRow,
  fileKey,
  type FileRef,
  type RawRow,
  type RowDraft,
  type RowEvaluation,
  type RowIssue,
} from "./rows";

export interface ImportRequest {
  clientId: string;
  rows: RawRow[];
  /** Descriptors of the files dropped on the page (names are matched by the rows). */
  files: FileRef[];
}

export interface RowCheck {
  ok: boolean;
  issues: RowIssue[];
  /** importKey of the draft; null while the row is invalid. */
  key: string | null;
  /** The post an earlier import already created from this very row. */
  existing: { postId: string; status: string } | null;
  /** "YYYY-MM" the post falls in (client's zone). */
  month: string | null;
}

interface ImportClient {
  id: string;
  timezone: string;
  networks: string[];
}

async function loadClient(workspaceId: string, clientId: string): Promise<ImportClient> {
  assertKindEnabled("SOCIAL_POST");
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId } });
  if (!client) throw new NotFoundError("Cliente non trovato");
  if (client.archivedAt) throw new ValidationError("Il cliente è archiviato");
  if (!clientHasService(client, "SOCIAL_POST")) throw new ValidationError(serviceNotActiveMessage("SOCIAL_POST"));
  return { id: client.id, timezone: client.timezone, networks: client.networks };
}

function assertRequest(request: ImportRequest) {
  if (request.rows.length === 0) throw new ValidationError("Non ci sono righe da importare");
  if (request.rows.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(`Puoi importare al massimo ${MAX_IMPORT_ROWS} righe alla volta`);
  }
}

/**
 * Stable id of a row's draft in `Post.importKey`: a hash of what the post is
 * (client, instant, networks, texts, picture names and sizes), not of where it
 * sat in the sheet. Identical rows of one import get ".2", ".3"…
 */
export function importKeys(clientId: string, drafts: Array<RowDraft | null>): Array<string | null> {
  const seen = new Map<string, number>();
  return drafts.map((draft) => {
    if (!draft) return null;
    const base = createHash("sha256").update(draftFingerprint(clientId, draft)).digest("hex").slice(0, 32);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return `panel:${base}${count > 1 ? `.${count}` : ""}`;
  });
}

function contentHash(clientId: string, draft: RowDraft): string {
  return createHash("sha256").update(draftFingerprint(clientId, draft)).digest("hex");
}

function postInput(clientId: string, draft: RowDraft, media: MediaItem[]) {
  return {
    clientId,
    title: draft.title,
    publishAt: draft.publishAt,
    networks: draft.networks,
    networkOptions: draft.networkOptions,
    text: draft.text,
    firstCommentText: draft.firstComment,
    media,
  };
}

/** The message of whatever a domain check threw, in Italian. */
function problemMessage(error: unknown): string {
  if (error instanceof AutomationError) return error.message;
  return publicErrorMessage(error);
}

function evaluateAll(client: ImportClient, request: ImportRequest, now: Date): RowEvaluation[] {
  return request.rows.map((row) =>
    evaluateRow(row, { timeZone: client.timezone, now, clientNetworks: client.networks, files: request.files })
  );
}

/** Preview: validates every row, writes nothing. */
export async function checkImportRows(
  workspaceId: string,
  request: ImportRequest,
  now: Date = new Date()
): Promise<RowCheck[]> {
  assertRequest(request);
  const client = await loadClient(workspaceId, request.clientId);
  const evaluations = evaluateAll(client, request, now);
  const keys = importKeys(client.id, evaluations.map((e) => e.draft));

  const existing = await prisma.post.findMany({
    where: { workspaceId, importKey: { in: keys.filter((k): k is string => k !== null) } },
    select: { id: true, importKey: true, status: true },
  });
  const byKey = new Map(existing.map((post) => [post.importKey, post]));

  const checks: RowCheck[] = [];
  for (const [index, evaluation] of evaluations.entries()) {
    const issues = [...evaluation.issues];
    const key = keys[index];
    const found = key ? byKey.get(key) : undefined;
    // A row that is already a post needs no checks: it will not be created again.
    if (evaluation.draft && !found) {
      try {
        // The same domain validation as the automation API (no media yet: they are uploaded on creation).
        await prepareDraft(workspaceId, postInput(client.id, evaluation.draft, []));
      } catch (error) {
        issues.push({ field: "row", message: problemMessage(error) });
      }
    }
    checks.push({
      ok: issues.length === 0,
      issues,
      key: issues.length === 0 ? key : null,
      existing: found ? { postId: found.id, status: found.status } : null,
      month: evaluation.draft ? draftMonth(evaluation.draft) : null,
    });
  }
  return checks;
}

export interface CreateRequest extends ImportRequest {
  /** MediaItems returned by /api/uploads, by file key (lowercase name). */
  uploaded: Record<string, MediaItem>;
  /** Also open the month's plan and put the drafts in it. */
  plan: boolean;
}

export type RowOutcome =
  | { index: number; status: "created" | "existing"; postId: string; title: string }
  | { index: number; status: "failed"; error: string };

export type PlanOutcome =
  | { status: "ok"; id: string; title: string; month: string; created: boolean }
  | { status: "error"; message: string };

export interface ImportResult {
  outcomes: RowOutcome[];
  created: number;
  existing: number;
  failed: number;
  plan: PlanOutcome | null;
}

/** Creates the drafts of the valid rows (the others are reported as failed) and, if asked, the month's plan. */
export async function createImportedDrafts(
  context: DraftContext,
  request: CreateRequest,
  now: Date = new Date()
): Promise<ImportResult> {
  assertRequest(request);
  const client = await loadClient(context.workspaceId, request.clientId);
  const evaluations = evaluateAll(client, request, now);
  const keys = importKeys(client.id, evaluations.map((e) => e.draft));

  // Rows an earlier import already turned into posts are replayed, not created again
  // (the key is derived from the row's content, so their pictures need no upload either).
  const known = await prisma.post.findMany({
    where: { workspaceId: context.workspaceId, importKey: { in: keys.filter((k): k is string => k !== null) } },
    select: { id: true, importKey: true },
  });
  const knownByKey = new Map(known.map((post) => [post.importKey, post.id]));

  const outcomes: RowOutcome[] = [];
  const posts: Array<{ id: string; month: string }> = [];
  let stopped: string | null = null;

  for (const [index, evaluation] of evaluations.entries()) {
    const draft = evaluation.draft;
    const key = keys[index];
    if (!draft || !key) {
      outcomes.push({ index, status: "failed", error: evaluation.issues[0]?.message ?? "Riga non valida" });
      continue;
    }
    const knownId = knownByKey.get(key);
    if (knownId) {
      outcomes.push({ index, status: "existing", postId: knownId, title: draft.title });
      posts.push({ id: knownId, month: draftMonth(draft) });
      continue;
    }
    if (stopped) {
      outcomes.push({ index, status: "failed", error: stopped });
      continue;
    }
    try {
      const media: MediaItem[] = draft.files.map((file) => {
        const item = request.uploaded[fileKey(file.name)];
        if (!item) throw new ValidationError(`«${file.name}» non è stato caricato: riprova.`);
        return item;
      });
      const prepared = await prepareDraft(context.workspaceId, postInput(client.id, draft, media));
      // Publishing rules on the real, normalized media — the same function the preview used.
      const rules = validateForNetworks({
        networks: prepared.post.networks,
        networkOptions: prepared.post.networkOptions,
        text: prepared.post.text ?? "",
        firstCommentText: prepared.post.firstCommentText ?? null,
        media: prepared.post.media,
        publishAt: prepared.post.publishAt,
        timezone: client.timezone,
        now,
      });
      if (rules.length > 0) throw new ValidationError(rules.map((issue) => issue.message).join(" "));

      const result = await importPreparedDraft(context, prepared, key, {
        hash: contentHash(client.id, draft),
        source: "panel",
      });
      outcomes.push({
        index,
        status: result.replayed ? "existing" : "created",
        postId: result.post.id,
        title: draft.title,
      });
      posts.push({ id: result.post.id, month: draftMonth(draft) });
    } catch (error) {
      if (error instanceof RateLimitError) stopped = error.message;
      if (!isDomainError(error) && !(error instanceof AutomationError)) {
        console.error("[post-import] Row failed:", error instanceof Error ? error.name : "unknown");
      }
      outcomes.push({ index, status: "failed", error: problemMessage(error) });
    }
  }

  const plan = request.plan ? await attachToPlan(context, client, posts) : null;
  return {
    outcomes,
    created: outcomes.filter((o) => o.status === "created").length,
    existing: outcomes.filter((o) => o.status === "existing").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    plan,
  };
}

/** The month's plan (opened, or the existing one) with the imported drafts in it. */
async function attachToPlan(
  context: DraftContext,
  client: ImportClient,
  posts: Array<{ id: string; month: string }>
): Promise<PlanOutcome> {
  const months = [...new Set(posts.map((post) => post.month))];
  if (posts.length === 0) return { status: "error", message: "Nessuna bozza da mettere nel piano." };
  if (months.length !== 1) {
    return { status: "error", message: "Le righe sono in mesi diversi: il piano riguarda un mese solo, crealo dalla pagina dei piani." };
  }
  try {
    const { plan, created } = await createPlan(
      context.workspaceId,
      { clientId: client.id, month: months[0] },
      userActor(context.userId)
    );
    if (!created) {
      // An existing plan: add the drafts that belong to no plan yet.
      const free = await prisma.post.findMany({
        where: { id: { in: posts.map((post) => post.id) }, workspaceId: context.workspaceId, planId: null },
        select: { id: true },
      });
      if (free.length > 0) await addPostsToPlan(plan.id, context.workspaceId, free.map((post) => post.id));
    }
    return { status: "ok", id: plan.id, title: plan.title, month: months[0], created };
  } catch (error) {
    if (!isDomainError(error)) console.error("[post-import] Plan failed:", error instanceof Error ? error.name : "unknown");
    return { status: "error", message: `Le bozze sono state create, ma il piano no: ${publicErrorMessage(error)}` };
  }
}
