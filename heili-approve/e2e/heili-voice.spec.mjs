// «Parla a voce» (GPT-Live) in the client portal: a tap always answers.
//
// The OpenAI API is replaced by a fake server in this file (OPENAI_BASE_URL):
// - POST /v1/responses: the chat, with a fixed reply;
// - POST /v1/live/sessions: the GPT-Live session. It records the browser's SDP
//   offer and answers with a REAL WebRTC answer made by a second page of the
//   same browser (the "answerer"), so the portal's call actually connects;
// - WebSocket /v1/live/sessions/<id>/attach: the server's control channel
//   («sideband»): session.update → session.updated, session.close →
//   session.closed.
// Chromium runs with a fake microphone (--use-fake-device-for-media-stream).
// The media analysis is on (MEDIA_ANALYSIS_ENABLED) without a media worker:
// the spec marks the analyses READY in the database itself, one at a time.
//
// 1. 390 px: tap → microphone first, then «Preparo le immagini: 0 di 2 / 1 di 2»,
//    SDP sent to the provider, «In ascolto», Heili's subtitles, «Termina».
// 2. A tap that cannot start (draft in the field) says why within 300 ms.
// 3. Microphone denied: said at once, before any preparation request.
// 4. The provider refuses the session: the client reads why, the microphone is off.
// 5. The server state says voice cannot work here: explained, or no box at all.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { MOBILE, connectDb, expect, require, root, seed, test, uniq } from "./helpers.mjs";
import { HELI_BASE, startHeiliServer } from "./support/heili-server.mjs";

const { WebSocketServer } = require("ws");

test.use({
  launchOptions: {
    // Raw host candidates instead of mDNS names: the two pages connect inside the container.
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns"],
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  },
});
test.describe.configure({ mode: "serial" });

const ANALYSIS_REVISION = /ANALYSIS_REVISION = "([^"]+)"/.exec(
  readFileSync(path.join(root, "lib", "media-analysis", "spec.ts"), "utf8")
)[1];
const GREETING = "Ciao, guardiamo questo post insieme. Dimmi cosa vorresti cambiare.";

let db;
let data;
let heili;
let provider;
const state = {};
const live = { requests: [], sideband: [], refuse: false, answer: null };

const reviewPath = () => new URL(state.fixture.reviewUrl).pathname;
const postUrl = (id) => `${HELI_BASE}${reviewPath()}/posts/${id}`;

/** The fake OpenAI API: chat, GPT-Live session creation and the sideband WebSocket. */
function startFakeOpenAI() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        const json = (status, payload) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(payload));
        };
        let request = {};
        try {
          request = JSON.parse(body || "{}");
        } catch {
          // not JSON
        }
        const url = new URL(req.url, "http://fake");
        if (req.method === "POST" && url.pathname === "/v1/live/sessions") {
          live.requests.push(request);
          if (live.refuse) return json(403, { error: { message: "model not available", type: "invalid_request_error", code: "model_not_found" } });
          const id = `sess_e2e_${uniq()}_${live.requests.length}`; // unique in the database across runs
          const sdp = await live.answer(request.transport?.sdp ?? "");
          return json(200, { session: { id, object: "live.session", model: request.session?.model }, transport: { type: "webrtc", sdp } });
        }
        if (req.method === "POST" && /^\/v1\/live\/sessions\/[^/]+\/hangup$/.test(url.pathname)) return json(200, {});
        // The chat (Responses API): one fixed reply.
        return json(200, {
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
              content: [{ type: "output_text", text: JSON.stringify({ reply: "Capito.", readiness: "exploring" }), annotations: [] }],
            },
          ],
        });
      });
    });
    // The SDK attaches at /v1/live/sessions/<id>/attach.
    const sideband = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      if (!/^\/v1\/live\/sessions\/[^/]+\/attach/.test(new URL(req.url, "http://fake").pathname)) return socket.destroy();
      sideband.handleUpgrade(req, socket, head, (ws) => sideband.emit("connection", ws, req));
    });
    sideband.on("connection", (socket, req) => {
      const sessionId = new URL(req.url, "http://fake").pathname.split("/")[4];
      socket.on("message", (raw) => {
        let event = {};
        try {
          event = JSON.parse(String(raw));
        } catch {
          return;
        }
        live.sideband.push({ sessionId, type: event.type });
        if (event.type === "session.update") {
          socket.send(
            JSON.stringify({
              type: "session.updated",
              event_id: `evt_upd_${Date.now()}`,
              session: { id: sessionId, expires_at: Math.floor(Date.now() / 1000) + 600 },
            })
          );
        }
        if (event.type === "session.close") {
          socket.send(
            JSON.stringify({
              type: "session.closed",
              event_id: `evt_closed_${Date.now()}`,
              reason: "client_closed",
              usage: { seconds: 3 },
            })
          );
          setTimeout(() => socket.close(), 50);
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, sideband, port: server.address().port }));
  });
}

