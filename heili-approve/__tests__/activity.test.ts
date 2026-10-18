import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  clientFindFirst: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  activityFindFirst: vi.fn(),
  update: vi.fn(),
  memberFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    client: { findFirst: mock.clientFindFirst },
    agencyActivity: {
      upsert: mock.upsert,
      updateMany: mock.updateMany,
      findMany: mock.findMany,
      count: mock.count,
      findFirst: mock.activityFindFirst,
      update: mock.update,
    },
    workspaceMember: { findFirst: mock.memberFindFirst },
  },
}));

import {
  ACTIVITY_TYPE_LABELS,
  activityKindOf,
  assign,
  cleanSummary,
  closeInfoActivity,
  closeTasksForPost,
  countOpenTasks,
  listActivities,
  markAllNotificationsRead,
  markDone,
  recordActivity,
  reopen,
  truncateSummary,
} from "@/lib/activity";
import { NotFoundError } from "@/lib/errors";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("activity labels and kinds", () => {
  it("maps each type to TASK or INFO", () => {
    expect(activityKindOf("CHANGES_REQUESTED")).toBe("TASK");
    expect(activityKindOf("CLIENT_COMMENT")).toBe("TASK");
    expect(activityKindOf("PLAN_COMMENT")).toBe("TASK");
    expect(activityKindOf("WEBSITE_NOTES")).toBe("TASK");
    expect(activityKindOf("SCHEDULE_FAILED")).toBe("TASK");
    expect(activityKindOf("APPROVED")).toBe("INFO");
    expect(activityKindOf("PLAN_APPROVED")).toBe("INFO");
  });

  it("labels every type in Italian for the UI", () => {
    expect(ACTIVITY_TYPE_LABELS.CHANGES_REQUESTED).toBe("Modifiche richieste");
    expect(ACTIVITY_TYPE_LABELS.SCHEDULE_FAILED).toBe("Programmazione non riuscita");
  });
});

describe("cleanSummary / truncateSummary", () => {
  it("drops internal markers and collapses whitespace", () => {
    expect(cleanSummary("  [punto media=0 x=0.5 y=0.5] Schiarire  lo sfondo \n\n")).toBe("Schiarire lo sfondo");
    expect(cleanSummary("[immagine, media 2, 0:07] Più veloce\nil testo")).toBe("Più veloce il testo");
  });

  it("truncates to 500 characters with an ellipsis", () => {
    expect(truncateSummary("a".repeat(600))).toBe(`${"a".repeat(499)}…`);
    expect(truncateSummary("corto")).toBe("corto");
  });
});

describe("recordActivity", () => {
  it("creates once and copies the assignee from the client's owner", async () => {
    mock.clientFindFirst.mockResolvedValue({ ownerUserId: "user-owner" });
    mock.upsert.mockResolvedValue({ id: "act-1" });

    await recordActivity({
      workspaceId: "ws-1",
      clientId: "client-1",
      postId: "post-1",
      type: "CHANGES_REQUESTED",
      title: "Modifiche richieste: Lancio autunno",
      versionNumber: 2,
      dedupeKey: "changes:post-1:v2",
    });

    expect(mock.clientFindFirst).toHaveBeenCalledWith({
      where: { id: "client-1", workspaceId: "ws-1" },
      select: { ownerUserId: true },
    });
    expect(mock.upsert).toHaveBeenCalledWith({
      where: { workspaceId_dedupeKey: { workspaceId: "ws-1", dedupeKey: "changes:post-1:v2" } },
      create: expect.objectContaining({
        workspaceId: "ws-1",
        clientId: "client-1",
        postId: "post-1",
        type: "CHANGES_REQUESTED",
        kind: "TASK",
        status: "OPEN",
        assigneeUserId: "user-owner",
        versionNumber: 2,
        dedupeKey: "changes:post-1:v2",
      }),
      // Dedupe: a repeated fact never rewrites the existing row.
      update: {},
    });
  });

  it("cleans and truncates the summary in the created row", async () => {
    mock.clientFindFirst.mockResolvedValue({ ownerUserId: null });
    mock.upsert.mockResolvedValue({ id: "act-1" });

    await recordActivity({
      workspaceId: "ws-1",
      clientId: "client-1",
      type: "CLIENT_COMMENT",
      title: "Commento del cliente",
      summary: `[punto media=0 x=0.5 y=0.5] ${"lungo ".repeat(200)}`,
      dedupeKey: "comment:c1",
    });

    const create = mock.upsert.mock.calls[0][0].create;
    expect(create.summary.length).toBeLessThanOrEqual(500);
    expect(create.summary).not.toContain("[punto");
    expect(create.summary.endsWith("…")).toBe(true);
  });

  it("throws NotFoundError when the client is not in the workspace", async () => {
    mock.clientFindFirst.mockResolvedValue(null);
    await expect(
      recordActivity({ workspaceId: "ws-1", clientId: "other", type: "APPROVED", title: "x", dedupeKey: "k" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mock.upsert).not.toHaveBeenCalled();
  });
});

describe("closeTasksForPost", () => {
  it("closes only the open tasks of the post", async () => {
    mock.updateMany.mockResolvedValue({ count: 2 });
    await expect(closeTasksForPost("post-1", "me")).resolves.toBe(2);
    expect(mock.updateMany).toHaveBeenCalledWith({
      where: { postId: "post-1", kind: "TASK", status: "OPEN" },
      data: { status: "DONE", doneAt: expect.any(Date), doneByUserId: "me" },
    });
  });
});

describe("closeInfoActivity", () => {
  it("marks the INFO of a dedupeKey as done (an approval undone)", async () => {
    mock.updateMany.mockResolvedValue({ count: 1 });
    await expect(closeInfoActivity("ws-1", "approved:post-1:v2", "me")).resolves.toBe(1);
    expect(mock.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", dedupeKey: "approved:post-1:v2", kind: "INFO" },
      data: { status: "DONE", doneAt: expect.any(Date), doneByUserId: "me" },
    });
  });
});

describe("listActivities", () => {
  it("defaults to open tasks, mine plus unassigned", async () => {
    mock.findMany.mockResolvedValue([]);
    await listActivities({ workspaceId: "ws-1", userId: "me", tab: "todo" });
    expect(mock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-1",
          kind: "TASK",
          status: "OPEN",
          OR: [{ assigneeUserId: "me" }, { assigneeUserId: null }],
        }),
        take: 31,
      })
    );
  });

  it("lists notifications without a status filter and honors scope all", async () => {
    mock.findMany.mockResolvedValue([]);
    await listActivities({ workspaceId: "ws-1", userId: "me", tab: "notifications", scope: "all" });
    const call = mock.findMany.mock.calls[0][0];
    expect(call.where.kind).toBe("INFO");
    expect(call.where.status).toBeUndefined();
    expect(call.where.OR).toBeUndefined();
  });

  it("returns the next cursor only when there is a full page", async () => {
    const page = Array.from({ length: 31 }, (_, i) => ({ id: `act-${i}` }));
    mock.findMany.mockResolvedValue(page);
    const result = await listActivities({ workspaceId: "ws-1", userId: "me", tab: "todo" });
    expect(result.items).toHaveLength(30);
    expect(result.nextCursor).toBe("act-29");

    mock.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `act-${i}` })));
    const short = await listActivities({ workspaceId: "ws-1", userId: "me", tab: "todo" });
    expect(short.items).toHaveLength(5);
    expect(short.nextCursor).toBeNull();
  });
});

