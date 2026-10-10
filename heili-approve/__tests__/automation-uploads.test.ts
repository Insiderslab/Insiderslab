import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  mediaAsset: { aggregate: vi.fn() },
  automationUploadReservation: { deleteMany: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import {
  automationStorageLimit,
  deadlineUploadStream,
  reserveAutomationUpload,
} from "@/lib/automation/uploads";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
  mockPrisma.$executeRaw.mockResolvedValue(1);
  mockPrisma.automationUploadReservation.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.mediaAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } });
  mockPrisma.automationUploadReservation.findMany.mockResolvedValue([]);
  mockPrisma.automationUploadReservation.create.mockResolvedValue({ id: "reservation-1" });
  delete process.env.AUTOMATION_STORAGE_LIMIT_BYTES;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.AUTOMATION_STORAGE_LIMIT_BYTES;
});

describe("automation upload storage reservations", () => {
  it("accepts a bounded configured quota and falls back for invalid values", () => {
    expect(automationStorageLimit()).toBe(5 * 1024 ** 3);

    process.env.AUTOMATION_STORAGE_LIMIT_BYTES = String(400 * 1024 ** 2);
    expect(automationStorageLimit()).toBe(400 * 1024 ** 2);

    for (const invalid of ["not-a-number", "0", String(MAX_UPLOAD_BYTES - 1), String(1024 ** 4 + 1)]) {
      process.env.AUTOMATION_STORAGE_LIMIT_BYTES = invalid;
      expect(automationStorageLimit()).toBe(5 * 1024 ** 3);
    }
  });

  it("counts stored media and live reservations under a workspace lock", async () => {
    process.env.AUTOMATION_STORAGE_LIMIT_BYTES = String(400 * 1024 ** 2);
    mockPrisma.mediaAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 100 * 1024 ** 2 } });
    mockPrisma.automationUploadReservation.findMany.mockResolvedValue([
      { sizeBytes: 50 * 1024 ** 2 },
      { sizeBytes: 25 * 1024 ** 2 },
    ]);

    await expect(reserveAutomationUpload("workspace-1", 200 * 1024 ** 2)).resolves.toEqual({ id: "reservation-1" });
    expect(mockPrisma.mediaAsset.aggregate).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1" },
      _sum: { sizeBytes: true },
    });
    expect(mockPrisma.automationUploadReservation.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", expiresAt: { gt: new Date("2026-10-08T12:00:00.000Z") } },
      select: { sizeBytes: true },
    });
    expect(mockPrisma.automationUploadReservation.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace-1",
        sizeBytes: 200 * 1024 ** 2,
        expiresAt: new Date("2026-10-08T12:30:00.000Z"),
      },
      select: { id: true },
    });
  });

  it("cleans stale leases and refuses quota overflow or a fourth live upload", async () => {
    process.env.AUTOMATION_STORAGE_LIMIT_BYTES = String(MAX_UPLOAD_BYTES);
    mockPrisma.mediaAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: MAX_UPLOAD_BYTES - 10 } });

    await expect(reserveAutomationUpload("workspace-1", 11)).rejects.toMatchObject({
      code: "STORAGE_QUOTA",
      status: 413,
    });
    expect(mockPrisma.automationUploadReservation.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", expiresAt: { lte: new Date("2026-10-08T12:00:00.000Z") } },
    });
    expect(mockPrisma.automationUploadReservation.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
    mockPrisma.mediaAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } });
    mockPrisma.automationUploadReservation.findMany.mockResolvedValue([
      { sizeBytes: 1 },
      { sizeBytes: 1 },
      { sizeBytes: 1 },
    ]);
    await expect(reserveAutomationUpload("workspace-1", 1)).rejects.toMatchObject({
      code: "UPLOAD_BUSY",
      status: 429,
    });
  });
});

describe("automation upload deadline", () => {
  it("lets a current stream pass", async () => {
    const current = deadlineUploadStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      })
    );
    await expect(current.getReader().read()).resolves.toMatchObject({ value: new Uint8Array([1, 2, 3]) });
  });

  it("actively rejects and cancels a stalled source after fifteen minutes", async () => {
    const cancel = vi.fn();
    const stalled = deadlineUploadStream(
      new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel,
      })
    );
    const pendingRead = stalled.getReader().read();
    const rejected = expect(pendingRead).rejects.toMatchObject({ code: "UPLOAD_TIMEOUT", status: 408 });

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
