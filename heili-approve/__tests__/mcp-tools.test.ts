import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/mcp-fake-db";

const db = vi.hoisted(() => ({ current: null as unknown as ReturnType<typeof createFakeDb> }));
vi.mock("@/lib/db/client", async () => {
  const { createFakeDb } = await import("./helpers/mcp-fake-db");
  db.current = createFakeDb();
  return { prisma: db.current };
});
const plans = vi.hoisted(() => ({
  createPlan: vi.fn(),
  addPostsToPlan: vi.fn(),
  updatePlan: vi.fn(),
  sendPlan: vi.fn(),
  makePlanAvailable: vi.fn(),
}));
vi.mock("@/lib/plans", async (original) => ({ ...(await original<typeof import("@/lib/plans")>()), ...plans }));

import type { McpPrincipal } from "@/lib/mcp/access";
import { getMcpConfig } from "@/lib/mcp/config";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { decodeBase64Strict } from "@/lib/mcp/tools/write";
import { handleJsonRpc } from "@/lib/mcp/protocol";
import { validateForNetworks } from "@/lib/metricool/payload";
import { createImportedDrafts } from "@/lib/post-import/service";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

const uploadDir = mkdtempSync(path.join(tmpdir(), "mcp-uploads-"));
afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

const principal = (overrides: Partial<McpPrincipal> = {}): McpPrincipal => ({
  kind: "automation", userId: "user-1", tokenId: "tok-1", scopes: ["approve:read", "approve:draft"],
  workspaces: [{ id: "ws-1", name: "Agenzia Uno", role: "MEMBER" }], rateKey: "key:tok-1", ...overrides,
});
const both = () => principal({ workspaces: [{ id: "ws-1", name: "Agenzia Uno", role: "MEMBER" }, { id: "ws-2", name: "Agenzia Due", role: "OWNER" }] });

async function run(name: string, args: unknown, p: McpPrincipal = principal()) {
  const { response, audit } = await handleJsonRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    { principal: p, tools: MCP_TOOLS, instructions: "" }
  );
  const result = response?.result as { isError: boolean; content: Array<{ text: string }>; structuredContent?: any } | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { error: response?.error, isError: result?.isError, text: result?.content?.[0]?.text ?? "", data: result?.structuredContent, audit };
}

const FUTURE = "2030-10-12T10:00:00+02:00";
const client1 = { id: "c1", workspaceId: "ws-1", name: "Aurora", services: ["SOCIAL_POST"], networks: ["instagram", "facebook", "bluesky"], timezone: "Europe/Rome", archivedAt: null, autoSchedule: true };
const client2 = { id: "c2", workspaceId: "ws-2", name: "Altro Cliente", services: ["SOCIAL_POST"], networks: ["instagram"], timezone: "Europe/Rome", archivedAt: null, autoSchedule: true };
const archived = { ...client1, id: "c1-old", name: "Vecchio", archivedAt: new Date("2026-01-01") };

