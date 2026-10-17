// End-to-end test of a website reviewed «Sul sito» (docs/SITO-WEB.md, Fase 2),
// against the running app (APP_VARIANT=all, WEBSITE_FETCH_ALLOW_LOCAL=1 so
// «Verifica installazione» may reach the local test site).
//
// A static site (e2e/support/static-site.mjs, port E2E_SITE_PORT = 4180)
// carries the review tag. The agency creates the «Sito web», registers the
// origin and verifies the installation; the client opens the portal, «Apri il
// sito» opens the real site with a one-time code (the fragment disappears),
// points at the <h1> and comments it, then at a password field (the field
// becomes its container); no request ever carries the field values
// (SEGRETO-123). The client asks for changes from the portal; the agency uses
// «Apri nel punto» (read-only, element found by its selector); the client
// approves; «Segna come pubblicato» revokes the key.
// Negatives: without the fragment the script is inert (no iframe, no request
// beyond the script itself); a used code shows nothing; an unregistered origin
// is never answered; at 390 px the sheet and the picking bar fit.

import { execFileSync } from "node:child_process";
import { DESKTOP, MOBILE, agencyContext, connectDb, expect, root, seed, test, uniq } from "./helpers.mjs";
import { SITE_PORT, startStaticSite } from "./support/static-site.mjs";

const SECRET = "SEGRETO-123";
const OTHER_PORT = Number(process.env.E2E_OTHER_SITE_PORT ?? 3304);

let db;
let data;
let site;
let otherSite;
const state = {};

test.describe.configure({ mode: "serial" });

function fixture(...args) {
  const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-website-fixture.ts", ...args], {
    cwd: root,
    env: { ...process.env, APP_VARIANT: "all" },
    encoding: "utf8",
  });
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  return JSON.parse(line.slice("RESULT ".length));
}

/** The iframe of the review script (inside a closed shadow root: reached through page.frames()), once connected. */
async function heiliFrame(page, { connected = true } = {}) {
  await expect.poll(() => page.frames().some((f) => f.url().includes("/embed/site")), { timeout: 20_000 }).toBe(true);
  const frame = page.frames().find((f) => f.url().includes("/embed/site"));
  if (connected) await expect(frame.getByRole("button", { name: "Apri Heili" })).toBeVisible({ timeout: 20_000 });
  return frame;
}

async function hostState(page) {
  return page.evaluate(() => document.querySelector("heili-review-root")?.getAttribute("data-heili-state") ?? null);
}

/** Every request of a context, with its body, to check nothing secret leaves the browser. */
function recordRequests(context) {
  const seen = [];
  context.on("request", (request) => seen.push({ url: request.url(), body: request.postData() ?? "" }));
  return seen;
}

test.beforeAll(async ({ baseURL }) => {
  data = seed();
  db = await connectDb();
  state.fixture = fixture("client", data.workspaceId, uniq());
  site = await startStaticSite({ port: SITE_PORT, approveBase: baseURL });
  otherSite = await startStaticSite({ port: OTHER_PORT, approveBase: baseURL });
});

test.afterAll(async () => {
  await site?.stop();
  await otherSite?.stop();
  await db?.end();
});

