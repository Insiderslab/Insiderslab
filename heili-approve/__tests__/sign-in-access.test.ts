import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ member: vi.fn(), invitation: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  prisma: { workspaceMember: { findFirst: mock.member }, workspaceInvitation: { findFirst: mock.invitation } },
}));

import { canEmailSignIn } from "@/lib/sign-in-access";

describe("agency sign-in access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALLOWED_EMAILS", "owner@agenzia.it");
    mock.member.mockResolvedValue(null);
    mock.invitation.mockResolvedValue(null);
  });

  it("lets in the allowlist without touching the database", async () => {
    expect(await canEmailSignIn("Owner@Agenzia.it")).toBe(true);
    expect(mock.member).not.toHaveBeenCalled();
  });

  it("refuses a stranger: no allowlist entry, no membership, no invitation", async () => {
    expect(await canEmailSignIn("stranger@example.com")).toBe(false);
    expect(await canEmailSignIn(null)).toBe(false);
  });

  it("lets in a teammate with a pending, unexpired invitation", async () => {
    mock.invitation.mockResolvedValue({ id: "inv" });
    expect(await canEmailSignIn("Collega@Gmail.com")).toBe(true);
    expect(mock.invitation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email: { equals: "Collega@Gmail.com", mode: "insensitive" }, status: "PENDING" }),
      })
    );
  });

  it("lets in an existing workspace member", async () => {
    mock.member.mockResolvedValue({ id: "m" });
    expect(await canEmailSignIn("collega@gmail.com")).toBe(true);
  });

  it("can require membership only (MCP): a pending invitation is not enough", async () => {
    mock.invitation.mockResolvedValue({ id: "inv" });
    expect(await canEmailSignIn("collega@gmail.com", { allowPendingInvitation: false })).toBe(false);
    expect(mock.invitation).not.toHaveBeenCalled();
  });

  it("keeps everyone allowed when no allowlist is configured", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect(await canEmailSignIn("anyone@example.com")).toBe(true);
  });
});