function postRow(id: string, workspaceId: string, client: typeof client1, extra: Record<string, unknown> = {}) {
  return {
    id, workspaceId, clientId: client.id, client: { id: client.id, name: client.name, timezone: client.timezone },
    title: `Titolo ${id}`, kind: "SOCIAL_POST", status: "DRAFT", publishAt: new Date("2030-10-12T08:00:00Z"),
    networks: ["instagram"], networkOptions: {}, currentVersionNumber: 1, planId: null, lastError: null, plan: null,
    versions: [{ id: `${id}-v1`, number: 1, text: `Testo ${id}`, firstCommentText: null, media: [{ url: "https://x/y.jpg", type: "image", mimeType: "image/jpeg", assetId: "a1" }], videoCoverMs: null, content: {}, changeNote: null, createdAt: new Date("2030-01-01") }],
    comments: [], events: [], reviewSessions: [], createdAt: new Date(),
    ...extra,
  };
}
const comment = (id: string, extra: Record<string, unknown> = {}) => ({
  id, authorType: "CLIENT", versionId: null, body: `Commento ${id}`, mediaIndex: null, pinX: null, pinY: null, timeSec: null, timeEndSec: null,
  anchor: null, variantId: null, resolvedAt: null, createdAt: new Date("2030-02-01"), reviewer: { name: "Maria" }, user: null, ...extra,
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("PUBLIC_BASE_URL", "https://approve.example.com");
  vi.stubEnv("APP_VARIANT", "all");
  vi.stubEnv("UPLOAD_DIR", uploadDir);
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const fn of Object.values(plans)) fn.mockReset();
  const d = db.current;
  d.client.reset([client1, client2, archived]);
  d.post.reset([
    postRow("p1", "ws-1", client1, { comments: [comment("k1"), comment("k2", { resolvedAt: new Date() }), comment("k3", { timeSec: 7, timeEndSec: 9, mediaIndex: 0, versionId: "p1-v1" })] }),
    postRow("p2", "ws-2", client2, { comments: [comment("secret")] }),
  ]);
  d.postEvent.reset();
  d.mediaAsset.reset([
    { id: "asset-1", workspaceId: "ws-1", storageKey: "ws-1/abc.jpg", fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 100, width: 1080, height: 1080 },
    { id: "asset-2", workspaceId: "ws-2", storageKey: "ws-2/def.jpg", fileName: "b.jpg", mimeType: "image/jpeg", sizeBytes: 100, width: 1080, height: 1080 },
  ]);
  d.automationUploadReservation.reset();
});

// ─── workspace isolation ─────────────────────────────────────────────────────

