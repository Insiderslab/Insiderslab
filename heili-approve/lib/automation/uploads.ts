import { prisma } from "@/lib/db/client";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { AutomationError } from "./auth";

const UPLOAD_DEADLINE_MS = 15 * 60 * 1000;
export function automationStorageLimit(): number {
  const configured = Number(process.env.AUTOMATION_STORAGE_LIMIT_BYTES);
  return Number.isSafeInteger(configured) && configured >= MAX_UPLOAD_BYTES && configured <= 1024 ** 4
    ? configured : 5 * 1024 ** 3;
}

/** Reserve disk capacity atomically before reading any upload bytes. */
export async function reserveAutomationUpload(workspaceId: string, sizeBytes: number) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-upload:${workspaceId}`}, 0))`;
    const now = new Date();
    await tx.automationUploadReservation.deleteMany({ where: { workspaceId, expiresAt: { lte: now } } });
    const [used, reserved] = await Promise.all([
      tx.mediaAsset.aggregate({ where: { workspaceId }, _sum: { sizeBytes: true } }),
      tx.automationUploadReservation.findMany({ where: { workspaceId, expiresAt: { gt: now } }, select: { sizeBytes: true } }),
    ]);
    if (reserved.length >= 3) throw new AutomationError("UPLOAD_BUSY", "Tre caricamenti sono già in corso: riprova tra poco", 429);
    const bytes = Number(used._sum.sizeBytes ?? 0) + reserved.reduce((total, item) => total + item.sizeBytes, 0);
    if (bytes + sizeBytes > automationStorageLimit()) {
      throw new AutomationError("STORAGE_QUOTA", "Spazio disponibile insufficiente per questa importazione", 413);
    }
    return tx.automationUploadReservation.create({ data: { workspaceId, sizeBytes, expiresAt: new Date(now.getTime() + 2 * UPLOAD_DEADLINE_MS) }, select: { id: true } });
  });
}

/** A paused connection cannot resume writing after its reservation expires. */
export function deadlineUploadStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        if (closed) return;
        closed = true;
        controller.error(new AutomationError("UPLOAD_TIMEOUT", "Caricamento scaduto: riprova", 408));
        void reader.cancel().catch(() => {});
      }, UPLOAD_DEADLINE_MS);
      timer.unref?.();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (closed) return;
        if (result.done) {
          closed = true;
          clearTimeout(timer);
          reader.releaseLock();
          controller.close();
        } else controller.enqueue(result.value);
      } catch (error) {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        controller.error(error);
        void reader.cancel().catch(() => {});
      }
    },
    async cancel(reason) {
      closed = true;
      clearTimeout(timer);
      await reader.cancel(reason);
    },
  });
}
