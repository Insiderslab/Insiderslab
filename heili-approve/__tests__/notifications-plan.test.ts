import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockSendEmail } = vi.hoisted(() => ({
  mockPrisma: {
    workspaceMember: { findMany: vi.fn() },
    contentPlan: { findUnique: vi.fn() },
  },
  mockSendEmail: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: mockSendEmail };
});

import { notifyPlanDecided } from "@/lib/notifications";

function decidedPlan() {
  return {
    id: "plan-1",
    workspaceId: "workspace-1",
    month: "2026-11",
    kind: "SOCIAL_POST",
    intro: null,
    reviewDueAt: null,
    client: {
      id: "client-1",
      name: "Caffè Aurora",
      timezone: "Europe/Rome",
      autoSchedule: false,
      metricoolBlogId: null,
      archivedAt: null,
      reviewers: [],
    },
    workspace: { id: "workspace-1", name: "InsidersLab" },
    posts: [
      {
        id: "post-1",
        title: "Post approvato",
        kind: "SOCIAL_POST",
        status: "APPROVED",
        publishAt: new Date("2026-11-05T09:00:00Z"),
        networks: ["instagram"],
        reviewDueAt: null,
        versions: [{ content: null }],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.workspaceMember.findMany.mockResolvedValue([
    { user: { email: "owner@insiderslab.it" } },
  ]);
  mockPrisma.contentPlan.findUnique.mockResolvedValue(decidedPlan());
});

describe("plan completion notification delivery", () => {
  it("returns false when the email transport rejects the send", async () => {
    mockSendEmail.mockResolvedValue({ ok: false, transport: "resend", error: "temporary failure" });

    await expect(notifyPlanDecided("plan-1")).resolves.toBe(false);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("returns true only when the email transport confirms the send", async () => {
    mockSendEmail.mockResolvedValue({ ok: true, transport: "resend" });

    await expect(notifyPlanDecided("plan-1")).resolves.toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["owner@insiderslab.it"],
        subject: expect.stringContaining("Caffè Aurora"),
      })
    );
  });

  it("returns false when the workspace has no agency recipient", async () => {
    mockPrisma.workspaceMember.findMany.mockResolvedValue([]);

    await expect(notifyPlanDecided("plan-1")).resolves.toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