describe("workspace and client isolation", () => {
  it("list_clients returns only the caller's workspaces", async () => {
    const own = await run("list_clients", {});
    expect(own.data.clients.map((c: { id: string }) => c.id)).toEqual(["c1"]);
    const wide = await run("list_clients", { include_archived: true });
    expect(wide.data.clients.map((c: { id: string }) => c.id)).toEqual(["c1", "c1-old"]);
    expect((await run("list_clients", {}, both())).data.clients.map((c: { id: string }) => c.id)).toEqual(["c2", "c1"]);
    expect(own.data.clients[0]).toMatchObject({ name: "Aurora", services: ["SOCIAL_POST"], timezone: "Europe/Rome", workspace_name: "Agenzia Uno" });
  });

  it("list_posts never returns another workspace's posts, and its client is 'not found'", async () => {
    const own = await run("list_posts", {});
    expect(own.data.posts.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(own.data.posts[0]).toMatchObject({ title: "Titolo p1", status: "DRAFT", version: 1, open_comment_count: 2, url: "https://approve.example.com/posts/p1" });
    const foreign = await run("list_posts", { client_id: "c2" });
    expect(foreign).toMatchObject({ isError: true, text: "Cliente non trovato" });
    expect(foreign.audit).toMatchObject({ outcome: "error" });
    expect((await run("list_posts", {}, both())).data.posts).toHaveLength(2);
  });

  it("get_post of another workspace is 'not found', same as a missing id", async () => {
    expect(await run("get_post", { post_id: "p2" })).toMatchObject({ isError: true, text: "Post non trovato" });
    expect(await run("get_post", { post_id: "nope" })).toMatchObject({ isError: true, text: "Post non trovato" });
    const ok = await run("get_post", { post_id: "p2" }, both());
    expect(ok.isError).toBe(false);
  });

  it("get_month_overview and list_open_feedback refuse a foreign client", async () => {
    expect(await run("get_month_overview", { client_id: "c2", month: "2030-10" })).toMatchObject({ isError: true, text: "Cliente non trovato" });
    expect(await run("list_open_feedback", { client_id: "c2" })).toMatchObject({ isError: true, text: "Cliente non trovato" });
    const all = await run("list_open_feedback", {});
    expect(JSON.stringify(all.data)).not.toContain("secret");
    expect(all.data.posts.map((p: { post_id: string }) => p.post_id)).toEqual(["p1"]);
  });

  it("write tools refuse a foreign client and create nothing", async () => {
    const drafts = await run("create_draft_posts", { posts: [{ source_id: "x1", client_id: "c2", title: "T", publish_at: FUTURE, networks: ["instagram"], text: "t" }] });
    expect(drafts.data.results[0]).toMatchObject({ status: "failed", error: "Cliente non trovato" });
    expect(db.current.post.created).toHaveLength(0);
    expect(await run("create_month_plan", { client_id: "c2", month: "2030-10" })).toMatchObject({ isError: true, text: "Cliente non trovato" });
    expect(plans.createPlan).not.toHaveBeenCalled();
    expect(await run("upload_media", { file_name: "a.png", data_base64: PNG_B64, client_id: "c2" })).toMatchObject({ isError: true, text: "Cliente non trovato" });
  });

  it("an archived client cannot receive drafts, plans or uploads", async () => {
    const drafts = await run("create_draft_posts", { posts: [{ source_id: "x2", client_id: "c1-old", title: "T", publish_at: FUTURE, networks: ["instagram"], text: "t" }] });
    expect(drafts.data.results[0].status).toBe("failed");
    expect((await run("create_month_plan", { client_id: "c1-old", month: "2030-10" })).isError).toBe(true);
  });

  it("a draft cannot use another workspace's media", async () => {
    const result = await run("create_draft_posts", {
      posts: [{ source_id: "x3", client_id: "c1", title: "T", publish_at: FUTURE, networks: ["instagram"], text: "t", media: [{ asset_id: "asset-2" }] }],
    });
    expect(result.data.results[0]).toMatchObject({ status: "failed" });
    expect(result.data.results[0].error).toMatch(/media non è stato trovato/);
    expect(db.current.post.created).toHaveLength(0);
  });
});

// ─── read tools ──────────────────────────────────────────────────────────────

describe("read tools", () => {
  it("list_posts filters by month in the client's time zone, by status, and paginates", async () => {
    db.current.post.reset([
      postRow("a", "ws-1", client1, { publishAt: new Date("2030-10-31T22:30:00Z") }), // 23:30 Rome → October
      postRow("b", "ws-1", client1, { publishAt: new Date("2030-10-31T23:30:00Z") }), // 00:30 Rome → November
      postRow("c", "ws-1", client1, { publishAt: new Date("2030-10-05T08:00:00Z"), status: "APPROVED" }),
      postRow("d", "ws-1", client1, { publishAt: new Date("2030-10-06T08:00:00Z"), status: "CANCELLED" }),
    ]);
    const october = await run("list_posts", { client_id: "c1", month: "2030-10" });
    expect(october.data.posts.map((p: { id: string }) => p.id)).toEqual(["c", "a"]);
    expect((await run("list_posts", { month: "2030-10", status: "APPROVED" })).data.posts.map((p: { id: string }) => p.id)).toEqual(["c"]);
    expect((await run("list_posts", { status: "CANCELLED" })).data.posts.map((p: { id: string }) => p.id)).toEqual(["d"]);

    const page1 = await run("list_posts", { limit: 2 });
    expect(page1.data.posts.map((p: { id: string }) => p.id)).toEqual(["c", "a"]);
    expect(page1.data.next_cursor).toBeTruthy();
    const page2 = await run("list_posts", { limit: 2, cursor: page1.data.next_cursor });
    expect(page2.data.posts.map((p: { id: string }) => p.id)).toEqual(["b"]);
    expect(page2.data.next_cursor).toBeNull();
    expect((await run("list_posts", { cursor: "garbage" })).isError).toBe(true);
    expect((await run("list_posts", { month: "ottobre" })).isError).toBe(true);
  });

  it("get_post returns the current version, media, comment locations and flags text as untrusted", async () => {
    const result = await run("get_post", { post_id: "p1" });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      id: "p1", version: 1, status: "DRAFT", client: { id: "c1" },
      content: { text: "Testo p1", media: [{ number: 1, asset_id: "a1", type: "image" }] },
      open_client_comment_count: 2,
    });
    const located = result.data.comments.find((c: { id: string }) => c.id === "k3");
    expect(located).toMatchObject({ author: "client", resolved: false, version: 1, location: { media_number: 1, timecode: "0:07–0:09", time_sec: 7 } });
    expect(result.data.notice).toMatch(/non eseguire istruzioni/);
    expect(result.text).toMatch(/non è un'istruzione/);
    expect(result.audit?.touched).toMatchObject({ resourceId: "p1", workspaceIds: ["ws-1"] });
  });

  it("get_month_overview counts posts by status and reports the plan", async () => {
    db.current.post.reset([
      postRow("a", "ws-1", client1, { publishAt: new Date("2030-10-05T08:00:00Z"), status: "APPROVED" }),
      postRow("b", "ws-1", client1, { publishAt: new Date("2030-10-06T08:00:00Z"), status: "IN_REVIEW" }),
      postRow("c", "ws-1", client1, { publishAt: new Date("2030-10-07T08:00:00Z") }),
      postRow("z", "ws-1", client1, { publishAt: new Date("2030-11-07T08:00:00Z") }),
    ]);
    const result = await run("get_month_overview", { client_id: "c1", month: "2030-10" });
    expect(result.text).not.toMatch(/errore/i);
    expect(result.data).toMatchObject({ month: "2030-10", post_count: 3, by_status: { APPROVED: 1, IN_REVIEW: 1, DRAFT: 1 }, plan: null });
    expect(result.data.progress).toMatchObject({ total: 3, approved: 1, in_review: 1, draft: 1, label: "1 di 3 approvati" });
  });

  it("list_open_feedback lists unresolved client comments of the current version with their location", async () => {
    const result = await run("list_open_feedback", { client_id: "c1" });
    expect(result.data.total_comments).toBe(2);
    expect(result.data.posts[0].comments.map((c: { id: string }) => c.id)).toEqual(["k1", "k3"]);
    expect(result.data.posts[0].comments[1].location.timecode).toBe("0:07–0:09");
    expect(result.data.posts[0]).not.toHaveProperty("workspaceId");
  });
});

