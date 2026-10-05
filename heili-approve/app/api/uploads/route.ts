import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { MAX_UPLOAD_BYTES, UploadError, parseDurationSec, saveMediaStream } from "@/lib/storage";

/**
 * Media upload for the post editor (agency only).
 *
 * Two request shapes are accepted:
 * - multipart/form-data with a `file` field (and optional `alt`, `durationSec`):
 *   the usual <input type="file"> / FormData upload;
 * - the raw file as the body (Content-Type image/* or video/*) with the name
 *   in an `X-File-Name` header (and optional `X-Alt`, `X-Duration-Sec`):
 *   streamed straight to disk, which is better for large videos since
 *   multipart parsing buffers the whole file in memory.
 *
 * Images (JPG, PNG, WebP, GIF) and videos (MP4, MOV, WebM) are accepted; the
 * type is sniffed from the bytes. `durationSec` is what the browser read from
 * a <video> element before uploading: it is kept on video media only.
 *
 * Response: { success: true, data: { asset, media } } where `media` is the
 * MediaItem to append to PostVersion.media (with `durationSec` for videos
 * when it was sent); `asset.durationSec` repeats it, or is null.
 */

// Multipart framing adds a little on top of the file itself.
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const fieldsSchema = z.object({
  alt: z.string().trim().max(1000).optional(),
  fileName: z.string().trim().max(500).optional(),
});

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return errorResponse("Non autorizzato", 401);

  const rawLength = request.headers.get("content-length");
  const declaredLength = rawLength !== null && /^\d+$/.test(rawLength.trim()) ? Number(rawLength) : null;
  if (declaredLength !== null && declaredLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return errorResponse("Il file supera il limite di 300 MB", 413);
  }

  const contentType = request.headers.get("content-type") ?? "";
  // formData() buffers the whole body in memory before the file size can be
  // checked: a multipart body must declare its length (browsers always do),
  // which the HTTP server then enforces, so a chunked body cannot exhaust it.
  if (contentType.startsWith("multipart/form-data") && declaredLength === null) {
    return errorResponse("Lunghezza della richiesta mancante", 411);
  }

  try {
    let source: ReadableStream<Uint8Array>;
    let fileName: string | undefined;
    let alt: string | undefined;
    let rawDuration: unknown;

    if (contentType.startsWith("multipart/form-data")) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return errorResponse("Richiesta di caricamento non valida", 400);
      }
      const file = form.get("file");
      if (!(file instanceof File)) return errorResponse("Nessun file ricevuto", 400);
      if (file.size > MAX_UPLOAD_BYTES) return errorResponse("Il file supera il limite di 300 MB", 413);

      const fields = fieldsSchema.safeParse({
        alt: typeof form.get("alt") === "string" ? form.get("alt") : undefined,
      });
      if (!fields.success) return errorResponse("Testo alternativo non valido", 400);

      source = file.stream();
      fileName = file.name;
      alt = fields.data.alt || undefined;
      rawDuration = form.get("durationSec") ?? undefined;
    } else if (/^(image|video)\//.test(contentType)) {
      if (!request.body) return errorResponse("Nessun file ricevuto", 400);
      const rawName = request.headers.get("x-file-name");
      const fields = fieldsSchema.safeParse({
        fileName: rawName ? safeDecode(rawName) : undefined,
        alt: request.headers.get("x-alt") ? safeDecode(request.headers.get("x-alt")!) : undefined,
      });
      if (!fields.success) return errorResponse("Intestazioni di caricamento non valide", 400);

      source = request.body;
      fileName = fields.data.fileName;
      alt = fields.data.alt || undefined;
      rawDuration = request.headers.get("x-duration-sec") ?? undefined;
    } else {
      return errorResponse("Formato della richiesta non supportato", 415);
    }

    const durationSec = parseDurationSec(rawDuration);
    if (durationSec === null) return errorResponse("Durata del video non valida", 400);

    const saved = await saveMediaStream({
      workspaceId: context.workspaceId,
      fileName,
      source,
      alt,
      durationSec,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          asset: {
            id: saved.asset.id,
            fileName: saved.asset.fileName,
            mimeType: saved.asset.mimeType,
            sizeBytes: saved.asset.sizeBytes,
            width: saved.asset.width,
            height: saved.asset.height,
            durationSec: saved.media.durationSec ?? null,
            url: saved.media.url,
          },
          media: saved.media,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof UploadError) return errorResponse(error.message, error.status);
    console.error("[uploads] Upload failed:", error);
    return errorResponse("Caricamento non riuscito. Riprova tra poco.", 500);
  }
}

/** Header values are percent-encoded by the client to carry non-ASCII names. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