/** Asset ids of the version's media (assetId, or the MediaAsset of its /media/ URL). */
async function assetIdsOf(postId) {
  const { rows } = await db.query('select media from "PostVersion" where "postId" = $1 order by number desc limit 1', [postId]);
  const ids = [];
  for (const item of rows[0].media) {
    if (item.assetId) ids.push(item.assetId);
    else {
      const key = decodeURIComponent(new URL(item.url, "http://x").pathname.replace(/^\/media\//, ""));
      const found = await db.query('select id from "MediaAsset" where "storageKey" = $1', [key]);
      ids.push(found.rows[0].id);
    }
  }
  return ids;
}

async function markAnalysisReady(assetId) {
  const result = {
    revision: ANALYSIS_REVISION,
    summary: "Un cerchio rosso su fondo bianco.",
    scenes: [],
    speech: [],
    audioStatus: "not-applicable",
    durationSec: null,
    uncertainties: [],
  };
  await db.query(
    `insert into "MediaAnalysis" ("assetId", revision, status, result, "completedAt", "updatedAt")
     values ($1, $2, 'READY', $3, now(), now())
     on conflict ("assetId") do update set revision = $2, status = 'READY', result = $3, "completedAt" = now(), "updatedAt" = now()`,
    [assetId, ANALYSIS_REVISION, JSON.stringify(result)]
  );
}

/** Records, in the page, the order of microphone requests and voice API calls. */
async function traceVoice(page) {
  await page.addInitScript(() => {
    window.__voiceLog = [];
    const media = navigator.mediaDevices;
    if (media?.getUserMedia) {
      const original = media.getUserMedia.bind(media);
      window.__voiceStreams = [];
      media.getUserMedia = async (constraints) => {
        window.__voiceLog.push("microphone");
        const stream = await original(constraints);
        window.__voiceStreams.push(stream);
        return stream;
      };
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/assistant/voice/prepare")) window.__voiceLog.push("prepare");
      else if (url.includes("/assistant/voice")) window.__voiceLog.push(`voice ${init?.method ?? "GET"}`);
      return originalFetch(input, init);
    };
  });
}

/** True while a microphone track the page obtained is still running. */
function microphoneLive(page) {
  return page.evaluate(() => window.__voiceStreams.some((stream) => stream.getTracks().some((track) => track.readyState === "live")));
}

async function openVoice(page, postId) {
  await page.goto(postUrl(postId));
  await page.getByTestId("heili-dock-button").click();
  const dock = page.getByTestId("heili-dock");
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("voice-box")).toBeVisible();
  return dock;
}

test.beforeAll(async ({ browser }) => {
  data = seed();
  db = await connectDb();
  const out = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-portal-fixture.ts", data.workspaceId, data.userId, uniq()],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  state.fixture = JSON.parse(out.split("\n").find((l) => l.startsWith("RESULT ")).slice("RESULT ".length));

  // The answerer: a page of the same browser that plays GPT-Live's side of WebRTC.
  state.answererContext = await browser.newContext();
  state.answerer = await state.answererContext.newPage();
  live.answer = async (offer) => {
    // A secure origin (localhost) for its own fake microphone: raw host candidates, a remote track.
    if (!state.answerer.url().startsWith(HELI_BASE)) await state.answerer.goto(`${HELI_BASE}/api/health`);
    return state.answerer.evaluate(async (sdp) => {
      const pc = new RTCPeerConnection();
      window.__pc = pc;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.ondatachannel = (event) => (window.__dc = event.channel);
      await pc.setRemoteDescription({ type: "offer", sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      // Like the portal: gathering may never "complete" here; host candidates come at once.
      await new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && resolve());
        setTimeout(resolve, 1_000);
      });
      return pc.localDescription.sdp;
    }, offer);
  };

  provider = await startFakeOpenAI();
  heili = await startHeiliServer({
    providerPort: provider.port,
    env: {
      MEDIA_ANALYSIS_ENABLED: "true",
      REVIEW_ASSISTANT_VOICE_START_COOLDOWN_MS: "1",
      REVIEW_ASSISTANT_VOICE_ENABLED: "true",
    },
  });
});

