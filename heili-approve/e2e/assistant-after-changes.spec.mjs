// Heili (the AI review assistant) after «Chiedi modifiche».
//
// The client has already asked for changes (post in CHANGES_REQUESTED) and
// waits for the agency's new version: Heili stays available on that version,
// from the floating button of the portal dock, and its conclusion is added to
// the feedback like a typed comment: no approval, no second change request,
// status unchanged.
//
// The AI provider is mocked: a second server (the same build) starts on
// E2E_HELI_PORT (default 3102) with OPENAI_BASE_URL pointing at a tiny HTTP
// server in this file that answers the Responses API with fixed structured
// outputs, and records the prompts it received. The main test server has no AI
// key (approval-flow checks that there is no chat then).
//
// 1. In review: the dock offers Heili with «Approva».
// 2. A typed comment + «Chiedi modifiche» → CHANGES_REQUESTED.
// 3. After a reload (390 px): Heili is offered again, no «Approva»; a chat turn,
//    the summary and «Aggiungi al feedback» → comments on the same version,
//    one COMMENTED event, still CHANGES_REQUESTED, no second CHANGES_REQUESTED
//    or APPROVED event; the prompts say it is extra feedback.
// 4. «Indica un punto sull'immagine»: the dock closes, a tap on the image adds
//    the point marker to the message and the dock reopens.
// 5. The agency sees the comments; the sent conversation is not offered again.
// 6. Other client's post and an old version are refused by the assistant API.

import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import {
  MOBILE,
  agencyContext,
  connectDb,
  expect,
  expectNoHorizontalScroll,
  postRow,
  root,
  seed,
  test,
  uniq,
  viewportShot,
  waitForStatus,
} from "./helpers.mjs";

const PORT = Number(process.env.E2E_HELI_PORT ?? 3102);
const BASE = `http://localhost:${PORT}`;
const MOBILE_OPTIONS = { ...MOBILE, baseURL: BASE };

const TYPED = "Il colore del bottone è troppo scuro.";
const CHAT = "Vorrei anche un secondo logo, in alto a destra.";
const SUMMARY_ITEM = "Aggiungere un secondo logo in alto a destra";

let db;
let data;
let server;
let serverLog = "";
let ai;
let aiPort;
const aiCalls = [];
const state = {};

test.describe.configure({ mode: "serial" });

/** Fixed structured outputs for the two model calls (chat turn, summary). */
function startMockProvider() {
  return new Promise((resolve) => {
    ai = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let request = {};
        try {
          request = JSON.parse(body);
        } catch {
          // not JSON: answered below as an empty request
        }
        const name = request.text?.format?.name;
        aiCalls.push({ name, instructions: String(request.instructions ?? "") });
        const payload =
          name === "review_summary"
            ? {
                // "approve" on purpose: after «Chiedi modifiche» it must never be offered.
                verdict: "approve",
                summary: "Il cliente aggiunge una richiesta: un secondo logo sull'immagine.",
                actionItems: [
                  {
                    area: "media",
                    mediaIndex: 0,
                    timeSec: null,
                    timeEndSec: null,
                    pinX: 0.8,
                    pinY: 0.15,
                    request: SUMMARY_ITEM,
                    priority: "media",
                    variantId: null,
                    anchorQuote: null,
                  },
                ],
              }
            : { reply: "Capito: un secondo logo in alto a destra. Vuoi aggiungere altro?", readiness: "ready_approve" };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: "resp_e2e",
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            status: "completed",
            model: "gpt-e2e-mock",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: {},
            parallel_tool_calls: false,
            temperature: 1,
            tool_choice: "auto",
            tools: [],
            top_p: 1,
            output: [
              {
                id: "msg_e2e",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [{ type: "output_text", text: JSON.stringify(payload), annotations: [] }],
              },
            ],
          })
        );
      });
    });
    ai.listen(0, "127.0.0.1", () => {
      aiPort = ai.address().port;
      resolve();
    });
  });
}

async function waitForHealth(timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) throw new Error(`Il server di prova si è fermato:\n${serverLog}`);
    if (Date.now() - started > timeoutMs) throw new Error(`Il server di prova non risponde su ${BASE}:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const reviewPath = () => new URL(state.fixture.reviewUrl).pathname;
const postPath = () => `${reviewPath()}/posts/${state.fixture.post.id}`;
const tokenOf = () => reviewPath().split("/").pop();

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  const out = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-assistant-fixture.ts", data.workspaceId, data.userId, uniq()],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  state.fixture = JSON.parse(line.slice("RESULT ".length));

  await startMockProvider();
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    cwd: root,
    env: {
      ...process.env,
      APP_VARIANT: "all",
      METRICOOL_FAKE: "1",
      PORT: String(PORT),
      REVIEW_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-e2e-mock-not-a-real-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`,
      REVIEW_ASSISTANT_ATTEMPT_COOLDOWN_MS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));
  await waitForHealth();
});

