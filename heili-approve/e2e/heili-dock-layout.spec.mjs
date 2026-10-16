// The Heili dock next to the page (QA-05, QA-13 desktop; QA-06 phone; QA-12 and
// QA-14 floating button; QA-16 one meaning). Heili needs an AI provider: this spec
// starts a second server of the same build with a mock one (e2e/support/heili-server.mjs).
//
// Data: a fresh client (create-portal-fixture.ts) with a carousel post in review.

import { execFileSync } from "node:child_process";
import { DESKTOP, MOBILE, connectDb, expect, root, seed, test, uniq, viewportShot, waitForStatus } from "./helpers.mjs";
import { HELI_BASE, startHeiliServer } from "./support/heili-server.mjs";
import { smallControls } from "./support/touch.mjs";

let db;
let data;
let heili;
const state = {};

test.describe.configure({ mode: "serial" });

function monthInRome(delta) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  const out = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-portal-fixture.ts", data.workspaceId, data.userId, uniq()],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  state.fixture = JSON.parse(line.slice("RESULT ".length));
  const month = execFileSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "e2e/support/create-month-fixture.ts",
      data.workspaceId,
      data.userId,
      monthInRome(1),
      monthInRome(2),
      monthInRome(3),
      uniq(),
    ],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  state.month = JSON.parse(month.split("\n").find((l) => l.startsWith("RESULT ")).slice("RESULT ".length));
  heili = await startHeiliServer();
});

test.afterAll(async () => {
  await db?.query('update "Client" set "archivedAt" = now() where id = any($1)', [
    [state.fixture?.clientId, state.month?.a.clientId, state.month?.b.clientId].filter(Boolean),
  ]);
  await db?.end();
  await heili?.stop();
});

const reviewPath = () => new URL(state.fixture.reviewUrl).pathname;
const postUrl = (id) => `${HELI_BASE}${reviewPath()}/posts/${id}`;
const context = (browser, options) => browser.newContext({ ...options, baseURL: HELI_BASE });

/** One message to Heili and the summary, so the panel has its longest content. */
async function chatToSummary(page) {
  const panel = page.getByRole("region", { name: "Assistente di revisione" });
  await panel.getByLabel("Messaggio per l'assistente").fill("Il testo mi sembra troppo formale.");
  await panel.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(panel.getByText("Capito. Quale frase ti suona peggio?")).toBeVisible();
  await panel.getByRole("button", { name: "Prepara il riepilogo per l'agenzia" }).click();
  await expect(panel.getByText("Rendere il tono più colloquiale").first()).toBeVisible();
  return panel;
}

// ─── QA-05 + QA-13 ───────────────────────────────────────────────────────────