test.afterAll(async () => {
  await db?.query('update "Client" set "archivedAt" = now() where id = $1', [state.fixture?.clientId]).catch(() => {});
  await db?.end();
  await heili?.stop();
  await state.answererContext?.close();
  provider?.sideband.close();
  provider?.server.close();
});

test("390 px: il tocco chiede subito il microfono, mostra l'avanzamento e la chiamata parte", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  const page = await context.newPage();
  await traceVoice(page);
  const dock = await openVoice(page, state.fixture.carouselId);
  const assets = await assetIdsOf(state.fixture.carouselId);
  expect(assets).toHaveLength(2);

  // The tap answers within 300 ms with a state, never with nothing.
  await dock.getByTestId("voice-start").click();
  await expect(dock.getByTestId("live-status")).toBeVisible({ timeout: 300 });
  // Media analysis pending (no media worker here): the count, not a bare wait.
  await expect(dock.getByTestId("live-status")).toHaveText("Preparo le immagini: 0 di 2");
  expect(await page.evaluate(() => window.__voiceLog.slice(0, 2))).toEqual(["microphone", "prepare"]);
  // The microphone is open but paused until the call starts: nothing reaches a provider yet.
  expect(await page.evaluate(() => window.__voiceLog.filter((entry) => entry === "voice POST").length)).toBe(0);
  expect(live.requests).toHaveLength(0);
  expect(await page.evaluate(() => window.__voiceStreams[0].getAudioTracks().map((track) => track.enabled))).toEqual([false]);
  await expect(dock.getByRole("button", { name: "Annulla preparazione" })).toBeVisible();

  await markAnalysisReady(assets[0]);
  await expect(dock.getByTestId("live-status")).toHaveText("Preparo le immagini: 1 di 2");
  await markAnalysisReady(assets[1]);

  // Ready: the browser's SDP offer reaches GPT-Live and the call connects for real.
  await expect.poll(() => live.requests.length, { timeout: 20_000 }).toBe(1);
  const [created] = live.requests;
  expect(created.session.model).toBe("gpt-live-1");
  expect(created.transport.type).toBe("webrtc");
  expect(created.transport.sdp.startsWith("v=0")).toBe(true);
  expect(created.transport.sdp).toContain("m=audio");
  expect(created.session.input.length).toBeGreaterThan(0);
  await expect(dock.getByTestId("live-status")).toHaveText("In ascolto", { timeout: 20_000 });
  expect(live.sideband.some((event) => event.type === "session.update")).toBe(true);

  // Heili speaks: the subtitles come from the data channel.
  await state.answerer.waitForFunction(() => window.__dc?.readyState === "open");
  await state.answerer.evaluate(
    (text) => window.__dc.send(JSON.stringify({ type: "session.output_transcript.delta", event_id: "evt_1", delta: text })),
    GREETING
  );
  await expect(dock.getByLabel("Sottotitoli")).toContainText(GREETING);
  await expect(dock.getByText(/Tempo rimasto/)).toBeVisible();

  // «Termina»: the server closes the provider session and the box is ready again.
  await dock.getByRole("button", { name: "Termina" }).click();
  await expect(dock.getByTestId("voice-start")).toBeVisible({ timeout: 20_000 });
  expect(live.sideband.some((event) => event.type === "session.close")).toBe(true);
  const { rows } = await db.query(
    'select c.status from "ReviewVoiceCall" c join "ReviewSession" s on s.id = c."sessionId" where s."postId" = $1',
    [state.fixture.carouselId]
  );
  expect(rows.map((row) => row.status)).toEqual(["CLOSED"]);
  // The microphone is released.
  expect(await microphoneLive(page)).toBe(false);
  await context.close();
});

