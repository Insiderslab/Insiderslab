import { authenticateAutomation, AutomationError } from "@/lib/automation/auth";
import { automationFailure, automationJson } from "@/lib/automation/http";
import { MAX_UPLOAD_BYTES, parseDurationSec, saveMediaStream, UploadError } from "@/lib/storage";
import { prisma } from "@/lib/db/client";
import { deadlineUploadStream, reserveAutomationUpload } from "@/lib/automation/uploads";

export async function POST(request: Request) {
  try {
    const context = await authenticateAutomation(request);
    if (!/^(image|video)\//.test(request.headers.get("content-type") ?? "")) {
      throw new AutomationError("CONTENT_TYPE", "Invia i byte del media con Content-Type image/* o video/*", 415);
    }
    if (!request.body) throw new AutomationError("EMPTY_FILE", "File mancante");
    const rawLength = request.headers.get("content-length");
    const declared = rawLength === null ? MAX_UPLOAD_BYTES : Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_UPLOAD_BYTES) throw new AutomationError("FILE_TOO_LARGE", "Dimensione file non valida o superiore a 300 MB", 413);
    let fileName: string;
    try { fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "media"); }
    catch { throw new AutomationError("INVALID_NAME", "Nome file non valido"); }
    if (fileName.length > 500) throw new AutomationError("INVALID_NAME", "Nome file troppo lungo");
    const durationSec = parseDurationSec(request.headers.get("x-duration-sec") ?? undefined);
    if (durationSec === null) throw new AutomationError("INVALID_DURATION", "Durata video non valida");
    const reservation = await reserveAutomationUpload(context.workspaceId, declared);
    try {
      const saved = await saveMediaStream({ workspaceId: context.workspaceId, source: deadlineUploadStream(request.body), fileName, durationSec, maxBytes: declared });
      return automationJson({ media: saved.media, asset: { id: saved.asset.id, fileName: saved.asset.fileName, sizeBytes: saved.asset.sizeBytes, mimeType: saved.asset.mimeType } }, 201);
    } finally {
      // If bookkeeping fails, capacity is recovered by the lease expiry. Do not
      // turn an already saved asset into a failed HTTP response that invites retries.
      await prisma.automationUploadReservation.deleteMany({ where: { id: reservation.id, workspaceId: context.workspaceId } }).catch(() => {});
    }
  } catch (error) {
    return automationFailure(error instanceof UploadError ? new AutomationError("UPLOAD_FAILED", error.message, error.status) : error);
  }
}
