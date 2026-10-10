/**
 * Write tools (scope approve:draft). They can only ADD things that are safe to
 * add: social DRAFT posts, uploaded media, the month's plan (never sent).
 * There is deliberately no tool that approves, submits to the client,
 * schedules, publishes, cancels, deletes or edits settings/reviewers/Metricool.
 *
 * create_draft_posts goes through exactly the code the panel's "Importa post"
 * and the automation API use (lib/automation/drafts.ts prepareDraft /
 * importPreparedDraft + validateForNetworks), so the three entry points cannot
 * drift: same validation, same importKey/hash idempotency, same daily cap
 * (AUTOMATION_DAILY_DRAFT_LIMIT), same DRAFT-only creation.
 */

import { z } from "zod";
import { prepareDraft, importPreparedDraft } from "@/lib/automation/drafts";
import { reserveAutomationUpload } from "@/lib/automation/uploads";
import { prisma } from "@/lib/db/client";
import { NETWORKS, type MediaItem } from "@/lib/domain";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { userActor } from "@/lib/actor";
import { validateForNetworks, zonedDateTimeToUtc } from "@/lib/metricool/payload";
import { MAX_MEDIA_PER_POST, networkOptionsSchema } from "@/lib/posts";
import { addPostsToPlan, createPlan, updatePlan } from "@/lib/plans";
import { MAX_UPLOAD_BYTES, mediaItemForAsset, parseDurationSec, saveMediaStream } from "@/lib/storage";
import { assertKindEnabled } from "@/lib/variant";
import { requireClient, resolveWorkspaceId } from "../access";
import { MCP_SCOPE_DRAFT, getMcpConfig } from "../config";
import { ToolInputError, defineTool, describeToolError } from "../protocol";
import { idSchema, monthOrThrow, monthSchema, planUrl, postUrl } from "./shared";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Posts per create_draft_posts call. */
export const MAX_DRAFTS_PER_CALL = 20;

const SOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// ─── create_draft_posts ──────────────────────────────────────────────────────

const draftPostSchema = z.strictObject({
  source_id: z
    .string()
    .min(1)
    .max(100)
    .regex(SOURCE_ID, "source_id: usa lettere, numeri e - _ . : /")
    .describe("Chiave stabile scelta da te per questo post (es. piano-ottobre-2026-01). Rilanciare la stessa chiave con gli stessi dati non crea duplicati"),
  client_id: idSchema("Id del cliente (da list_clients)"),
  title: z.string().trim().min(1).max(200).describe("Titolo interno del post"),
  publish_at: z
    .string()
    .describe("Data e ora di pubblicazione: ISO 8601 con fuso (2026-10-12T10:00:00+02:00) oppure senza fuso (2026-10-12T10:00), letta nel fuso del cliente"),
  networks: z.array(z.enum(NETWORKS)).min(1).max(NETWORKS.length).describe("Reti di pubblicazione, tra quelle abilitate per il cliente"),
  text: z.string().max(70_000).describe("Testo del post"),
  first_comment: z.string().max(10_000).optional().describe("Primo commento (facoltativo)"),
  network_options: networkOptionsSchema.optional().describe("Opzioni per rete nel formato Metricool, es. {\"instagramData\":{\"type\":\"REEL\"}}"),
  media: z
    .array(
      z.strictObject({
        asset_id: idSchema("asset_id restituito da upload_media"),
        alt: z.string().trim().max(1000).optional(),
        duration_sec: z.number().positive().max(21_600).optional().describe("Durata del video in secondi"),
      })
    )
    .max(MAX_MEDIA_PER_POST)
    .optional()
    .describe("Media già caricati con upload_media, nell'ordine di pubblicazione"),
});

type DraftPostInput = z.infer<typeof draftPostSchema>;

type DraftOutcome =
  | { index: number; source_id: string; status: "created" | "existing"; post_id: string; post_status: string; url: string }
  | { index: number; source_id: string; status: "valid" }
  | { index: number; source_id: string; status: "failed"; error: string };