test("un tocco che non può partire dice subito perché (bozza nel campo)", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  const page = await context.newPage();
  const dock = await openVoice(page, state.fixture.secondId);
  await dock.getByLabel("Messaggio per l'assistente").fill("Il titolo è troppo lungo");
  const start = dock.getByTestId("voice-start");
  // Announced as unavailable (aria-disabled) but never a dead `disabled` button: the tap answers.
  expect(await start.evaluate((button) => button.disabled)).toBe(false);
  await expect(start).toHaveAttribute("aria-disabled", "true");
  await start.click({ force: true }); // a real tap: Playwright would wait for aria-disabled to go
  
  await expect(dock.getByTestId("voice-notice")).toHaveText(/Invia prima il messaggio scritto/, { timeout: 300 });
  // Once the reason is gone, so is the sentence.
  await dock.getByLabel("Messaggio per l'assistente").fill("");
  await expect(dock.getByTestId("voice-notice")).toHaveCount(0);
  await expect(start).not.toHaveAttribute("aria-disabled", "true");
  await context.close();
});

test("microfono negato: lo dice subito, prima di preparare qualcosa", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  const page = await context.newPage();
  await traceVoice(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => {
      window.__voiceLog.push("microphone");
      return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    };
  });
  const dock = await openVoice(page, state.fixture.secondId);
  await dock.getByTestId("voice-start").click();
  await expect(dock.getByRole("alert").filter({ hasText: "Il microfono è bloccato" })).toBeVisible({ timeout: 1_000 });
  await expect(dock.getByTestId("voice-start")).toBeVisible();
  expect(await page.evaluate(() => window.__voiceLog)).toEqual(["microphone"]);
  await context.close();
});

test("GPT-Live rifiuta la sessione: il cliente legge cosa succede e il microfono si spegne", async ({ browser }) => {
  // The second post's single image is ready, so the start reaches the provider.
  for (const asset of await assetIdsOf(state.fixture.secondId)) await markAnalysisReady(asset);
  live.refuse = true;
  const before = live.requests.length;
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  const page = await context.newPage();
  await traceVoice(page);
  const dock = await openVoice(page, state.fixture.secondId);
  await dock.getByTestId("voice-start").click();
  await expect(dock.getByTestId("live-status")).toBeVisible({ timeout: 300 });
  await expect(dock.getByRole("alert").filter({ hasText: "La conversazione vocale non è disponibile in questo momento" })).toBeVisible({
    timeout: 20_000,
  });
  expect(live.requests.length).toBe(before + 1);
  await expect(dock.getByTestId("voice-start")).toBeVisible();
  expect(await microphoneLive(page)).toBe(false);
  live.refuse = false;
  await context.close();
});

// ─── Dettatura del commento (SpeechRecognition del browser) ──────────────────

/** The comment field's microphone, whatever its state. */
const dictationButton = (page) =>
  page.locator('button[aria-label="Detta il commento"], button[aria-label="Ferma dettatura"], button[aria-label="Dettatura non disponibile in questo browser"]').first();

