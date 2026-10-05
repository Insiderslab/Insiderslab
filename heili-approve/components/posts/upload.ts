/**
 * Browser-side media upload for the post editor: reads a video's duration,
 * then sends the file to POST /api/uploads with progress events.
 *
 * Known image/video types go as the raw request body (streamed to disk by the
 * route, which matters for 300 MB videos); anything else falls back to
 * multipart and lets the server sniff and reject it.
 */

import type { MediaItem } from "@/lib/domain";

export const MAX_UPLOAD_MB = 300;
export const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

const RAW_TYPES = new Set(ACCEPTED_MEDIA.split(","));

/** Duration of a local video file in seconds, or undefined when the browser cannot read it. */
export function readVideoDuration(file: File, timeoutMs = 15_000): Promise<number | undefined> {
  if (!file.type.startsWith("video/")) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (value: number | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const duration = video.duration;
      finish(Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : undefined);
    };
    video.onerror = () => finish(undefined);
    video.src = url;
  });
}

export class UploadFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadFailed";
  }
}

/**
 * Uploads one file and resolves with the MediaItem to add to the post.
 * `onProgress` receives 0..1; `signal` aborts the request.
 */
export function uploadMedia(
  file: File,
  options: { durationSec?: number; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}
): Promise<MediaItem> {
  const { durationSec, onProgress, signal } = options;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return Promise.reject(new UploadFailed(`Il file supera il limite di ${MAX_UPLOAD_MB} MB.`));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";

    let body: Document | XMLHttpRequestBodyInit;
    if (RAW_TYPES.has(file.type)) {
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      if (durationSec !== undefined) xhr.setRequestHeader("X-Duration-Sec", String(durationSec));
      body = file;
    } else {
      const form = new FormData();
      form.append("file", file);
      if (durationSec !== undefined) form.append("durationSec", String(durationSec));
      body = form;
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const response = xhr.response as
        | { success: true; data: { media: MediaItem } }
        | { success: false; error?: string }
        | null;
      if (xhr.status >= 200 && xhr.status < 300 && response && response.success) {
        onProgress?.(1);
        resolve(response.data.media);
        return;
      }
      if (xhr.status === 401) {
        reject(new UploadFailed("Sessione scaduta: accedi di nuovo."));
        return;
      }
      const message = response && !response.success && response.error ? response.error : "Caricamento non riuscito.";
      reject(new UploadFailed(message));
    };
    xhr.onerror = () => reject(new UploadFailed("Connessione interrotta durante il caricamento."));
    xhr.onabort = () => reject(new UploadFailed("Caricamento annullato."));

    if (signal) {
      if (signal.aborted) {
        reject(new UploadFailed("Caricamento annullato."));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}