test("QA-05/QA-13: a 1366 px il pannello sta sopra la barra e la pagina gli lascia 400 px", async ({ browser }) => {
  const ctx = await context(browser, DESKTOP);
  const page = await ctx.newPage();
  await page.goto(postUrl(state.fixture.carouselId));
  const approve = page.getByTestId("decision-approve");
  await expect(approve).toBeVisible();
  const title = page.getByRole("heading", { level: 1 });
  const closedRight = (await title.boundingBox()).x + (await title.boundingBox()).width;

  await page.getByTestId("heili-dock-button").click();
  const dock = page.getByTestId("heili-dock");
  await expect(dock).toBeVisible();
  const panel = await chatToSummary(page);

  // QA-13: the page keeps 400 px clear: title, date and «Approva» stay readable, left of the panel.
  const dockBox = await dock.boundingBox();
  expect(dockBox.width).toBe(400);
  expect(dockBox.x + dockBox.width).toBe(1366);
  const titleBox = await title.boundingBox();
  expect(titleBox.x + titleBox.width, "il titolo finisce sotto il pannello").toBeLessThanOrEqual(dockBox.x);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closedRight);
  const approveBox = await approve.boundingBox();
  expect(approveBox.x + approveBox.width, "«Approva» finisce sotto il pannello").toBeLessThanOrEqual(dockBox.x);
  await expect(page.getByText("Pubblicazione:")).toBeVisible();
  const date = await page.getByText("Pubblicazione:").boundingBox();
  expect(date.x + date.width).toBeLessThanOrEqual(dockBox.x);

  // QA-05: above the bar, whatever is under the pointer in the panel's strip belongs to the panel.
  const z = await page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="heili-dock"]');
    const bar = document.querySelector('[data-testid="decision-approve"]').closest(".sticky");
    return { dock: Number(getComputedStyle(dialog).zIndex), bar: Number(getComputedStyle(bar).zIndex) };
  });
  expect(z.dock).toBeGreaterThan(z.bar);
  for (const y of [700, 800, 850, 880, 895]) {
    const inside = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="heili-dock"]'), { x: 1200, y });
    expect(inside, `a (1200, ${y}) il tocco non va al pannello`).toBe(true);
  }
  for (const button of await panel.getByRole("button").all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    const ok = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="heili-dock"]'),
      { x: box.x + box.width / 2, y: Math.min(box.y + box.height / 2, 895) }
    );
    expect(ok, `«${await button.textContent()}» del pannello è coperto`).toBe(true);
  }
  await viewportShot(page, "qa05-desktop-dock-1366.png");

  // Closing gives the page its width back.
  await page.getByRole("button", { name: "Chiudi Heili" }).click();
  await expect(dock).not.toBeVisible();
  const after = await title.boundingBox();
  expect(after.x + after.width).toBeCloseTo(closedRight, 0);
  await ctx.close();
});