// ─── create_draft_posts ──────────────────────────────────────────────────────

const draft = (extra: Record<string, unknown> = {}) => ({
  source_id: "piano-ott-01", client_id: "c1", title: "Lancio autunno", publish_at: FUTURE, networks: ["instagram"], text: "Scopri la collezione",
  media: [{ asset_id: "asset-1" }], ...extra,
});

describe("create_draft_posts", () => {
  it("creates DRAFT posts only, records the CREATED event with source mcp, and never sets a status", async () => {
    const result = await run("create_draft_posts", { posts: [draft()] });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({ created: 1, existing: 0, failed: 0 });
    const created = db.current.post.created[0];
    expect(created).toMatchObject({ workspaceId: "ws-1", clientId: "c1", importKey: "mcp:piano-ott-01", currentVersionNumber: 1 });
    expect(created).not.toHaveProperty("status"); // the schema default is DRAFT
    expect(db.current.post.rows.find((p) => p.id === created.id)?.status).toBe("DRAFT");
    expect(created.publishAt).toEqual(new Date("2030-10-12T08:00:00Z"));
    const event = db.current.postEvent.created[0];
    expect(event).toMatchObject({ type: "CREATED", userId: "user-1", metadata: { source: "mcp", externalId: "mcp:piano-ott-01", tokenId: "tok-1" } });
    expect(result.audit?.touched.created?.postIds).toEqual([created.id]);
    expect(result.data.results[0]).toMatchObject({ status: "created", post_status: "DRAFT", url: expect.stringContaining("/posts/") });
  });

  it("an OAuth caller leaves the AI app in the event (via) and no tokenId", async () => {
    await run("create_draft_posts", { posts: [draft()] }, principal({ kind: "oauth", tokenId: undefined, oauthClientId: "claude-app" }));
    expect(db.current.postEvent.created[0].metadata).toMatchObject({ source: "mcp", via: "claude-app" });
    expect(db.current.postEvent.created[0].metadata).not.toHaveProperty("tokenId");
  });

  it("is idempotent: same source_id + same data replays, other data is a conflict", async () => {
    await run("create_draft_posts", { posts: [draft()] });
    const again = await run("create_draft_posts", { posts: [draft()] });
    expect(again.data).toMatchObject({ created: 0, existing: 1, failed: 0 });
    expect(db.current.post.created).toHaveLength(1);
    const conflict = await run("create_draft_posts", { posts: [draft({ text: "Un altro testo" })] });
    expect(conflict.data.results[0]).toMatchObject({ status: "failed" });
    expect(conflict.data.results[0].error).toMatch(/dati diversi/);
    expect(conflict.isError).toBe(true);
    expect(db.current.post.created).toHaveLength(1);
  });

  it("reads a date without offset in the client's time zone", async () => {
    await run("create_draft_posts", { posts: [draft({ publish_at: "2030-07-12T10:00" })] });
    expect(db.current.post.created[0].publishAt).toEqual(new Date("2030-07-12T08:00:00Z"));
    const bad = await run("create_draft_posts", { posts: [draft({ source_id: "b", publish_at: "domani alle 10" })] });
    expect(bad.data.results[0].error).toMatch(/publish_at non valido/);
  });

  it("validate_only checks without writing anything", async () => {
    const ok = await run("create_draft_posts", { posts: [draft()], validate_only: true });
    expect(ok.data).toMatchObject({ validate_only: true, valid: 1, created: 0 });
    expect(db.current.post.created).toHaveLength(0);
    const bad = await run("create_draft_posts", { posts: [draft({ publish_at: "2020-01-01T10:00:00Z" })], validate_only: true });
    expect(bad.data.failed).toBe(1);
  });

  it("refuses unknown fields: no status, kind or client-side overrides can be smuggled in", async () => {
    for (const extra of [{ status: "APPROVED" }, { kind: "BLOG_ARTICLE" }, { url: "https://evil.example/x.jpg" }]) {
      const result = await run("create_draft_posts", { posts: [draft(extra)] });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/Argomenti non validi/);
    }
    expect((await run("create_draft_posts", { posts: [draft()], status: "APPROVED" })).isError).toBe(true);
    expect(db.current.post.created).toHaveLength(0);
  });

  it("caps a batch at 20 posts", async () => {
    const posts = Array.from({ length: 21 }, (_, i) => draft({ source_id: `s${i}` }));
    expect((await run("create_draft_posts", { posts })).isError).toBe(true);
    expect((await run("create_draft_posts", { posts: [] })).isError).toBe(true);
  });

  it("applies the daily draft limit and stops the rest of the batch", async () => {
    vi.stubEnv("AUTOMATION_DAILY_DRAFT_LIMIT", "1");
    const result = await run("create_draft_posts", { posts: [draft({ source_id: "l1" }), draft({ source_id: "l2" }), draft({ source_id: "l3" })] });
    expect(result.data).toMatchObject({ created: 1, failed: 2 });
    expect(result.data.results[1].error).toMatch(/Limite giornaliero/);
    expect(result.data.results[2].error).toMatch(/Limite giornaliero/);
  });

  it("refuses networks the client does not have", async () => {
    const result = await run("create_draft_posts", { posts: [draft({ networks: ["tiktok"] })] });
    expect(result.data.results[0].error).toMatch(/Reti non abilitate/);
  });

  it("validation parity with the panel import: same publishing rules, same messages", async () => {
    // Instagram needs a picture; Bluesky is capped at 300 characters.
    const cases = [
      { networks: ["instagram"], text: "Senza immagine", media: [] as Array<{ asset_id: string }> },
      { networks: ["bluesky"], text: "x".repeat(301), media: [] as Array<{ asset_id: string }> },
    ];
    for (const [index, c] of cases.entries()) {
      const rules = validateForNetworks({ networks: c.networks, text: c.text, media: [], publishAt: new Date(FUTURE), timezone: "Europe/Rome", networkOptions: {} });
      expect(rules.length).toBeGreaterThan(0);
      const mcp = await run("create_draft_posts", { posts: [draft({ source_id: `par-${index}`, networks: c.networks, text: c.text, media: c.media })] });
      expect(mcp.data.results[0].status).toBe("failed");
      for (const issue of rules) expect(mcp.data.results[0].error).toContain(issue.message);

      // The panel's server path (createImportedDrafts) refuses the same row for the same reason.
      const panel = await createImportedDrafts(
        { workspaceId: "ws-1", userId: "user-1" },
        {
          clientId: "c1",
          rows: [{ sourceRow: 2, date: "12/10/2030", time: "10:00", networks: c.networks[0], text: c.text, firstComment: "", title: "T", images: "" }],
          files: [], uploaded: {}, plan: false,
        }
      );
      expect(panel.outcomes[0].status).toBe("failed");
      for (const issue of rules) expect((panel.outcomes[0] as { error: string }).error).toContain(issue.message);
    }
    expect(db.current.post.created).toHaveLength(0);
  });
});