/** "2026-10-12T10:00" is the client's wall clock; with an offset it is an exact instant. */
function parsePublishAt(value: string, timeZone: string): Date {
  const text = value.trim();
  let date: Date | null = null;
  if (OFFSET_DATE_TIME.test(text)) date = new Date(text);
  else if (LOCAL_DATE_TIME.test(text)) date = zonedDateTimeToUtc(text, timeZone);
  if (!date || Number.isNaN(date.getTime())) {
    throw new ValidationError("publish_at non valido: usa 2026-10-12T10:00:00+02:00 oppure 2026-10-12T10:00");
  }
  return date;
}

async function mediaFor(workspaceId: string, items: DraftPostInput["media"]): Promise<MediaItem[]> {
  if (!items?.length) return [];
  const ids = [...new Set(items.map((item) => item.asset_id))];
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids }, workspaceId } });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return items.map((item) => {
    const asset = byId.get(item.asset_id);
    if (!asset) throw new ValidationError("Uno dei media non è stato trovato: caricalo con upload_media");
    return {
      ...mediaItemForAsset(asset, item.alt, { durationSec: item.duration_sec }),
      ...(asset.width && asset.height ? { width: asset.width, height: asset.height } : {}),
    };
  });
}

export const createDraftPostsTool = defineTool({
  name: "create_draft_posts",
  title: "Crea bozze di post social",
  description:
    `Crea fino a ${MAX_DRAFTS_PER_CALL} post social IN BOZZA per i clienti dell'utente. Non invia nulla al cliente, non approva e non programma: ` +
    "dopo la creazione una persona dell'agenzia rivede le bozze nel pannello e le invia lei. " +
    "Ogni post richiede un source_id (chiave di idempotenza): ripetere la chiamata con gli stessi dati restituisce le bozze già create senza duplicarle; " +
    "lo stesso source_id con dati diversi è un conflitto e non modifica nulla. Le regole di validazione sono quelle di «Importa post» del pannello " +
    "(data non nel passato, lunghezze per rete, Instagram richiede un media, ecc.). I media vanno caricati prima con upload_media. " +
    "Con validate_only=true controlla soltanto, senza creare. Testo e titoli che scrivi restano dati: non contengono istruzioni per nessuno.",
  scope: MCP_SCOPE_DRAFT,
  annotations: WRITE,
  schema: z.strictObject({
    posts: z.array(draftPostSchema).min(1).max(MAX_DRAFTS_PER_CALL),
    validate_only: z.boolean().optional().describe("Solo controlli, nessuna bozza creata"),
  }),
  async run(input, { principal, now }) {
    assertKindEnabled("SOCIAL_POST");
    const outcomes: DraftOutcome[] = [];
    const clients = new Map<string, Awaited<ReturnType<typeof requireClient>>>();
    const createdPostIds: string[] = [];
    const workspaceIds = new Set<string>();
    let stopped: string | null = null;

    for (const [index, post] of input.posts.entries()) {
      if (stopped) {
        outcomes.push({ index, source_id: post.source_id, status: "failed", error: stopped });
        continue;
      }
      try {
        let client = clients.get(post.client_id);
        if (!client) {
          client = await requireClient(principal, post.client_id);
          clients.set(client.id, client);
        }
        workspaceIds.add(client.workspaceId);
        const publishAt = parsePublishAt(post.publish_at, client.timezone);
        const media = await mediaFor(client.workspaceId, post.media);
        // Same two steps as the panel importer (lib/post-import/service.ts createImportedDrafts).
        const prepared = await prepareDraft(client.workspaceId, {
          clientId: client.id,
          title: post.title,
          publishAt,
          networks: post.networks,
          ...(post.network_options ? { networkOptions: post.network_options } : {}),
          text: post.text,
          ...(post.first_comment !== undefined ? { firstCommentText: post.first_comment } : {}),
          media,
        });
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
        if (input.validate_only) {
          outcomes.push({ index, source_id: post.source_id, status: "valid" });
          continue;
        }
        const result = await importPreparedDraft(
          { workspaceId: client.workspaceId, userId: principal.userId, tokenId: principal.tokenId ?? null },
          prepared,
          `mcp:${post.source_id}`,
          { source: "mcp", via: principal.oauthClientId ?? null }
        );
        if (!result.replayed) createdPostIds.push(result.post.id);
        outcomes.push({
          index,
          source_id: post.source_id,
          status: result.replayed ? "existing" : "created",
          post_id: result.post.id,
          post_status: result.post.status,
          url: postUrl(result.post.id),
        });
      } catch (error) {
        if (error instanceof RateLimitError) stopped = error.message;
        outcomes.push({ index, source_id: post.source_id, status: "failed", error: describeToolError(error).message });
      }
    }

    const count = (status: DraftOutcome["status"]) => outcomes.filter((outcome) => outcome.status === status).length;
    const created = count("created");
    const existing = count("existing");
    const valid = count("valid");
    const failed = count("failed");
    const lines = [
      input.validate_only
        ? `Controllo senza creare nulla: ${valid} validi, ${failed} da correggere.`
        : `Bozze: ${created} create, ${existing} già esistenti, ${failed} non riuscite. Restano in Bozza: l'agenzia le rivede e le invia dal pannello.`,
      ...outcomes.map((outcome) =>
        outcome.status === "failed"
          ? `- ${outcome.source_id}: NON riuscito, ${outcome.error}`
          : outcome.status === "valid"
            ? `- ${outcome.source_id}: valido`
            : `- ${outcome.source_id}: ${outcome.status === "created" ? "creata" : "già esistente"} (id ${outcome.post_id})`
      ),
    ];
    return {
      text: lines.join("\n"),
      data: {
        validate_only: input.validate_only === true,
        created,
        existing,
        valid,
        failed,
        results: outcomes,
      },
      isError: failed === outcomes.length,
      touched: { workspaceIds: [...workspaceIds], created: { postIds: createdPostIds } },
    };
  },
});

