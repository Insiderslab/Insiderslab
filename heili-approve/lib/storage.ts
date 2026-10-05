/**
 * Media storage on local disk (a Docker volume in production).
 *
 * Metricool downloads media from public URLs, so every upload is served by
 * app/media/[...key] under an unguessable key `<workspaceId>/<token>.<ext>`.
 * The file type is decided by sniffing the bytes, never by the client's
 * declared Content-Type or file name, and keys are validated against a strict
 * pattern before touching the filesystem (no path traversal).
 */

import { randomBytes } from "crypto";
import { mkdir, open, rename, rm } from "fs/promises";
import path from "path";
import type { MediaAsset } from "@/app/generated/prisma/client";
import { generateToken } from "@/lib/crypto";
import { prisma } from "@/lib/db/client";
import type { MediaItem, MediaType } from "@/lib/domain";
import { getBaseUrl, getUploadDir } from "@/lib/env";

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

export const ALLOWED_MEDIA = {
  "image/jpeg": { ext: "jpg", type: "image" },
  "image/png": { ext: "png", type: "image" },
  "image/webp": { ext: "webp", type: "image" },
  "image/gif": { ext: "gif", type: "image" },
  "video/mp4": { ext: "mp4", type: "video" },
  "video/quicktime": { ext: "mov", type: "video" },
} as const satisfies Record<string, { ext: string; type: MediaType }>;

export type AllowedMimeType = keyof typeof ALLOWED_MEDIA;

const EXT_TO_MIME: Record<string, AllowedMimeType> = Object.fromEntries(
  Object.entries(ALLOWED_MEDIA).map(([mime, { ext }]) => [ext, mime as AllowedMimeType])
);

/** Bytes kept in memory to sniff the type and read image dimensions. */
const HEAD_BYTES = 256 * 1024;