test("agenzia: crea il «Sito web», installa la riga e la verifica", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/new?kind=web&clientId=${state.fixture.clientId}`);
  await page.getByLabel("Titolo (visibile al cliente)").fill(`Nuovo sito ${uniq()}`);
  await page.getByTestId("website-site-url").fill(`${site.origin}/`);
  await page.getByTestId("website-site-url").blur();
  await page.getByRole("button", { name: "Aggiungi pagina" }).click();
  await page.getByLabel("Nome della pagina 2").fill("Chi siamo");
  await page.getByLabel("Indirizzo della pagina 2").fill("/chi-siamo.html");
  await page.getByLabel("Indirizzo della pagina 2").blur();
  await page.getByRole("button", { name: "Aggiungi pagina" }).click();
  await page.getByLabel("Nome della pagina 3").fill("Contatti");
  await page.getByLabel("Indirizzo della pagina 3").fill("/contatti.html");
  await page.getByLabel("Indirizzo della pagina 3").blur();
  await page.getByRole("button", { name: "Salva bozza" }).click();
  await page.waitForURL(/\/posts\/[a-z0-9]+\?tab=modifica/);
  state.postId = new URL(page.url()).pathname.split("/").pop();

  // «Sul sito»: the line with the key, the origin already allowed (localhost).
  const panel = page.getByTestId("site-panel");
  await expect(panel).toBeVisible();
  const snippet = await page.getByTestId("site-snippet").inputValue();
  const key = /data-site="(hs_[A-Za-z0-9_-]+)"/.exec(snippet)?.[1];
  expect(key).toBeTruthy();
  expect(snippet).toContain("/heili-review.js");
  state.siteKey = key;
  await expect(page.getByTestId("site-origins")).toContainText(site.origin);

  // «Dove la metto?»: a tab per platform, three steps each; WordPress has the plugin and the key to copy.
  await expect(page.getByTestId("site-next-step")).toContainText("Passo 1: installa la riga");
  await expect(page.getByTestId("site-step")).toHaveCount(3);
  await expect(page.getByTestId("site-copy-line")).toBeVisible();
  await page.getByTestId("site-platform-wordpress").click();
  await expect(page.getByTestId("site-step")).toHaveCount(3);
  await expect(page.getByTestId("site-plugin-download")).toHaveAttribute("href", "/wordpress/heili-approve-review.zip");
  expect(await page.getByTestId("site-key").inputValue()).toBe(key);
  await page.getByTestId("site-platform-gtm").click();
  await expect(page.getByTestId("site-step")).toHaveCount(3);
  await expect(page.getByText(/non vede i tag di Tag Manager/)).toBeVisible();
  await page.getByTestId("site-platform-html").click();

  // The tag still has no key → not verified, with what to do; with the key → «Script trovato sul sito».
  await page.getByTestId("site-verify").click();
  await expect(page.getByTestId("site-verify-message")).toContainText("senza chiave");
  await expect(page.getByTestId("site-verify-hints")).toContainText("Copia di nuovo la riga");
  site.setKey(key);
  otherSite.setKey(key);
  await page.getByTestId("site-verify").click();
  await expect(page.getByTestId("site-verify-message")).toHaveText("Script trovato sul sito");

  // An http:// address that is not local needs the test-site mark (the list of addresses is folded away once the site's own is allowed).
  await page.getByText(/^Indirizzi consentiti \(/).click();
  await page.getByTestId("site-origin-input").fill("http://prova.esempio.it");
  await page.getByTestId("site-origin-add").click();
  await expect(page.getByText(/solo per i siti di prova/)).toBeVisible();
  await page.getByTestId("site-origin-input").fill("");

  await page.getByRole("button", { name: "Invia in revisione" }).first().click();
  await page.getByRole("button", { name: "Invia al cliente" }).click();
  await expect.poll(async () => (await db.query('select status from "Post" where id=$1', [state.postId])).rows[0].status).toBe("IN_REVIEW");
  await context.close();
});

test("senza frammento lo script è inerte: niente iframe, nessuna richiesta oltre al file", async ({ browser }) => {
  const context = await browser.newContext(DESKTOP);
  const requests = recordRequests(context);
  const page = await context.newPage();
  await page.goto(`${site.origin}/`);
  await page.waitForLoadState("networkidle");
  expect(await page.locator("heili-review-root").count()).toBe(0);
  expect(page.frames()).toHaveLength(1);
  const external = requests.filter((r) => !r.url.startsWith(site.origin));
  expect(external.map((r) => new URL(r.url).pathname)).toEqual(["/heili-review.js"]);
  await context.close();
});

test("cliente: «Apri il sito», indica il titolo e un campo, nessun valore esce", async ({ browser }) => {
  const context = await browser.newContext(DESKTOP);
  const requests = recordRequests(context);
  const portal = await context.newPage();
  await portal.goto(`${state.fixture.reviewUrl}/posts/${state.postId}`);
  await expect(portal.getByTestId("website-notes-title")).toHaveText("Le tue note (0)");

  const [sitePage] = await Promise.all([context.waitForEvent("page"), portal.getByTestId("website-open").click()]);
  await sitePage.waitForURL((url) => url.origin === site.origin);
  await expect.poll(() => hostState(sitePage)).toBe("closed");
  // The one-time code left the address at once.
  expect(new URL(sitePage.url()).hash).toBe("");

  const frame = await heiliFrame(sitePage);
  await frame.getByTestId("embed-launcher").click();
  await expect.poll(() => hostState(sitePage)).toBe("panel");
  await frame.getByTestId("embed-pick").click();
  await expect.poll(() => hostState(sitePage)).toBe("picking");
  await sitePage.locator("h1").click();
  await expect(frame.getByTestId("embed-picked")).toContainText("Scopri la collezione");
  await frame.locator("#embed-note").fill("Il titolo è troppo piccolo su questa foto");
  await frame.getByTestId("embed-send").click();
  await expect(frame.getByText(/Nota salvata/)).toBeVisible();
  await expect(frame.getByTestId("embed-note")).toHaveCount(1);

  // Another page of the same tab: the review stays on (tab flag), the session lives in the iframe.
  await sitePage.goto(`${site.origin}/contatti.html`);
  const frame2 = await heiliFrame(sitePage);
  await frame2.getByTestId("embed-launcher").click();
  await frame2.getByTestId("embed-pick").click();
  await sitePage.locator('input[type="password"]').click();
  await expect(frame2.getByText(/Questo campo non si può commentare/)).toBeVisible();
  await frame2.locator("#embed-note").fill("Questo modulo è confuso");
  await frame2.getByTestId("embed-send").click();
  await expect(frame2.getByText(/Nota salvata/)).toBeVisible();

  // Esc closes the open panel and the focus goes back to Heili's button.
  await frame2.locator("#embed-note").focus();
  await sitePage.keyboard.press("Escape");
  await expect.poll(() => hostState(sitePage)).toBe("closed");
  await expect(frame2.getByTestId("embed-launcher")).toBeFocused();

  const { rows } = await db.query('select anchor, body from "PostComment" where "postId"=$1 order by "createdAt"', [state.postId]);
  expect(rows).toHaveLength(2);
  expect(rows[0].anchor).toMatchObject({ textSnippet: "Scopri la collezione", tag: "h1", device: "desktop", viewport: { w: 1366 } });
  expect(rows[0].anchor.selector).toContain("h1");
  expect(rows[0].anchor.pageUrl).toBe(`${site.origin}/`);
  expect(rows[1].anchor.tag).toBe("label");
  expect(JSON.stringify(rows)).not.toContain(SECRET);
  for (const request of requests) {
    expect(`${request.url} ${request.body}`).not.toContain(SECRET);
  }

  // Back to the portal: «Le tue note (2)», and the decision is taken here.
  await portal.reload();
  await expect(portal.getByTestId("website-notes-title")).toHaveText("Le tue note (2)");
  await expect(portal.getByTestId("website-note").first()).toContainText("Home · Computer · «Scopri la collezione»");
  await portal.getByTestId("decision-changes").click();
  await expect(portal.getByText("Modifiche inviate all'agenzia.")).toBeVisible();
  await context.close();
});

test("un codice già usato non apre nulla; un'origine non registrata non riceve risposta", async ({ browser }) => {
  const { code } = fixture("launch", state.postId, state.fixture.reviewerId);
  // CHANGES_REQUESTED still accepts comments: the code is valid once.
  const context = await browser.newContext(DESKTOP);
  const requests = recordRequests(context);
  const page = await context.newPage();
  await page.goto(`${otherSite.origin}/#heili-review=${code}`);
  await page.waitForTimeout(2500);
  expect(requests.some((r) => r.url.includes("/api/site/v1/exchange"))).toBe(false);
  const unused = await db.query('select count(*)::int as n from "WebsiteSession" where "launchUsedAt" is null and "postId"=$1', [state.postId]);
  expect(unused.rows[0].n).toBeGreaterThan(0);
  await context.close();

  // The same code on the registered site works once …
  const first = await browser.newContext(DESKTOP);
  const firstPage = await first.newPage();
  await firstPage.goto(`${site.origin}/#heili-review=${code}`);
  const frame = await heiliFrame(firstPage);
  await frame.getByTestId("embed-launcher").click();
  await expect(frame.getByTestId("embed-pick")).toBeVisible();
  await first.close();
  // … and never again: the iframe ends the review and the script removes itself.
  const second = await browser.newContext(DESKTOP);
  const secondPage = await second.newPage();
  await secondPage.goto(`${site.origin}/#heili-review=${code}`);
  await expect.poll(() => secondPage.locator("heili-review-root").count(), { timeout: 20_000 }).toBe(0);
  expect(await secondPage.evaluate(() => sessionStorage.getItem("heili-review"))).toBeNull();
  await second.close();
});