test.afterAll(async () => {
  await db?.end();
  ai?.close();
  if (server && server.exitCode === null) {
    // The whole process group: next start may fork.
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-server.pid, "SIGKILL");
        } catch {
          // already gone
        }
        resolve();
      }, 5_000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
});

test("cliente (390px): in revisione Heili c'è; un commento e «Chiedi modifiche»", async ({ browser }) => {
  const context = await browser.newContext(MOBILE_OPTIONS);
  const page = await context.newPage();
  await page.goto(postPath());
  await expect(page.getByText(state.fixture.post.title).first()).toBeVisible();

  // Waiting for the decision: Heili in the floating dock and «Approva», as always.
  await expect(page.getByTestId("heili-dock-button")).toHaveAttribute("aria-label", "Parla con Heili");
  await expect(page.getByRole("button", { name: "Approva", exact: true })).toBeVisible();

  await page.getByPlaceholder(/Per esempio/).fill(TYPED);
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento salvato e visibile all’agenzia")).toBeVisible();
  await page.getByRole("button", { name: "Chiedi modifiche" }).click();
  await expect(page.getByText("Modifiche inviate all'agenzia.", { exact: true })).toBeVisible();

  // K-08: without a reload the page is the CHANGES_REQUESTED one — the comment
  // field and Heili (feedback mode) are right there; «Approva» never returns.
  await expect(page.getByText("Hai già chiesto modifiche: puoi aggiungere altro")).toBeVisible();
  await expect(page.getByRole("button", { name: "Invia commento" })).toBeVisible();
  await expect(page.getByTestId("heili-dock-button")).toHaveAttribute("aria-label", "Parla con Heili");
  await expect(page.getByRole("button", { name: "Approva", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chiedi modifiche" })).toHaveCount(0);

  const row = await waitForStatus(db, state.fixture.post.id, "CHANGES_REQUESTED", 10_000);
  expect(row.currentVersionNumber).toBe(1);
  await context.close();
});

test("cliente (390px): dopo le modifiche Heili resta disponibile e il riepilogo si aggiunge al feedback", async ({ browser }) => {
  const context = await browser.newContext(MOBILE_OPTIONS);
  const page = await context.newPage();
  await page.goto(postPath());
  await expect(page.getByText("Modifiche richieste").first()).toBeVisible();

  // Heili is offered in the floating dock; nothing to approve any more.
  await expect(page.getByText("Hai già chiesto modifiche: puoi aggiungere altro scrivendo, dettando o parlando con Heili.")).toBeVisible();
  const heili = page.getByTestId("heili-dock-button");
  await expect(heili).toBeVisible();
  await expect(page.getByRole("button", { name: "Approva", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chiedi modifiche" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await heili.scrollIntoViewIfNeeded();
  await viewportShot(page, "heili-dopo-modifiche-disponibile-mobile.png");

  await heili.click();
  const panel = page.getByRole("region", { name: "Assistente di revisione" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Hai già chiesto modifiche e l'agenzia sta preparando la nuova versione")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Approva/ })).toHaveCount(0);

  // «Indica un punto sull'immagine»: the sheet closes, the tap on the image
  // becomes a point marker in the message and the sheet reopens.
  await panel.getByRole("button", { name: "Indica un punto sull'immagine" }).click();
  await expect(page.getByTestId("heili-dock")).not.toBeVisible();
  const image = page.locator('[aria-label="Anteprima del post"] img').first();
  await image.scrollIntoViewIfNeeded();
  await image.click({ position: { x: 30, y: 30 } });
  await expect(page.getByTestId("heili-dock")).toBeVisible();
  await expect(panel.getByLabel("Messaggio per l'assistente")).toHaveValue(/\[punto media=0/);

  await panel.getByLabel("Messaggio per l'assistente").fill(CHAT);
  await panel.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(panel.getByText("Capito: un secondo logo in alto a destra.")).toBeVisible();
  // The mock says "ready_approve": the panel must not turn it into an approval.
  await expect(panel.getByRole("button", { name: /Approva/ })).toHaveCount(0);

  await panel.getByRole("button", { name: "Prepara il riepilogo per l'agenzia" }).click();
  await expect(panel.getByText(SUMMARY_ITEM).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "Invia le modifiche all'agenzia" })).toHaveCount(0);
  await panel.getByText("Il cliente aggiunge una richiesta").first().scrollIntoViewIfNeeded();
  await viewportShot(page, "heili-dopo-modifiche-riepilogo-mobile.png");
  await panel.getByRole("button", { name: "Aggiungi al feedback" }).click();
  await expect(page.getByText("Il riepilogo di Heili è stato aggiunto al tuo feedback")).toBeVisible();

  // Same post, same version, same status: only more feedback.
  const row = await postRow(db, state.fixture.post.id);
  expect(row.status).toBe("CHANGES_REQUESTED");
  expect(row.currentVersionNumber).toBe(1);

  const { rows: comments } = await db.query(
    'select body, "authorType", "pinX", "pinY", "mediaIndex" from "PostComment" where "postId" = $1 order by "createdAt"',
    [state.fixture.post.id]
  );
  expect(comments.map((c) => c.authorType)).toEqual(["CLIENT", "CLIENT", "CLIENT"]);
  expect(comments[0].body).toBe(TYPED);
  expect(comments[1].body).toContain("secondo logo");
  expect(comments[2]).toMatchObject({ body: SUMMARY_ITEM, mediaIndex: 0 });
  expect(comments[2].pinX).toBeCloseTo(0.8);

  const { rows: events } = await db.query(
    'select type, metadata from "PostEvent" where "postId" = $1 and type in (\'CHANGES_REQUESTED\', \'APPROVED\', \'COMMENTED\')',
    [state.fixture.post.id]
  );
  expect(events.filter((e) => e.type === "CHANGES_REQUESTED")).toHaveLength(1);
  expect(events.filter((e) => e.type === "APPROVED")).toHaveLength(0);
  // The typed comment and Heili's feedback: one COMMENTED event each.
  const commented = events.filter((e) => e.type === "COMMENTED" && e.metadata.reviewSessionId);
  expect(events.filter((e) => e.type === "COMMENTED")).toHaveLength(2);
  expect(commented).toHaveLength(1);

  const { rows: sessions } = await db.query(
    'select id, status, verdict, "versionNumber" from "ReviewSession" where "postId" = $1',
    [state.fixture.post.id]
  );
  expect(sessions).toHaveLength(1);
  // "approve" from the model is never kept once the changes were requested.
  expect(sessions[0]).toMatchObject({ status: "COMPLETED", verdict: "unclear", versionNumber: 1 });
  expect(commented[0].metadata.reviewSessionId).toBe(sessions[0].id);

  // The prompts told the model it is extra feedback, not a decision.
  expect(aiCalls.map((c) => c.name)).toEqual(["review_turn", "review_summary"]);
  for (const call of aiCalls) {
    expect(call.instructions).toContain("ALREADY asked the agency for changes");
  }
  expect(aiCalls[0].instructions).toContain("Never tell the client they can approve");

  // A reload keeps the page in the same state, and the sent conversation is not offered again.
  await page.reload();
  await page.getByTestId("heili-dock-button").click();
  const reopened = page.getByRole("region", { name: "Assistente di revisione" });
  await expect(reopened.getByText("Dimmi pure cos'altro vorresti aggiungere")).toBeVisible();
  await expect(reopened.getByText("Non ancora inviato")).toHaveCount(0);
  await expect(reopened.getByText(CHAT)).toHaveCount(0);
  await context.close();
});

test("agenzia: vede il feedback aggiunto con Heili sulla stessa versione", async ({ browser }) => {
  const context = await agencyContext(browser, data, { baseUrl: BASE, options: { viewport: { width: 1366, height: 900 }, baseURL: BASE } });
  const page = await context.newPage();
  await page.goto(`/posts/${state.fixture.post.id}?tab=revisione`);
  await expect(page.getByText(TYPED).first()).toBeVisible();
  await expect(page.getByText(SUMMARY_ITEM).first()).toBeVisible();
  await page.goto(`/posts/${state.fixture.post.id}?tab=attivita`);
  await expect(page.getByText("Preparato con Heili").first()).toBeVisible();
  await context.close();
});

test("assistente: un altro cliente e una versione vecchia sono rifiutati, il resto resta chiuso", async ({ browser }) => {
  const context = await browser.newContext(MOBILE_OPTIONS);
  const api = `${BASE}/api/review/${tokenOf()}/assistant`;

  // Allowed: current version of this client's post in CHANGES_REQUESTED.
  const state1 = await context.request.get(`${api}?postId=${state.fixture.post.id}&versionNumber=1`);
  expect(await state1.json()).toMatchObject({ success: true, data: { canChat: true, mode: "feedback" } });

  // Other client's post: not found (nothing leaks).
  const other = await context.request.get(`${api}?postId=${state.fixture.otherPost.id}&versionNumber=1`);
  expect(other.status()).toBe(404);
  const otherSend = await context.request.post(api, {
    data: { postId: state.fixture.otherPost.id, versionNumber: 1, message: "ciao", inputMode: "TEXT" },
  });
  expect(otherSend.status()).toBe(404);

  // Old/other version: closed, and no model call.
  const calls = aiCalls.length;
  const old = await context.request.post(api, {
    data: { postId: state.fixture.post.id, versionNumber: 2, message: "ciao", inputMode: "TEXT" },
  });
  expect(old.status()).toBe(409);
  expect(aiCalls).toHaveLength(calls);
  await context.close();
});
