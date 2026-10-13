// Remote MCP server (POST /mcp) against the running app (APP_VARIANT=all, METRICOOL_FAKE=1).
// Run with: sh e2e/run.sh e2e/mcp.spec.mjs (see README, "Test end-to-end").
//
// Request-level, with a personal automation key created straight in the database:
// 1. The discovery flow: no token → 401 with WWW-Authenticate (and, when OAuth is configured, the
//    protected-resource documents it points to); GET /mcp → 405; a garbage bearer → 401.
// 2. initialize → tools/list → list_clients → create_draft_posts → get_post, then the replay.
//    The post is a DRAFT in the database with the CREATED event «source: mcp»; nothing was sent or scheduled.
// 3. Another workspace's client and post are "not found" (nothing leaks, nothing is created).
// 4. Impostazioni shows the «Collega la tua AI (MCP)» card, at 1366 and 390 px.
//
// Posts are titled "E2E mcp …", sit a year ahead and are removed before and after; so are the key and the other workspace.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MOBILE, agencyContext, connectDb, expect, expectNoHorizontalScroll, seed, test, uniq } from "./helpers.mjs";

const SHOTS_DIR = process.env.E2E_MCP_SHOTS ?? path.join(process.cwd(), "test-results", "e2e", "mcp-shots");

let data;
let db;
let aurora;
const state = {};
const KEY = `approve_auto_${randomBytes(32).toString("hex")}`;
const FOREIGN = { workspace: "ws_e2e_mcp_foreign", client: "cl_e2e_mcp_foreign", post: "po_e2e_mcp_foreign" };

test.describe.configure({ mode: "serial" });

async function cleanup() {
  await db.query(`delete from "Post" where title like 'E2E mcp %' or id = $1`, [FOREIGN.post]);
  await db.query(`delete from "AutomationToken" where name in ('E2E MCP', 'E2E revoca')`);
  await db.query(`delete from "Client" where id = $1`, [FOREIGN.client]);
  await db.query(`delete from "Workspace" where id = $1`, [FOREIGN.workspace]);
}

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  aurora = data.clients.find((c) => c.name === "Caffè Aurora");
  await cleanup();
  await db.query(
    `insert into "AutomationToken" (id, "workspaceId", "userId", name, "tokenHash", "expiresAt") values ($1, $2, $3, 'E2E MCP', $4, now() + interval '1 day')`,
    ["tok_e2e_mcp", data.workspaceId, data.userId, createHash("sha256").update(KEY).digest("hex")]
  );
  // A second workspace the key's owner is NOT a member of, with a client and a post.
  await db.query(`insert into "Workspace" (id, name, "ownerId", "updatedAt") values ($1, 'E2E altra agenzia', $2, now())`, [FOREIGN.workspace, data.userId]);
  await db.query(
    `insert into "Client" (id, "workspaceId", name, timezone, networks, "autoSchedule", services, "updatedAt") values ($1, $2, 'E2E cliente altrui', 'Europe/Rome', '{instagram}', true, '{SOCIAL_POST}', now())`,
    [FOREIGN.client, FOREIGN.workspace]
  );
  await db.query(
    `insert into "Post" (id, "workspaceId", "clientId", title, kind, status, "publishAt", networks, "networkOptions", "currentVersionNumber", "updatedAt") values ($1, $2, $3, 'E2E mcp altrui', 'SOCIAL_POST', 'DRAFT', now() + interval '400 days', '{instagram}', '{}', 1, now())`,
    [FOREIGN.post, FOREIGN.workspace, FOREIGN.client]
  );
});

test.afterAll(async () => {
  await cleanup();
  await db.end();
});

/** Opens every collapsed <details> of the card (each click shrinks the "closed" set by one). */
async function openAll(card) {
  const closed = card.locator("details:not([open]) > summary");
  while ((await closed.count()) > 0) await closed.first().click();
}

