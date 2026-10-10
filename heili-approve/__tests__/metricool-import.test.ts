import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory Client table behind the real createClient / updateClient, so the
// import service runs end to end (planning, validation, idempotency).
const { db, mockPrisma, mockContext, mockRevalidate } = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string; workspaceId: string };
  const db = { clients: [] as Row[], nextId: 1 };
  const matches = (row: Row, where: Record<string, unknown> | undefined) =>
    Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
  const mockPrisma = {
    workspace: {
      findUnique: vi.fn(async () => ({ metricoolUserId: "1234567", metricoolTokenEncrypted: "x" })),
    },
    client: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
        db.clients.filter((row) => matches(row, where)).map((row) => ({ ...row }))
      ),
      findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        const row = db.clients.find((r) => matches(r, where));
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `c${db.nextId++}`, archivedAt: null, ...data } as unknown as Row;
        db.clients.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.clients.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
  };
  return {
    db,
    mockPrisma,
    mockContext: { current: null as null | { userId: string; workspaceId: string; role: string } },
    mockRevalidate: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
// The real module pulls in next-auth; only the role rule matters here.
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => mockContext.current),
  canManageWorkspace: (role: string) => role === "ADMIN" || role === "OWNER",
}));

import { importMetricoolClientsAction } from "@/app/(dashboard)/clients/import/actions";
import { MetricoolClient, parseBrands } from "@/lib/metricool/client";
import {
  buildImportRows,
  defaultChoices,
  findBrandByName,
  importButtonLabel,
  linkClientPatch,
  newClientInput,
  normalizeName,
  planImport,
  skipMessage,
  suggestMatches,
  summaryHeadline,
  usableLogoUrl,
  type ImportBrand,
  type ImportClient,
} from "@/lib/metricool/import";
import { importMetricoolBrands, loadImportRows } from "@/lib/metricool/import-service";

const previousVariant = process.env.APP_VARIANT;
const previousFake = process.env.METRICOOL_FAKE;

beforeEach(() => {
  process.env.APP_VARIANT = "all";
  process.env.METRICOOL_FAKE = "1";
  db.clients = [];
  db.nextId = 1;
  mockContext.current = { userId: "u1", workspaceId: "ws1", role: "OWNER" };
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.APP_VARIANT = previousVariant;
  process.env.METRICOOL_FAKE = previousFake;
});

const brand = (over: Partial<ImportBrand> = {}): ImportBrand => ({
  blogId: "1",
  label: "Brand",
  timezone: "Europe/Rome",
  avatarUrl: "https://cdn.example.com/logo.png",
  networks: ["instagram"],
  ...over,
});

const client = (over: Partial<ImportClient> = {}): ImportClient => ({
  id: "c1",
  name: "Cliente",
  metricoolBlogId: null,
  archivedAt: null,
  logoUrl: null,
  networks: [],
  services: ["SOCIAL_POST"],
  ...over,
});

function seedClient(over: Record<string, unknown>) {
  const row = {
    id: `c${db.nextId++}`,
    workspaceId: "ws1",
    name: "Cliente",
    metricoolBlogId: null,
    timezone: "Europe/Rome",
    logoUrl: null,
    networks: [] as string[],
    autoSchedule: true,
    services: ["SOCIAL_POST"],
    archivedAt: null,
    ...over,
  };
  db.clients.push(row);
  return row;
}

// ─── Parsing the brand list ──────────────────────────────────────────────────

