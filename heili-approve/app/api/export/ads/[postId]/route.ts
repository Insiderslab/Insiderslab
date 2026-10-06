import { createReadStream, type ReadStream } from "fs";
import { stat } from "fs/promises";
import { PassThrough, Readable } from "stream";
import JSZip from "jszip";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  adExportZipName,
  buildAdsCopyCsv,
  buildAdsReadme,
  coerceAdContent,
  planAdExportFiles,
  type PlannedExportFile,
} from "@/lib/content/ads";
import { listDecisions } from "@/lib/creative-decisions";
import { prisma } from "@/lib/db/client";
import { resolveStoragePath, storageKeyFromMediaUrl } from "@/lib/storage";
import { isKindEnabled } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

/**
 * Package of the approved ad creatives (GET /api/export/ads/<postId>).
 *
 * A ZIP with:
 * - the files of the variants the client APPROVED on the approved version,
 *   named `<cliente>_<campagna>_<variante>_<posizionamenti>.<ext>`;
 * - copy.csv (UTF-8 with BOM, ";"): variant, texts, CTA, URL, placements;
 * - README.txt: campaign, the client's decision and note on every variant
 *   (discarded ones included), the copy verbatim, external links.
 *
 * Agency-authenticated, workspace-scoped, AD_CREATIVE only, and only once the
 * set is APPROVED (or DELIVERED). Files are read from local storage through
 * their storage key, never fetched: media hosted elsewhere are listed in
 * README.txt as links. The ZIP is streamed (stored, not recompressed) and
 * capped at MAX_EXPORT_BYTES of media.
 */

const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;

const postIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

type ExportParams = { params: Promise<{ postId: string }> };

const APPROVED_STATUSES = new Set(["APPROVED", "DELIVERED"]);

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

interface ResolvedFile {
  planned: PlannedExportFile;
  path: string;
  size: number;
}

export async function GET(request: NextRequest, { params }: ExportParams) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return errorResponse("Non autorizzato", 401);

  const parsedId = postIdSchema.safeParse((await params).postId);
  if (!parsedId.success) return errorResponse("Creatività non trovate", 404);

  const post = await prisma.post.findFirst({
    where: { id: parsedId.data, workspaceId: context.workspaceId },
    select: {
      id: true,
      kind: true,
      status: true,
      approvedAt: true,
      currentVersionNumber: true,
      client: { select: { name: true, timezone: true } },
    },
  });
  // A kind this instance does not enable (APP_VARIANT) does not exist for it.
  if (!post || !isKindEnabled(post.kind)) return errorResponse("Creatività non trovate", 404);
  if (post.kind !== "AD_CREATIVE") return errorResponse("Questo contenuto non è un set di creatività ads", 400);
  if (!APPROVED_STATUSES.has(post.status)) {
    return errorResponse("Il cliente non ha ancora approvato questo set: il pacchetto si scarica dopo l'approvazione", 409);
  }

  // The version the client approved (the current one, unless the history says otherwise).
  const approval = await prisma.postEvent.findFirst({
    where: { postId: post.id, type: "APPROVED", versionNumber: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = approval?.versionNumber ?? post.currentVersionNumber;
  const version = await prisma.postVersion.findUnique({
    where: { postId_number: { postId: post.id, number: versionNumber } },
    select: { number: true, content: true },
  });
  if (!version) return errorResponse("Versione approvata non trovata", 404);

  const content = coerceAdContent(version.content);
  const decisions = await listDecisions(post.id, version.number);
  const approvedIds = new Set(decisions.filter((d) => d.verdict === "APPROVED").map((d) => d.variantId));
  const approvedVariants = content.variants.filter((v) => approvedIds.has(v.id));
  if (approvedVariants.length === 0) {
    return errorResponse("Nessuna variante approvata in questa versione: non c'è niente da esportare", 409);
  }

  const planned = planAdExportFiles({
    clientName: post.client.name,
    campaignName: content.campaign.name,
    variants: approvedVariants,
  });

  // Local files only: the key must be one of this workspace's uploads.
  const files: ResolvedFile[] = [];
  const externalMedia: Array<{ variantId: string; mediaIndex: number; url: string }> = [];
  const missingMedia: Array<{ variantId: string; mediaIndex: number; fileName: string }> = [];
  let totalBytes = 0;
  for (const entry of planned) {
    const key = storageKeyFromMediaUrl(entry.media.url);
    if (!key) {
      externalMedia.push({ variantId: entry.variantId, mediaIndex: entry.mediaIndex, url: entry.media.url });
      continue;
    }
    const path = key.startsWith(`${context.workspaceId}/`) ? resolveStoragePath(key) : null;
    const size = path ? await fileSize(path) : null;
    if (!path || size === null) {
      missingMedia.push({ variantId: entry.variantId, mediaIndex: entry.mediaIndex, fileName: entry.fileName });
      continue;
    }
    totalBytes += size;
    files.push({ planned: entry, path, size });
  }
  if (totalBytes > MAX_EXPORT_BYTES) {
    return errorResponse(
      "Il pacchetto supera 1 GB: scarica i video più pesanti singolarmente dalla scheda delle creatività",
      413
    );
  }

  const included = files.map((f) => f.planned);
  const readme = buildAdsReadme({
    clientName: post.client.name,
    campaign: content.campaign,
    versionNumber: version.number,
    approvedAt: post.approvedAt,
    generatedAt: new Date(),
    timeZone: post.client.timezone,
    variants: content.variants,
    decisions: decisions.map((d) => ({
      variantId: d.variantId,
      verdict: d.verdict,
      note: d.note,
      reviewerName: d.reviewer?.name ?? null,
      decidedAt: d.updatedAt,
    })),
    files: included,
    externalMedia,
    missingMedia,
  });

  const zip = new JSZip();
  const streams: ReadStream[] = [];
  for (const file of files) {
    const stream = createReadStream(file.path);
    streams.push(stream);
    // Images and videos are already compressed: store them as they are.
    zip.file(file.planned.fileName, stream, { binary: true, compression: "STORE" });
  }
  zip.file("copy.csv", buildAdsCopyCsv(approvedVariants, included), { compression: "DEFLATE" });
  zip.file("README.txt", readme, { compression: "DEFLATE" });

  // JSZip emits a readable-stream v2 stream: pipe it through a core
  // PassThrough so Readable.toWeb can adapt it with backpressure.
  const output = new PassThrough();
  const zipStream = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true });
  let finished = false;
  const stop = (error?: Error) => {
    if (finished) return;
    finished = true;
    zipStream.unpipe(output);
    for (const stream of streams) stream.destroy();
    if (error) {
      console.error("[export/ads] ZIP generation failed:", error.message);
      output.destroy(error);
    }
  };
  zipStream.on("error", (error: Error) => stop(error));
  for (const stream of streams) stream.on("error", (error) => stop(error));
  zipStream.on("end", () => {
    finished = true;
  });
  // Client gone (or the web stream cancelled): stop reading from disk.
  output.on("close", () => stop());
  request.signal.addEventListener("abort", () => {
    stop();
    output.destroy();
  }, { once: true });
  zipStream.pipe(output);

  const fileName = adExportZipName(post.client.name, content.campaign.name);
  const body = Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      // The name is a sanitized ASCII slug: safe to quote as is.
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}
