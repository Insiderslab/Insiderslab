import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: { agencyActivity: { findMany: mock.findMany, count: mock.count } },
}));

import { countUnreadNotifications, listCompletedTasks } from "@/lib/activity";
import { activityHref, memberLabel, relativeTimeLabel } from "@/components/attivita/helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("relativeTimeLabel", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it("labels the age with 'adesso', minutes, hours and days", () => {
    expect(relativeTimeLabel(new Date("2026-10-18T11:59:40Z"), now)).toBe("adesso");
    expect(relativeTimeLabel(new Date("2026-10-18T11:58:00Z"), now)).toBe("2 minuti fa");
    expect(relativeTimeLabel(new Date("2026-10-18T11:00:00Z"), now)).toBe("1 ora fa");
    expect(relativeTimeLabel(new Date("2026-10-16T12:00:00Z"), now)).toBe("2 giorni fa");
  });

  it("falls back to a date after 30 days", () => {
    const label = relativeTimeLabel(new Date("2020-01-02T00:00:00Z"), now);
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toContain(" fa");
  });

  it("returns an empty string for an invalid date", () => {
    expect(relativeTimeLabel("not-a-date", now)).toBe("");
  });
});

describe("activityHref", () => {
  it("links a post to its Revisione tab and a plan to its page", () => {
    expect(activityHref({ postId: "post-1", planId: null })).toBe("/posts/post-1?tab=revisione");
    expect(activityHref({ postId: null, planId: "plan-1" })).toBe("/plans/plan-1");
    expect(activityHref({ postId: null, planId: null })).toBeNull();
  });

  it("prefers the plan when both are set", () => {
    expect(activityHref({ postId: "post-1", planId: "plan-1" })).toBe("/plans/plan-1");
  });
});

describe("memberLabel", () => {
  it("uses the name, then the email, then a placeholder", () => {
    expect(memberLabel({ name: "Anna", email: "anna@agenzia.it" })).toBe("Anna");
    expect(memberLabel({ name: null, email: "anna@agenzia.it" })).toBe("anna@agenzia.it");
    expect(memberLabel({ name: null, email: null })).toBe("Persona senza nome");
  });
});

describe("listCompletedTasks", () => {
  it("lists done tasks of the last 30 days, mine plus unassigned", async () => {
    mock.findMany.mockResolvedValue([]);
    await listCompletedTasks({ workspaceId: "ws-1", userId: "me" });
    expect(mock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-1",
          kind: "TASK",
          status: "DONE",
          doneAt: { gte: expect.any(Date) },
          OR: [{ assigneeUserId: "me" }, { assigneeUserId: null }],
        }),
        take: 31,
      })
    );
  });

  it("drops the assignee filter for scope all", async () => {
    mock.findMany.mockResolvedValue([]);
    await listCompletedTasks({ workspaceId: "ws-1", userId: "me", scope: "all" });
    const where = mock.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});

describe("countUnreadNotifications", () => {
  it("counts unread, still open INFO assigned to me plus unassigned", async () => {
    mock.count.mockResolvedValue(4);
    await expect(countUnreadNotifications("ws-1", "me")).resolves.toBe(4);
    expect(mock.count).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        kind: "INFO",
        status: "OPEN",
        readAt: null,
        OR: [{ assigneeUserId: "me" }, { assigneeUserId: null }],
      },
    });
  });
});
