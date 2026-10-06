// Shared helpers of the end-to-end specs (social, blog, ads, variant gating).
//
// Stateless on purpose: Playwright runs every spec file in the same worker
// (workers: 1), so module-level state here would leak between files. Each
// spec keeps its own `db` connection and seed data.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..");
export const require = createRequire(path.join(root, "package.json"));

// The runner and the specs must share one Playwright instance (run.sh sets it).
const playwrightTest = require(process.env.PLAYWRIGHT_TEST_MODULE ?? "playwright/test");
export const test = playwrightTest.test;
export const expect = playwrightTest.expect;

export const SHOTS = path.join(root, "docs", "screenshots");
export const FIXTURES = path.join(here, "fixtures");
export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1366, height: 900 } };

export function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(root, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL non trovato");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

/** Opens a pg client on the app's database (close it in afterAll). */
export async function connectDb() {
  const pg = require("pg");
  const db = new pg.Client({ connectionString: readDatabaseUrl() });
  await db.connect();
  return db;
}

/** Runs the (idempotent) seed and returns its SEED_JSON line. */
export function seed() {
  const out = execFileSync("npm", ["run", "--silent", "db:seed"], { cwd: root, encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("SEED_JSON "));
  if (!line) throw new Error(`Seed senza SEED_JSON:\n${out}`);
  return JSON.parse(line.slice("SEED_JSON ".length));
}

/** Local date (Europe/Rome) `days` from now, as the editors' date inputs want it. */
export function romeDate(days) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + days * 86_400_000));
}

/** Short unique suffix for titles, so reruns never collide. */
export function uniq() {
  return Date.now().toString(36);
}

/**
 * Full-length screenshot. The agency shell scrolls inside <main>, so a plain
 * fullPage shot would stop at the viewport: the viewport is stretched to the
 * tallest scrolling element first, then restored.
 */
export async function shot(page, name, { maxHeight = 3200 } = {}) {
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  const height = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll("main, main *")].map((el) => el.scrollHeight))
  );
  const stretch = original && height > original.height;
  if (stretch) await page.setViewportSize({ width: original.width, height: Math.min(height, maxHeight) });
  // Start from the top: a focused field may have scrolled <main>.
  await page.evaluate(() => {
    for (const el of [document.scrollingElement, ...document.querySelectorAll("main, main *")]) {
      if (el && el.scrollTop) el.scrollTop = 0;
    }
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  if (stretch) await page.setViewportSize(original);
}

/** Screenshot of what is on screen only (mobile sheets, highlights). */
export async function viewportShot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, name) });
}

export async function postRow(db, id) {
  const { rows } = await db.query(
    'select status, "currentVersionNumber", "metricoolPostId", "lastError" from "Post" where id = $1',
    [id]
  );
  return rows[0];
}

export async function waitForStatus(db, id, status, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    const row = await postRow(db, id);
    if (row?.status === status) return row;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Post ${id}: atteso ${status}, trovato ${row?.status} (${row?.lastError ?? "nessun errore"})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Browser context logged in as the seeded agency owner. */
export async function agencyContext(browser, data, { baseUrl = data.baseUrl, options = DESKTOP } = {}) {
  const context = await browser.newContext(options);
  await context.addCookies([{ name: "authjs.session-token", value: data.sessionToken, url: baseUrl }]);
  return context;
}

/** Submits an editor and returns the post id from the URL it lands on. */
export async function saveAndSubmit(page) {
  await page.getByRole("button", { name: /Salva e invia in revisione|Invia in revisione/ }).click();
  await page.waitForURL((url) => /^\/posts\/(?!new$)[a-z0-9]+$/.test(url.pathname), { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop();
}

/** The page fits the viewport width (no horizontal scroll). */
export async function expectNoHorizontalScroll(page, width = 390) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
}

/** Clicks a download link and returns { name, buffer }. */
export async function download(page, locator) {
  const [file] = await Promise.all([page.waitForEvent("download"), locator.click()]);
  const filePath = await file.path();
  return { name: file.suggestedFilename(), buffer: readFileSync(filePath) };
}
