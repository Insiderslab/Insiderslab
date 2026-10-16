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
    const { bottom, height, vh, pb } = await page.evaluate(() => {
      const el = document.querySelector(".sticky.bottom-0");
      const r = el.getBoundingClientRect();
      return {
        bottom: r.bottom,
        height: r.height,
        vh: window.innerHeight,
        pb: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--decision-bar-h")),
      };
    });
    expect(Math.abs(bottom - vh), `${name}: la barra sta a ${Math.round(vh - bottom)} px dal bordo inferiore`).toBeLessThanOrEqual(1);
    // --decision-bar-h is exactly the bar's height now (nothing under it).
    expect(Math.abs(pb - height)).toBeLessThanOrEqual(1);
    if (name === "post" || name === "Sfoglia") await viewportShot(page, `qa14-${name.toLowerCase()}-fondo-390.png`);
  }
  await context.close();
});

// ─── QA-12 ───────────────────────────────────────────────────────────────────

const boxOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, selector);

test("QA-12: a 390 e 360 px il pulsante di Heili sta nella barra e non copre immagine né frecce del carosello", async ({ browser }) => {
  const plan = `${state.month.a.reviewUrl}/piani/${state.month.planId}`;
  const pages = [
    ["post", `${state.portal.reviewUrl}/posts/${state.portal.carouselId}`],
    ["annunci", `${state.portal.reviewUrl}/posts/${state.portal.adsId}`],
    ["articolo", `${state.portal.reviewUrl}/posts/${state.portal.blogId}`],
    ["piano", plan],
    ["Sfoglia", `${plan}?vista=sfoglia`],
  ];
  for (const width of [360, 390]) {
    const context = await browser.newContext({ ...MOBILE, viewport: { width, height: 844 } });
    const page = await context.newPage();
    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("heili-dock-button")).toBeVisible();
      for (const scroll of [0, 400]) {
        await page.evaluate((y) => window.scrollTo(0, y), scroll);
        await page.waitForTimeout(250);
        const launcher = await boxOf(page, '[data-testid="heili-dock-button"]');
        const bar = await boxOf(page, ".sticky.bottom-0");
        const where = `${name} ${width}px, scroll ${scroll}`;
        // Inside the bar: the page's content (media, arrows) is never under the button.
        expect(launcher.y, `${where}: il pulsante esce dalla barra (sopra)`).toBeGreaterThanOrEqual(bar.y);
        expect(launcher.y + launcher.height, `${where}: il pulsante esce dalla barra (sotto)`).toBeLessThanOrEqual(bar.y + bar.height + 1);
        expect(launcher.x + launcher.width).toBeLessThanOrEqual(width);
        // ... and clear of the bar's buttons.
        const buttons = await page.evaluate(() =>
          [...document.querySelectorAll(".sticky.bottom-0 button, .sticky.bottom-0 a")].map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          })
        );
        for (const button of buttons) expect(overlap(launcher, button), `${where}: il pulsante di Heili copre un pulsante della barra`).toBe(false);
        // The carousel arrows: the part of an arrow that is above the bar must be the one a tap reaches
        // (the bar itself always covers what scrolls under it; the Heili button must not add to that).
        for (const arrow of ["Contenuto successivo", "Contenuto precedente"]) {
          const reached = await page.evaluate(
            ({ label, barTop }) => {
              const el = document.querySelector(`button[aria-label="${label}"]`);
              if (!el) return "assente";
              const r = el.getBoundingClientRect();
              const top = Math.max(r.top, 0);
              const bottom = Math.min(r.bottom, barTop);
              if (bottom - top < 6) return "sotto la barra";
              const hit = document.elementFromPoint(r.left + r.width / 2, (top + bottom) / 2);
              return hit?.closest("button") === el ? "raggiunta" : `coperta da ${hit?.getAttribute("data-testid") ?? hit?.tagName}`;
            },
            { label: arrow, barTop: bar.y }
          );
          expect(["assente", "sotto la barra", "raggiunta"], `${where}: «${arrow}» ${reached}`).toContain(reached);
        }
      }
      if (width === 390 && (name === "post" || name === "Sfoglia")) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await viewportShot(page, `qa12-${name.toLowerCase()}-390.png`);
      }
    }
    await context.close();
  }
});

test("QA-12: a 768 px (e senza barra) il pulsante resta nell'angolo, sopra la barra", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 768, height: 900 }, locale: "it-IT" });
  const page = await context.newPage();
  await page.goto(`${state.portal.reviewUrl}/posts/${state.portal.carouselId}`);
  await expect(page.getByTestId("heili-dock-button")).toBeVisible();
  const launcher = await boxOf(page, '[data-testid="heili-dock-button"]');
  const bar = await boxOf(page, ".sticky.bottom-0");
  expect(launcher.y + launcher.height).toBeLessThanOrEqual(bar.y);
  await page.goto(state.portal.reviewUrl);
  const home = await page.getByTestId("heili-dock-button").boundingBox();
  expect(900 - (home.y + home.height)).toBeLessThanOrEqual(16);
  await context.close();
});

// ─── QA-15 ───────────────────────────────────────────────────────────────────

test("QA-15: «Approva tutto il piano» compare una volta sola, nella barra; in evidenza resta la revisione veloce", async ({ browser }) => {
  const plan = `${state.month.a.reviewUrl}/piani/${state.month.planId}`;
  for (const options of [MOBILE, { viewport: { width: 1366, height: 900 } }]) {
    const context = await browser.newContext({ ...options, locale: "it-IT" });
    const page = await context.newPage();
    await page.goto(plan);
    const all = page.getByRole("button", { name: /Approva tutto il piano/ });
    await expect(all).toHaveCount(1);
    await expect(page.getByTestId("plan-approve-all")).toHaveCount(1);
    // That one is the bar's: sticky at the bottom of the window.
    expect(await all.evaluate((el) => !!el.closest(".sticky.bottom-0"))).toBe(true);
    // Reviewing is still offered in the card: quick mode (when on) and one by one.
    await expect(page.getByRole("link", { name: "Apri il primo post" })).toBeVisible();
    if (options === MOBILE) await viewportShot(page, "qa15-piano-390.png");
    await context.close();
  }
});

// ─── QA-18 ───────────────────────────────────────────────────────────────────

test("QA-18: la riga «Elenco · Successivo» ha la stessa disposizione con e senza contatore (390 px)", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const rows = {};
  for (const [name, id] of [["da approvare", state.portal.carouselId], ["modifiche richieste", state.portal.askedId]]) {
    await page.goto(`${state.portal.reviewUrl}/posts/${id}`);
    const nav = page.getByRole("navigation", { name: "Navigazione della revisione" });
    await expect(nav).toBeVisible();
    const back = await nav.getByRole("link").first().boundingBox();
    const next = await nav.getByRole("link", { name: /Prossimo/ }).boundingBox();
    rows[name] = { back, next, counter: await nav.getByText(/^\d+\/\d+$/).count() };
    if (name === "modifiche richieste") await viewportShot(page, "qa18-modifiche-richieste-390.png");
  }
  expect(rows["da approvare"].counter).toBe(1);
  expect(rows["modifiche richieste"].counter).toBe(0);
  for (const row of Object.values(rows)) {
    expect(row.back.x).toBeCloseTo(16, 0);
    expect(row.next.x + row.next.width, "«Successivo» non è sul bordo destro").toBeCloseTo(374, 0);
  }
  expect(rows["modifiche richieste"].next.x + rows["modifiche richieste"].next.width).toBeCloseTo(
    rows["da approvare"].next.x + rows["da approvare"].next.width,
    0
  );
  await context.close();
});
