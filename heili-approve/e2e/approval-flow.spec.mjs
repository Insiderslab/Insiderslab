// End-to-end test of the whole approval flow, against the running app
// (METRICOOL_FAKE=1) and worker. Run with: sh e2e/run.sh (see README).
//
// 1. Image post: agency creates it with an upload → submits → client (390px)
//    pins a comment and asks for changes → agency publishes version 2 →
//    client sees "Cosa è cambiato" and approves → worker schedules it on
//    (fake) Metricool → SCHEDULED with a metricoolPostId.
// 2. Access rules: wrong token, a DRAFT post, another client's post; the AI
//    assistant is hidden when no provider key is configured.
// 3. Instagram Reel: the client comments at a moment ("Commenta a 0:05"),
//    the agency sees the marker and the timed note, picks the cover frame,
//    and the Metricool payload carries videoCoverMilliseconds.
//
// Screenshots of the key screens go to docs/screenshots/.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));

// The runner and the spec must share one Playwright instance (run.sh sets it).
const { test, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE ?? "playwright/test");
const pg = require("pg");

const SHOTS = path.join(root, "docs", "screenshots");
const FIXTURES = path.join(here, "fixtures");
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1366, height: 900 } };

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(root, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL non trovato");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

/** Runs the (idempotent) seed and returns its SEED_JSON line. */
function seed() {
  const out = execFileSync("npm", ["run", "--silent", "db:seed"], { cwd: root, encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("SEED_JSON "));
  if (!line) throw new Error(`Seed senza SEED_JSON:\n${out}`);
  return JSON.parse(line.slice("SEED_JSON ".length));
}

/** Local date (Europe/Rome) `days` from now, as the editor's date input wants it. */
function romeDate(days) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + days * 86_400_000));
}

/**
 * Full-length screenshot. The agency shell scrolls inside <main>, so a plain
 * fullPage shot would stop at the viewport: the viewport is stretched to the
 * tallest scrolling element first, then restored.
 */
async function shot(page, name, { maxHeight = 3200 } = {}) {
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  const height = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll("main, main *")].map((el) => el.scrollHeight))
  );
  const stretch = original && height > original.height;
  if (stretch) await page.setViewportSize({ width: original.width, height: Math.min(height, maxHeight) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  if (stretch) await page.setViewportSize(original);
}

/** The fake Metricool client prints `[Metricool fake] payload {...}` per post. */
function fakePayloadFor(metricoolPostId) {
  const logPath = process.env.E2E_WORKER_LOG;
  if (!logPath || !existsSync(logPath)) {
    throw new Error("Imposta E2E_WORKER_LOG con il log del worker (METRICOOL_FAKE=1 npm run worker > worker.log)");
  }
  const prefix = "[Metricool fake] payload ";
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    const at = line.indexOf(prefix);
    if (at === -1) continue;
    const entry = JSON.parse(line.slice(at + prefix.length));
    if (entry.metricoolPostId === metricoolPostId) return entry;
  }
  return null;
}

let db;
let data;
const state = {};

async function postRow(id) {
  const { rows } = await db.query(
    'select status, "currentVersionNumber", "metricoolPostId", "lastError" from "Post" where id = $1',
    [id]
  );
  return rows[0];
}

async function waitForStatus(id, status, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    const row = await postRow(id);
    if (row?.status === status) return row;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Post ${id}: atteso ${status}, trovato ${row?.status} (${row?.lastError ?? "nessun errore"})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function agencyContext(browser) {
  const context = await browser.newContext(DESKTOP);
  await context.addCookies([{ name: "authjs.session-token", value: data.sessionToken, url: data.baseUrl }]);
  return context;
}

/** Fills the common editor fields of a new post for Caffè Aurora. */
async function fillNewPost(page, { title, text, format }) {
  await page.goto(`/posts/new?clientId=${state.aurora.id}`);
  await expect(page.locator("#post-client")).toHaveValue(state.aurora.id);
  await page.locator("#post-title").fill(title);
  await page.getByLabel("Data di pubblicazione").fill(romeDate(6));
  await page.getByLabel("Ora di pubblicazione").fill("10:30");
  const instagram = page.getByLabel("Instagram", { exact: true });
  if (!(await instagram.isChecked())) await instagram.check();
  if (format) await page.getByLabel("Formato per Instagram").selectOption(format);
  await page.locator("#post-text").fill(text);
}

async function uploadAndWait(page, file) {
  await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, file));
  await expect(page.getByLabel("Testo alternativo del media 1")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Caricamento in corso")).toHaveCount(0, { timeout: 30_000 });
}

