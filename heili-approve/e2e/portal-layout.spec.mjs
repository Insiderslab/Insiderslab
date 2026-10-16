// Client portal layout checks on a phone (390 px) and desktop: the QA-2026-10-15
// findings of the portal that are about where things sit on the screen
// (QA-04 decision bar, QA-11 touch targets, QA-12 floating Heili button,
// QA-14 end of page, QA-15 plan, QA-16 Sfoglia, QA-17 Guida, QA-18 navigation).
//
// Against the running app (METRICOOL_FAKE=1), with or without an AI key: the
// floating Heili button is there either way. Data: a fresh client with the three
// services (create-portal-fixture.ts) and the month fixture (a sent plan with a
// carousel), so reruns and other specs do not interfere.

import { execFileSync } from "node:child_process";
import { MOBILE, connectDb, expect, root, seed, test, uniq, viewportShot } from "./helpers.mjs";
import { smallControls } from "./support/touch.mjs";

let db;
let data;
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
  state.portal = runFixture("e2e/support/create-portal-fixture.ts", [data.workspaceId, data.userId, uniq()]);
  state.month = runFixture("e2e/support/create-month-fixture.ts", [
    data.workspaceId,
    data.userId,
    monthInRome(1),
    monthInRome(2),
    monthInRome(3),
    uniq(),
  ]);
});

test.afterAll(async () => {
  await db?.query('update "Client" set "archivedAt" = now() where id = any($1)', [
    [state.portal?.clientId, state.month?.a.clientId, state.month?.b.clientId].filter(Boolean),
  ]);
  await db?.end();
});

const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// ─── QA-04 ───────────────────────────────────────────────────────────────────

test("QA-04: la barra delle decisioni (post, annunci, articolo) tiene ogni etichetta nel suo pulsante a 360 e 390 px", async ({ browser }) => {
  const pages = {
    post: `${state.portal.reviewUrl}/posts/${state.portal.carouselId}`,
    annunci: `${state.portal.reviewUrl}/posts/${state.portal.adsId}`,
    articolo: `${state.portal.reviewUrl}/posts/${state.portal.blogId}`,
  };
  for (const width of [360, 390]) {
    const context = await browser.newContext({ ...MOBILE, viewport: { width, height: 800 } });
    const page = await context.newPage();
    for (const [name, url] of Object.entries(pages)) {
      await page.goto(url);
      const changes = page.getByTestId("decision-changes");
      const approve = page.getByTestId("decision-approve");
      await expect(approve).toBeVisible();
      for (const button of [changes, approve]) {
        const fit = await button.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
        expect(fit.scroll, `${name} ${width}: «${await button.textContent()}» esce dal pulsante`).toBeLessThanOrEqual(fit.client);
      }
      const [a, b] = [await changes.boundingBox(), await approve.boundingBox()];
      expect(overlap(a, b), `${name} ${width}: i due pulsanti si sovrappongono`).toBe(false);
      for (const box of [a, b]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      if (name === "annunci" && width === 390) await viewportShot(page, "qa04-annunci-390.png");
    }
    await context.close();
  }
});

// ─── QA-11 ───────────────────────────────────────────────────────────────────

test("QA-11: nel portale a 390 px nessun controllo sotto i 44 px", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const aurora = state.portal.reviewUrl;
  const plan = `${state.month.a.reviewUrl}/piani/${state.month.planId}`;
  const pages = [
    ["home", aurora],
    ["post", `${aurora}/posts/${state.portal.carouselId}`],
    ["post con modifiche", `${aurora}/posts/${state.portal.askedId}`],
    ["annunci", `${aurora}/posts/${state.portal.adsId}`],
    ["articolo", `${aurora}/posts/${state.portal.blogId}`],
    ["piano", plan],
    ["piano · Sfoglia", `${plan}?vista=sfoglia`],
    ["piano · Griglia", `${plan}?vista=griglia`],
  ];
  const failures = [];
  for (const [name, url] of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    for (const found of await smallControls(page)) failures.push(`${name}: ${found}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
  await context.close();
});

// ─── QA-14 ───────────────────────────────────────────────────────────────────

test("QA-14: in fondo alla pagina la barra delle decisioni è attaccata al bordo inferiore (390 px)", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const plan = `${state.month.a.reviewUrl}/piani/${state.month.planId}`;
  const pages = [
    ["post", `${state.portal.reviewUrl}/posts/${state.portal.carouselId}`],
    ["annunci", `${state.portal.reviewUrl}/posts/${state.portal.adsId}`],
    ["articolo", `${state.portal.reviewUrl}/posts/${state.portal.blogId}`],
    ["piano", plan],
    ["Sfoglia", `${plan}?vista=sfoglia`],
  ];
  for (const [name, url] of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const bar = page.locator(".sticky.bottom-0").last();
    await expect(bar).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const { bottom, height, vh, pb, clearance } = await page.evaluate(() => {
      const el = document.querySelector(".sticky.bottom-0");
      const r = el.getBoundingClientRect();
      const button = document.querySelector('[data-testid="heili-dock-button"]').getBoundingClientRect();
      return {
        bottom: r.bottom,
        height: r.height,
        vh: window.innerHeight,
        pb: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--decision-bar-h")),
        clearance: r.top - button.bottom,
      };
    });
    expect(Math.abs(bottom - vh), `${name}: la barra sta a ${Math.round(vh - bottom)} px dal bordo inferiore`).toBeLessThanOrEqual(1);
    // The floating button is above the bar and --decision-bar-h is exactly the bar's height now.
    expect(Math.abs(pb - height)).toBeLessThanOrEqual(1);
    expect(clearance, `${name}: il pulsante di Heili tocca la barra`).toBeGreaterThanOrEqual(8);
    if (name === "post" || name === "Sfoglia") await viewportShot(page, `qa14-${name.toLowerCase()}-fondo-390.png`);
  }
  await context.close();
});
