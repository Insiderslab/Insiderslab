import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn(), plan: vi.fn(), reviewers: vi.fn(), postUrl: vi.fn(), planUrl: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { post: { findFirst: mocks.post }, contentPlan: { findFirst: mocks.plan }, clientReviewer: { findMany: mocks.reviewers } } }));
vi.mock("@/lib/reviewers", () => ({ getReviewPostUrl: mocks.postUrl, getReviewPlanUrl: mocks.planUrl }));
import { getQuickReviewLinks } from "@/lib/review-links";

beforeEach(() => {
  vi.resetAllMocks(); process.env.APP_VARIANT = "all";
  mocks.post.mockResolvedValue({ clientId: "c1", kind: "SOCIAL_POST", status: "IN_REVIEW", client: { archivedAt: null } });
  mocks.plan.mockResolvedValue({ clientId: "c1", kind: "SOCIAL_POST", sentAt: new Date(), client: { archivedAt: null } });
  mocks.reviewers.mockResolvedValue([{ id: "r1", name: "Giulia", tokenEncrypted: "encrypted" }]);
  mocks.postUrl.mockReturnValue("https://example.test/review/token/posts/p1");
  mocks.planUrl.mockReturnValue("https://example.test/review/token/piani/plan1");
});

describe("quick review links", () => {
  it("resolves only active reviewers of the authenticated target workspace", async () => {
    await expect(getQuickReviewLinks("w1", "post", "p1")).resolves.toEqual([{ id: "r1", name: "Giulia", url: "https://example.test/review/token/posts/p1" }]);
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", workspaceId: "w1" } }));
    expect(mocks.reviewers).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: "c1", active: true, client: { workspaceId: "w1", archivedAt: null } } }));
  });
  it.each(["DRAFT", "CANCELLED"])("does not expose %s posts", async status => {
    mocks.post.mockResolvedValue({ clientId: "c1", kind: "SOCIAL_POST", status, client: { archivedAt: null } });
    await expect(getQuickReviewLinks("w1", "post", "p1")).rejects.toThrow();
    expect(mocks.reviewers).not.toHaveBeenCalled();
  });
  it("does not resolve nonexistent, archived, or disabled targets", async () => {
    mocks.post.mockResolvedValue(null);
    await expect(getQuickReviewLinks("w2", "post", "p1")).rejects.toThrow();
    mocks.post.mockResolvedValue({ clientId: "c1", kind: "SOCIAL_POST", status: "IN_REVIEW", client: { archivedAt: new Date() } });
    await expect(getQuickReviewLinks("w1", "post", "p1")).rejects.toThrow();
    process.env.APP_VARIANT = "blog";
    mocks.post.mockResolvedValue({ clientId: "c1", kind: "SOCIAL_POST", status: "IN_REVIEW", client: { archivedAt: null } });
    await expect(getQuickReviewLinks("w1", "post", "p1")).rejects.toThrow();
    expect(mocks.reviewers).not.toHaveBeenCalled();
  });
  it("requires an available plan and returns a plan deep link", async () => {
    await expect(getQuickReviewLinks("w1", "plan", "plan1")).resolves.toMatchObject([{ url: "https://example.test/review/token/piani/plan1" }]);
    mocks.plan.mockResolvedValue({ clientId: "c1", kind: "SOCIAL_POST", sentAt: null, client: { archivedAt: null } });
    await expect(getQuickReviewLinks("w1", "plan", "plan1")).rejects.toThrow();
  });
  it("offers explicit recovery without exposing corrupt encrypted tokens", async () => {
    mocks.postUrl.mockImplementation(() => { throw new Error("bad secret"); });
    await expect(getQuickReviewLinks("w1", "post", "p1")).resolves.toEqual([{ id: "r1", name: "Giulia", url: null }]);
  });
});
