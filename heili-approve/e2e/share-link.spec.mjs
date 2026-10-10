// The client's personal link as the first-class way to send work for review,
// against the running app. Run with: sh e2e/run.sh (see README).
//
// - a new client without reviewers: "Link per il cliente" asks "Chi approva
//   per …?", a name is enough (email optional), "Crea link" shows the link
//   at once with Copia link / Invia su WhatsApp (prefilled message) /
//   Apri anteprima; the link opens the client portal without login;
// - a client with a reviewer without email (seed: Paolo Fabbri of
//   "Agriturismo Le Querce"): "Nessuna email", no "Reinvia via email";
// - a post in review: "Condividi con il cliente" with a deep link per
//   reviewer straight to the item, which opens in the portal;
// - the clients list has "Copia link" per client with a reviewer;
// - mobile (390 px): no horizontal scroll.

import {
  DESKTOP,
  MOBILE,
  agencyContext,
  connectDb,
  expect,
  expectNoHorizontalScroll,
  seed,
  shot,
  test,
  uniq,
} from "./helpers.mjs";

let data;
let db;
const createdClients = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
});

test.afterAll(async () => {
  // Keep the demo lists tidy: archive the clients this spec created.
  if (createdClients.length > 0) {
    await db.query('update "Client" set "archivedAt" = now() where id = any($1)', [createdClients]);
  }
  await db?.end();
});

test("cliente senza referenti: «Crea link» con il solo nome, poi WhatsApp e portale", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: MOBILE });
  const page = await context.newPage();

  await page.goto("/clients/new");
  const clientName = `Forno Sette Spighe ${uniq()}`;
  await page.getByLabel("Nome del cliente").fill(clientName);
  await page.getByRole("button", { name: "Crea cliente" }).click();
  await page.waitForURL(/\/clients\/[a-z0-9]+\?nuovo=1$/);
  const clientId = new URL(page.url()).pathname.split("/").pop();
  createdClients.push(clientId);

  const panel = page.getByTestId("client-links-panel");
  await expect(panel.getByRole("heading", { name: "Link per il cliente" })).toBeVisible();
  const form = panel.getByTestId("quick-reviewer-form");
  await expect(form.getByText(`Chi approva per ${clientName}?`)).toBeVisible();
  await expect(form.getByText("Facoltativa: serve solo per le notifiche via email.")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "share-crea-link-mobile.png");

  // A name is enough.
  await form.getByTestId("quick-reviewer-name").fill("Sara Neri");
  await form.getByRole("button", { name: "Crea link" }).click();
  await expect(panel.getByText("Link creato per Sara Neri: copialo o mandalo su WhatsApp.")).toBeVisible();

  const row = panel.getByTestId("client-link-row").filter({ hasText: "Sara Neri" });
  await expect(row.getByText("Nessuna email")).toBeVisible();
  const url = await row.getByTestId("share-link-url").inputValue();
  expect(url).toMatch(/\/review\/[A-Za-z0-9_-]{32,}$/);

  // WhatsApp: prefilled greeting with the client's name and the link.
  const href = await row.getByTestId("share-whatsapp").getAttribute("href");
  expect(href.startsWith("https://wa.me/?text=")).toBe(true);
  const text = decodeURIComponent(href.slice("https://wa.me/?text=".length));
  expect(text).toBe(`Ciao Sara, ecco il link per rivedere e approvare i post di ${clientName}: ${url}`);
  await expect(row.getByTestId("share-preview")).toHaveAttribute("href", url);
  await expect(row.getByTestId("share-copy")).toHaveText("Copia link");

  // QR on request.
  await row.getByTestId("share-qr-toggle").click();
  await expect(row.getByTestId("share-qr")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "share-link-creato-mobile.png");

  // The reviewer row exists, without email.
  const { rows } = await db.query('select email, active from "ClientReviewer" where "clientId" = $1', [clientId]);
  expect(rows).toEqual([{ email: null, active: true }]);

  // In the management section: no "Reinvia via email" without an email.
  const referenti = page.locator("#referenti");
  await expect(referenti.getByText("Nessuna email: il link lo mandi tu")).toBeVisible();
  await expect(referenti.getByRole("button", { name: "Reinvia via email" })).toHaveCount(0);
  await context.close();

  // The link opens the client portal, no login.
  const client = await browser.newContext(MOBILE);
  const portal = await client.newPage();
  await portal.goto(url);
  await expect(portal.getByRole("banner").getByText(clientName)).toBeVisible();
  await client.close();
});

