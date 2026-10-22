import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  invitation: vi.fn(),
  canSignIn: vi.fn(),
  ensureWorkspace: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findFirst: mock.userFindFirst, findUnique: mock.userFindUnique, create: mock.userCreate, update: mock.userUpdate },
    workspaceInvitation: { findUnique: mock.invitation },
  },
}));
vi.mock("@/lib/sign-in-access", () => ({ canEmailSignIn: mock.canSignIn }));
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: mock.ensureWorkspace }));

import { resetRateLimitsForTests } from "@/lib/mcp/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  ACCOUNT_EXISTS,
  TOO_MANY_ATTEMPTS,
  WRONG_CREDENTIALS,
  changePassword,
  createAccountFromInvitation,
  signInWithPassword,
} from "@/lib/password-login";

const future = () => new Date(Date.now() + 86_400_000);

describe("email + password sign-in", () => {
  let storedHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    storedHash ??= await hashPassword("password giusta");
    mock.canSignIn.mockResolvedValue(true);
  });

  it("signs in with the right password, email in any case", async () => {
    mock.userFindFirst.mockResolvedValue({ id: "u1", passwordHash: storedHash });
    expect(await signInWithPassword("  Gabriela@Example.com ", "password giusta", "ip")).toEqual({ ok: true, userId: "u1" });
    expect(mock.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: "gabriela@example.com", mode: "insensitive" } } })
    );
  });

  it("gives the same answer for a wrong password, an unknown email and an account without password", async () => {
    mock.userFindFirst.mockResolvedValueOnce({ id: "u1", passwordHash: storedHash });
    expect(await signInWithPassword("a@example.com", "sbagliata!!", "ip")).toEqual({ ok: false, error: WRONG_CREDENTIALS });
    mock.userFindFirst.mockResolvedValueOnce(null);
    expect(await signInWithPassword("b@example.com", "qualcosa!!", "ip")).toEqual({ ok: false, error: WRONG_CREDENTIALS });
    mock.userFindFirst.mockResolvedValueOnce({ id: "u3", passwordHash: null });
    expect(await signInWithPassword("c@example.com", "qualcosa!!", "ip")).toEqual({ ok: false, error: WRONG_CREDENTIALS });
  });

  it("keeps the access rule of the magic link", async () => {
    mock.userFindFirst.mockResolvedValue({ id: "u1", passwordHash: storedHash });
    mock.canSignIn.mockResolvedValue(false);
    const result = await signInWithPassword("a@example.com", "password giusta", "ip");
    expect(result.ok).toBe(false);
  });

  it("slows down guessing on one email", async () => {
    mock.userFindFirst.mockResolvedValue({ id: "u1", passwordHash: storedHash });
    for (let i = 0; i < 5; i += 1) await signInWithPassword("a@example.com", "sbagliata!!", `ip${i}`);
    expect(await signInWithPassword("a@example.com", "password giusta", "ip-new")).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS });
  });
});

describe("creating the account from an invitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mock.invitation.mockResolvedValue({ email: "gabriela@example.com", status: "PENDING", expiresAt: future() });
    mock.userFindFirst.mockResolvedValue(null);
    mock.userCreate.mockResolvedValue({ id: "new" });
  });

  it("creates the user with a hashed password and joins the workspace", async () => {
    expect(await createAccountFromInvitation("tok", "una password valida", "una password valida")).toEqual({ ok: true, userId: "new" });
    const data = mock.userCreate.mock.calls[0][0].data;
    expect(data.email).toBe("gabriela@example.com");
    expect(data.passwordHash).not.toContain("una password");
    expect(await verifyPassword("una password valida", data.passwordHash)).toBe(true);
    expect(mock.ensureWorkspace).toHaveBeenCalledWith("new", "gabriela@example.com");
  });

  it("never takes over an existing account", async () => {
    mock.userFindFirst.mockResolvedValue({ id: "existing", passwordHash: null });
    expect(await createAccountFromInvitation("tok", "una password valida", "una password valida")).toEqual({ ok: false, error: ACCOUNT_EXISTS });
    expect(mock.userCreate).not.toHaveBeenCalled();
  });

  it("refuses revoked, accepted or expired invitations", async () => {
    mock.invitation.mockResolvedValueOnce(null);
    expect((await createAccountFromInvitation("tok", "una password valida", "una password valida")).ok).toBe(false);
    mock.invitation.mockResolvedValueOnce({ email: "g@example.com", status: "ACCEPTED", expiresAt: future() });
    expect((await createAccountFromInvitation("tok", "una password valida", "una password valida")).ok).toBe(false);
    mock.invitation.mockResolvedValueOnce({ email: "g@example.com", status: "PENDING", expiresAt: new Date(Date.now() - 1000) });
    expect((await createAccountFromInvitation("tok", "una password valida", "una password valida")).ok).toBe(false);
    expect(mock.userCreate).not.toHaveBeenCalled();
  });

  it("checks length and confirmation before anything else", async () => {
    expect((await createAccountFromInvitation("tok", "corta", "corta")).ok).toBe(false);
    expect(await createAccountFromInvitation("tok", "una password valida", "un'altra password")).toEqual({
      ok: false,
      error: "Le due password non coincidono.",
    });
    expect(mock.userCreate).not.toHaveBeenCalled();
  });

  it("treats a race on the unique email as an existing account", async () => {
    mock.userCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await createAccountFromInvitation("tok", "una password valida", "una password valida")).toEqual({ ok: false, error: ACCOUNT_EXISTS });
  });
});

describe("changing the password from Impostazioni", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

  it("sets a first password without asking for a current one", async () => {
    mock.userFindUnique.mockResolvedValue({ passwordHash: null });
    expect(await changePassword("u1", "", "una password valida", "una password valida")).toEqual({ ok: true });
    expect(mock.userUpdate).toHaveBeenCalled();
  });

  it("requires the current password to change it", async () => {
    mock.userFindUnique.mockResolvedValue({ passwordHash: await hashPassword("vecchia password") });
    expect((await changePassword("u1", "sbagliata!!", "una password valida", "una password valida")).ok).toBe(false);
    expect(mock.userUpdate).not.toHaveBeenCalled();
    expect(await changePassword("u1", "vecchia password", "una password valida", "una password valida")).toEqual({ ok: true });
  });
});
