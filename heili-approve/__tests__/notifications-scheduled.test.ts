import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockSendEmail } = vi.hoisted(() => ({
  mockPrisma: {
    workspaceMember: { findMany: vi.fn() },
    post: { findUnique: vi.fn() },
    postEvent: { findFirst: vi.fn() },
  },
  mockSendEmail: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: mockSendEmail };
});

import { notifyScheduled } from "@/lib/notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue(true);
  mockPrisma.workspaceMember.findMany.mockResolvedValue([{ user: { email: "owner@example.com" } }]);
  mockPrisma.post.findUnique.mockResolvedValue({
    id: "post-1",
    title: "Post del mese",
    kind: "SOCIAL_POST",
    status: "SCHEDULED",
    workspaceId: "workspace-1",
    currentVersionNumber: 2,
    publishAt: new Date("2026-11-05T09:00:00Z"),
    networks: ["instagram"],
    client: { name: "Cliente Prova", timezone: "Europe/Rome" },
    workspace: { id: "workspace-1", name: "Agenzia" },
  });
});

describe("«Programmato» email after scheduling", () => {
  it("is sent for a post approved on its own", async () => {
    mockPrisma.postEvent.findFirst.mockResolvedValue({ metadata: { undoable: true } });
    await notifyScheduled("post-1");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockPrisma.postEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId: "post-1", type: "APPROVED", versionNumber: 2 } })
    );
  });

  it("is skipped for a post approved with «Approva tutto il piano» (the summary is enough)", async () => {
    mockPrisma.postEvent.findFirst.mockResolvedValue({ metadata: { bulk: true } });
    await notifyScheduled("post-1");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("is sent when the approval event is missing or malformed", async () => {
    mockPrisma.postEvent.findFirst.mockResolvedValue(null);
    await notifyScheduled("post-1");
    mockPrisma.postEvent.findFirst.mockResolvedValue({ metadata: ["bulk"] });
    await notifyScheduled("post-1");
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });
});