test("se il collegamento cade, Heili dice cosa non va e «Riprova» lo riapre", async ({ browser }) => {
  const { code } = fixture("launch", state.postId, state.fixture.reviewerId);
  const context = await browser.newContext(DESKTOP);
  // The exchange of the code fails (network): the server never sees the code, so it is still valid.
  await context.route("**/api/site/v1/exchange", (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${site.origin}/#heili-review=${code}`);
  const frame = await heiliFrame(page, { connected: false });
  await expect(frame.getByTestId("embed-launcher")).toHaveAttribute("data-phase", "error", { timeout: 20_000 });
  // A tap is never a dead button: the message opens, with «Riprova».
  await frame.getByTestId("embed-launcher").click();
  await expect(frame.getByText(/Non riesco a collegarmi ad Approve/)).toBeVisible();
  await expect(frame.getByTestId("embed-retry")).toBeVisible();
  await context.unroute("**/api/site/v1/exchange");
  await frame.getByTestId("embed-retry").click();
  await expect(frame.getByTestId("embed-pick")).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test("telefono 390, agenzia: riquadro «Sul sito» senza scorrimento orizzontale e con aree da 44 px", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: MOBILE });
  const page = await context.newPage();
  await page.goto(`/posts/${state.postId}?tab=modifica`);
  await expect(page.getByTestId("site-panel")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const id of ["site-platform-html", "site-platform-wordpress", "site-platform-webflow", "site-platform-shopify", "site-platform-gtm", "site-verify", "site-revoke"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height, id).toBeGreaterThanOrEqual(43.5);
  }
  // Every tab keeps the page inside 390 px.
  for (const id of ["wordpress", "webflow", "shopify", "gtm"]) {
    await page.getByTestId(`site-platform-${id}`).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), id).toBeLessThanOrEqual(390);
  }
  // Revoking asks inline, and «No» leaves the key as it is.
  await page.getByTestId("site-revoke").click();
  await expect(page.getByRole("alertdialog")).toContainText("Revocare la chiave?");
  await page.getByRole("button", { name: "No, lasciala com'è" }).click();
  await expect(page.getByTestId("site-revoke")).toBeVisible();
  await context.close();
});

