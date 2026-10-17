// «Come usare lo strumento», at 390 and 1366 px:
// 1. the agency's «Guida» page is reachable from the menu, every step links into
//    the app and the FAQ opens;
// 2. «Per iniziare» on the dashboard ticks its steps from the real data, can be
//    closed (remembered in this browser) and leaves by itself once complete;
// 3. the client's three-step intro appears once, on the first page a link opens,
//    without covering the decision bar or Heili's button.
//
// Data: a brand-new agency user (own workspace, session inserted here) for the
// checklist, and a fresh portal client (create-portal-fixture.ts) for the intro.
// Both are removed afterwards; nothing else in the seed is touched.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { DESKTOP, MOBILE, agencyContext, connectDb, expect, root, seed, test, uniq, viewportShot } from "./helpers.mjs";
import { smallControls } from "./support/touch.mjs";

let db;
let data;
const state = {};

test.describe.configure({ mode: "serial" });

const SIZES = [
  ["390", MOBILE],
  ["1366", DESKTOP],
];

const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Hydrated and idle: what appears after hydration has had its chance. */
async function settled(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

/**
 * No horizontal scroll. The agency shell scrolls inside <main> (overflow-x
 * hidden): there, wider content would be cut off, so <main> is checked too.
 */
async function noHorizontalScroll(page, { agencyMain = false } = {}) {
  const { doc, main, width } = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    main: Math.max(0, ...[...document.querySelectorAll("main.agency-main")].map((el) => el.scrollWidth - el.clientWidth)),
    width: window.innerWidth,
  }));
  expect(doc, "la pagina scorre in orizzontale").toBeLessThanOrEqual(width);
  if (agencyMain) expect(main, "il contenuto esce dalla pagina").toBe(0);
}

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();

  // A new agency: user, workspace, membership and a session cookie of its own.
  const id = uniq() + randomBytes(3).toString("hex");
  state.userId = `usr_e2e_guide_${id}`;
  state.workspaceId = `ws_e2e_guide_${id}`;
  state.sessionToken = `e2e-guide-${id}-${randomBytes(12).toString("hex")}`;
  await db.query(`insert into "User" (id, email, name, "updatedAt") values ($1, $2, 'E2E Guida', now())`, [
    state.userId,
    `e2e-guide-${id}@example.com`,
  ]);
  await db.query(`insert into "Workspace" (id, name, "ownerId", "updatedAt") values ($1, 'E2E agenzia nuova', $2, now())`, [
    state.workspaceId,
    state.userId,
  ]);
  await db.query(`insert into "WorkspaceMember" (id, "workspaceId", "userId", role) values ($1, $2, $3, 'OWNER')`, [
    `wm_e2e_guide_${id}`,
    state.workspaceId,
    state.userId,
  ]);
  await db.query(`insert into "Session" (id, "sessionToken", "userId", expires) values ($1, $2, $3, now() + interval '1 day')`, [
    `ses_e2e_guide_${id}`,
    state.sessionToken,
    state.userId,
  ]);

  const out = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-portal-fixture.ts", data.workspaceId, data.userId, uniq()],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  state.portal = JSON.parse(line.slice("RESULT ".length));
});

test.afterAll(async () => {
  if (state.portal?.clientId) await db?.query('update "Client" set "archivedAt" = now() where id = $1', [state.portal.clientId]);
  if (state.workspaceId) await db?.query('delete from "Workspace" where id = $1', [state.workspaceId]);
  if (state.userId) await db?.query('delete from "User" where id = $1', [state.userId]);
  await db?.end();
});

/** Logged in as the brand-new agency. */
async function newAgencyContext(browser, options) {
  const context = await browser.newContext({ ...options, locale: "it-IT" });
  await context.addCookies([{ name: "authjs.session-token", value: state.sessionToken, url: data.baseUrl }]);
  return context;
}

// ─── 1. «Guida» ──────────────────────────────────────────────────────────────