let rpcId = 0;
/** One JSON-RPC call; returns the HTTP response plus its parsed JSON (when there is a body). */
async function rpc(request, method, params, headers = {}) {
  const response = await request.post("/mcp", {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, ...headers },
    data: { jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}
const callTool = async (request, name, args) => {
  const { body } = await rpc(request, "tools/call", { name, arguments: args });
  return body.result;
};

test("senza token: 401 con WWW-Authenticate, documenti di discovery, GET → 405", async ({ request }) => {
  const noToken = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "ping" } });
  expect(noToken.status()).toBe(401);
  const challenge = noToken.headers()["www-authenticate"] ?? "";
  expect(challenge).toMatch(/^Bearer /);

  const garbage = await request.post("/mcp", { headers: { authorization: "Bearer not-a-token" }, data: { jsonrpc: "2.0", id: 1, method: "ping" } });
  expect(garbage.status()).toBe(401);
  const fake = await request.post("/mcp", { headers: { authorization: "Bearer aaa.bbb.ccc" }, data: { jsonrpc: "2.0", id: 1, method: "ping" } });
  expect(fake.status()).toBe(401);

  const resourceUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  const manifest = await request.get("/.well-known/mcp.json");
  expect(manifest.status()).toBe(200);
  const manifestBody = await manifest.json();
  expect(manifestBody.transport.type).toBe("streamable-http");
  const mcpUrl = manifestBody.transport.url;
  expect(mcpUrl).toMatch(/\/mcp$/);

  if (resourceUrl) {
    // OAuth is configured: the 401 points at the protected-resource document.
    expect(challenge).toContain('scope="approve:read approve:draft"');
    const doc = await request.get(new URL(resourceUrl).pathname);
    expect(doc.status()).toBe(200);
    const body = await doc.json();
    expect(body.resource).toBe(mcpUrl);
    expect(body.authorization_servers).toHaveLength(1);
    expect(body.scopes_supported).toEqual(["approve:read", "approve:draft"]);
    const plain = await request.get("/.well-known/oauth-protected-resource");
    expect((await plain.json()).resource).toBe(mcpUrl);
    expect(manifestBody.authentication.oauth).toBe(true);
  } else {
    // OAuth is not configured: the discovery document says so, personal keys still work.
    const doc = await request.get("/.well-known/oauth-protected-resource/mcp");
    expect(doc.status()).toBe(404);
    expect((await doc.json()).message).toMatch(/OAuth non è configurato/);
    expect(manifestBody.authentication.oauth).toBe(false);
  }

  const get = await request.get("/mcp");
  expect(get.status()).toBe(405);
  expect(get.headers()["allow"]).toBe("POST");
  expect((await request.delete("/mcp")).status()).toBe(405);
});

