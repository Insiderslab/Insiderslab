import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import type { NextRequest } from "next/server";
import { contentTypeForKey, parseRangeHeader, resolveStoragePath } from "@/lib/storage";

/**
 * Public media files (GET/HEAD /media/<workspaceId>/<token>.<ext>).
 *
 * Deliberately unauthenticated: Metricool and the social networks fetch these
 * URLs, and the client portal shows them. Access control is the unguessable
 * key. Range requests are supported so videos seek and play on iOS Safari,
 * which refuses to play mp4 without 206 responses.
 */

type MediaParams = { params: Promise<{ key: string[] }> };

async function serve(request: NextRequest, { params }: MediaParams, includeBody: boolean) {
  const { key: segments } = await params;
  const key = (segments ?? []).join("/");
  const filePath = resolveStoragePath(key);
  const contentType = contentTypeForKey(key);
  if (!filePath || !contentType) return notFound();

  let size: number;
  let mtime: Date;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return notFound();
    size = info.size;
    mtime = info.mtime;
  } catch {
    return notFound();
  }

  const etag = `"${size.toString(16)}-${Math.floor(mtime.getTime() / 1000).toString(16)}"`;
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    // Keys are content-addressed by a random token and never rewritten.
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
    "Last-Modified": mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  // If-Range: only honour the range when the client's copy is still current.
  const ifRange = request.headers.get("if-range");
  const rangeHeader = ifRange && ifRange !== etag ? null : request.headers.get("range");
  const range = parseRangeHeader(rangeHeader, size);

  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  headers.set("Content-Length", String(length));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  const status = range ? 206 : 200;

  if (!includeBody || length === 0) {
    return new Response(null, { status, headers });
  }

  const stream = createReadStream(filePath, { start, end });
  // Stop reading from disk when the client goes away (video scrubbing aborts
  // many requests mid-way).
  request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function GET(request: NextRequest, context: MediaParams) {
  return serve(request, context, true);
}

export function HEAD(request: NextRequest, context: MediaParams) {
  return serve(request, context, false);
}