// ─── upload_media ────────────────────────────────────────────────────────────

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("upload_media", () => {
  it("stores the file through the shared upload code and returns an asset id", async () => {
    const result = await run("upload_media", { file_name: "foto.png", data_base64: PNG_B64, alt: "Una foto" });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({ mime_type: "image/png", type: "image", width: 1, height: 1 });
    expect(db.current.mediaAsset.rows.some((a) => a.id === result.data.asset_id && a.workspaceId === "ws-1")).toBe(true);
    expect(result.audit?.touched.created?.mediaIds).toEqual([result.data.asset_id]);
    // The capacity reservation is released.
    expect(db.current.automationUploadReservation.rows).toHaveLength(0);
  });

  it("decides the type from the bytes, not from the name; refuses what is not an image or video", async () => {
    const disguised = await run("upload_media", { file_name: "film.mp4", data_base64: PNG_B64 });
    expect(disguised.data.mime_type).toBe("image/png");
    const text = Buffer.from("questo non è un'immagine, è solo del testo lungo abbastanza").toString("base64");
    const refused = await run("upload_media", { file_name: "foto.png", data_base64: text });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/Formato non supportato/);
  });

  it("enforces the size limit (and never above the 300 MB of the other upload paths)", async () => {
    vi.stubEnv("MCP_MAX_UPLOAD_BYTES", "50");
    const big = Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.alloc(200)]).toString("base64");
    const result = await run("upload_media", { file_name: "grande.png", data_base64: big });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/supera il limite/);
    expect(getMcpConfig({ MCP_MAX_UPLOAD_BYTES: String(10 * 1024 ** 3) } as unknown as NodeJS.ProcessEnv).maxUploadBytes).toBe(MAX_UPLOAD_BYTES);
    expect(getMcpConfig({} as NodeJS.ProcessEnv).maxUploadBytes).toBe(20 * 1024 * 1024);
  });

  it("decodeBase64Strict refuses data: URLs, non-base64 and oversize input", () => {
    expect(() => decodeBase64Strict(`data:image/png;base64,${PNG_B64}`, 1000)).toThrow(/senza il prefisso/);
    expect(() => decodeBase64Strict("questo non è base64!!", 1000)).toThrow(/base64 valido/);
    expect(() => decodeBase64Strict("A".repeat(5000), 100)).toThrow(/supera il limite/);
    expect(decodeBase64Strict(PNG_B64, 1000).length).toBeGreaterThan(10);
  });

  it("does not accept URLs: there is no field to fetch from", async () => {
    const result = await run("upload_media", { file_name: "a.png", url: "http://169.254.169.254/latest/meta-data", data_base64: PNG_B64 });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Argomenti non validi/);
  });

  it("with several workspaces it asks which one", async () => {
    const result = await run("upload_media", { file_name: "a.png", data_base64: PNG_B64 }, both());
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("client_id") });
  });

  it("refuses when the storage quota is exhausted (same reservation as the automation API)", async () => {
    vi.stubEnv("AUTOMATION_STORAGE_LIMIT_BYTES", String(MAX_UPLOAD_BYTES));
    db.current.mediaAsset.reset([{ id: "big", workspaceId: "ws-1", sizeBytes: MAX_UPLOAD_BYTES }]);
    const result = await run("upload_media", { file_name: "a.png", data_base64: PNG_B64 });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Spazio disponibile/);
  });
});

