// Variant gating: the same build started with APP_VARIANT=blog only shows
// articles. Starts a second server on E2E_BLOG_PORT (default 3101) against
// the same database, checks it, then stops it.
//
// - the menu has "Articoli" and no "Post" / "Creatività";
// - no Metricool anywhere (top bar, settings, client page);
// - ad sets do not exist for this instance (agency and client portal 404,
//   `?kind=ads` opens the article editor) and the service refuses to create
//   one (lib/posts createPost run with APP_VARIANT=blog).

import { execFileSync, spawn } from "node:child_process";
import {
  DESKTOP,
  agencyContext,
  expect,
  root,
  seed,
  test,
} from "./helpers.mjs";

const PORT = Number(process.env.E2E_BLOG_PORT ?? 3101);
const BASE = `http://localhost:${PORT}`;

let server;
let serverLog = "";
let data;

async function waitForHealth(timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) throw new Error(`Il server blog si è fermato:\n${serverLog}`);
    if (Date.now() - started > timeoutMs) throw new Error(`Il server blog non risponde su ${BASE}:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    cwd: root,
    env: { ...process.env, APP_VARIANT: "blog", METRICOOL_FAKE: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));
  await waitForHealth();
});

test.afterAll(async () => {
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

test("APP_VARIANT=blog: solo Articoli, niente Metricool, niente ads", async ({ browser }) => {
  const context = await agencyContext(browser, data, { baseUrl: BASE, options: { ...DESKTOP, baseURL: BASE } });
  const page = await context.newPage();

  await page.goto("/dashboard");
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Articoli" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Post", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Creatività" })).toHaveCount(0);
  await expect(page.getByText("Approve by Heili — Blog").first()).toBeVisible();
  await expect(page.getByText(/Metricool/)).toHaveCount(0);
  await expect(page).toHaveTitle(/Approve by Heili — Blog/);

  // Lists only show articles.
  await page.goto("/posts");
  await expect(page.getByText(data.blog.posts[0].title).first()).toBeVisible();
  await expect(page.getByText(data.ads.posts[0].title)).toHaveCount(0);
  await expect(page.getByText(data.posts[0].title)).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByText(/Metricool/)).toHaveCount(0);
  await page.goto(`/clients/${data.clients[0].id}`);
  await expect(page.getByText(/Metricool/)).toHaveCount(0);

  // No way to an ad set: ?kind=ads is the article editor, an existing set is not found.
  await page.goto(`/posts/new?kind=ads&clientId=${data.ads.client.id}`);
  await expect(page.getByLabel("Titolo dell'articolo")).toBeVisible();
  await expect(page.getByLabel("Nome della campagna")).toHaveCount(0);
  const agencyAd = await page.goto(`/posts/${data.ads.posts[0].id}`);
  expect(agencyAd.status()).toBe(404);
  await context.close();

  const client = await browser.newContext({ ...DESKTOP, baseURL: BASE });
  const portal = await client.newPage();
  const adsReviewUrl = data.ads.client.reviewUrl.replace(data.baseUrl, BASE);
  const portalAd = await portal.goto(`${adsReviewUrl}/posts/${data.ads.posts[0].id}`);
  expect(portalAd.status()).toBe(404);
  await client.close();
});

test("APP_VARIANT=blog: il servizio rifiuta di creare una creatività ads", async () => {
  // Same code path as the server action (createContentAction → createPost).
  const out = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-ad.ts", data.workspaceId, data.ads.client.id, data.userId],
    { cwd: root, env: { ...process.env, APP_VARIANT: "blog" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  expect(line).toBe("RESULT ValidationError: Le creatività ads non sono disponibili in Approve by Heili — Blog");
});
