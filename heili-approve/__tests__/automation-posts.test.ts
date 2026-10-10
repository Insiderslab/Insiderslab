import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  client: { findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  post: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
  postEvent: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { AutomationError } from "@/lib/automation/auth";
import { importAutomationDraft, prepareAutomationDraft } from "@/lib/automation/posts";

const context = { workspaceId: "workspace-1", userId: "user-1", tokenId: "token-1" };
const client = {
  id: "client-1",
  workspaceId: "workspace-1",
  name: "Aurora",
  archivedAt: null,
  services: ["SOCIAL_POST"],
  networks: ["instagram"],
};
const asset = {
  id: "asset-1",
  workspaceId: "workspace-1",
  storageKey: "workspace-1/asset-1/photo.jpg",
  fileName: "photo.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1234,
  width: 1200,
  height: 1200,
  createdAt: new Date("2026-10-08T10:00:00Z"),
};

function body(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "excel-row-42",
    post: {
      clientId: "client-1",
      title: "Lancio autunno",
      publishAt: "2026-10-20T12:00:00+02:00",
      networks: ["instagram"],
      networkOptions: { instagramData: { type: "POST" } },
      text: "Scopri la nuova collezione",
      firstCommentText: null,
      media: [
        {
          assetId: "asset-1",
          url: "https://caller.example/untrusted-name.jpg",
          type: "image",
          mimeType: "image/jpeg",
          alt: "Nuova collezione",
        },
      ],
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PUBLIC_BASE_URL", "https://approve.example.com");
  vi.stubEnv("APP_VARIANT", "social");
  mockPrisma.client.findFirst.mockResolvedValue(client);
  mockPrisma.mediaAsset.findMany.mockResolvedValue([asset]);
  mockPrisma.post.findUnique.mockResolvedValue(null);
  mockPrisma.post.count.mockResolvedValue(0);
  mockPrisma.post.create.mockResolvedValue({ id: "post-new", status: "DRAFT" });
  mockPrisma.postEvent.create.mockResolvedValue({ id: "event-1" });
  mockPrisma.$executeRaw.mockResolvedValue(1);
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
});

describe("automation draft validation", () => {
  it("uses strict input and refuses status or envelope injection before DB access", async () => {
    await expect(prepareAutomationDraft(context, body({ status: "APPROVED" }))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(prepareAutomationDraft(context, { ...body(), workspaceId: "other-workspace" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(mockPrisma.client.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
  });

  it("requires an ISO instant with an explicit offset", async () => {
    await expect(prepareAutomationDraft(context, body({ publishAt: "2026-10-20T12:00:00" }))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    const prepared = await prepareAutomationDraft(context, body());
    expect(prepared.post.publishAt).toEqual(new Date("2026-10-20T10:00:00.000Z"));
  });

  it("scopes both client and uploaded asset lookup to the token workspace", async () => {
    const prepared = await prepareAutomationDraft(context, body());

    expect(mockPrisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: "client-1", workspaceId: "workspace-1" },
    });
    expect(mockPrisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        OR: [{ id: { in: ["asset-1"] } }, { storageKey: { in: [] } }],
      },
    });
    expect(prepared.post.media?.[0]).toMatchObject({
      assetId: "asset-1",
      url: expect.stringContaining("/media/"),
      mimeType: "image/jpeg",
    });
  });

  it("refuses remote media and assets not owned by the workspace", async () => {
    await expect(
      prepareAutomationDraft(
        context,
        body({ media: [{ url: "https://remote.example/photo.jpg", type: "image", mimeType: "image/jpeg" }] })
      )
    ).rejects.toMatchObject({ code: "MEDIA_ASSET_REQUIRED" });

    mockPrisma.mediaAsset.findMany.mockResolvedValue([]);
    await expect(prepareAutomationDraft(context, body())).rejects.toThrow("media non è stato trovato");
  });

  it("is a dry run: it validates and normalizes without writes", async () => {
    const prepared = await prepareAutomationDraft(context, body());
    expect(prepared.externalId).toBe("excel-row-42");
    expect(prepared.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
    expect(mockPrisma.postEvent.create).not.toHaveBeenCalled();
  });
});

describe("idempotent automation import", () => {
  it("creates only a DRAFT with version 1 and a traceable event", async () => {
    const result = await importAutomationDraft(context, body());

    expect(result).toEqual({ post: { id: "post-new", status: "DRAFT" }, replayed: false });
    const createArgs = mockPrisma.post.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      workspaceId: "workspace-1",
      clientId: "client-1",
      importKey: "excel-row-42",
      importHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      currentVersionNumber: 1,
      createdById: "user-1",
      versions: {
        create: expect.objectContaining({ number: 1, text: "Scopri la nuova collezione", createdById: "user-1" }),
      },
    });
    expect(createArgs.data).not.toHaveProperty("submittedAt");
    expect(createArgs.data).not.toHaveProperty("approvedAt");
    expect(createArgs.data).not.toHaveProperty("metricoolPostId");
    expect(mockPrisma.postEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        postId: "post-new",
        type: "CREATED",
        userId: "user-1",
        metadata: expect.objectContaining({
          source: "automation",
          externalId: "excel-row-42",
          tokenId: "token-1",
        }),
      }),
    });
  });

  it("replays the same externalId and payload without a second write", async () => {
    const prepared = await prepareAutomationDraft(context, body());
    vi.clearAllMocks();
    mockPrisma.client.findFirst.mockResolvedValue(client);
    mockPrisma.mediaAsset.findMany.mockResolvedValue([asset]);
    mockPrisma.post.findUnique.mockResolvedValue({ id: "post-existing", status: "DRAFT", importHash: prepared.hash });

    await expect(importAutomationDraft(context, body())).resolves.toEqual({
      post: { id: "post-existing", status: "DRAFT" },
      replayed: true,
    });
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
    expect(mockPrisma.postEvent.create).not.toHaveBeenCalled();
  });

  it("returns 409 semantics when an externalId is replayed with changed content", async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: "post-existing", status: "DRAFT", importHash: "other-hash" });

    await expect(importAutomationDraft(context, body({ text: "Contenuto cambiato" }))).rejects.toEqual(
      expect.objectContaining<Partial<AutomationError>>({ code: "IMPORT_CONFLICT", status: 409 })
    );
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
  });

  it("returns rate-limit semantics at 1000 imported drafts without creating a post or event", async () => {
    mockPrisma.post.count.mockResolvedValue(1000);

    await expect(importAutomationDraft(context, body())).rejects.toMatchObject({
      name: "RateLimitError",
      message: expect.stringContaining("Limite giornaliero"),
    });
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockPrisma.post.count).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        importKey: { not: null },
        createdAt: { gte: expect.any(Date) },
      },
    });
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
    expect(mockPrisma.postEvent.create).not.toHaveBeenCalled();
  });

  it("resolves a P2002 race as an idempotent replay and never retries creation", async () => {
    const prepared = await prepareAutomationDraft(context, body());
    vi.clearAllMocks();
    mockPrisma.client.findFirst.mockResolvedValue(client);
    mockPrisma.mediaAsset.findMany.mockResolvedValue([asset]);
    mockPrisma.post.count.mockResolvedValue(0);
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.post.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "post-winner", status: "DRAFT", importHash: prepared.hash });
    mockPrisma.post.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));

    await expect(importAutomationDraft(context, body())).resolves.toEqual({
      post: { id: "post-winner", status: "DRAFT" },
      replayed: true,
    });
    expect(mockPrisma.post.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.postEvent.create).not.toHaveBeenCalled();
  });
});
