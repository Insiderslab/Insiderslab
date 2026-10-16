// Client portal under stress (KIMI-2026-10-16-CLIENTE): what happens when the
// phone loses the network, when people paste odd text, when the same link is
// open twice, and what the words on the buttons say.
//
// Against the running app (METRICOOL_FAKE=1). Data: fresh clients from
// create-portal-fixture.ts, so reruns and other specs do not interfere.
//
// - K-01  without a network «Sì, approva» and «Chiedi modifiche» answer with a
//         message and can be tapped again (they used to stay on «Approvazione…»
//         / «Invio…» for good);
// - K-02  a comment made of one very long word (a link) does not widen the page
//         at 390 px;
// - K-03  the client never reads «Metricool» (the sheet and the done panel say
//         «programmato per <data>»);
// - K-04  the same link open on two devices: after approving on one, the other
//         does not blame the agency for the change;
// - K-06  the toast after an approval says what «Annulla» undoes («Annulla
//         l'approvazione»), so it is not mistaken for the sheet's «Annulla»;
// - K-05  one name per way of reviewing a plan: «Sfoglia» is «Sfoglia i post,
//         uno alla volta» everywhere (button, Heili), the other button opens
//         the first post;
// - K-08  plain words on the post page: the way back says «Tutti i post» (not
//         «Elenco») and the saved notes are «Commenti salvati».

import { execFileSync } from "node:child_process";
import { MOBILE, connectDb, expect, expectNoHorizontalScroll, root, seed, test, uniq } from "./helpers.mjs";

let db;
let data;
const state = {};

test.describe.configure({ mode: "serial" });

function runFixture(script, args) {
  const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script, ...args], {
    cwd: root,
    env: { ...process.env, APP_VARIANT: "all" },
    encoding: "utf8",
  });
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  return JSON.parse(line.slice("RESULT ".length));
}

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  state.a = runFixture("e2e/support/create-portal-fixture.ts", [data.workspaceId, data.userId, uniq()]);
  state.b = runFixture("e2e/support/create-portal-fixture.ts", [data.workspaceId, data.userId, uniq() + "b"]);
  state.c = runFixture("e2e/support/create-portal-fixture.ts", [data.workspaceId, data.userId, uniq() + "c"]);
});

test.afterAll(async () => {
  await db?.query('update "Client" set "archivedAt" = now() where id = any($1)', [
    [state.a?.clientId, state.b?.clientId, state.c?.clientId, state.month?.a.clientId, state.month?.b.clientId].filter(Boolean),
  ]);
  await db?.end();
});

/** A phone that already saw the three steps, so the page starts on the content. */
async function phone(browser, reviewUrl) {
  const token = reviewUrl.split("/").pop();
  const context = await browser.newContext(MOBILE);
  await context.addInitScript((key) => window.localStorage.setItem(key, "1"), `portal.howto.${token}`);
  return { context, page: await context.newPage() };
}

test("K-01: senza rete «Sì, approva» dà un messaggio e si può riprovare", async ({ browser }) => {
  const { context, page } = await phone(browser, state.a.reviewUrl);
  await page.goto(`${state.a.reviewUrl}/posts/${state.a.secondId}`);
  await page.getByTestId("decision-approve").click();
  const sheet = page.locator("dialog[open]");
  await expect(sheet).toBeVisible();

  await context.setOffline(true);
  await sheet.getByRole("button", { name: "Sì, approva" }).click();
  await expect(sheet.getByText(/Non riesco a collegarmi/)).toBeVisible();
  // The sheet can be used again: confirm is there, enabled, and «Annulla» closes it.
  await expect(sheet.getByRole("button", { name: "Sì, approva" })).toBeEnabled();
  expect((await postStatus(state.a.secondId)).status).toBe("IN_REVIEW");

  await context.setOffline(false);
  await sheet.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Post approvato.")).toBeVisible();
  expect((await postStatus(state.a.secondId)).status).toBe("APPROVED");
  await context.close();
});

test("K-01: senza rete «Chiedi modifiche» dà un messaggio e si può riprovare", async ({ browser }) => {
  const { context, page } = await phone(browser, state.a.reviewUrl);
  await page.goto(`${state.a.reviewUrl}/posts/${state.a.carouselId}`);
  await page.locator("textarea").first().fill("Il titolo è troppo lungo.");
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento salvato e visibile all’agenzia.")).toBeVisible();

  await context.setOffline(true);
  const changes = page.getByTestId("decision-changes");
  await changes.click();
  await expect(page.getByRole("alert").getByText(/Non riesco a collegarmi/)).toBeVisible();
  await expect(changes).toBeEnabled();
  await expect(changes).toHaveText("Chiedi modifiche");
  expect((await postStatus(state.a.carouselId)).status).toBe("IN_REVIEW");

  await context.setOffline(false);
  await changes.click();
  await expect(page.getByText("Modifiche inviate all'agenzia.")).toBeVisible();
  expect((await postStatus(state.a.carouselId)).status).toBe("CHANGES_REQUESTED");
  await context.close();
});

test("K-02: un commento fatto di una sola parola lunghissima non allarga la pagina", async ({ browser }) => {
  const { context, page } = await phone(browser, state.b.reviewUrl);
  await page.goto(`${state.b.reviewUrl}/posts/${state.b.carouselId}`);
  const longLink = `https://www.esempio.it/${"percorso-lunghissimo-senza-spazi/".repeat(20)}?x=${"a".repeat(300)}`;
  await page.locator("textarea").first().fill(longLink);
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento salvato e visibile all’agenzia.")).toBeVisible();
  await expectNoHorizontalScroll(page);
  // The same with the whole 5000 characters and no space at all.
  await page.locator("textarea").first().fill("x".repeat(5200));
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.locator("main")).toContainText("x".repeat(100));
  await expectNoHorizontalScroll(page);
  await context.close();
});