describe("brand parsing (shape of Metricool's brand list)", () => {
  const real = {
    id: 3045507,
    userId: 1234567,
    label: "  Pharmera ",
    image: "https://cdn.metricool.test/pharmera.png",
    timezone: "Europe/Rome",
    networksData: {
      facebookData: { id: "1", name: "Pharmera Page" },
      instagramData: { username: "pharmera.it", id: "9" },
      tiktokData: null,
      youtubeData: {},
      gbpData: { name: "Pharmera Milano" },
      linkedinData: { id: "55" },
      facebookAdsData: { id: "act_1" },
      googleAdsData: { id: "123" },
      tiktokAdsData: { id: "7" },
    },
  };

  it("trims the label, reads the image and the networks, ignores ads accounts", () => {
    const [parsed] = parseBrands([real]);
    expect(parsed.blogId).toBe("3045507");
    expect(parsed.label).toBe("Pharmera");
    expect(parsed.avatarUrl).toBe("https://cdn.metricool.test/pharmera.png");
    expect(parsed.timezone).toBe("Europe/Rome");
    // Publishing networks only, in the app's order; empty / null data is not connected.
    expect(parsed.networks).toEqual(["instagram", "facebook", "linkedin", "gmb"]);
    expect(parsed.networks).not.toContain("tiktok");
    expect(parsed.networks).not.toContain("youtube");
  });

  it("keeps an account name per network when Metricool gives one", () => {
    const [parsed] = parseBrands([real]);
    expect(parsed.accounts.instagram).toBe("pharmera.it");
    expect(parsed.accounts.facebook).toBe("Pharmera Page");
    expect(parsed.accounts.gmb).toBe("Pharmera Milano");
    // Connected but nameless: no hint, still listed.
    expect(parsed.networks).toContain("linkedin");
    expect(parsed.accounts.linkedin).toBeUndefined();
  });

  it("falls back to 'Brand <id>' for a missing or blank label", () => {
    const parsed = parseBrands([{ id: 77 }, { id: 78, label: "   " }, { id: 79, label: null }]);
    expect(parsed.map((b) => b.label)).toEqual(["Brand 77", "Brand 78", "Brand 79"]);
  });

  it("counts a brand with only ads accounts as having no publishing network", () => {
    const [parsed] = parseBrands([{ id: 1, networksData: { facebookAdsData: { id: "a" }, googleAdsData: { id: "b" } } }]);
    expect(parsed.networks).toEqual([]);
    expect(parsed.accounts).toEqual({});
  });

  it("still reads the older flat profile fields", () => {
    const [parsed] = parseBrands([{ id: 5, label: "Old", picture: "https://x.test/p.png", instagram: "handle" }]);
    expect(parsed.avatarUrl).toBe("https://x.test/p.png");
    expect(parsed.networks).toEqual(["instagram"]);
    expect(parsed.accounts).toEqual({ instagram: "handle" });
  });
});

describe("fake brands (METRICOOL_FAKE=1)", () => {
  it("are realistic: 10 brands with logos, a trailing-space name, a missing label, no ads networks", async () => {
    const brands = await new MetricoolClient({ userId: "u", token: "t", fake: true }).listBrands();
    expect(brands).toHaveLength(10);
    expect(new Set(brands.map((b) => b.blogId)).size).toBe(10);
    for (const b of brands) {
      expect(b.avatarUrl).toMatch(/^https?:\/\/.+\/fake-brands\/brand-\d+\.svg$/);
      expect(b.label).toBe(b.label.trim());
    }
    expect(brands.map((b) => b.label)).toContain("Pharmera");
    expect(brands.some((b) => /^Brand fake-/.test(b.label))).toBe(true);
    expect(brands.some((b) => b.networks.length >= 4)).toBe(true);
    expect(new Set(brands.map((b) => b.timezone)).size).toBeGreaterThan(2);
  });
});

// ─── Names ───────────────────────────────────────────────────────────────────

describe("name matching", () => {
  it("ignores case, accents, spaces and punctuation", () => {
    expect(normalizeName("Pharmera ")).toBe("pharmera");
    expect(normalizeName("  CAFFÈ   Aurora")).toBe(normalizeName("caffe aurora"));
    expect(normalizeName("L'Osteria-del Borgo")).toBe("losteriadelborgo");
    expect(normalizeName("Şahin Café")).toBe("sahincafe");
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName("!!!")).toBe("");
  });

  it("finds the brand of a typed name only when exactly one matches", () => {
    const brands = [{ label: "Pharmera" }, { label: "Osteria del Borgo" }];
    expect(findBrandByName("  pharmera ", brands)).toBe(brands[0]);
    expect(findBrandByName("OSTERIA DEL BORGO", brands)).toBe(brands[1]);
    expect(findBrandByName("Pharm", brands)).toBeNull();
    expect(findBrandByName("", brands)).toBeNull();
    expect(findBrandByName("x", [{ label: "X" }, { label: "x " }])).toBeNull();
  });

  it("suggests an unlinked client for a brand: unique, active, once", () => {
    const brands = [
      { blogId: "1", label: "Pharmera" },
      { blogId: "2", label: "pharmera " },
      { blogId: "3", label: "Gelateria Nuvola" },
      { blogId: "4", label: "Doppio" },
      { blogId: "5", label: "Collegato" },
    ];
    const clients = [
      client({ id: "a", name: "PHARMERA" }),
      client({ id: "b", name: "Gelateria Nuvola", archivedAt: new Date() }),
      client({ id: "c", name: "Doppio" }),
      client({ id: "d", name: "doppio" }),
      client({ id: "e", name: "Collegato", metricoolBlogId: "999" }),
    ];
    const suggestions = suggestMatches(brands, clients);
    // The first brand takes the client; the second does not get the same one.
    expect(suggestions.get("1")).toBe("a");
    expect(suggestions.has("2")).toBe(false);
    // Archived clients, ambiguous names and already linked clients are never suggested.
    expect(suggestions.has("3")).toBe(false);
    expect(suggestions.has("4")).toBe(false);
    expect(suggestions.has("5")).toBe(false);
  });
});

