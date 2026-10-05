import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStorageKey,
  contentTypeForKey,
  isValidStorageKey,
  parseRangeHeader,
  readImageDimensions,
  resolveStoragePath,
  sanitizeFileName,
  sniffMediaMime,
  storageKeyFromMediaUrl,
  publicMediaUrl,
} from "../lib/storage";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("PUBLIC_BASE_URL", "https://approve.example.com");
});

const bytes = (...values: Array<number | string>) =>
  new Uint8Array(
    values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v]))
  );

describe("storage keys", () => {
  it("builds unguessable keys that pass validation", () => {
    const key = buildStorageKey("cmabc123", "video/mp4");
    expect(key).toMatch(/^cmabc123\/[A-Za-z0-9_-]{32}\.mp4$/);
    expect(isValidStorageKey(key)).toBe(true);
    expect(buildStorageKey("cmabc123", "video/mp4")).not.toBe(key);
  });

  it("rejects traversal and malformed keys", () => {
    const root = "/srv/uploads";
    for (const key of [
      "../etc/passwd",
      "ws/../../etc/passwd.jpg",
      "ws/..%2F..%2Fsecret0000000000.jpg",
      "/etc/aaaaaaaaaaaaaaaaaaaa.jpg",
      "ws/sub/aaaaaaaaaaaaaaaaaaaa.jpg",
      "ws/aaaaaaaaaaaaaaaaaaaa.svg",
      "ws/aaaaaaaaaaaaaaaaaaaa.jpg\0.png",
      "ws/short.jpg",
      "",
    ]) {
      expect(resolveStoragePath(key, root)).toBeNull();
    }
    expect(resolveStoragePath("ws/aaaaaaaaaaaaaaaaaaaa.jpg", root)).toBe(path.join(root, "ws/aaaaaaaaaaaaaaaaaaaa.jpg"));
  });

  it("maps keys to content types and public URLs", () => {
    expect(contentTypeForKey("ws/aaaaaaaaaaaaaaaaaaaa.mov")).toBe("video/quicktime");
    expect(contentTypeForKey("ws/aaaaaaaaaaaaaaaaaaaa.exe")).toBeNull();
    const key = "ws/aaaaaaaaaaaaaaaaaaaa.jpg";
    expect(publicMediaUrl(key)).toBe("https://approve.example.com/media/ws/aaaaaaaaaaaaaaaaaaaa.jpg");
    expect(storageKeyFromMediaUrl(publicMediaUrl(key))).toBe(key);
    expect(storageKeyFromMediaUrl("https://elsewhere.com/media/" + key)).toBeNull();
  });

  it("sanitises display file names", () => {
    expect(sanitizeFileName("../../evil<script>.jpg")).toBe("evilscript.jpg");
    expect(sanitizeFileName("C:\\Users\\me\\foto estate.png")).toBe("foto estate.png");
    expect(sanitizeFileName("")).toBe("file");
  });
});

describe("type sniffing", () => {
  it("recognises allowed formats by their bytes", () => {
    expect(sniffMediaMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("image/jpeg");
    expect(sniffMediaMime(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe("image/png");
    expect(sniffMediaMime(bytes("GIF89a", 0, 0, 0, 0, 0, 0))).toBe("image/gif");
    expect(sniffMediaMime(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image/webp");
    expect(sniffMediaMime(bytes(0, 0, 0, 0x20, "ftyp", "isom"))).toBe("video/mp4");
    expect(sniffMediaMime(bytes(0, 0, 0, 0x14, "ftyp", "qt  "))).toBe("video/quicktime");
  });

  it("rejects everything else, whatever the extension", () => {
    expect(sniffMediaMime(bytes("<svg xmlns='x'>"))).toBeNull();
    expect(sniffMediaMime(bytes("<!doctype html>"))).toBeNull();
    expect(sniffMediaMime(bytes("%PDF-1.7 aaaaa"))).toBeNull();
    expect(sniffMediaMime(bytes(0xff, 0xd8))).toBeNull();
  });

  it("reads image dimensions from headers", () => {
    const png = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, "IHDR", 0, 0, 4, 56, 0, 0, 5, 70);
    expect(readImageDimensions(png, "image/png")).toEqual({ width: 1080, height: 1350 });

    const gif = bytes("GIF89a", 0x38, 0x04, 0x38, 0x04);
    expect(readImageDimensions(gif, "image/gif")).toEqual({ width: 1080, height: 1080 });

    // SOI, APP0 (length 16), SOF0 with height 1350 / width 1080.
    const jpeg = bytes(
      0xff, 0xd8,
      0xff, 0xe0, 0, 16, "JFIF", 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
      0xff, 0xc0, 0, 17, 8, 0x05, 0x46, 0x04, 0x38, 3
    );
    expect(readImageDimensions(jpeg, "image/jpeg")).toEqual({ width: 1080, height: 1350 });
    expect(readImageDimensions(bytes(0xff, 0xd8, 0xff), "image/jpeg")).toBeNull();
  });
});

describe("Range header", () => {
  it("serves the whole file without a usable header", () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
    expect(parseRangeHeader("bytes=-", 1000)).toBeNull();
    expect(parseRangeHeader("items=0-10", 1000)).toBeNull();
    expect(parseRangeHeader("bytes=0-10,20-30", 1000)).toBeNull();
  });

  it("parses open, closed and suffix ranges", () => {
    expect(parseRangeHeader("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRangeHeader("bytes=0-1", 1000)).toEqual({ start: 0, end: 1 });
    expect(parseRangeHeader("bytes=500-5000", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("flags unsatisfiable ranges", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=10-5", 1000)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});