test("agenzia: «Apri nel punto» trova l'elemento (sola lettura)", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/${state.postId}?tab=revisione`);
  await expect(page.getByTestId("site-anchor-chip").first()).toContainText("Home · Computer · «Scopri la collezione»");
  const [sitePage] = await Promise.all([context.waitForEvent("page"), page.getByTestId("open-on-site").first().click()]);
  await sitePage.waitForURL((url) => url.origin === site.origin);
  await expect.poll(() => hostState(sitePage), { timeout: 20_000 }).toBe("focus:selector");
  const frame = await heiliFrame(sitePage, { connected: false });
  await expect(frame.getByTestId("embed-focus")).toContainText("Il titolo è troppo piccolo");
  await expect(frame.getByText("Vista dell'agenzia: sola lettura.")).toBeVisible();
  await expect(frame.getByTestId("embed-pick")).toHaveCount(0);
  await context.close();
});

test("telefono 390: foglio e barra «Tocca l'elemento» senza scorrimento orizzontale; il cliente approva", async ({ browser }) => {
  // A new round so the client can act again.
  const agency = await agencyContext(browser, data);
  const editor = await agency.newPage();
  await editor.goto(`/posts/${state.postId}?tab=modifica`);
  await editor.getByRole("button", { name: "Nuovo giro" }).click();
  await editor.getByRole("button", { name: "Salva e invia in revisione" }).click();
  await expect.poll(async () => (await db.query('select status, "currentVersionNumber" as v from "Post" where id=$1', [state.postId])).rows[0]).toEqual({
    status: "IN_REVIEW",
    v: 2,
  });
  await agency.close();

  const context = await browser.newContext(MOBILE);
  const portal = await context.newPage();
  await portal.goto(`${state.fixture.reviewUrl}/posts/${state.postId}`);
  const [sitePage] = await Promise.all([context.waitForEvent("page"), portal.getByTestId("website-open").click()]);
  await sitePage.waitForURL((url) => url.origin === site.origin);
  const frame = await heiliFrame(sitePage);
  await frame.getByTestId("embed-launcher").click();
  await expect.poll(() => hostState(sitePage)).toBe("sheet");
  for (const id of ["embed-pick", "embed-send"]) {
    expect((await frame.getByTestId(id).boundingBox())?.height, id).toBeGreaterThanOrEqual(43.5);
  }
  await frame.getByTestId("embed-pick").click();
  await expect.poll(() => hostState(sitePage)).toBe("picking");
  const width = await sitePage.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await sitePage.keyboard.press("Escape");
  await expect.poll(() => hostState(sitePage)).toBe("sheet");

  await portal.getByTestId("decision-approve").click();
  await portal.getByRole("button", { name: "Sì, approva" }).click();
  await expect(portal.getByText("Fatto! Sito approvato.")).toBeVisible();
  await context.close();
});

test("«Segna come pubblicato» revoca la chiave e ricorda di togliere la riga", async ({ browser }) => {
  await expect.poll(async () => (await db.query('select status from "Post" where id=$1', [state.postId])).rows[0].status, { timeout: 30_000 }).toBe(
    "APPROVED"
  );
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/${state.postId}`);
  await page.getByRole("button", { name: "Segna come pubblicato" }).click();
  await page.getByRole("button", { name: "Sì, segna come pubblicato" }).click();
  await expect(page.getByTestId("site-status")).toHaveText("Chiave revocata");
  await expect(page.getByText(/togliere la riga di codice di Heili/).first()).toBeVisible();
  const { rows } = await db.query('select "revokedAt" from "WebsiteSite" where "siteKey"=$1', [state.siteKey]);
  expect(rows[0].revokedAt).not.toBeNull();
  // The script on the site no longer finds an active key.
  const response = await page.request.get(`/api/site/v1/site?key=${state.siteKey}`);
  expect(response.status()).toBe(404);
  await context.close();
});
