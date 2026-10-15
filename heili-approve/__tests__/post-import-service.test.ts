import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  client: { findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  post: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  postEvent: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
const mockPlans = vi.hoisted(() => ({ createPlan: vi.fn(), addPostsToPlan: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/plans", () => mockPlans);

import { draftFingerprint, evaluateRow, type EvalContext, type FileRef, type RawRow } from "@/lib/post-import/rows";
import { checkImportRows, createImportedDrafts, importKeys } from "@/lib/post-import/service";

const NOW = new Date("2026-10-10T10:00:00Z");
const client = {
  id: "client-1",
  workspaceId: "workspace-1",
  name: "Aurora",
  archivedAt: null,
  services: ["SOCIAL_POST"],
  networks: ["instagram", "facebook", "twitter"],
  timezone: "Europe/Rome",
};
const photo: FileRef = { name: "Foto-1.jpg", size: 1000, type: "image", mimeType: "image/jpeg" };
const context = { workspaceId: "workspace-1", userId: "user-1" };

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    sourceRow: 2, date: "15/10/2026", time: "10:30", networks: "Instagram, Facebook", text: "Scopri la nuova collezione",
    firstComment: "", title: "", images: "foto-1.jpg", ...overrides,
  };
}
const ctx = (overrides: Partial<EvalContext> = {}): EvalContext => ({
  timeZone: "Europe/Rome", now: NOW, clientNetworks: client.networks, files: [photo], ...overrides,
});
const messages = (raw: RawRow, c: EvalContext = ctx()) => evaluateRow(raw, c).issues.map((i) => i.message);

describe("evaluateRow", () => {
  it("builds a draft: the date is read in the client's zone, the title comes from the text", () => {
    const result = evaluateRow(row(), ctx());
    expect(result.issues).toEqual([]);
    expect(result.draft).toMatchObject({
      publishAt: new Date("2026-10-15T08:30:00Z"),
      localDateTime: "2026-10-15T10:30",
      networks: ["instagram", "facebook"],
      title: "Scopri la nuova collezione",
      firstComment: null,
    });
    expect(result.draft?.files).toEqual([photo]);
    expect(result.when).toBe("gio 15 ott 2026, 10:30");
  });

  it("uses winter time after the clocks go back", () => {
    expect(evaluateRow(row({ date: "05/11/2026" }), ctx()).draft?.publishAt).toEqual(new Date("2026-11-05T09:30:00Z"));
  });

  it("reads the English columns of the automation file", () => {
    const result = evaluateRow(row({ date: "2026-10-15T10:30:00+02:00", time: "", networks: "instagram|facebook", kind: "SOCIAL_POST", networkOptions: '{"instagramData":{"type":"POST"}}' }), ctx());
    expect(result.issues).toEqual([]);
    expect(result.draft?.publishAt).toEqual(new Date("2026-10-15T08:30:00Z"));
    expect(result.draft?.networkOptions).toEqual({ instagramData: { type: "POST" } });
  });

  it("flags a date in the past, and still does when the networks are wrong", () => {
    expect(messages(row({ date: "01/01/2020" }))).toContain("La data di pubblicazione è già passata: scegli una data futura.");
    expect(messages(row({ date: "01/01/2020", networks: "Snapchat" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("già passata"), expect.stringContaining("Snapchat")])
    );
  });

  it("flags missing date, time, networks, and an empty post", () => {
    expect(messages(row({ date: "", time: "", networks: "", text: "", images: "" }))).toEqual(
      expect.arrayContaining(["Manca la data.", "Manca l'ora (per esempio 10:30).", expect.stringContaining("almeno una rete")])
    );
    expect(messages(row({ text: "", images: "" }))).toContain("Il post è vuoto: aggiungi un testo o almeno un'immagine o un video.");
  });

  it("names unknown networks and networks the client does not have", () => {
    expect(messages(row({ networks: "Instagram, Snapchat" }))[0]).toMatch(/«Snapchat».*Instagram, Facebook, X/);
    expect(messages(row({ networks: "LinkedIn" }))).toContain("LinkedIn non è abilitata per questo cliente (reti: Instagram, Facebook, X).");
    // No networks configured on the client: every network is allowed (the server's rule).
    expect(messages(row({ networks: "LinkedIn" }), ctx({ clientNetworks: [] }))).toEqual([]);
  });

  it("applies the per-network text limit and the Instagram media rule", () => {
    expect(messages(row({ networks: "X", text: "a".repeat(281), images: "" }))).toContain("Il testo supera il limite di 280 caratteri per X (281).");
    expect(messages(row({ images: "" }))).toContain("Instagram richiede almeno un'immagine o un video.");
    expect(messages(row({ networks: "Facebook", images: "" }))).toEqual([]);
  });

  it("matches files by name and flags missing or unsupported ones", () => {
    expect(evaluateRow(row({ images: "FOTO-1.JPG" }), ctx()).images[0].file).toEqual(photo);
    expect(messages(row({ images: "foto-1.jpg, manca.jpg" }))).toEqual(["Immagine non trovata: «manca.jpg». Trascina il file in questa pagina."]);
    expect(messages(row({ images: "scheda.pdf" }))).toEqual([expect.stringContaining("formato non supportato")]);
    expect(messages(row({ images: "foto-1.jpg" }), ctx({ files: [{ ...photo, size: 301 * 1024 * 1024 }] }))).toEqual(["«Foto-1.jpg» supera il limite di 300 MB."]);
  });

  it("maps «Formato» onto the networks that offer it", () => {
    const reel = { name: "reel.mp4", size: 1000, type: "video", mimeType: "video/mp4" } as const;
    const result = evaluateRow(row({ images: "reel.mp4", format: "Reel" }), ctx({ files: [reel] }));
    expect(result.issues).toEqual([]);
    expect(result.draft?.networkOptions).toEqual({ instagramData: { type: "REEL" }, facebookData: { type: "REEL" } });
  });

  it("applies «Rete: Formato» to one network only and merges with network_options", () => {
    const reel = { name: "reel.mp4", size: 1000, type: "video", mimeType: "video/mp4" } as const;
    const result = evaluateRow(
      row({ images: "reel.mp4", format: "Instagram: Reel", networkOptions: '{"facebookData":{"type":"STORY"}}' }),
      ctx({ files: [reel] })
    );
    expect(result.issues).toEqual([]);
    expect(result.draft?.networkOptions).toEqual({ instagramData: { type: "REEL" }, facebookData: { type: "STORY" } });
  });

  it("flags an unknown format, a network not in the row and a format no network offers", () => {
    expect(messages(row({ format: "Carosello" }))).toEqual([expect.stringContaining("Formato non riconosciuto")]);
    expect(messages(row({ format: "LinkedIn: Reel" }))).toEqual([expect.stringContaining("non è nella riga")]);
    expect(messages(row({ networks: "X", images: "", format: "Reel" }))).toEqual([expect.stringContaining("non vale per nessuna rete")]);
  });

  it("refuses a time skipped by the spring-forward jump, and a non-social kind", () => {
    expect(messages(row({ date: "28/03/2027", time: "02:30" }))).toContain("Quest'ora non esiste quel giorno (cambio dell'ora legale): scegline un'altra.");
    expect(messages(row({ kind: "BLOG_ARTICLE" }))).toContain("In questa versione si importano solo post social.");
  });

  it("has no draft while there are issues", () => {
    expect(evaluateRow(row({ date: "" }), ctx()).draft).toBeNull();
  });
});

describe("import keys", () => {
  const draftOf = (raw: RawRow) => evaluateRow(raw, ctx()).draft;

  it("depends on what the post is, not on its row number", () => {
    const [a] = importKeys("client-1", [draftOf(row({ sourceRow: 2 }))]);
    const [b] = importKeys("client-1", [draftOf(row({ sourceRow: 9 }))]);
    expect(a).toBe(b);
    expect(a).toMatch(/^panel:[a-f0-9]{32}$/);
    expect(importKeys("client-2", [draftOf(row())])[0]).not.toBe(a);
    expect(importKeys("client-1", [draftOf(row({ text: "Un altro testo" }))])[0]).not.toBe(a);
  });

  it("tells identical rows of one import apart, and skips invalid rows", () => {
    const keys = importKeys("client-1", [draftOf(row()), null, draftOf(row()), draftOf(row())]);
    expect(keys[1]).toBeNull();
    expect(keys[2]).toBe(`${keys[0]}.2`);
    expect(keys[3]).toBe(`${keys[0]}.3`);
    expect(draftFingerprint("c", draftOf(row())!)).toContain("foto-1.jpg");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PUBLIC_BASE_URL", "https://approve.example.com");
  vi.stubEnv("APP_VARIANT", "social");
  mockPrisma.client.findFirst.mockResolvedValue(client);
  mockPrisma.mediaAsset.findMany.mockResolvedValue([]);
  mockPrisma.post.findUnique.mockResolvedValue(null);
  mockPrisma.post.findMany.mockResolvedValue([]);
  mockPrisma.post.count.mockResolvedValue(0);
  let n = 0;
  mockPrisma.post.create.mockImplementation(async () => ({ id: `post-${++n}`, status: "DRAFT" }));
  mockPrisma.postEvent.create.mockResolvedValue({ id: "event-1" });
  mockPrisma.$executeRaw.mockResolvedValue(1);
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
});

const request = (rows: RawRow[], extra: Record<string, unknown> = {}) => ({ clientId: "client-1", rows, files: [photo], ...extra });

describe("checkImportRows (preview)", () => {
  it("validates with the server's rules and writes nothing", async () => {
    const checks = await checkImportRows("workspace-1", request([row(), row({ sourceRow: 3, date: "01/01/2020" })]), NOW);
    expect(checks.map((c) => c.ok)).toEqual([true, false]);
    expect(checks[0]).toMatchObject({ key: expect.stringMatching(/^panel:/), existing: null, month: "2026-10" });
    expect(checks[1].issues[0].message).toContain("già passata");
    expect(mockPrisma.client.findFirst).toHaveBeenCalledWith({ where: { id: "client-1", workspaceId: "workspace-1" } });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
  });

  it("reports the rows an earlier import already created", async () => {
    const [{ key }] = await checkImportRows("workspace-1", request([row()]), NOW);
    mockPrisma.post.findMany.mockResolvedValue([{ id: "post-old", importKey: key, status: "DRAFT" }]);
    const [check] = await checkImportRows("workspace-1", request([row()]), NOW);
    expect(check.existing).toEqual({ postId: "post-old", status: "DRAFT" });
    expect(mockPrisma.post.findMany).toHaveBeenLastCalledWith({
      where: { workspaceId: "workspace-1", importKey: { in: [key] } },
      select: { id: true, importKey: true, status: true },
    });
  });

  it("refuses an archived client, one without the social service, and one of another workspace", async () => {
    mockPrisma.client.findFirst.mockResolvedValue({ ...client, archivedAt: new Date() });
    await expect(checkImportRows("workspace-1", request([row()]), NOW)).rejects.toThrow("archiviato");
    mockPrisma.client.findFirst.mockResolvedValue({ ...client, services: ["BLOG_ARTICLE"] });
    await expect(checkImportRows("workspace-1", request([row()]), NOW)).rejects.toThrow("Post social");
    mockPrisma.client.findFirst.mockResolvedValue(null);
    await expect(checkImportRows("workspace-1", request([row()]), NOW)).rejects.toThrow("Cliente non trovato");
  });

  it("limits the rows", async () => {
    await expect(checkImportRows("workspace-1", request([]), NOW)).rejects.toThrow("Non ci sono righe");
    await expect(checkImportRows("workspace-1", request(Array.from({ length: 201 }, () => row())), NOW)).rejects.toThrow("al massimo 200");
  });

  it("flags a row identical to an earlier one of the same sheet", async () => {
    const checks = await checkImportRows(
      "workspace-1",
      request([row(), row({ sourceRow: 3 }), row({ sourceRow: 4, title: "Altro titolo" })]),
      NOW
    );
    expect(checks[0].ok).toBe(true);
    expect(checks[1].ok).toBe(false);
    expect(checks[1].issues[0].message).toBe("Uguale alla riga 2: creerebbe una bozza identica");
    // A different field makes it its own draft again.
    expect(checks[2].ok).toBe(true);
  });
});

describe("createImportedDrafts", () => {
  const uploaded = {
    "foto-1.jpg": { assetId: "asset-1", url: "https://approve.example.com/media/workspace-1/x.jpg", type: "image" as const, mimeType: "image/jpeg" },
  };
  const asset = {
    id: "asset-1", workspaceId: "workspace-1", storageKey: "workspace-1/x.jpg", fileName: "Foto-1.jpg", mimeType: "image/jpeg",
    sizeBytes: 1000, width: 800, height: 800, createdAt: NOW,
  };

  it("creates only DRAFTs through the shared importer, marked as coming from the panel", async () => {
    mockPrisma.mediaAsset.findMany.mockResolvedValue([asset]);
    const result = await createImportedDrafts(context, { ...request([row(), row({ sourceRow: 3, networks: "Facebook", images: "", date: "16/10/2026" })]), uploaded, plan: false }, NOW);

    expect(result).toMatchObject({ created: 2, existing: 0, failed: 0, plan: null });
    expect(result.outcomes[0]).toMatchObject({ status: "created", postId: "post-1", title: "Scopri la nuova collezione" });
    const data = mockPrisma.post.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      workspaceId: "workspace-1", clientId: "client-1", currentVersionNumber: 1, createdById: "user-1",
      publishAt: new Date("2026-10-15T08:30:00Z"), importKey: expect.stringMatching(/^panel:[a-f0-9]{32}$/),
      versions: { create: expect.objectContaining({ number: 1, text: "Scopri la nuova collezione" }) },
    });
    for (const call of mockPrisma.post.create.mock.calls) {
      expect(call[0].data).not.toHaveProperty("submittedAt");
      expect(call[0].data).not.toHaveProperty("approvedAt");
      expect(call[0].data.networks).toEqual(expect.any(Array));
    }
    expect(mockPrisma.postEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "CREATED", metadata: expect.objectContaining({ source: "panel", externalId: data.importKey }) }),
    });
    expect(mockPrisma.postEvent.create.mock.calls[0][0].data.metadata).not.toHaveProperty("tokenId");
  });

  it("does not trust the browser: an invalid row is not created, the others are", async () => {
    const result = await createImportedDrafts(context, { ...request([row({ date: "01/01/2020" }), row({ networks: "Facebook", images: "" })]), uploaded, plan: false }, NOW);
    expect(result.outcomes[0]).toMatchObject({ status: "failed", error: expect.stringContaining("già passata") });
    expect(result.outcomes[1].status).toBe("created");
    expect(mockPrisma.post.create).toHaveBeenCalledTimes(1);
  });

  it("fails a row whose picture was not uploaded, and one whose asset is not in the workspace", async () => {
    const missing = await createImportedDrafts(context, { ...request([row()]), uploaded: {}, plan: false }, NOW);
    expect(missing.outcomes[0]).toMatchObject({ status: "failed", error: "«Foto-1.jpg» non è stato caricato: riprova." });
    mockPrisma.mediaAsset.findMany.mockResolvedValue([]);
    const foreign = await createImportedDrafts(context, { ...request([row()]), uploaded, plan: false }, NOW);
    expect(foreign.outcomes[0]).toMatchObject({ status: "failed", error: expect.stringContaining("media non è stato trovato") });
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
  });

  it("importing the same sheet again duplicates nothing", async () => {
    const [{ key }] = await checkImportRows("workspace-1", request([row()]), NOW);
    mockPrisma.post.findMany.mockResolvedValue([{ id: "post-old", importKey: key }]);
    const result = await createImportedDrafts(context, { ...request([row()]), uploaded: {}, plan: false }, NOW);
    expect(result).toMatchObject({ created: 0, existing: 1, failed: 0 });
    expect(result.outcomes[0]).toMatchObject({ status: "existing", postId: "post-old" });
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
  });

  it("resolves a creation race (P2002) as a replay", async () => {
    mockPrisma.mediaAsset.findMany.mockResolvedValue([asset]);
    mockPrisma.post.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    // The winner has the same content, hence the same (row-derived) hash.
    mockPrisma.post.findUnique.mockImplementation(async () =>
      mockPrisma.post.create.mock.calls.length
        ? { id: "post-winner", status: "DRAFT", importHash: mockPrisma.post.create.mock.calls[0][0].data.importHash }
        : null
    );
    const result = await createImportedDrafts(context, { ...request([row()]), uploaded, plan: false }, NOW);
    expect(result.outcomes[0]).toMatchObject({ status: "existing", postId: "post-winner" });
    expect(mockPrisma.post.create).toHaveBeenCalledTimes(1);
  });

  it("opens the month's plan when asked and all rows are in that month", async () => {
    mockPlans.createPlan.mockResolvedValue({ plan: { id: "plan-1", title: "Piano social ottobre 2026" }, created: true });
    const result = await createImportedDrafts(context, { ...request([row({ networks: "Facebook", images: "" })]), uploaded: {}, plan: true }, NOW);
    expect(mockPlans.createPlan).toHaveBeenCalledWith("workspace-1", { clientId: "client-1", month: "2026-10" }, { kind: "user", userId: "user-1" });
    expect(result.plan).toEqual({ status: "ok", id: "plan-1", title: "Piano social ottobre 2026", month: "2026-10", created: true });
    expect(mockPlans.addPostsToPlan).not.toHaveBeenCalled();
  });

  it("adds the drafts to an existing plan, only those without a plan", async () => {
    mockPlans.createPlan.mockResolvedValue({ plan: { id: "plan-1", title: "Piano" }, created: false });
    mockPrisma.post.findMany.mockResolvedValue([{ id: "post-1" }]);
    await createImportedDrafts(context, { ...request([row({ networks: "Facebook", images: "" })]), uploaded: {}, plan: true }, NOW);
    expect(mockPlans.addPostsToPlan).toHaveBeenCalledWith("plan-1", "workspace-1", ["post-1"]);
  });

  it("explains why there is no plan when the rows span several months, and never fails the drafts", async () => {
    const rows = [row({ networks: "Facebook", images: "" }), row({ networks: "Facebook", images: "", date: "05/11/2026" })];
    const result = await createImportedDrafts(context, { ...request(rows), uploaded: {}, plan: true }, NOW);
    expect(result.created).toBe(2);
    expect(result.plan).toMatchObject({ status: "error", message: expect.stringContaining("mesi diversi") });
    expect(mockPlans.createPlan).not.toHaveBeenCalled();

    mockPlans.createPlan.mockRejectedValue(new Error("boom"));
    const again = await createImportedDrafts(context, { ...request([row({ networks: "Facebook", images: "", text: "Altro" })]), uploaded: {}, plan: true }, NOW);
    expect(again.created).toBe(1);
    expect(again.plan).toMatchObject({ status: "error", message: expect.stringContaining("il piano no") });
  });
});