// ─── create_month_plan ───────────────────────────────────────────────────────

describe("create_month_plan", () => {
  const plan = { id: "plan-1", title: "Piano social ottobre 2030", status: "DRAFT", sentAt: null, intro: null };

  it("opens the plan in the client's workspace and does not send it", async () => {
    plans.createPlan.mockResolvedValue({ plan, created: true });
    plans.updatePlan.mockResolvedValue(plan);
    db.current.post.reset([postRow("p1", "ws-1", client1, { planId: "plan-1" })]);
    const result = await run("create_month_plan", { client_id: "c1", month: "2030-10", intro: "Ciao" });
    expect(result.isError).toBe(false);
    expect(plans.createPlan).toHaveBeenCalledWith("ws-1", { clientId: "c1", month: "2030-10" }, { kind: "user", userId: "user-1" });
    expect(plans.updatePlan).toHaveBeenCalledWith("plan-1", "ws-1", { intro: "Ciao" });
    expect(plans.sendPlan).not.toHaveBeenCalled();
    expect(plans.makePlanAvailable).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ created: true, plan: { id: "plan-1", sent_to_client: false, post_count: 1 } });
    expect(result.text).toMatch(/Non è stato inviato al cliente/);
    expect(result.audit?.touched.created?.planIds).toEqual(["plan-1"]);
  });

  it("returns the existing plan, keeps the agency's intro, and can add more drafts", async () => {
    plans.createPlan.mockResolvedValue({ plan: { ...plan, intro: "Scritta dall'agenzia" }, created: false });
    plans.addPostsToPlan.mockResolvedValue(2);
    const result = await run("create_month_plan", { client_id: "c1", month: "2030-10", intro: "Nuova", post_ids: ["p1", "p3"] });
    expect(plans.updatePlan).not.toHaveBeenCalled();
    expect(plans.addPostsToPlan).toHaveBeenCalledWith("plan-1", "ws-1", ["p1", "p3"]);
    expect(result.data).toMatchObject({ created: false, posts_added: 2 });
  });

  it("validates the month", async () => {
    expect((await run("create_month_plan", { client_id: "c1", month: "2030-13" })).isError).toBe(true);
  });
});