export class UploadError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
    this.name = "UploadError";
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return "";
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** Detects the real file type from its first bytes (needs ≥ 12 bytes). */
export function sniffMediaMime(head: Uint8Array): AllowedMimeType | null {
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && ascii(head, 1, 3) === "PNG" && head[4] === 0x0d && head[5] === 0x0a) return "image/png";
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "image/webp";

  const box = ascii(head, 4, 4);
  if (box === "ftyp") {
    // ISO base media: QuickTime declares the "qt  " major brand, the rest is MP4.
    return ascii(head, 8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  // Older QuickTime files start straight with one of these atoms.
  if (["moov", "mdat", "wide", "free", "skip", "pnot"].includes(box)) return "video/quicktime";
  return null;
}

/**
 * Pixel size of PNG / GIF / WebP / JPEG images from their header bytes.
 * Returns null when the header is truncated or unknown (dimensions are only
 * informative: previews fall back to the natural size).
 */
export function readImageDimensions(
  head: Uint8Array,
  mime: AllowedMimeType
): { width: number; height: number } | null {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const fits = (offset: number, length: number) => head.length >= offset + length;

  switch (mime) {
    case "image/png":
      if (!fits(16, 8)) return null;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    case "image/gif":
      if (!fits(6, 4)) return null;
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    case "image/webp": {
      const chunk = ascii(head, 12, 4);
      if (chunk === "VP8X" && fits(24, 6)) {
        const width = 1 + (head[24] | (head[25] << 8) | (head[26] << 16));
        const height = 1 + (head[27] | (head[28] << 8) | (head[29] << 16));
        return { width, height };
      }
      if (chunk === "VP8 " && fits(26, 4)) {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (chunk === "VP8L" && fits(21, 4)) {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    case "image/jpeg": {
      let offset = 2;
      while (fits(offset, 4)) {
        if (head[offset] !== 0xff) return null;
        const marker = head[offset + 1];
        // Fill bytes / standalone markers without a length.
        if (marker === 0xff) {
          offset += 1;
          continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const length = view.getUint16(offset + 2);
        const isStartOfFrame =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isStartOfFrame) {
          if (!fits(offset + 5, 4)) return null;
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        if (length < 2) return null;
        offset += 2 + length;
      }
      return null;
    }
    default:
      return null;
  }
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{16,128}\.(jpg|png|webp|gif|mp4|mov)$/;

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function buildStorageKey(workspaceId: string, mime: AllowedMimeType): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workspaceId)) {
    throw new Error("Invalid workspace id for a storage key");
  }
  return `${workspaceId}/${generateToken(24)}.${ALLOWED_MEDIA[mime].ext}`;
}

/**
 * Absolute path of a stored file, or null if the key is malformed or would
 * resolve outside the upload directory.
 */
export function resolveStoragePath(key: string, uploadDir: string = getUploadDir()): string | null {
  if (!isValidStorageKey(key)) return null;
  const root = path.resolve(uploadDir);
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

export function contentTypeForKey(key: string): AllowedMimeType | null {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

export function publicMediaUrl(key: string): string {
  return `${getBaseUrl()}/media/${key}`;
}

/** Inverse of publicMediaUrl for URLs pointing at this app; null otherwise. */
export function storageKeyFromMediaUrl(url: string): string | null {
  const prefix = `${getBaseUrl()}/media/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return isValidStorageKey(key) ? key : null;
}

export type ByteRange = { start: number; end: number };

/**
 * Parses a single-range `Range: bytes=...` header against a file size.
 * Returns null when there is no usable header (serve the whole file),
 * "unsatisfiable" for a 416, or the inclusive byte range for a 206.
 * Multi-range requests are answered with the whole file, as RFC 9110 allows.
 */
export function parseRangeHeader(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}

/** Keeps a user-provided file name readable but harmless (stored for display only). */
export function sanitizeFileName(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim().slice(0, 200);
  return cleaned || "file";
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export interface SaveMediaInput {
  workspaceId: string;
  fileName: string | null | undefined;
  source: ReadableStream<Uint8Array>;
  alt?: string;
  maxBytes?: number;
}

export interface SavedMedia {
  asset: MediaAsset;
  media: MediaItem;
}

/**
 * Streams an upload to disk (never buffering more than HEAD_BYTES), checks its
 * real type and size, then records the MediaAsset. The file is written to a
 * temporary name and only renamed once complete, so /media never serves a
 * partial file; any failure removes it.
 */
export async function saveMediaStream(input: SaveMediaInput): Promise<SavedMedia> {
  const maxBytes = input.maxBytes ?? MAX_UPLOAD_BYTES;
  const uploadDir = path.resolve(getUploadDir());
  const workspaceDir = path.join(uploadDir, input.workspaceId);
  await mkdir(workspaceDir, { recursive: true });

  const tempPath = path.join(workspaceDir, `.upload-${randomBytes(12).toString("hex")}.part`);
  const handle = await open(tempPath, "wx");
  const reader = input.source.getReader();

  let size = 0;
  let mime: AllowedMimeType | null = null;
  const headChunks: Uint8Array[] = [];
  let headLength = 0;
  let finalPath: string | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      size += value.byteLength;
      if (size > maxBytes) {
        throw new UploadError(`Il file supera il limite di ${Math.round(maxBytes / 1024 / 1024)} MB`, 413);
      }

      if (headLength < HEAD_BYTES) {
        headChunks.push(value);
        headLength += value.byteLength;
      }
      if (!mime && headLength >= 12) {
        mime = sniffMediaMime(concat(headChunks, headLength));
        if (!mime) throw unsupportedFormat();
      }

      await handle.write(value);
    }

    if (size === 0) throw new UploadError("Il file è vuoto");
    const head = concat(headChunks, Math.min(headLength, HEAD_BYTES));
    mime ??= sniffMediaMime(head);
    if (!mime) throw unsupportedFormat();

    await handle.close();

    const key = buildStorageKey(input.workspaceId, mime);
    finalPath = resolveStoragePath(key, uploadDir);
    if (!finalPath) throw new Error("Generated storage key failed validation");
    await rename(tempPath, finalPath);

    const dimensions = ALLOWED_MEDIA[mime].type === "image" ? readImageDimensions(head, mime) : null;
    const asset = await prisma.mediaAsset.create({
      data: {
        workspaceId: input.workspaceId,
        storageKey: key,
        fileName: sanitizeFileName(input.fileName),
        mimeType: mime,
        sizeBytes: size,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      },
    });

    return { asset, media: mediaItemForAsset(asset, input.alt) };
  } catch (error) {
    await reader.cancel().catch(() => {});
    await handle.close().catch(() => {});
    await rm(tempPath, { force: true }).catch(() => {});
    if (finalPath) await rm(finalPath, { force: true }).catch(() => {});
    throw error;
  }
}

function unsupportedFormat(): UploadError {
  return new UploadError("Formato non supportato: carica immagini JPG, PNG, WebP o GIF oppure video MP4 o MOV", 415);
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const slice = chunk.subarray(0, length - offset);
    out.set(slice, offset);
    offset += slice.byteLength;
  }
  return out;
}

export function mediaItemForAsset(
  asset: Pick<MediaAsset, "id" | "storageKey" | "mimeType">,
  alt?: string
): MediaItem {
  const mime = asset.mimeType as AllowedMimeType;
  return {
    url: publicMediaUrl(asset.storageKey),
    type: ALLOWED_MEDIA[mime]?.type ?? (asset.mimeType.startsWith("video/") ? "video" : "image"),
    mimeType: asset.mimeType,
    assetId: asset.id,
    ...(alt ? { alt } : {}),
  };
}