test("scheda cliente: link pronti per ogni referente, anche senza email", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: DESKTOP });
  const page = await context.newPage();
  await page.goto(`/clients/${data.multi.client.id}`);

  const panel = page.getByTestId("client-links-panel");
  const rows = panel.getByTestId("client-link-row");
  await expect(rows).toHaveCount(2);

  const chiara = rows.filter({ hasText: "Chiara Fabbri" });
  await expect(chiara.getByTestId("share-link-url")).toHaveValue(data.multi.client.reviewUrl);
  const paolo = rows.filter({ hasText: data.multi.linkOnlyReviewer.name });
  await expect(paolo.getByText("Nessuna email")).toBeVisible();
  await expect(paolo.getByTestId("share-link-url")).toHaveValue(data.multi.linkOnlyReviewer.reviewUrl);
  const text = decodeURIComponent(
    (await paolo.getByTestId("share-whatsapp").getAttribute("href")).slice("https://wa.me/?text=".length)
  );
  expect(text).toBe(
    `Ciao Paolo, ecco il link per rivedere e approvare i contenuti di ${data.multi.client.name}: ${data.multi.linkOnlyReviewer.reviewUrl}`
  );
  await shot(page, "share-scheda-cliente.png");

  // Add form: the email checkbox only works with an email.
  const form = page.getByTestId("add-reviewer-form");
  const invite = form.getByRole("checkbox", { name: "Invia il link via email" });
  await expect(invite).toBeDisabled();
  await form.getByLabel("Email del referente").fill("ospiti@agriturismolequerce.it");
  await expect(invite).toBeEnabled();
  await context.close();
});

test("post in revisione: il link diretto porta dritto al post", async ({ browser }) => {
  const post = data.multi.posts.find((p) => p.kind === "SOCIAL_POST");
  const context = await agencyContext(browser, data, { options: MOBILE });
  const page = await context.newPage();
  await page.goto(`/posts/${post.id}`);

  const panel = page.getByTestId("post-share-panel");
  await expect(panel.getByRole("heading", { name: "Link diretto per il cliente" })).toBeVisible();
  const row = panel.getByTestId("post-share-row");
  await expect(row).toContainText("Chiara Fabbri");
  const url = await row.getByTestId("share-link-url").inputValue();
  expect(url).toBe(`${data.multi.client.reviewUrl}/posts/${post.id}`);
  const text = decodeURIComponent(
    (await row.getByTestId("share-whatsapp").getAttribute("href")).slice("https://wa.me/?text=".length)
  );
  expect(text).toBe(`Ciao Chiara, c'è un nuovo post da approvare: «${post.title}». Lo trovi qui: ${url}`);
  await expectNoHorizontalScroll(page);
  await shot(page, "share-post-mobile.png");
  await context.close();

  const client = await browser.newContext(MOBILE);
  const portal = await client.newPage();
  await portal.goto(url);
  await expect(portal.getByText(post.title).first()).toBeVisible();
  await client.close();
});

test("bozza: il link compare dopo l'invio; elenco clienti con «Copia link»", async ({ browser }) => {
  const draft = data.posts.find((p) => p.status === "DRAFT");
  const context = await agencyContext(browser, data, { options: DESKTOP });
  const page = await context.newPage();
  await page.goto(`/posts/${draft.id}`);
  await expect(page.getByTestId("post-share-draft-hint")).toContainText("La bozza non è ancora visibile al cliente.");
  await expect(page.getByTestId("share-link-url")).toHaveCount(0);

  await page.goto("/clients");
  await expect(page.getByTestId("client-copy-link").first()).toBeVisible();
  await expect(page.getByTestId("client-copy-link").getByRole("button", { name: "Copia link" }).first()).toBeVisible();
  await context.close();
});