test("K-03: il cliente non legge mai «Metricool» nel foglio di conferma né dopo l'approvazione", async ({ browser }) => {
  const { context, page } = await phone(browser, state.b.reviewUrl);
  await page.goto(`${state.b.reviewUrl}/posts/${state.b.secondId}`);
  await page.getByTestId("decision-approve").click();
  const sheet = page.locator("dialog[open]");
  await expect(sheet).toContainText(/Il post verrà programmato per /);
  await expect(sheet).not.toContainText("Metricool");
  await sheet.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Post approvato.")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("Metricool");
  await context.close();
});

test("K-04: lo stesso link su due dispositivi: l'altra scheda non dà la colpa all'agenzia", async ({ browser }) => {
  const one = await phone(browser, state.c.reviewUrl);
  const two = await phone(browser, state.c.reviewUrl);
  const url = `${state.c.reviewUrl}/posts/${state.c.secondId}`;
  await one.page.goto(url);
  await two.page.goto(url);

  await one.page.getByTestId("decision-approve").click();
  await one.page.locator("dialog[open]").getByRole("button", { name: "Sì, approva" }).click();
  await expect(one.page.getByText("Fatto! Post approvato.")).toBeVisible();

  await two.page.locator("textarea").first().fill("Cambiate il titolo");
  await two.page.getByRole("button", { name: "Invia commento" }).click();
  const banner = two.page.getByRole("alert").filter({ hasText: "cambiato nel frattempo" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("già rivisto da un altro dispositivo");
  await expect(banner.getByRole("button", { name: "Mostra la versione aggiornata" })).toBeVisible();
  await one.context.close();
  await two.context.close();
});

test("K-06: il toast dopo l'approvazione dice cosa annulla e sta nello schermo a 360 e 390 px", async ({ browser }) => {
  for (const width of [360, 390]) {
    const token = state.c.reviewUrl.split("/").pop();
    const context = await browser.newContext({ ...MOBILE, viewport: { width, height: 800 } });
    await context.addInitScript((key) => window.localStorage.setItem(key, "1"), `portal.howto.${token}`);
    const page = await context.newPage();
    await page.goto(`${state.c.reviewUrl}/posts/${state.c.carouselId}`);
    await page.getByTestId("decision-approve").click();
    const sheet = page.locator("dialog[open]");
    // In the sheet «Annulla» means «non approvare».
    await expect(sheet.getByRole("button", { name: "Annulla", exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Sì, approva" }).click();
    const undo = page.getByTestId("undo-button");
    await expect(undo).toHaveText("Annulla l'approvazione");
    const box = await undo.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const fit = await undo.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.client);
    await expectNoHorizontalScroll(page, width);
    await undo.click();
    await expect(page.getByTestId("decision-approve")).toBeVisible();
    await context.close();
  }
});

test("K-05: il piano usa un nome solo per «Sfoglia»: pulsante, scorciatoia di Heili e scheda", async ({ browser }) => {
  const month = await monthPlan();
  const { context, page } = await phone(browser, month.a.reviewUrl);
  await page.goto(`${month.a.reviewUrl}/piani/${month.planId}`);
  const quick = page.getByTestId("quick-review");
  await expect(quick).toHaveText("Sfoglia i post, uno alla volta");
  await expect(page.getByRole("link", { name: "Apri il primo post" })).toBeVisible();
  await expect(page.getByTestId("view-sfoglia")).toHaveText("Sfoglia");
  expect(await page.locator("main").innerText()).not.toMatch(/modalità veloce|uno per uno|Rivedi veloce/);
  // Heili's shortcut says the same thing as the button.
  await page.getByRole("button", { name: "Apri la Guida di Heili" }).click();
  await expect(page.getByTestId("heili-shortcut-browse")).toHaveText("Sfoglia i post, uno alla volta");
  await context.close();
});

function monthInRome(delta) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

async function monthPlan() {
  state.month ??= runFixture("e2e/support/create-month-fixture.ts", [
    data.workspaceId,
    data.userId,
    monthInRome(1),
    monthInRome(2),
    monthInRome(3),
    uniq() + "m",
  ]);
  return state.month;
}

test("K-08: la pagina del post usa parole semplici (Tutti i post, Commenti salvati)", async ({ browser }) => {
  const month = await monthPlan();
  const { context, page } = await phone(browser, month.a.reviewUrl);
  await page.goto(`${month.a.reviewUrl}/posts/${month.loosePosts[0].id}`);
  const nav = page.getByRole("navigation", { name: "Navigazione della revisione" });
  expect((await nav.getByRole("link", { name: "Tutti i post" }).innerText()).trim()).toBe("Tutti i post");
  const back = await nav.getByRole("link", { name: "Tutti i post" }).boundingBox();
  expect(back.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("heading", { name: "Commenti salvati" })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toContain("Richieste raccolte");
  expect(text).not.toMatch(/^Elenco$/m);
  await expectNoHorizontalScroll(page);
  await context.close();
});

async function postStatus(id) {
  const { rows } = await db.query('select status from "Post" where id = $1', [id]);
  return rows[0];
}