for (const [label, options] of SIZES) {
  test(`Guida: dal menu alla pagina, passi con i link e domande frequenti (${label} px)`, async ({ browser }) => {
    const context = await agencyContext(browser, data, { options });
    const page = await context.newPage();
    await page.goto(`${data.baseUrl}/dashboard`);

    if (options === MOBILE) await page.getByRole("button", { name: "Apri menu" }).click();
    const menu = page.getByRole("navigation", { name: "Menu principale" });
    await menu.getByRole("link", { name: "Guida", exact: true }).click();
    await page.waitForURL("**/guida");
    await expect(page.getByRole("heading", { level: 1, name: "Guida" })).toBeVisible();
    // The drawer closes on a phone: reopen it to see the entry marked as the current page.
    if (options === MOBILE) await page.getByRole("button", { name: "Apri menu" }).click();
    await expect(menu.getByRole("link", { name: "Guida", exact: true })).toHaveAttribute("aria-current", "page");
    if (options === MOBILE) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
    }

    // The path: «1. Aggiungi il cliente» … «6. Piano del mese», then «Collega la tua AI (MCP)».
    const titles = await page.locator('[data-testid^="guida-passo-"] h3').allInnerTexts();
    expect(titles.map((t) => t.replace(/\s+/g, " ").trim())).toEqual([
      "1. Aggiungi il cliente",
      "2. Crea o importa i post",
      "3. Invia in revisione e condividi il link",
      "4. Il cliente approva o chiede modifiche",
      "5. Programmazione su Metricool",
      "6. Piano del mese",
      "Collega la tua AI (MCP)",
    ]);
    for (const card of await page.locator('[data-testid^="guida-passo-"]').all()) {
      expect(await card.getByRole("link").count()).toBeGreaterThan(0);
    }

    // The FAQ answers in place.
    const faq = page.getByTestId("guida-faq-link");
    await faq.getByText("Il cliente non trova il link").click();
    await expect(faq.getByText(/«Nuovo link» ne crea uno nuovo/)).toBeVisible();
    await expect(page.getByTestId("guida-faq-errore")).toContainText("Ho sbagliato un post già approvato");
    await expect(page.getByTestId("guida-faq-cliente")).toContainText("Cosa vede il cliente");

    await noHorizontalScroll(page, { agencyMain: true });
    if (options === MOBILE) expect(await smallControls(page, "main")).toEqual([]);
    await viewportShot(page, `guida-${label}.png`);

    // A step's link opens the right page: MCP lands on its section in Impostazioni.
    await page.getByTestId("guida-passo-mcp").getByRole("link", { name: "Collega la tua AI" }).click();
    await page.waitForURL(/\/settings#mcp$/);
    await expect(page.getByTestId("mcp-settings")).toBeVisible();
    await context.close();
  });
}

// ─── 2. «Per iniziare» ───────────────────────────────────────────────────────

async function progressOf(page) {
  const steps = {};
  for (const id of ["client", "post", "submit", "approval"]) {
    steps[id] = await page.getByTestId(`getting-started-${id}`).getAttribute("data-done");
  }
  return steps;
}

test("Per iniziare: si spunta dai dati veri, si chiude e sparisce da sola (390 e 1366 px)", async ({ browser }) => {
  // Empty workspace: the list is the way in, with the client as the next step and no «Chiudi».
  const mobile = await newAgencyContext(browser, MOBILE);
  const phone = await mobile.newPage();
  await phone.goto(`${data.baseUrl}/dashboard`);
  const list = phone.getByTestId("getting-started");
  await expect(list).toBeVisible();
  await expect(phone.getByTestId("getting-started-progress")).toContainText("0 di 4 passi fatti");
  expect(await progressOf(phone)).toEqual({ client: "false", post: "false", submit: "false", approval: "false" });
  await expect(list.getByRole("button", { name: "Chiudi «Per iniziare»" })).toHaveCount(0);
  await noHorizontalScroll(phone, { agencyMain: true });
  expect(await smallControls(phone, '[data-testid="getting-started"]')).toEqual([]);
  await viewportShot(phone, "per-iniziare-vuoto-390.png");

  // Step 1 through the app: the next step's button opens the form.
  await list.getByRole("link", { name: "Aggiungi il cliente" }).click();
  await phone.waitForURL("**/clients/new");
  await phone.getByLabel("Nome del cliente").fill(`E2E Guida cliente ${uniq()}`);
  await phone.getByRole("button", { name: "Crea cliente" }).click();
  await phone.waitForURL(/\/clients\/[^/]+\?nuovo=1/);
  const clientId = new URL(phone.url()).pathname.split("/").pop();

  await phone.goto(`${data.baseUrl}/dashboard`);
  await expect(phone.getByTestId("getting-started-progress")).toContainText("1 di 4 passi fatti");
  expect(await progressOf(phone)).toEqual({ client: "true", post: "false", submit: "false", approval: "false" });
  await expect(phone.getByTestId("getting-started-post").getByRole("link", { name: "Importa da un foglio" })).toBeVisible();
  await mobile.close();

  // A draft, then the first send: the data moves the ticks.
  const postId = `po_e2e_guide_${uniq()}`;
  await db.query(
    `insert into "Post" (id, "workspaceId", "clientId", title, kind, status, "publishAt", networks, "networkOptions", "currentVersionNumber", "updatedAt")
     values ($1, $2, $3, 'E2E guida bozza', 'SOCIAL_POST', 'DRAFT', now() + interval '20 days', '{instagram}', '{}', 1, now())`,
    [postId, state.workspaceId, clientId]
  );
  const desktop = await newAgencyContext(browser, DESKTOP);
  const page = await desktop.newPage();
  await page.goto(`${data.baseUrl}/dashboard`);
  await expect(page.getByTestId("getting-started-progress")).toContainText("2 di 4 passi fatti");
  await expect(page.getByTestId("getting-started-submit").getByRole("link", { name: "Apri le bozze" })).toBeVisible();

  await db.query(`update "Post" set status = 'IN_REVIEW', "submittedAt" = now() where id = $1`, [postId]);
  await page.reload();
  await expect(page.getByTestId("getting-started-progress")).toContainText("3 di 4 passi fatti");
  expect(await progressOf(page)).toEqual({ client: "true", post: "true", submit: "true", approval: "false" });
  await viewportShot(page, "per-iniziare-1366.png");

  // «Chiudi» hides it and this browser remembers (no flash on reload).
  await page.getByRole("button", { name: "Chiudi «Per iniziare»" }).click();
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await page.reload();
  await settled(page);
  await expect(page.getByRole("heading", { name: "Da gestire" })).toBeVisible();
  await expect(page.getByTestId("getting-started")).toHaveCount(0);

  // Another browser (storage empty) still sees it…
  const other = await newAgencyContext(browser, DESKTOP);
  const otherPage = await other.newPage();
  await otherPage.goto(`${data.baseUrl}/dashboard`);
  await expect(otherPage.getByTestId("getting-started")).toBeVisible();

  // …until the first approval: then it leaves by itself, for everyone.
  await db.query(`update "Post" set status = 'APPROVED', "approvedAt" = now() where id = $1`, [postId]);
  await otherPage.reload();
  await expect(otherPage.getByRole("heading", { name: "Da gestire" })).toBeVisible();
  await expect(otherPage.getByTestId("getting-started")).toHaveCount(0);
  await other.close();
  await desktop.close();
});

