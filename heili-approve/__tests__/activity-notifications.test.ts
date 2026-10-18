import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockSendEmail, mockRecordActivity } = vi.hoisted(() => ({
  mockPrisma: {
    post: { findUnique: vi.fn() },
    postEvent: { findFirst: vi.fn() },
    postComment: { findUnique: vi.fn(), findMany: vi.fn() },
    reviewSession: { findUnique: vi.fn() },
    clientReviewer: { findUnique: vi.fn() },
    contentPlan: { findUnique: vi.fn() },
    contentPlanComment: { findUnique: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
  },
  mockSendEmail: vi.fn(),
  mockRecordActivity: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/activity", () => ({ recordActivity: mockRecordActivity }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: mockSendEmail };
});

import {
  notifyApproved,
  notifyChangesRequested,
  notifyPlanApproved,
  notifyPlanComment,
  notifyPlanDecided,
  notifyScheduleFailed,
} from "@/lib/notifications";

function socialPost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    title: "Lancio autunno",
    kind: "SOCIAL_POST",
    status: "CHANGES_REQUESTED",
    workspaceId: "workspace-1",
    clientId: "client-1",
    planId: null,
    currentVersionNumber: 2,
    lastError: null,
    approvedByReviewerId: null,
    publishAt: new Date("2026-11-05T09:00:00Z"),
    networks: ["instagram"],
    client: { name: "Caffè Aurora", timezone: "Europe/Rome", autoSchedule: false, metricoolBlogId: null },
    workspace: { id: "workspace-1", name: "InsidersLab" },
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    workspaceId: "workspace-1",
    clientId: "client-1",
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
    posts: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue({ ok: true, transport: "resend" });
  mockRecordActivity.mockResolvedValue({ id: "act-1" });
  mockPrisma.workspaceMember.findMany.mockResolvedValue([{ user: { email: "owner@insiderslab.it" } }]);
  mockPrisma.postEvent.findFirst.mockResolvedValue({
    reviewer: { name: "Mario" },
    metadata: { commentId: "comment-1" },
  });
  mockPrisma.postComment.findUnique.mockResolvedValue({
    body: "Schiarisci lo sfondo",
    versionId: "version-2",
    version: { content: null },
  });
  mockPrisma.postComment.findMany.mockResolvedValue([]);
  mockPrisma.reviewSession.findUnique.mockResolvedValue(null);
});

describe("activity hooks in the agency notifications", () => {
  it("records a change request as a task, without blocking the email", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(socialPost());

    await notifyChangesRequested("post-1");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockRecordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        clientId: "client-1",
        postId: "post-1",
        type: "CHANGES_REQUESTED",
        title: "Modifiche richieste: Lancio autunno",
        summary: "Schiarisci lo sfondo",
        versionNumber: 2,
        dedupeKey: "changes:post-1:v2",
      })
    );
  });

  it("records WEBSITE_NOTES for a website change request", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(socialPost({ kind: "WEBSITE", title: "Sito vetrina" }));

    await notifyChangesRequested("post-1");

    expect(mockRecordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "WEBSITE_NOTES",
        title: "Note sul sito: Sito vetrina",
        dedupeKey: "changes:post-1:v2",
      })
    );
  });

  it("still sends the email when recordActivity throws", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(socialPost());
    mockRecordActivity.mockRejectedValue(new Error("db down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(notifyChangesRequested("post-1")).resolves.toBeUndefined();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it("records an approval as an INFO", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      socialPost({ status: "APPROVED", approvedByReviewerId: "reviewer-1" })
    );
    mockPrisma.clientReviewer.findUnique.mockResolvedValue({ name: "Mario" });

    await notifyApproved("post-1");

    expect(mockRecordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "APPROVED",
        title: "Approvato: Lancio autunno",
        dedupeKey: "approved:post-1:v2",
      })
    );
  });

  it("records a failed schedule as a task", async () => {
    mockPrisma.post.findUnique.mockResolvedValue(
      socialPost({ status: "FAILED", lastError: "401 Unauthorized" })
    );

    await notifyScheduleFailed("post-1");

    expect(mockRecordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SCHEDULE_FAILED",
        summary: "401 Unauthorized",
        dedupeKey: "schedule-failed:post-1:v2",
      })
    );
  });

  it("records a plan comment as a task", async () => {
    mockPrisma.contentPlanComment.findUnique.mockResolvedValue({
      id: "pc-1",
      authorType: "CLIENT",
      body: "Rivediamo il tono di tutto il mese",
      reviewer: { name: "Mario" },
      plan: {
        id: "plan-1",
        workspaceId: "workspace-1",
        clientId: "client-1",
        month: "2026-11",
        client: { name: "Caffè Aurora" },
      },
    });

    await notifyPlanComment("pc-1");

    expect(mockRecordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PLAN_COMMENT",
        planId: "plan-1",
        title: "Commento sul piano: Caffè Aurora",
        dedupeKey: "plan-comment:pc-1",
      })
    );
  });

  it("records a bulk plan approval as an INFO", async () => {
    mockPrisma.contentPlan.findUnique.mockResolvedValue(plan({ posts: [{ id: "post-1", status: "APPROVED" }] }));
    mockPrisma.clientReviewer.findUnique.mockResolvedValue({ name: "Mario" });

    await notifyPlanApproved("plan-1", "reviewer-1", ["post-1"]);

    expect(mockRecordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PLAN_APPROVED",
        planId: "plan-1",
        dedupeKey: "plan-approved:plan-1",
      })
    );
  });

  it("records a decided plan as an INFO", async () => {
    mockPrisma.contentPlan.findUnique.mockResolvedValue(plan({ posts: [{ id: "post-1", status: "APPROVED" }] }));

    await notifyPlanDecided("plan-1");

    expect(mockRecordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PLAN_APPROVED",
        planId: "plan-1",
        dedupeKey: "plan-approved:plan-1",
      })
    );
  });
});