// ─── nothing beyond drafts ───────────────────────────────────────────────────

describe("no tool changes a post's status", () => {
  it("running every tool never updates a post row or writes a non-CREATED event", async () => {
    plans.createPlan.mockResolvedValue({ plan: { id: "plan-1", title: "P", status: "DRAFT", sentAt: null, intro: null }, created: true });
    const before = JSON.stringify(db.current.post.rows.map((p) => [p.id, p.status]));
    await run("list_clients", {});
    await run("list_posts", {});
    await run("get_post", { post_id: "p1" });
    await run("get_month_overview", { client_id: "c1", month: "2030-10" });
    await run("list_open_feedback", {});
    await run("create_draft_posts", { posts: [draft()] });
    await run("upload_media", { file_name: "a.png", data_base64: PNG_B64 });
    await run("create_month_plan", { client_id: "c1", month: "2030-10" });
    const existing = JSON.stringify(db.current.post.rows.filter((p) => p.id === "p1" || p.id === "p2").map((p) => [p.id, p.status]));
    expect(existing).toBe(before);
    expect(db.current.post.updateMany).not.toHaveBeenCalled();
    expect(db.current.post.rows.filter((p) => !["p1", "p2"].includes(p.id)).every((p) => p.status === "DRAFT")).toBe(true);
    expect(db.current.postEvent.created.every((e) => e.type === "CREATED")).toBe(true);
  });
});