// ─── Rows and planning ───────────────────────────────────────────────────────

describe("import rows and defaults", () => {
  const brands = [
    brand({ blogId: "1", label: "Zeta" }),
    brand({ blogId: "2", label: "Alfa" }),
    brand({ blogId: "3", label: "Pharmera" }),
  ];
  const clients = [
    client({ id: "p", name: "pharmera " }),
    client({ id: "z", name: "Zeta Srl", metricoolBlogId: "1" }),
    client({ id: "g", name: "Vecchio", metricoolBlogId: "2", archivedAt: new Date() }),
  ];

  it("sorts by name, marks linked brands (archived too) and proposes create / link", () => {
    const rows = buildImportRows(brands, clients);
    expect(rows.map((r) => r.label)).toEqual(["Alfa", "Pharmera", "Zeta"]);
    const [alfa, pharmera, zeta] = rows;
    expect(alfa.linkedTo).toEqual({ id: "g", name: "Vecchio", archived: true });
    expect(alfa.defaultAction).toBe("skip");
    expect(pharmera.linkedTo).toBeNull();
    expect(pharmera.suggestedClientId).toBe("p");
    expect(pharmera.defaultAction).toBe("link");
    expect(zeta.linkedTo?.name).toBe("Zeta Srl");
    expect(zeta.defaultAction).toBe("skip");
  });

  it("starts from a choice for every brand that is not linked", () => {
    expect(defaultChoices(buildImportRows(brands, clients))).toEqual([
      { blogId: "3", action: "link", clientId: "p" },
    ]);
    expect(defaultChoices(buildImportRows([brand({ blogId: "9", label: "Nuovo" })], []))).toEqual([
      { blogId: "9", action: "create", clientId: null },
    ]);
  });
});

describe("planImport", () => {
  const brands = [
    brand({ blogId: "1", label: "Uno" }),
    brand({ blogId: "2", label: "Due" }),
    brand({ blogId: "3", label: "Tre" }),
  ];

  it("creates, links and leaves out what is ignored", () => {
    const steps = planImport({
      brands,
      clients: [client({ id: "c1", name: "Due" })],
      choices: [
        { blogId: "1", action: "create" },
        { blogId: "2", action: "link", clientId: "c1" },
        { blogId: "3", action: "skip" },
      ],
    });
    expect(steps.map((s) => s.kind)).toEqual(["create", "link"]);
  });

  it("skips a brand that already belongs to a client, archived ones too (idempotent)", () => {
    const steps = planImport({
      brands,
      clients: [
        client({ id: "c1", name: "Uno SRL", metricoolBlogId: "1" }),
        client({ id: "c2", name: "Due", metricoolBlogId: "2", archivedAt: new Date() }),
      ],
      choices: [
        { blogId: "1", action: "create" },
        { blogId: "2", action: "create" },
        { blogId: "3", action: "create" },
      ],
    });
    expect(steps.map((s) => s.kind)).toEqual(["skip", "skip", "create"]);
    expect(steps.map((s) => (s.kind === "skip" ? skipMessage(s) : ""))).toEqual([
      "Già collegato a Uno SRL",
      "Già collegato a Due (archiviato)",
      "",
    ]);
  });

  it("never lets the browser invent data: unknown brands are skipped", () => {
    const steps = planImport({ brands, clients: [], choices: [{ blogId: "nope", action: "create" }] });
    expect(steps).toEqual([
      { kind: "skip", blogId: "nope", label: "nope", reason: "unknown_brand", detail: null },
    ]);
  });

  it("refuses a link to a client that is missing, archived, already linked or used twice", () => {
    const steps = planImport({
      brands: [...brands, brand({ blogId: "4", label: "Quattro" }), brand({ blogId: "5", label: "Cinque" })],
      clients: [
        client({ id: "free", name: "Libero" }),
        client({ id: "old", name: "Archiviato", archivedAt: new Date() }),
        client({ id: "busy", name: "Occupato", metricoolBlogId: "77" }),
      ],
      choices: [
        { blogId: "1", action: "link", clientId: "ghost" },
        { blogId: "2", action: "link", clientId: "old" },
        { blogId: "3", action: "link", clientId: "busy" },
        { blogId: "4", action: "link", clientId: "free" },
        { blogId: "5", action: "link", clientId: "free" },
      ],
    });
    expect(steps.map((s) => (s.kind === "skip" ? s.reason : s.kind))).toEqual([
      "client_not_found",
      "client_not_found",
      "client_has_brand",
      "link",
      "client_already_used",
    ]);
  });

  it("counts a brand chosen twice once (the first choice wins)", () => {
    const steps = planImport({
      brands,
      clients: [],
      choices: [
        { blogId: "1", action: "create" },
        { blogId: "1", action: "skip" },
      ],
    });
    expect(steps).toHaveLength(1);
  });
});