describe("«Formato» in the preview grid (QA-03)", () => {
  it("reads the menu words, any case, and tells apart what the menu cannot show", async () => {
    const { formatChoice } = await import("@/lib/post-import/rows");
    expect(formatChoice("")).toBe("");
    expect(formatChoice(undefined)).toBe("");
    expect(formatChoice(" reel ")).toBe("Reel");
    expect(formatChoice("STORY")).toBe("Storia");
    expect(formatChoice("Post")).toBe("Post");
    expect(formatChoice("Video")).toBeNull();
    expect(formatChoice("Instagram: Reel")).toBeNull();
  });

  it("puts a wrong format on the «Formato» field, not on the whole row", () => {
    const result = evaluateRow(row({ format: "Video" }), ctx());
    expect(result.issues).toEqual([{ field: "format", message: expect.stringContaining("Formato non riconosciuto: «Video»") }]);
    expect(result.formats).toEqual([]);
  });

  it("says which format was read, per network", () => {
    const reel: FileRef = { name: "reel.mp4", size: 2000, type: "video", mimeType: "video/mp4" };
    const all = evaluateRow(row({ images: "reel.mp4", format: "Reel" }), ctx({ files: [reel] }));
    expect(all.formats).toEqual([{ network: "instagram", label: "Reel" }, { network: "facebook", label: "Reel" }]);
    const one = evaluateRow(row({ images: "reel.mp4", format: "Instagram: Storia" }), ctx({ files: [reel] }));
    expect(one.formats).toEqual([{ network: "instagram", label: "Storia" }]);
    expect(evaluateRow(row(), ctx()).formats).toEqual([]);
  });
});