describe("countOpenTasks", () => {
  it("counts mine plus unassigned open tasks", async () => {
    mock.count.mockResolvedValue(3);
    await expect(countOpenTasks("ws-1", "me")).resolves.toBe(3);
    expect(mock.count).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        kind: "TASK",
        status: "OPEN",
        OR: [{ assigneeUserId: "me" }, { assigneeUserId: null }],
      },
    });
  });
});

describe("markDone / reopen / assign", () => {
  it("refuses to touch an activity of another workspace", async () => {
    mock.activityFindFirst.mockResolvedValue(null);
    await expect(markDone("ws-1", "act-1", "me")).rejects.toBeInstanceOf(NotFoundError);
    await expect(reopen("ws-1", "act-1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(assign("ws-1", "act-1", "me")).rejects.toBeInstanceOf(NotFoundError);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("marks done with the acting user", async () => {
    mock.activityFindFirst.mockResolvedValue({ id: "act-1" });
    mock.update.mockResolvedValue({ id: "act-1", status: "DONE" });
    await markDone("ws-1", "act-1", "me");
    expect(mock.update).toHaveBeenCalledWith({
      where: { id: "act-1" },
      data: { status: "DONE", doneAt: expect.any(Date), doneByUserId: "me" },
    });
  });

  it("reopens by clearing doneAt and doneByUserId", async () => {
    mock.activityFindFirst.mockResolvedValue({ id: "act-1" });
    mock.update.mockResolvedValue({ id: "act-1", status: "OPEN" });
    await reopen("ws-1", "act-1");
    expect(mock.update).toHaveBeenCalledWith({
      where: { id: "act-1" },
      data: { status: "OPEN", doneAt: null, doneByUserId: null },
    });
  });

  it("assigns only to a member of the workspace, or unassigns with null", async () => {
    mock.activityFindFirst.mockResolvedValue({ id: "act-1" });
    mock.memberFindFirst.mockResolvedValue(null);
    await expect(assign("ws-1", "act-1", "stranger")).rejects.toBeInstanceOf(NotFoundError);
    expect(mock.memberFindFirst).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", userId: "stranger" },
      select: { id: true },
    });

    mock.update.mockResolvedValue({ id: "act-1", assigneeUserId: null });
    await assign("ws-1", "act-1", null);
    expect(mock.update).toHaveBeenCalledWith({ where: { id: "act-1" }, data: { assigneeUserId: null } });
  });
});

describe("markAllNotificationsRead", () => {
  it("marks the user's unread notifications as read", async () => {
    mock.updateMany.mockResolvedValue({ count: 4 });
    await expect(markAllNotificationsRead("ws-1", "me")).resolves.toBe(4);
    expect(mock.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        kind: "INFO",
        readAt: null,
        OR: [{ assigneeUserId: "me" }, { assigneeUserId: null }],
      },
      data: { readAt: expect.any(Date) },
    });
  });
});