test("dettatura: senza riconoscimento vocale il tocco spiega cosa fare", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  const page = await context.newPage();
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await page.goto(postUrl(state.fixture.secondId));
  const mic = dictationButton(page);
  await expect(mic).toHaveAttribute("aria-label", "Dettatura non disponibile in questo browser");
  expect(await mic.evaluate((button) => button.disabled)).toBe(false);
  await mic.click({ force: true }); // aria-disabled: a real tap still lands
  await expect(page.getByRole("alert").filter({ hasText: "La dettatura non è disponibile in questo browser" })).toBeVisible({ timeout: 300 });
  await context.close();
});

test("dettatura: un riconoscimento che non parte non lascia «Ti ascolto…» per sempre", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  await context.grantPermissions(["microphone"], { origin: HELI_BASE });
  const page = await context.newPage();
  // Accepts start() and then never sends a single event (seen in in-app browsers).
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    };
  });
  await page.goto(postUrl(state.fixture.secondId));
  await dictationButton(page).click();
  await expect(page.getByText("Ti ascolto…")).toBeVisible({ timeout: 300 });
  await expect(page.getByRole("alert").filter({ hasText: "Il microfono non risponde" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Ti ascolto…")).toHaveCount(0);
  await expect(dictationButton(page)).toHaveAttribute("aria-label", "Detta il commento");
  await context.close();
});

test("dettatura: il testo arriva nel campo e «Ferma» chiude anche se il browser non lo conferma", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  await context.grantPermissions(["microphone"], { origin: HELI_BASE });
  const page = await context.newPage();
  // Starts, hears one sentence, and never sends onend after stop().
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {
        setTimeout(() => this.onstart?.(), 50);
        setTimeout(() => this.onresult?.({ results: [[{ transcript: "il titolo è troppo piccolo" }]] }), 150);
      }
      stop() {}
      abort() {}
    };
  });
  await page.goto(postUrl(state.fixture.secondId));
  await dictationButton(page).click();
  const field = page.getByPlaceholder(/Per esempio/);
  await expect(field).toHaveValue("il titolo è troppo piccolo");
  // Past the start watchdog: a recognizer that started is never cut off.
  await page.waitForTimeout(5_500);
  await expect(dictationButton(page)).toHaveAttribute("aria-label", "Ferma dettatura");
  await dictationButton(page).click();
  await expect(dictationButton(page)).toHaveAttribute("aria-label", "Detta il commento", { timeout: 3_000 });
  await expect(field).toHaveValue("il titolo è troppo piccolo");
  // And it can start again at once.
  await dictationButton(page).click();
  await expect(page.getByText("Ti ascolto…")).toBeVisible({ timeout: 300 });
  await context.close();
});

test("se la voce non può funzionare su questo contenuto il riquadro lo spiega; se non c'è, non compare", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, baseURL: HELI_BASE });
  const page = await context.newPage();
  let reason = "media-analysis-off";
  // The server state as an instance without media analysis (or without voice) would send it.
  await page.route(/\/api\/review\/[^/]+\/assistant\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.voice = { available: false, reason };
    await route.fulfill({ response, json: body });
  });
  const dock = await openVoice(page, state.fixture.blogId);
  await expect(dock.getByTestId("voice-unavailable")).toHaveText(/immagini o video la conversazione a voce non è attiva/);
  await expect(dock.getByTestId("voice-start")).toHaveCount(0);
  await page.getByRole("button", { name: "Chiudi Heili" }).click();

  reason = "not-configured";
  await page.goto(postUrl(state.fixture.blogId));
  await page.getByTestId("heili-dock-button").click();
  await expect(page.getByRole("region", { name: "Assistente di revisione" })).toBeVisible();
  await expect(page.getByTestId("voice-box")).toHaveCount(0);
  // The chat is still there.
  await expect(page.getByLabel("Messaggio per l'assistente")).toBeVisible();
  await context.close();
});