describe("what an import writes", () => {
  it("builds a new client from the brand", () => {
    expect(newClientInput(brand({ label: "Osteria", blogId: "42", timezone: "Europe/Madrid", networks: ["instagram", "gmb"] }))).toEqual({
      name: "Osteria",
      metricoolBlogId: "42",
      timezone: "Europe/Madrid",
      logoUrl: "https://cdn.example.com/logo.png",
      networks: ["instagram", "gmb"],
      autoSchedule: true,
      services: ["SOCIAL_POST"],
    });
  });

  it("falls back to Rome for a missing or invalid time zone and drops an unusable logo", () => {
    expect(newClientInput(brand({ timezone: "Mars/Olympus" })).timezone).toBe("Europe/Rome");
    expect(newClientInput(brand({ timezone: null })).timezone).toBe("Europe/Rome");
    expect(newClientInput(brand({ avatarUrl: "javascript:alert(1)" })).logoUrl).toBeNull();
    expect(usableLogoUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(usableLogoUrl("not a url")).toBeNull();
    expect(usableLogoUrl(null)).toBeNull();
  });

  it("links an existing client filling only what is empty", () => {
    const b = brand({ networks: ["instagram", "facebook"] });
    expect(linkClientPatch(b, client(), ["SOCIAL_POST"])).toEqual({
      metricoolBlogId: "1",
      logoUrl: "https://cdn.example.com/logo.png",
      networks: ["instagram", "facebook"],
    });
    // Existing logo, networks and (always) time zone stay as they are.
    expect(
      linkClientPatch(b, client({ logoUrl: "https://mine.example.com/l.png", networks: ["linkedin"] }), ["SOCIAL_POST"])
    ).toEqual({ metricoolBlogId: "1" });
  });

  it("gives the social service to a client that has only articles", () => {
    const patch = linkClientPatch(brand(), client({ services: ["BLOG_ARTICLE"] }), ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"]);
    expect(patch.services).toEqual(["SOCIAL_POST", "BLOG_ARTICLE"]);
  });

  it("words the result", () => {
    const some = { created: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}] as never[], linked: [{}, {}, {}] as never[] };
    expect(summaryHeadline(some)).toBe("12 clienti creati, 3 collegati");
    expect(summaryHeadline({ created: [{}] as never[], linked: [] })).toBe("1 cliente creato");
    expect(summaryHeadline({ created: [], linked: [{}] as never[] })).toBe("1 collegato");
    expect(summaryHeadline({ created: [], linked: [] })).toBe("Nessun cliente importato");
    expect(importButtonLabel(0)).toBe("Importa clienti");
    expect(importButtonLabel(1)).toBe("Importa 1 cliente");
    expect(importButtonLabel(12)).toBe("Importa 12 clienti");
  });
});

