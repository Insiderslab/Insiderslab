import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  automationToken: { findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  client: { findMany: vi.fn() },
  post: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { GET as listClients } from "@/app/api/automation/v1/clients/route";
import { GET as readPost } from "@/app/api/automation/v1/posts/[id]/route";
import {
  AutomationError,
  authenticateAutomation,
  hashAutomationToken,
  newAutomationToken,
} from "@/lib/automation/auth";
import { automationFailure, readAutomationJson } from "@/lib/automation/http";
import { RateLimitError } from "@/lib/errors";

const plainToken = `approve_auto_${"a".repeat(64)}`;
const authRequest = (url = "https://approve.example/api/automation/v1/clients") =>
  new Request(url, { headers: { authorization: `Bearer ${plainToken}` } });

function activeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    tokenHash: hashAutomationToken(plainToken),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automationToken.findUnique.mockResolvedValue(activeToken());
  mockPrisma.workspaceMember.findUnique.mockResolvedValue({ id: "member-1" });
  mockPrisma.client.findMany.mockResolvedValue([]);
  mockPrisma.post.findFirst.mockResolvedValue(null);
});

describe("automation token authentication", () => {
  it("generates opaque keys and stores/looks up only their SHA-256 hash", async () => {
    const generated = newAutomationToken();
    expect(generated).toMatch(/^approve_auto_[a-f0-9]{64}$/);
    expect(hashAutomationToken(generated)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAutomationToken(generated)).not.toContain(generated);

    await expect(authenticateAutomation(authRequest())).resolves.toEqual({
      workspaceId: "workspace-1",
      userId: "user-1",
      tokenId: "token-1",
    });
    expect(mockPrisma.automationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashAutomationToken(plainToken) },
    });
  });

  it("rejects cookies, malformed keys, expiry and revocation", async () => {
    await expect(
      authenticateAutomation(new Request("https://approve.example/api", { headers: { cookie: "session=yes" } }))
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(mockPrisma.automationToken.findUnique).not.toHaveBeenCalled();

    await expect(
      authenticateAutomation(
        new Request("https://approve.example/api", { headers: { authorization: "Bearer approve_auto_NOT_HEX" } })
      )
    ).rejects.toMatchObject({ status: 401 });

    mockPrisma.automationToken.findUnique.mockResolvedValueOnce(activeToken({ expiresAt: new Date(Date.now() - 1) }));
    await expect(authenticateAutomation(authRequest())).rejects.toMatchObject({ status: 401 });
    mockPrisma.automationToken.findUnique.mockResolvedValueOnce(activeToken({ revokedAt: new Date() }));
    await expect(authenticateAutomation(authRequest())).rejects.toMatchObject({ status: 401 });
  });

  it("invalidates a key as soon as its creator loses workspace membership", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    await expect(authenticateAutomation(authRequest())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Accesso al workspace revocato",
    });
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: "workspace-1", userId: "user-1" } },
      select: { id: true },
    });
  });
});

describe("bounded automation JSON", () => {
  it("parses JSON without trusting Content-Length", async () => {
    const request = new Request("https://approve.example/api", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: JSON.stringify({ title: "Post" }),
    });
    await expect(readAutomationJson(request, 100)).resolves.toEqual({ title: "Post" });
  });

  it("rejects wrong media type, malformed JSON and streamed bodies over the bound", async () => {
    await expect(
      readAutomationJson(new Request("https://approve.example/api", { method: "POST", body: "{}" }))
    ).rejects.toMatchObject({ code: "CONTENT_TYPE", status: 415 });

    await expect(
      readAutomationJson(
        new Request("https://approve.example/api", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{broken",
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_JSON" });

    await expect(
      readAutomationJson(
        new Request("https://approve.example/api", {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": "2" },
          body: JSON.stringify({ value: "larger than ten bytes" }),
        }),
        10
      )
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  });

  it("rejects JSON deeper than the iterative complexity bound", async () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 22; depth++) nested = { child: nested };
    const request = new Request("https://approve.example/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nested),
    });

    await expect(readAutomationJson(request)).rejects.toMatchObject({
      code: "JSON_TOO_COMPLEX",
      status: 400,
    });
  });
});

describe("automation route boundaries", () => {
  it("returns 401 before reading data when no automation key is supplied", async () => {
    const response = await listClients(new Request("https://approve.example/api/automation/v1/clients"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(mockPrisma.client.findMany).not.toHaveBeenCalled();
  });

  it("scopes client search and post reads to the token workspace", async () => {
    mockPrisma.client.findMany.mockResolvedValue([
      { id: "client-1", name: "Aurora", timezone: "Europe/Rome", services: ["SOCIAL_POST"], networks: ["instagram"] },
    ]);
    const clientsResponse = await listClients(authRequest("https://approve.example/api/automation/v1/clients?q=Aurora&limit=20"));
    expect(clientsResponse.status).toBe(200);
    expect(mockPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "workspace-1", archivedAt: null }),
        take: 21,
      })
    );

    mockPrisma.post.findFirst.mockResolvedValue({ id: "post-1", workspaceId: "workspace-1", versions: [] });
    const postResponse = await readPost(authRequest("https://approve.example/api/automation/v1/posts/post-1"), {
      params: Promise.resolve({ id: "post-1" }),
    });
    expect(postResponse.status).toBe(200);
    expect(mockPrisma.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "post-1", workspaceId: "workspace-1" } })
    );
  });

  it("rejects malformed queries and redacts unexpected internal errors", async () => {
    const malformed = await listClients(authRequest("https://approve.example/api/automation/v1/clients?limit=101"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ success: false, code: "INVALID_QUERY" });

    const response = automationFailure(new Error("database password: secret"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: "INTERNAL_ERROR" });
    expect(JSON.stringify(body)).not.toContain("secret");

    const known = automationFailure(new AutomationError("IMPORT_CONFLICT", "Conflitto", 409));
    expect(known.status).toBe(409);

    const limited = automationFailure(new RateLimitError("Troppe bozze"));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ success: false, code: "RATE_LIMITED", error: "Troppe bozze" });
  });
});
