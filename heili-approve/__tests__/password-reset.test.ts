import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  tokenCreate: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenFindFirst: vi.fn(),
  sessionDeleteMany: vi.fn(),
  canSignIn: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findFirst: mock.userFindFirst, update: mock.userUpdate },
    verificationToken: { create: mock.tokenCreate, deleteMany: mock.tokenDeleteMany, findFirst: mock.tokenFindFirst },
    session: { deleteMany: mock.sessionDeleteMany },
  },
}));
vi.mock("@/lib/sign-in-access", () => ({ canEmailSignIn: mock.canSignIn }));
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: mock.sendEmail,
}));

import { hashToken } from "@/lib/crypto";
import { resetRateLimitsForTests } from "@/lib/mcp/rate-limit";
import { verifyPassword } from "@/lib/password";
import {
  RESET_LINK_INVALID,
  TOO_MANY_ATTEMPTS,
  isResetTokenUsable,
  requestPasswordReset,
  resetPasswordWithToken,
} from "@/lib/password-login";

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  vi.stubEnv("PUBLIC_BASE_URL", "https://approve.example.com");
  mock.canSignIn.mockResolvedValue(true);
  mock.sendEmail.mockResolvedValue({ ok: true, transport: "console" });
});

describe("«Password dimenticata?»", () => {
  it("emails a one-hour link and stores only the token hash", async () => {
    mock.userFindFirst.mockResolvedValue({ id: "u1", passwordHash: "scrypt$x" });
    expect(await requestPasswordReset(" Stefano@Example.com ", "ip")).toEqual({ ok: true });

    const email = mock.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("stefano@example.com");
    const link = /https:\/\/approve\.example\.com\/nuova-password\/([\w-]+)/.exec(email.text);
    expect(link).not.toBeNull();
    const stored = mock.tokenCreate.mock.calls[0][0].data;
    expect(stored.identifier).toBe("password-reset:stefano@example.com");
    expect(stored.token).toBe(hashToken(link![1]));
    expect(stored.expires.getTime() - Date.now()).toBeGreaterThan(55 * 60 * 1000);
    expect(mock.tokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: "password-reset:stefano@example.com" } });
  });

  it("answers the same for an unknown email or one without access, and sends nothing", async () => {
    mock.userFindFirst.mockResolvedValueOnce(null);
    expect(await requestPasswordReset("nessuno@example.com", "ip")).toEqual({ ok: true });
    mock.userFindFirst.mockResolvedValueOnce({ id: "u2", passwordHash: null });
    mock.canSignIn.mockResolvedValueOnce(false);
    expect(await requestPasswordReset("bloccato@example.com", "ip")).toEqual({ ok: true });
    expect(mock.sendEmail).not.toHaveBeenCalled();
    expect(mock.tokenCreate).not.toHaveBeenCalled();
  });

  it("limits repeated requests for one email", async () => {
    mock.userFindFirst.mockResolvedValue(null);
    await requestPasswordReset("a@example.com", "ip1");
    await requestPasswordReset("a@example.com", "ip2");
    expect(await requestPasswordReset("a@example.com", "ip3")).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS });
  });
});

describe("choosing the new password from the link", () => {
  const row = (expiresInMs: number) => ({
    identifier: "password-reset:stefano@example.com",
    token: hashToken("tok"),
    expires: new Date(Date.now() + expiresInMs),
  });

  it("sets the password, uses the link once and signs out every device", async () => {
    mock.tokenFindFirst.mockResolvedValue(row(60_000));
    mock.userFindFirst.mockResolvedValue({ id: "u1" });
    expect(await resetPasswordWithToken("tok", "una password nuova", "una password nuova")).toEqual({ ok: true, userId: "u1" });
    expect(mock.tokenFindFirst.mock.calls[0][0].where.token).toBe(hashToken("tok"));
    expect(mock.tokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: "password-reset:stefano@example.com" } });
    expect(await verifyPassword("una password nuova", mock.userUpdate.mock.calls[0][0].data.passwordHash)).toBe(true);
    expect(mock.sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("refuses an unknown or expired link without changing anything", async () => {
    mock.tokenFindFirst.mockResolvedValueOnce(null);
    expect(await resetPasswordWithToken("tok", "una password nuova", "una password nuova")).toEqual({ ok: false, error: RESET_LINK_INVALID });
    mock.tokenFindFirst.mockResolvedValueOnce(row(-1000));
    expect(await resetPasswordWithToken("tok", "una password nuova", "una password nuova")).toEqual({ ok: false, error: RESET_LINK_INVALID });
    expect(mock.userUpdate).not.toHaveBeenCalled();
  });

  it("checks the password before spending the link", async () => {
    expect((await resetPasswordWithToken("tok", "corta", "corta")).ok).toBe(false);
    expect(await resetPasswordWithToken("tok", "una password nuova", "un'altra password")).toEqual({
      ok: false,
      error: "Le due password non coincidono.",
    });
    expect(mock.tokenFindFirst).not.toHaveBeenCalled();
  });

  it("tells the page whether the link still works", async () => {
    mock.tokenFindFirst.mockResolvedValueOnce(row(60_000));
    expect(await isResetTokenUsable("tok")).toBe(true);
    mock.tokenFindFirst.mockResolvedValueOnce(row(-1));
    expect(await isResetTokenUsable("tok")).toBe(false);
    expect(await isResetTokenUsable("")).toBe(false);
  });
});