// ─── The service, end to end (fake Metricool, in-memory clients) ─────────────

describe("importMetricoolBrands", () => {
  it("loads the rows with the name match preselected", async () => {
    seedClient({ name: "PHARMERA " });
    seedClient({ name: "Altro cliente" });
    const data = await loadImportRows("ws1");
    expect(data.fake).toBe(true);
    expect(data.rows).toHaveLength(10);
    const pharmera = data.rows.find((r) => r.label === "Pharmera")!;
    expect(pharmera.defaultAction).toBe("link");
    expect(pharmera.suggestedClientId).toBe(db.clients[0].id);
    expect(data.candidates.map((c) => c.name)).toEqual(["PHARMERA ", "Altro cliente"]);
  });

  it("creates the clients, links the existing one, and a second run changes nothing", async () => {
    const existing = seedClient({ name: "pharmera" });
    const data = await loadImportRows("ws1");
    const choices = defaultChoices(data.rows);

    const first = await importMetricoolBrands("ws1", choices);
    expect(first.created).toHaveLength(9);
    expect(first.linked.map((l) => l.id)).toEqual([existing.id]);
    expect(first.skipped).toEqual([]);
    expect(db.clients).toHaveLength(10);

    const linked = db.clients.find((c) => c.id === existing.id)!;
    expect(linked.metricoolBlogId).toBe("fake-1001");
    expect(linked.name).toBe("pharmera");
    expect(linked.logoUrl).toMatch(/brand-1\.svg$/);
    expect(linked.networks).toEqual(["instagram", "facebook", "linkedin"]);

    const created = db.clients.find((c) => c.name === "Osteria del Borgo")!;
    expect(created).toMatchObject({
      workspaceId: "ws1",
      metricoolBlogId: "fake-1002",
      timezone: "Europe/Rome",
      autoSchedule: true,
      services: ["SOCIAL_POST"],
    });
    // The brand without a label becomes "Brand <id>".
    expect(db.clients.map((c) => c.name)).toContain("Brand fake-1005");

    // Same choices again: everything is already linked, nothing is duplicated.
    const second = await importMetricoolBrands("ws1", choices);
    expect(second.created).toEqual([]);
    expect(second.linked).toEqual([]);
    expect(second.skipped).toHaveLength(10);
    expect(second.skipped.every((s) => s.reason.startsWith("Già collegato a "))).toBe(true);
    expect(db.clients).toHaveLength(10);
  });

  it("does not duplicate when two imports run at the same time", async () => {
    const choices = defaultChoices((await loadImportRows("ws1")).rows);
    const [a, b] = await Promise.all([importMetricoolBrands("ws1", choices), importMetricoolBrands("ws1", choices)]);
    expect(a.created.length + b.created.length).toBe(10);
    expect(db.clients).toHaveLength(10);
    expect(new Set(db.clients.map((c) => c.metricoolBlogId)).size).toBe(10);
  });

  it("only imports what was chosen and keeps the client's own time zone on a link", async () => {
    const mine = seedClient({ name: "Mio cliente", timezone: "America/Bogota", logoUrl: "https://mine.example.com/l.png" });
    const summary = await importMetricoolBrands("ws1", [
      { blogId: "fake-1004", action: "link", clientId: mine.id },
      { blogId: "fake-1003", action: "skip" },
    ]);
    expect(summary.created).toEqual([]);
    expect(summary.linked).toHaveLength(1);
    expect(db.clients).toHaveLength(1);
    expect(mine.timezone).toBe("America/Bogota");
    expect(mine.logoUrl).toBe("https://mine.example.com/l.png");
    expect(mine.metricoolBlogId).toBe("fake-1004");
  });

  it("scopes everything to the workspace: another workspace's client cannot be linked", async () => {
    const foreign = seedClient({ workspaceId: "other", name: "Altrui" });
    const summary = await importMetricoolBrands("ws1", [{ blogId: "fake-1001", action: "link", clientId: foreign.id }]);
    expect(summary.linked).toEqual([]);
    expect(summary.skipped[0].reason).toContain("Cliente non trovato");
    expect(foreign.metricoolBlogId).toBeNull();
  });

  it("an invalid client does not stop the others", async () => {
    mockPrisma.client.create.mockRejectedValueOnce(new Error("db down"));
    const summary = await importMetricoolBrands("ws1", [
      { blogId: "fake-1001", action: "create" },
      { blogId: "fake-1002", action: "create" },
    ]);
    expect(summary.created.map((c) => c.name)).toEqual(["Osteria del Borgo"]);
    expect(summary.skipped).toEqual([
      { blogId: "fake-1001", label: "Pharmera", reason: "Si è verificato un errore imprevisto. Riprova tra poco." },
    ]);
  });
});