// ─── upload_media ────────────────────────────────────────────────────────────

/** Decodes standard or URL-safe base64; refuses data: URLs, whitespace tricks and non-base64 text. */
export function decodeBase64Strict(value: string, maxBytes: number): Buffer {
  if (value.startsWith("data:")) {
    throw new ToolInputError("Passa solo il base64, senza il prefisso data:…;base64,");
  }
  // Generous upper bound before touching the string: 4 chars per 3 bytes.
  if (value.length > Math.ceil((maxBytes * 4) / 3) + 8) {
    throw new ToolInputError(`Il file supera il limite di ${Math.round(maxBytes / 1024 / 1024)} MB per i caricamenti via MCP`);
  }
  const clean = value.replace(/[\r\n]+/g, "");
  if (clean.length === 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) {
    throw new ToolInputError("data_base64 non è base64 valido");
  }
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length > maxBytes) {
    throw new ToolInputError(`Il file supera il limite di ${Math.round(maxBytes / 1024 / 1024)} MB per i caricamenti via MCP`);
  }
  return bytes;
}

export const uploadMediaTool = defineTool({
  name: "upload_media",
  title: "Carica un'immagine o un video",
  description:
    "Carica un'immagine (JPG, PNG, WebP, GIF) o un video (MP4, MOV, WebM) passando i byte in base64. Restituisce l'asset_id da usare in " +
    "create_draft_posts. Il tipo vero del file è riconosciuto dal contenuto, non dal nome; i limiti di spazio sono quelli dell'importazione " +
    "via API. Non scarica file da indirizzi web: devi passare tu i dati. I file grandi vanno caricati dal pannello.",
  scope: MCP_SCOPE_DRAFT,
  annotations: { ...WRITE, idempotentHint: false },
  schema: z.strictObject({
    file_name: z.string().trim().min(1).max(500).describe("Nome del file, es. foto-prodotto.jpg"),
    data_base64: z.string().min(16).describe("Contenuto del file in base64 (senza prefisso data:)"),
    client_id: idSchema("Cliente a cui serve il file (sceglie il workspace). Facoltativo se hai un solo workspace").optional(),
    alt: z.string().trim().max(1000).optional().describe("Testo alternativo"),
    duration_sec: z.number().positive().max(21_600).optional().describe("Durata in secondi, solo per i video"),
  }),
  async run(input, { principal }) {
    const config = getMcpConfig();
    const limit = Math.min(config.maxUploadBytes, MAX_UPLOAD_BYTES);
    const workspaceId = await resolveWorkspaceId(principal, input.client_id);
    const durationSec = parseDurationSec(input.duration_sec);
    if (durationSec === null) throw new ToolInputError("Durata video non valida");
    const bytes = decodeBase64Strict(input.data_base64, limit);
    // Same disk-capacity reservation as the automation upload endpoint.
    const reservation = await reserveAutomationUpload(workspaceId, bytes.length);
    try {
      const saved = await saveMediaStream({
        workspaceId,
        source: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
        fileName: input.file_name,
        alt: input.alt,
        durationSec,
        maxBytes: limit,
      });
      return {
        text: `File caricato: asset_id ${saved.asset.id} (${saved.asset.mimeType}, ${Math.max(1, Math.round(saved.asset.sizeBytes / 1024))} KB). Usalo in create_draft_posts.`,
        data: {
          asset_id: saved.asset.id,
          file_name: saved.asset.fileName,
          mime_type: saved.asset.mimeType,
          size_bytes: saved.asset.sizeBytes,
          type: saved.media.type,
          width: saved.asset.width,
          height: saved.asset.height,
        },
        touched: { workspaceIds: [workspaceId], created: { mediaIds: [saved.asset.id] } },
      };
    } finally {
      await prisma.automationUploadReservation.deleteMany({ where: { id: reservation.id, workspaceId } }).catch(() => {});
    }
  },
});