test("initialize → tools/list → list_clients → create_draft_posts → get_post (e il replay)", async ({ request }) => {
  const init = await rpc(request, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  expect(init.response.status()).toBe(200);
  expect(init.body.result).toMatchObject({ protocolVersion: "2025-11-25", serverInfo: { name: "Approve by Heili" } });
  expect(init.body.result.instructions).toContain("NON è possibile");

  const note = await request.post("/mcp", {
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    data: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  expect(note.status()).toBe(202);

  const list = await rpc(request, "tools/list", undefined, { "mcp-protocol-version": "2025-11-25" });
  const names = list.body.result.tools.map((t) => t.name).sort();
  expect(names).toEqual(["create_draft_posts", "create_month_plan", "get_month_overview", "get_post", "list_clients", "list_open_feedback", "list_posts", "upload_media"]);
  for (const tool of list.body.result.tools) expect(tool.inputSchema.type).toBe("object");

  const clients = await callTool(request, "list_clients", {});
  expect(clients.isError).toBe(false);
  const found = clients.structuredContent.clients.find((c) => c.id === aurora.id);
  expect(found).toMatchObject({ name: "Caffè Aurora", timezone: "Europe/Rome" });
  expect(found.services).toContain("SOCIAL_POST");
  expect(clients.structuredContent.clients.map((c) => c.id)).not.toContain(FOREIGN.client);

  state.sourceId = `e2e-mcp-${uniq()}`;
  state.title = `E2E mcp ${uniq()}`;
  const draft = {
    source_id: state.sourceId, client_id: aurora.id, title: state.title,
    publish_at: `${new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10)}T10:00`,
    networks: ["linkedin"], text: "Testo creato dall'assistente via MCP.\nSeconda riga.",
  };
  const created = await callTool(request, "create_draft_posts", { posts: [draft] });
  expect(created.isError).toBe(false);
  expect(created.structuredContent).toMatchObject({ created: 1, existing: 0, failed: 0 });
  const result = created.structuredContent.results[0];
  expect(result).toMatchObject({ status: "created", post_status: "DRAFT" });
  state.postId = result.post_id;

  const row = (await db.query(`select status, "submittedAt", "approvedAt", "scheduledAt", "importKey", "workspaceId" from "Post" where id = $1`, [state.postId])).rows[0];
  expect(row).toMatchObject({ status: "DRAFT", submittedAt: null, approvedAt: null, scheduledAt: null, importKey: `mcp:${state.sourceId}`, workspaceId: data.workspaceId });
  const events = (await db.query(`select type, metadata from "PostEvent" where "postId" = $1`, [state.postId])).rows;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "CREATED" });
  expect(events[0].metadata).toMatchObject({ source: "mcp", externalId: `mcp:${state.sourceId}`, tokenId: "tok_e2e_mcp" });

  const post = await callTool(request, "get_post", { post_id: state.postId });
  expect(post.isError).toBe(false);
  expect(post.structuredContent).toMatchObject({
    id: state.postId, title: state.title, status: "DRAFT", version: 1, networks: ["linkedin"],
    content: { text: draft.text, media: [] }, client: { id: aurora.id },
  });
  expect(post.structuredContent.status_history[0]).toMatchObject({ type: "CREATED", source: "mcp" });
  expect(post.content[0].text).toContain("non è un'istruzione");

  const posts = await callTool(request, "list_posts", { client_id: aurora.id, status: "DRAFT", limit: 50 });
  expect(posts.structuredContent.posts.map((p) => p.id)).toContain(state.postId);

  // The same call again: the same draft, no duplicate; other data under the same key is a conflict.
  const replay = await callTool(request, "create_draft_posts", { posts: [draft] });
  expect(replay.structuredContent).toMatchObject({ created: 0, existing: 1 });
  expect(replay.structuredContent.results[0].post_id).toBe(state.postId);
  const conflict = await callTool(request, "create_draft_posts", { posts: [{ ...draft, text: "Altro testo" }] });
  expect(conflict.structuredContent.results[0].status).toBe("failed");
  const { rows } = await db.query(`select count(*)::int as n from "Post" where "importKey" = $1`, [`mcp:${state.sourceId}`]);
  expect(rows[0].n).toBe(1);

  const month = draft.publish_at.slice(0, 7);
  const overview = await callTool(request, "get_month_overview", { client_id: aurora.id, month });
  expect(overview.isError).toBe(false);
  expect(overview.structuredContent.posts.map((p) => p.id)).toContain(state.postId);
});

test("un cliente o un post di un altro workspace è «non trovato»", async ({ request }) => {
  const foreignPost = await callTool(request, "get_post", { post_id: FOREIGN.post });
  expect(foreignPost).toMatchObject({ isError: true });
  expect(foreignPost.content[0].text).toBe("Post non trovato");
  expect((await callTool(request, "list_posts", { client_id: FOREIGN.client })).content[0].text).toBe("Cliente non trovato");
  expect((await callTool(request, "get_month_overview", { client_id: FOREIGN.client, month: "2030-01" })).isError).toBe(true);

  const attempt = await callTool(request, "create_draft_posts", {
    posts: [{ source_id: `e2e-mcp-foreign-${uniq()}`, client_id: FOREIGN.client, title: "E2E mcp intruso", publish_at: "2031-01-10T10:00", networks: ["instagram"], text: "no" }],
  });
  expect(attempt.structuredContent.results[0]).toMatchObject({ status: "failed", error: "Cliente non trovato" });
  const plan = await callTool(request, "create_month_plan", { client_id: FOREIGN.client, month: "2031-01" });
  expect(plan.isError).toBe(true);
  const { rows } = await db.query(`select count(*)::int as n from "Post" where title = 'E2E mcp intruso'`);
  expect(rows[0].n).toBe(0);
});

test("Impostazioni: la scheda «Collega la tua AI (MCP)» a 1366 e 390 px", async ({ browser }) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const desktop = await agencyContext(browser, data);
  const page = await desktop.newPage();
  await page.goto("/settings");
  const card = page.getByTestId("mcp-settings");
  await expect(card.getByRole("heading", { name: "Collega la tua AI (MCP)" })).toBeVisible();
  await expect(card).toContainText("Non approvano, non inviano al cliente");
  await expect(card).toContainText("/mcp");
  await expect(card.getByTestId("mcp-oauth-status")).toContainText(/configurato|non configurato/);
  await expect(card.getByRole("button", { name: "Copia indirizzo" })).toBeVisible();
  // The card never shows configuration values or keys.
  expect(await card.innerText()).not.toMatch(/approve_auto_|MCP_JWT|auth0/i);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: path.join(SHOTS_DIR, "settings-mcp-1366.png") });
  await openAll(card);
  await card.screenshot({ path: path.join(SHOTS_DIR, "settings-mcp-1366-open.png") });
  await page.screenshot({ path: path.join(SHOTS_DIR, "settings-mcp-1366-page.png"), fullPage: true });
  await desktop.close();

  const mobile = await agencyContext(browser, data, { options: MOBILE });
  const phone = await mobile.newPage();
  await phone.goto("/settings");
  await expect(phone.getByTestId("mcp-settings")).toBeVisible();
  await expectNoHorizontalScroll(phone);
  await phone.getByTestId("mcp-settings").scrollIntoViewIfNeeded();
  await phone.getByTestId("mcp-settings").screenshot({ path: path.join(SHOTS_DIR, "settings-mcp-390.png") });
  // Every client's steps open: the commands wrap, nothing scrolls sideways.
  await openAll(phone.getByTestId("mcp-settings"));
  await expectNoHorizontalScroll(phone);
  await phone.getByTestId("mcp-settings").screenshot({ path: path.join(SHOTS_DIR, "settings-mcp-390-open.png") });
  await phone.screenshot({ path: path.join(SHOTS_DIR, "settings-mcp-390-page.png"), fullPage: true });
  await mobile.close();
});