test("QA-13: sotto i 1280 px il pannello è un foglio modale che si chiude con un tocco fuori", async ({ browser }) => {
  const ctx = await context(browser, { viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(postUrl(state.fixture.carouselId));
  await page.getByTestId("heili-dock-button").click();
  const dock = page.getByTestId("heili-dock");
  await expect(dock).toBeVisible();
  expect(await dock.evaluate((el) => el.matches(":modal"))).toBe(true);
  const box = await dock.boundingBox();
  expect(box.width).toBeLessThanOrEqual(640);
  // The page does not shrink under it: the backdrop says the rest is inactive.
  expect(await page.evaluate(() => document.documentElement.dataset.heiliPanel ?? "")).toBe("");
  await page.mouse.click(40, 100);
  await expect(dock).not.toBeVisible();
  await ctx.close();
});

// ─── QA-06 ───────────────────────────────────────────────────────────────────

test("QA-06: su telefono il riepilogo dice di chiudere Heili e il foglio riporta alla barra", async ({ browser }) => {
  const ctx = await context(browser, MOBILE);
  const page = await ctx.newPage();
  await page.goto(postUrl(state.fixture.secondId));
  await expect(page.getByTestId("decision-changes")).toBeVisible();

  await page.getByTestId("heili-dock-button").click();
  const dock = page.getByTestId("heili-dock");
  await expect(dock).toBeVisible();
  const panel = await chatToSummary(page);

  // The sheet is modal: the bar below it cannot be seen or tapped, so the text must not send the client there.
  expect(await dock.evaluate((el) => el.matches(":modal"))).toBe(true);
  const hint = panel.getByTestId("assistant-bar-hint");
  await expect(hint).toContainText("chiudi Heili");
  await expect(hint).toContainText("«Chiedi modifiche»");
  const back = panel.getByRole("button", { name: "Torna alla pagina" });
  await back.scrollIntoViewIfNeeded();
  await viewportShot(page, "qa06-riepilogo-390.png");

  // One tap to the page: the bar is there, on top, and «Chiedi modifiche» sends the summary.
  await back.click();
  await expect(dock).not.toBeVisible();
  const changes = page.getByTestId("decision-changes");
  await expect(changes).toBeVisible();
  const box = await changes.boundingBox();
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="decision-changes"]') !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  );
  expect(onTop).toBe(true);
  await changes.click();
  await expect(page.getByText("Modifiche inviate all'agenzia.", { exact: true })).toBeVisible();
  await waitForStatus(db, state.fixture.secondId, "CHANGES_REQUESTED", 15_000);
  await ctx.close();
});

// ─── QA-11 (Heili's sheet) ───────────────────────────────────────────────────

test("QA-11: i controlli del foglio di Heili (Feedback e Guida) sono da 44 px a 390 px", async ({ browser }) => {
  const ctx = await context(browser, MOBILE);
  const page = await ctx.newPage();
  await page.goto(postUrl(state.fixture.carouselId));
  await page.getByTestId("heili-dock-button").click();
  const dock = page.getByTestId("heili-dock");
  await expect(dock).toBeVisible();
  const failures = [];
  for (const found of await smallControls(page, '[data-testid="heili-dock"]')) failures.push(`Feedback: ${found}`);
  await page.getByRole("tab", { name: "Guida" }).click();
  for (const found of await smallControls(page, '[data-testid="heili-dock"]')) failures.push(`Guida: ${found}`);
  expect(failures, failures.join("\n")).toEqual([]);
  await ctx.close();
});

// ─── QA-16 ───────────────────────────────────────────────────────────────────

test("QA-16: l'icona di Heili ha un solo significato: dove si commenta apre la chat, altrove la Guida (e lo dice)", async ({ browser }) => {
  const ctx = await context(browser, MOBILE);
  const page = await ctx.newPage();
  const planUrl = `${HELI_BASE}${new URL(state.month.a.reviewUrl).pathname}/piani/${state.month.planId}`;

  // Sfoglia is not a content page: the icon opens the Guida, says so, and differs from «Parla con Heili».
  await page.goto(`${planUrl}?vista=sfoglia`);
  const icon = page.getByTestId("heili-dock-button");
  await expect(icon).toHaveAttribute("data-kind", "guide");
  await expect(icon).toHaveAttribute("aria-label", "Apri la Guida di Heili");
  await expect(icon.getByTestId("heili-guide-badge")).toBeVisible();
  const chat = page.getByTestId("browse-heili");
  await expect(chat).toHaveText("Parla con Heili");
  expect(await icon.getAttribute("aria-label")).not.toBe((await chat.textContent()).trim());
  await icon.click();
  const dock = page.getByTestId("heili-dock");
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("heili-guide-status")).toBeVisible();
  await expect(dock.getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Chiudi Heili" }).click();

  // «Parla con Heili» takes the card to its conversation: the same Feedback tab the icon opens on a content page.
  await chat.click();
  await page.waitForURL(/\/posts\/.+heili=1/);
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("tab", { name: "Feedback" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Chiudi Heili" }).click();

  // On the content page the icon is the conversation: same label as «Parla con Heili», same tab, no «?».
  const content = page.getByTestId("heili-dock-button");
  await expect(content).toHaveAttribute("data-kind", "chat");
  await expect(content).toHaveAttribute("aria-label", "Parla con Heili");
  await expect(content.getByTestId("heili-guide-badge")).toHaveCount(0);
  await content.click();
  await expect(dock.getByRole("tab", { name: "Feedback" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Chiudi Heili" }).click();
  await page.getByRole("button", { name: "Parla con Heili" }).first().click();
  await expect(dock.getByRole("tab", { name: "Feedback" })).toHaveAttribute("aria-selected", "true");
  await ctx.close();
});

// ─── QA-17 ───────────────────────────────────────────────────────────────────

test("QA-17: la Guida rafforza il percorso della pagina: stesso prossimo passo, niente frase ripetuta, terzo passo col nome del gesto", async ({ browser }) => {
  const ctx = await context(browser, MOBILE);
  const page = await ctx.newPage();
  const dock = page.getByTestId("heili-dock");

  // Home with a plan waiting: the page's big button and the Guida's next step are the same.
  await page.goto(`${HELI_BASE}${new URL(state.month.a.reviewUrl).pathname}`);
  const primary = page.getByRole("link", { name: "Rivedi il piano del mese" }).first();
  await expect(primary).toBeVisible();
  const href = await primary.getAttribute("href");
  await page.getByTestId("heili-dock-button").click();
  await expect(dock).toBeVisible();
  const next = dock.getByTestId("heili-guide-next");
  await expect(next).toHaveText("Rivedi il piano del mese");
  await expect(next).toHaveAttribute("href", href);
  // The line under «Heili» does not repeat the sentence that opens the Guida.
  const subtitle = (await dock.getByTestId("heili-dock-context").textContent()).trim();
  const status = (await dock.getByTestId("heili-guide-status").textContent()).trim();
  expect(subtitle).toBe("Guida");
  expect(status.startsWith(subtitle)).toBe(false);
  expect(status).toContain("Questa è la tua pagina di revisione");
  expect((status.match(/Questa è la tua pagina di revisione/g) ?? []).length).toBe(1);
  await page.getByRole("button", { name: "Chiudi Heili" }).click();

  // Home without a plan: «Inizia dal primo» (several waiting) is the next step too.
  await page.goto(`${HELI_BASE}${reviewPath()}`);
  const first = page.getByRole("link", { name: "Inizia dal primo" });
  await expect(first).toBeVisible();
  const firstHref = await first.getAttribute("href");
  await page.getByTestId("heili-dock-button").click();
  await expect(dock.getByTestId("heili-guide-next")).toHaveText("Inizia dal primo");
  await expect(dock.getByTestId("heili-guide-next")).toHaveAttribute("href", firstHref);
  await page.getByRole("button", { name: "Chiudi Heili" }).click();

  // After «Chiedi modifiche» the last of the three steps is the gesture that closes the flow.
  await page.goto(postUrl(state.fixture.askedId));
  await page.getByTestId("heili-dock-button").click();
  await expect(dock.getByTestId("assistant-steps")).toContainText("3 Aggiungi");
  await expect(dock.getByTestId("assistant-steps")).not.toContainText("3 Invia");
  await ctx.close();
});

// ─── Tocco prima che la pagina sia pronta ────────────────────────────────────

test("Heili: un tocco prima che la pagina sia pronta risponde subito e apre il dock appena può", async ({ browser }) => {
  for (const options of [MOBILE, DESKTOP]) {
    const ctx = await context(browser, options);
    const page = await ctx.newPage();
    // A slow phone: the page's JavaScript is held back until the tap has happened.
    let release;
    const held = new Promise((resolve) => (release = resolve));
    // Scripts only: the stylesheets live under chunks/ too and must arrive.
    await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
      await held;
      await route.continue();
    });
    // "commit": the held scripts would delay DOMContentLoaded; the HTML is enough.
    await page.goto(postUrl(state.fixture.carouselId), { waitUntil: "commit" });
    const button = page.getByTestId("heili-dock-button");
    await expect(button).toBeVisible();
    await button.click({ noWaitAfter: true });
    // Feedback at once (no React yet): the button is marked as waiting.
    await expect(button).toHaveAttribute("data-heili-pending", "", { timeout: 300 });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("heili-dock")).not.toBeVisible();
    release();
    // Hydrated: the tap is honoured, on the conversation (a content page).
    const dock = page.getByTestId("heili-dock");
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("tab", { name: "Feedback" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Chiudi Heili" }).click();
    await expect(dock).not.toBeVisible();
    // After hydration the button works as always and carries no leftover mark.
    await expect(button).not.toHaveAttribute("data-heili-pending", "");
    await button.click();
    await expect(dock).toBeVisible();
    await ctx.close();
  }
});
