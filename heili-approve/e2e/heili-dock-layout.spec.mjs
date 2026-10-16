// The Heili dock next to the page (QA-05, QA-13 desktop; QA-06 phone; QA-12 and
// QA-14 floating button; QA-16 one meaning). Heili needs an AI provider: this spec
// starts a second server of the same build with a mock one (e2e/support/heili-server.mjs).
//
// Data: a fresh client (create-portal-fixture.ts) with a carousel post in review.

import { execFileSync } from "node:child_process";
import { DESKTOP, connectDb, expect, root, seed, test, uniq, viewportShot } from "./helpers.mjs";
import { HELI_BASE, startHeiliServer } from "./support/heili-server.mjs";

let db;
let data;
let heili;
const state = {};

test.describe.configure({ mode: "serial" });

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
  heili = await startHeiliServer();
});

test.afterAll(async () => {
  await db?.query('update "Client" set "archivedAt" = now() where id = $1', [state.fixture?.clientId]);
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