// ─── Authorization ───────────────────────────────────────────────────────────

describe("importMetricoolClientsAction: who can import", () => {
  const input = { choices: [{ blogId: "fake-1001", action: "create" as const }] };

  it("refuses without a session", async () => {
    mockContext.current = null;
    expect(await importMetricoolClientsAction(input)).toEqual({ ok: false, error: "Sessione scaduta: accedi di nuovo." });
    expect(db.clients).toHaveLength(0);
  });

  it("refuses a plain member and writes nothing", async () => {
    mockContext.current = { userId: "u2", workspaceId: "ws1", role: "MEMBER" };
    const result = await importMetricoolClientsAction(input);
    expect(result).toEqual({
      ok: false,
      error: "Solo titolari e amministratori possono importare i clienti da Metricool.",
    });
    expect(db.clients).toHaveLength(0);
    expect(mockPrisma.client.create).not.toHaveBeenCalled();
  });

  it("refuses on an instance without social posts", async () => {
    process.env.APP_VARIANT = "blog";
    const result = await importMetricoolClientsAction(input);
    expect(result.ok).toBe(false);
    expect(db.clients).toHaveLength(0);
  });

  it("lets admins and owners import, in their own workspace", async () => {
    for (const role of ["ADMIN", "OWNER"]) {
      db.clients = [];
      mockContext.current = { userId: "u", workspaceId: "ws9", role };
      const result = await importMetricoolClientsAction(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message).toBe("1 cliente creato");
        expect(result.data.created).toHaveLength(1);
      }
      expect(db.clients.map((c) => c.workspaceId)).toEqual(["ws9"]);
    }
    expect(mockRevalidate).toHaveBeenCalledWith("/clients");
  });

  it("validates the input", async () => {
    const result = await importMetricoolClientsAction({
      choices: [{ blogId: "x", action: "destroy" as never }],
    });
    expect(result.ok).toBe(false);
    const tooMany = await importMetricoolClientsAction({
      choices: Array.from({ length: 501 }, (_, i) => ({ blogId: `b${i}`, action: "skip" as const })),
    });
    expect(tooMany.ok).toBe(false);
    expect(db.clients).toHaveLength(0);
  });
});

describe("parseBrands with the real simpleProfiles shape", () => {
  // Trimmed copy of a real response: networksData values are plain strings
  // (page id, handle, GBP location path); ads ids must not become networks.
  const real = {
    data: [
      {
        id: 4917753,
        userId: 3711261,
        label: "Ecosmart Building",
        image: "https://static.metricool.com/brand-logo/202506/4917753-file.png",
        timezone: "Europe/Rome",
        networksData: {
          facebookData: "1637235966606560",
          instagramData: "ecosmartbuildingitalia",
          gbpData: "accounts/112724755818305873156/locations/11996975363281491637",
          googleAdsData: "1986580494",
        },
      },
      { id: 4918118, userId: 3711261, label: "Pharmera ", timezone: "Europe/Rome", networksData: { googleAdsData: "1497228242" } },
      { id: 6265104, userId: 3711261, timezone: "Europe/Rome", networksData: {} },
    ],
  };

  it("maps string accounts to networks, ignores ads, trims and falls back on labels", () => {
    const brands = parseBrands(real);
    expect(brands).toHaveLength(3);
    expect(brands[0]).toMatchObject({
      blogId: "4917753",
      label: "Ecosmart Building",
      avatarUrl: "https://static.metricool.com/brand-logo/202506/4917753-file.png",
      timezone: "Europe/Rome",
    });
    expect([...brands[0].networks].sort()).toEqual(["facebook", "gmb", "instagram"]);
    expect(brands[0].accounts.instagram).toBe("ecosmartbuildingitalia");
    expect(brands[1]).toMatchObject({ blogId: "4918118", label: "Pharmera", networks: [] });
    expect(brands[2].label).toBe("Brand 6265104");
  });
});
