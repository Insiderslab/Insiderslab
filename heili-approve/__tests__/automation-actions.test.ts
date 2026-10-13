import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: {
    $executeRaw: vi.fn(),
    automationToken: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mocks.getContext }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  createAutomationToken,
  revokeAutomationToken,
} from "@/app/(dashboard)/settings/automation-actions";
import { automationTokenExpiry, hashAutomationToken } from "@/lib/automation/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getContext.mockResolvedValue({
    workspaceId: "workspace-1",
    userId: "user-1",
    role: "MEMBER",
    workspace: { id: "workspace-1" },
  });
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => unknown) =>
    callback(mocks.prisma)
  );
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.prisma.automationToken.count.mockResolvedValue(0);
  mocks.prisma.automationToken.create.mockResolvedValue({ id: "token-1" });
  mocks.prisma.automationToken.updateMany.mockResolvedValue({ count: 1 });
});

describe("automation key actions", () => {
  it("lets a workspace member create a personal key and persists only its hash", async () => {
    const result = await createAutomationToken({ name: "Codex import", days: 30 });

    expect(result).toMatchObject({ ok: true, id: "token-1" });
    if (!result.ok) throw new Error("Expected a key");
    expect(result.token).toMatch(/^approve_auto_[a-f0-9]{64}$/);
    expect(mocks.prisma.automationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "user-1",
        name: "Codex import",
        tokenHash: hashAutomationToken(result.token),
      }),
      select: { id: true },
    });
    expect(mocks.prisma.automationToken.create.mock.calls[0][0].data).not.toHaveProperty("token");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("enforces the per-member active-key cap under the transaction lock", async () => {
    mocks.prisma.automationToken.count.mockResolvedValue(10);
    await expect(createAutomationToken({ name: "Claude import", days: 30 })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("10 chiavi"),
    });
    expect(mocks.prisma.automationToken.create).not.toHaveBeenCalled();
  });

  it("scopes revocation to the current member and workspace", async () => {
    mocks.getContext.mockResolvedValue({
      workspaceId: "workspace-1",
      userId: "other-user",
      role: "MEMBER",
      workspace: { id: "workspace-1" },
    });
    await expect(revokeAutomationToken("token-owned-by-user-1")).resolves.toEqual({ ok: true });
    expect(mocks.prisma.automationToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "token-owned-by-user-1",
        workspaceId: "workspace-1",
        userId: "other-user",
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe("automationTokenExpiry", () => {
  const romeDay = (date: Date) =>
    new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome" }).format(date);

  it("counts calendar days in Rome: 30 days from 12/10 ends on 11/11, not 10/11", () => {
    // 12 October 2026, 00:30 in Rome (CEST, UTC+2): the DST change is in between.
    const expiry = automationTokenExpiry(new Date("2026-10-11T22:30:00Z"), 30);
    expect(romeDay(expiry)).toBe("11/11/2026");
    // End of that day in Rome (CET, UTC+1).
    expect(expiry.toISOString()).toBe("2026-11-11T22:59:59.000Z");
  });

  it("stays right across the DST change itself", () => {
    // 25 October 2026, 01:30 in Rome, still summer time: +2 days ends on 27/10.
    const expiry = automationTokenExpiry(new Date("2026-10-24T23:30:00Z"), 2);
    expect(romeDay(expiry)).toBe("27/10/2026");
    expect(expiry.toISOString()).toBe("2026-10-27T22:59:59.000Z");
  });

  it("never expires before the promised local day and always after now", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    const expiry = automationTokenExpiry(now, 1);
    expect(romeDay(expiry)).toBe("15/10/2026");
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
  });
});
