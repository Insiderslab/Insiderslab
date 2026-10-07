import { NextResponse } from "next/server";
import { httpStatusForError, publicErrorMessage } from "@/lib/errors";
import { AutomationError } from "./auth";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export const automationJson = (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status, headers });
export function automationFailure(error: unknown) {
  const status = error instanceof AutomationError ? error.status : httpStatusForError(error);
  return NextResponse.json({
    success: false,
    code: error instanceof AutomationError ? error.code : status === 500 ? "INTERNAL_ERROR" : status === 429 ? "RATE_LIMITED" : "VALIDATION_ERROR",
    error: error instanceof AutomationError ? error.message : publicErrorMessage(error),
  }, { status, headers });
}

/** Bound JSON bodies before decoding; works even with missing/spoofed Content-Length. */
export async function readAutomationJson(request: Request, limit = 1024 * 1024): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new AutomationError("CONTENT_TYPE", "Usa Content-Type application/json", 415);
  }
  if (!request.body) throw new AutomationError("INVALID_JSON", "Corpo JSON mancante");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AutomationError("BODY_TOO_LARGE", "Richiesta troppo grande", 413);
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new AutomationError("INVALID_JSON", "JSON non valido"); }
  const pending: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++nodes > 50_000 || depth > 20) throw new AutomationError("JSON_TOO_COMPLEX", "JSON troppo annidato o complesso");
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
    }
  }
  return parsed;
}