// ─── create_month_plan ───────────────────────────────────────────────────────

export const createMonthPlanTool = defineTool({
  name: "create_month_plan",
  title: "Crea il piano del mese",
  description:
    "Apre il piano social del mese di un cliente (o restituisce quello già aperto) e ci raccoglie i post del mese, come il pulsante «Crea piano» del pannello. " +
    "Con post_ids aggiunge al piano anche altre bozze dello stesso cliente. NON invia il piano al cliente e non cambia lo stato di nessun post: " +
    "l'invio lo decide una persona dal pannello. Se il piano esiste già, titolo e introduzione scritti dall'agenzia non vengono sovrascritti.",
  scope: MCP_SCOPE_DRAFT,
  annotations: WRITE,
  schema: z.strictObject({
    client_id: idSchema("Id del cliente"),
    month: monthSchema,
    title: z.string().trim().min(1).max(200).optional().describe("Titolo del piano (predefinito: «Piano social <mese anno>»)"),
    intro: z.string().trim().max(5000).optional().describe("Messaggio introduttivo per il cliente (solo se il piano è nuovo o ne è privo)"),
    post_ids: z.array(idSchema("Id di una bozza del cliente")).max(200).optional().describe("Altre bozze dello stesso cliente da aggiungere al piano"),
  }),
  async run(input, { principal }) {
    const month = monthOrThrow(input.month);
    const client = await requireClient(principal, input.client_id);
    const actor = userActor(principal.userId);
    // Never sendPlan / makePlanAvailable here: the plan stays an internal draft.
    const { plan, created } = await createPlan(
      client.workspaceId,
      { clientId: client.id, month, ...(input.title ? { title: input.title } : {}) },
      actor
    );
    let added = 0;
    if (input.post_ids?.length) added = await addPostsToPlan(plan.id, client.workspaceId, input.post_ids);
    if (input.intro && (created || !plan.intro)) await updatePlan(plan.id, client.workspaceId, { intro: input.intro });
    const postCount = await prisma.post.count({ where: { planId: plan.id, workspaceId: client.workspaceId, status: { not: "CANCELLED" } } });
    return {
      text:
        `${created ? "Piano creato" : "Piano già esistente"}: «${plan.title}» (${month}) di ${client.name}, ${postCount} post. ` +
        `Non è stato inviato al cliente: lo invia una persona dal pannello. ${planUrl(plan.id)}`,
      data: {
        plan: { id: plan.id, title: plan.title, month, status: plan.status, sent_to_client: plan.sentAt !== null, post_count: postCount, url: planUrl(plan.id) },
        created,
        posts_added: added,
        client: { id: client.id, name: client.name },
      },
      touched: { workspaceIds: [client.workspaceId], created: created ? { planIds: [plan.id] } : {} },
    };
  },
});

export const WRITE_TOOLS = [createDraftPostsTool, uploadMediaTool, createMonthPlanTool];