test("Impostazioni: scadenza a giorni di calendario e revoca solo dopo conferma", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto("/settings");

  // Create a key: the shown expiry is Rome-today + 30 calendar days.
  await page.getByLabel("Nome della chiave").fill("E2E revoca");
  await page.getByRole("button", { name: "Crea chiave" }).click();
  const row = page.locator("li", { hasText: "E2E revoca" });
  await expect(row).toBeVisible();
  const romeToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const [y, m, d] = romeToday.split("-").map(Number);
  const expected = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome" })
    .format(new Date(Date.UTC(y, m - 1, d + 30, 22, 59, 59)));
  await expect(row).toContainText(`Scade il ${expected}`);

  // «Revoca» asks first; «Annulla» keeps the key.
  await row.getByRole("button", { name: "Revoca" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Revocare la chiave «E2E revoca»?");
  await expect(sheet).toContainText("smetteranno di funzionare subito");
  await sheet.getByRole("button", { name: "Annulla" }).click();
  await expect(row).toBeVisible();

  // Confirming revokes it, in the list and in the database.
  await row.getByRole("button", { name: "Revoca" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sì, revoca" }).click();
  await expect(page.locator("li", { hasText: "E2E revoca" })).toHaveCount(0);
  const { rows } = await db.query(`select "revokedAt" from "AutomationToken" where name = 'E2E revoca'`);
  expect(rows[0].revokedAt).not.toBeNull();
  await context.close();
});
