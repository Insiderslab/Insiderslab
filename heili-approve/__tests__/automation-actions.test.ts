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
import { hashAutomationToken } from "@/lib/automation/auth";

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