/** Submits the editor and returns the post id from the URL it lands on. */
async function saveAndSubmit(page) {
  await page.getByRole("button", { name: /Salva e invia in revisione|Invia in revisione/ }).click();
  await page.waitForURL((url) => /^\/posts\/(?!new$)[a-z0-9]+$/.test(url.pathname), { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop();
}

function reviewPostUrl(clientIndex, postId) {
  return `${data.clients[clientIndex].reviewUrl}/posts/${postId}`;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  state.aurora = data.clients[0];
  state.verde = data.clients[1];
  db = new pg.Client({ connectionString: readDatabaseUrl() });
  await db.connect();
});

test.afterAll(async () => {
  await db?.end();
});

test("agenzia: crea un post con immagine e lo invia in revisione", async ({ browser }) => {
  const context = await agencyContext(browser);
  const page = await context.newPage();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" }).first()).toBeVisible();
  await shot(page, "01-agenzia-dashboard.png");

  state.imageTitle = `Menu d'autunno ${Date.now().toString(36)}`;
  await fillNewPost(page, {
    title: state.imageTitle,
    text:
      "Il menu d'autunno è arrivato 🍂 Vellutata di zucca, tortelli al burro e salvia e la nostra torta di mele della nonna.\n\n" +
      "Vi aspettiamo da giovedì!\n\n#CaffèAurora #menu #autunno",
  });
  await uploadAndWait(page, "post-image.png");
  await expect(page.getByText("Il post rispetta le regole di tutte le reti scelte.")).toBeVisible();
  await expect(page.locator("aside").getByText("caffè aurora", { exact: false }).first()).toBeVisible();
  await shot(page, "02-agenzia-editor-anteprime.png");

  state.imagePostId = await saveAndSubmit(page);
  const row = await waitForStatus(state.imagePostId, "IN_REVIEW", 10_000);
  expect(row.currentVersionNumber).toBe(1);
  await context.close();
});

test("cliente (390px): commento con pin e richiesta di modifiche", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(data.clients[0].reviewUrl);
  await expect(page.getByText(state.imageTitle)).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await shot(page, "03-cliente-portale-mobile.png");

  await page.getByText(state.imageTitle).first().click();
  await page.waitForURL(new RegExp(`/posts/${state.imagePostId}$`));

  // No AI provider key is configured on the test server: no assistant button.
  await expect(page.getByRole("button", { name: /Parlane con l'assistente/ })).toHaveCount(0);

  const image = page.getByRole("region", { name: "Anteprima del post" }).locator("img").first();
  await image.scrollIntoViewIfNeeded();
  const box = await image.boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await page.getByPlaceholder("Cosa vorresti cambiare in questo punto?").fill("Qui metterei la foto della torta di mele.");
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento inviato")).toBeVisible();
  await shot(page, "04-cliente-post-mobile.png");

  await page.getByRole("button", { name: "Chiedi modifiche" }).click();
  await page.getByPlaceholder(/Per esempio/).fill("Togliete \"della nonna\" e aggiungete l'orario: dalle 12 alle 15.");
  await page.getByRole("button", { name: "Invia la richiesta" }).click();
  await expect(page.getByText("Richiesta inviata all'agenzia.")).toBeVisible();

  const row = await waitForStatus(state.imagePostId, "CHANGES_REQUESTED", 10_000);
  expect(row.currentVersionNumber).toBe(1);
  await context.close();
});

test("agenzia: versione 2 del testo e nuovo invio", async ({ browser }) => {
  const context = await agencyContext(browser);
  const page = await context.newPage();

  await page.goto(`/posts/${state.imagePostId}?tab=revisione`);
  await expect(page.getByText("Qui metterei la foto della torta di mele.").first()).toBeVisible();

  await page.goto(`/posts/${state.imagePostId}?tab=modifica`);
  await page.locator("#post-text").fill(
    "Il menu d'autunno è arrivato 🍂 Vellutata di zucca, tortelli al burro e salvia e la nostra torta di mele.\n\n" +
      "Vi aspettiamo da giovedì, a pranzo dalle 12 alle 15!\n\n#CaffèAurora #menu #autunno"
  );
  await page.locator("#post-change-note").fill("Tolto \"della nonna\" e aggiunto l'orario del pranzo.");
  await page.getByRole("button", { name: "Salva e invia in revisione" }).click();

  await expect
    .poll(async () => (await postRow(state.imagePostId)).status, { timeout: 15_000 })
    .toBe("IN_REVIEW");
  expect((await postRow(state.imagePostId)).currentVersionNumber).toBe(2);
  await context.close();
});

test("cliente: vede cosa è cambiato e approva; il worker programma su Metricool", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(reviewPostUrl(0, state.imagePostId));
  await expect(page.getByRole("heading", { name: "Cosa è cambiato" })).toBeVisible();
  await expect(page.getByText("Tolto \"della nonna\" e aggiunto l'orario del pranzo.")).toBeVisible();
  await expect(page.getByText("Versione 2", { exact: true })).toBeVisible();
  await shot(page, "05-cliente-cosa-e-cambiato.png");

  await page.getByRole("button", { name: "Approva", exact: true }).click();
  await page.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Post approvato.")).toBeVisible();
  await context.close();

  const row = await waitForStatus(state.imagePostId, "SCHEDULED", 60_000);
  expect(row.metricoolPostId).toMatch(/^fake-/);
  state.imageMetricoolId = row.metricoolPostId;

  const agency = await agencyContext(browser);
  const agencyPage = await agency.newPage();
  await agencyPage.goto(`/posts/${state.imagePostId}?tab=attivita`);
  await expect(agencyPage.getByText("Programmato").first()).toBeVisible();
  await shot(agencyPage, "06-agenzia-post-programmato.png");
  await agency.close();
});

test("accessi: link sbagliato, bozza e post di un altro cliente", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(`${data.baseUrl}/review/questo-token-non-esiste-affatto-0000000000000`);
  await expect(page.getByRole("heading", { name: "Questo link non funziona più" })).toBeVisible();
  await shot(page, "07-cliente-link-non-valido.png");

  const draft = data.posts.find((p) => p.client === state.aurora.name && p.status === "DRAFT");
  const response = await page.goto(reviewPostUrl(0, draft.id));
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Questo post non è disponibile" })).toBeVisible();

  const otherClientPost = data.posts.find((p) => p.client === state.verde.name && p.status === "IN_REVIEW");
  const other = await page.goto(reviewPostUrl(0, otherClientPost.id));
  expect(other.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Questo post non è disponibile" })).toBeVisible();
  await expect(page.getByText(otherClientPost.title)).toHaveCount(0);
  await context.close();
});

test("reel: commento a un momento, copertina e videoCoverMilliseconds", async ({ browser }) => {
  // ── Agency: Instagram Reel with the test video ──
  const agency = await agencyContext(browser);
  const agencyPage = await agency.newPage();
  state.reelTitle = `Reel latte art ${Date.now().toString(36)}`;
  await fillNewPost(agencyPage, {
    title: state.reelTitle,
    text: "Tre gesti per un cuore perfetto ☕️ Guardate fino alla fine!\n\n#latteart #CaffèAurora #reel",
    format: "REEL",
  });
  await uploadAndWait(agencyPage, "reel-test.mp4");
  await expect(agencyPage.getByText("durata 0:12")).toBeVisible();
  state.reelPostId = await saveAndSubmit(agencyPage);
  await waitForStatus(state.reelPostId, "IN_REVIEW", 10_000);

  // ── Client (390px): "Commenta a 0:05" ──
  const client = await browser.newContext(MOBILE);
  const page = await client.newPage();
  await page.goto(reviewPostUrl(0, state.reelPostId));
  const preview = page.getByRole("region", { name: "Anteprima del post" });
  const forward = preview.getByRole("button", { name: "Avanti di 1 secondo" });
  await forward.scrollIntoViewIfNeeded();
  for (let i = 0; i < 5; i++) await forward.click();
  const commentAt = preview.getByRole("button", { name: "Commenta a 0:05" });
  await expect(commentAt).toBeVisible();
  await commentAt.click();
  await expect(page.getByLabel("Al momento")).toHaveValue("0:05");
  await page
    .getByPlaceholder("Cosa non ti convince in questo momento del video?")
    .fill("Qui la scritta passa troppo veloce, lasciatela un secondo in più.");
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento inviato")).toBeVisible();
  await shot(page, "08-cliente-reel-mobile.png");

  await page.getByRole("button", { name: "Chiedi modifiche" }).click();
  await page.getByPlaceholder(/Per esempio/).fill("Vedi il commento sul video. Come copertina usate il cuore già formato.");
  await page.getByRole("button", { name: "Invia la richiesta" }).click();
  await expect(page.getByText("Richiesta inviata all'agenzia.")).toBeVisible();
  await waitForStatus(state.reelPostId, "CHANGES_REQUESTED", 10_000);

  // ── Agency: marker on the timeline and the timed note ──
  await agencyPage.goto(`/posts/${state.reelPostId}?tab=revisione`);
  await expect(agencyPage.getByRole("heading", { name: "Note sul video" })).toBeVisible();
  await expect(agencyPage.getByRole("button", { name: /vai a 0:05/ }).first()).toBeVisible();
  await expect(agencyPage.getByText("Qui la scritta passa troppo veloce").first()).toBeVisible();
  await shot(agencyPage, "09-agenzia-note-video.png");

  // ── Agency: cover frame at 0:02 → version 2, resubmit ──
  await agencyPage.goto(`/posts/${state.reelPostId}?tab=modifica`);
  const picker = agencyPage
    .locator("div.space-y-3", { has: agencyPage.getByRole("button", { name: "Usa questo fotogramma" }) })
    .last();
  const coverForward = picker.getByRole("button", { name: "Avanti di 1 secondo" });
  await coverForward.click();
  await coverForward.click();
  await picker.getByRole("button", { name: "Usa questo fotogramma" }).click();
  await expect(picker.getByRole("button", { name: "Copertina a 0:02" })).toBeVisible();
  await agencyPage.locator("#post-change-note").fill("Copertina sul cuore già formato.");
  await agencyPage.getByRole("button", { name: "Salva e invia in revisione" }).click();
  await expect
    .poll(async () => (await postRow(state.reelPostId)).status, { timeout: 15_000 })
    .toBe("IN_REVIEW");
  expect((await postRow(state.reelPostId)).currentVersionNumber).toBe(2);

  // ── Client approves version 2 ──
  await page.goto(reviewPostUrl(0, state.reelPostId));
  await expect(page.getByRole("heading", { name: "Cosa è cambiato" })).toBeVisible();
  await expect(page.getByText("Copertina del video modificata")).toBeVisible();
  await page.getByRole("button", { name: "Approva", exact: true }).click();
  await page.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Post approvato.")).toBeVisible();

  // ── Worker → fake Metricool: the payload carries the cover ──
  const row = await waitForStatus(state.reelPostId, "SCHEDULED", 60_000);
  await expect.poll(() => fakePayloadFor(row.metricoolPostId), { timeout: 10_000 }).not.toBeNull();
  const entry = fakePayloadFor(row.metricoolPostId);
  expect(entry.payload.instagramData).toMatchObject({ type: "REEL" });
  expect(entry.payload.videoCoverMilliseconds).toBeGreaterThanOrEqual(1900);
  expect(entry.payload.videoCoverMilliseconds).toBeLessThanOrEqual(2100);
  expect(entry.payload.media[0]).toMatch(/\/media\/.+\.mp4$/);

  await agencyPage.goto(`/posts/${state.reelPostId}?tab=revisione`);
  await expect(agencyPage.getByText("Programmato").first()).toBeVisible();
  await shot(agencyPage, "10-agenzia-reel-programmato.png");

  await client.close();
  await agency.close();
});