// ─── 3. Client intro ─────────────────────────────────────────────────────────

for (const [label, options] of SIZES) {
  test(`Cliente: i tre passi compaiono una volta sola e non coprono barra né Heili (${label} px)`, async ({ browser }) => {
    const width = options.viewport.width;
    const postUrl = `${state.portal.reviewUrl}/posts/${state.portal.carouselId}`;

    // The link opens straight on a post: the intro is there, in the page.
    const context = await browser.newContext({ ...options, locale: "it-IT" });
    const page = await context.newPage();
    await page.goto(postUrl);
    const intro = page.getByTestId("portal-intro");
    await expect(intro).toBeVisible();
    await expect(intro.locator("li")).toHaveText([
      /Guarda i contenuti/,
      /Approva o scrivi cosa cambiare/,
      /Fatto, ci pensiamo noi/,
    ]);
    await expect(page.getByTestId("decision-approve")).toBeVisible();
    await expect(page.getByTestId("heili-dock-button")).toBeVisible();
    await noHorizontalScroll(page);
    expect(await smallControls(page, '[data-testid="portal-intro"]')).toEqual([]);
    await viewportShot(page, `intro-cliente-${label}.png`);

    // In the flow (never fixed), so never on the bar or on Heili's button. K-10: it sits under
    // the preview, so it is checked where the client reads it, at the top and in the middle of the window.
    expect(await intro.evaluate((el) => getComputedStyle(el).position)).toBe("static");
    // The content comes first: the preview starts above the intro.
    const preview = await page.getByRole("region", { name: "Anteprima del post" }).boundingBox();
    expect(preview.y).toBeLessThan((await intro.boundingBox()).y);
    for (const block of ["start", "center"]) {
      await intro.evaluate((el, b) => el.scrollIntoView({ block: b }), block);
      await page.waitForTimeout(200);
      const box = await intro.boundingBox();
      if (!box || box.y + box.height <= 0) continue;
      for (const other of [page.locator(".sticky.bottom-0").last(), page.getByTestId("heili-dock-button")]) {
        const otherBox = await other.boundingBox();
        expect(overlap(box, otherBox), `${label}px, ${block}: l'introduzione copre ${await other.getAttribute("data-testid") ?? "la barra"}`).toBe(false);
      }
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    // «Ho capito» closes it; a reload and the home do not bring it back.
    await intro.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await intro.getByRole("button", { name: "Ho capito" }).click();
    await expect(intro).toHaveCount(0);
    await page.reload();
    await settled(page);
    await expect(page.getByTestId("decision-approve")).toBeVisible();
    await expect(page.getByTestId("portal-intro")).toHaveCount(0);
    await page.goto(state.portal.reviewUrl);
    await settled(page);
    await expect(page.getByTestId("home-howto")).toBeVisible();
    await expect(page.getByRole("list", { name: "Come funziona" })).toHaveCount(0);
    await context.close();

    // A client who starts from the home reads the same three steps there, and only there.
    const fresh = await browser.newContext({ ...options, locale: "it-IT" });
    const home = await fresh.newPage();
    await home.goto(state.portal.reviewUrl);
    const steps = home.getByRole("list", { name: "Come funziona" });
    await expect(steps).toBeVisible();
    await expect(steps).toContainText("Fatto, ci pensiamo noi");
    await home.goto(postUrl);
    await settled(home);
    await expect(home.getByTestId("decision-approve")).toBeVisible();
    await expect(home.getByTestId("portal-intro")).toHaveCount(0);
    await fresh.close();
  });
}
