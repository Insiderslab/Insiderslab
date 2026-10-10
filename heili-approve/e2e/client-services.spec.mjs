// Per-client services and the unified client portal (APP_VARIANT=all),
// against the running app. Run with: sh e2e/run.sh (see README).
//
// - the seeded client with all three services ("Agriturismo Le Querce") has
//   a portal with the tabs "Tutti · Post social · Articoli · Creatività" and
//   the number of items waiting in each; a tab filters the list; a client
//   with one service has no tabs;
// - the agency's client page has one overview per service with "Nuovo …";
// - "Nuovo contenuto" offers only the client's services (skips the choice
//   when there is one) and lists only the clients with the chosen service;
// - a new client created with only "Articoli" hides Metricool and gets only
//   that service;
// - the service refuses to create a kind that is not among the client's
//   services.

import { execFileSync } from "node:child_process";
import {
  DESKTOP,
  MOBILE,
  agencyContext,
  expect,
  expectNoHorizontalScroll,
  root,
  seed,
  shot,
  test,
  uniq,
} from "./helpers.mjs";

let data;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
});

function titleOf(kind) {
  return data.multi.posts.find((p) => p.kind === kind).title;
}

test("portale unificato: schede per tipo con i conteggi, filtro, mobile", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  await page.goto(data.multi.client.reviewUrl);

  // Header: the client's name and what they find here.
  const header = page.getByRole("banner");
  await expect(header.getByText(data.multi.client.name)).toBeVisible();
  await expect(header.getByText("I tuoi contenuti da approvare: post social, articoli e creatività ads")).toBeVisible();

  // Tabs, only the client's services, with the items waiting for them.
  const tabs = page.getByRole("navigation", { name: "Tipo di contenuto" });
  await expect(tabs.getByRole("link")).toHaveCount(4);
  await expect(tabs.getByRole("link", { name: "Tutti: 3 da approvare" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Post social: 1 da approvare" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Articoli: 1 da approvare" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Creatività ads: 1 da approvare" })).toBeVisible();

  // "Da approvare" first, every kind together.
  await expect(page.getByText("Ci sono 3 contenuti che aspettano la tua approvazione: 1 post social, 1 articolo e 1 set di creatività.")).toBeVisible();
  const toReview = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Da approvare/ }) });
  for (const kind of ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"]) {
    await expect(toReview.getByText(titleOf(kind))).toBeVisible();
  }
  await expectNoHorizontalScroll(page);
  await shot(page, "portale-unificato-mobile.png");

  // Filter: articles only.
  await tabs.getByRole("link", { name: "Articoli: 1 da approvare" }).click();
  await page.waitForURL(/\?tipo=blog$/);
  await expect(tabs.getByRole("link", { name: "Articoli: 1 da approvare" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(titleOf("BLOG_ARTICLE"))).toBeVisible();
  await expect(page.getByText(titleOf("SOCIAL_POST"))).toHaveCount(0);
  await expect(page.getByText(titleOf("AD_CREATIVE"))).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // Ads: the per-kind item page is the usual one.
  await tabs.getByRole("link", { name: "Creatività ads: 1 da approvare" }).click();
  await page.waitForURL(/\?tipo=ads$/);
  await expect(page.getByText(titleOf("SOCIAL_POST"))).toHaveCount(0);
  await page.getByText(titleOf("AD_CREATIVE")).click();
  await page.waitForURL(/\/posts\/[a-z0-9]+$/);
  await expect(page.getByRole("button", { name: /Approva variante/ }).first()).toBeVisible();

  // A client with a single service: no tabs.
  await page.goto(data.blog.client.reviewUrl);
  await expect(page.getByRole("banner").getByText("I tuoi articoli da approvare")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tipo di contenuto" })).toHaveCount(0);
  await context.close();
});

test("agenzia: scheda cliente con un riquadro per servizio", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: DESKTOP });
  const page = await context.newPage();
  await page.goto(`/clients/${data.multi.client.id}`);

  await expect(page.getByText("Servizi: post social, articoli e creatività ads")).toBeVisible();
  for (const [slug, label, newLabel] of [
    ["social", "Post social", "Nuovo post"],
    ["blog", "Articoli", "Nuovo articolo"],
    ["ads", "Creatività ads", "Nuova creatività ads"],
  ]) {
    const card = page.getByTestId(`service-${slug}`);
    await expect(card.getByRole("heading", { name: label })).toBeVisible();
    const pending = card.getByRole("link", { name: /Da approvare/ });
    await expect(pending).toContainText("1");
    await expect(pending).toHaveAttribute("href", `/posts?kind=${slug}&status=IN_REVIEW&clientId=${data.multi.client.id}`);
    await expect(card.getByRole("link", { name: newLabel })).toHaveAttribute(
      "href",
      `/posts/new?kind=${slug}&clientId=${data.multi.client.id}`
    );
  }
  // The edit form: the three services ticked, Metricool shown (social is one of them).
  for (const name of [/Post social/, /Articoli/, /Creatività/]) {
    await expect(page.getByRole("checkbox", { name })).toBeChecked();
  }
  await expect(page.getByLabel("Brand su Metricool")).toBeVisible();
  await shot(page, "agenzia-cliente-servizi.png");

  // The filtered list opens from the card.
  await page.getByTestId("service-blog").getByRole("link", { name: /Da approvare/ }).click();
  await page.waitForURL(/\/posts\?/);
  await expect(page.getByText(titleOf("BLOG_ARTICLE")).first()).toBeVisible();
  await expect(page.getByText(titleOf("SOCIAL_POST"))).toHaveCount(0);
  await context.close();
});

test("agenzia: nuovo contenuto offre solo i servizi del cliente", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: DESKTOP });
  const page = await context.newPage();

  // No kind, no client: the client first.
  await page.goto("/posts/new");
  await expect(page.getByRole("heading", { name: "Per quale cliente?" })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(data.multi.client.name) }).click();
  await expect(page.getByRole("heading", { name: `Cosa vuoi preparare per ${data.multi.client.name}?` })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Nuovo post/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Nuovo articolo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Nuova creatività/ })).toBeVisible();

  // One service: straight to its editor.
  await page.goto(`/posts/new?clientId=${data.blog.client.id}`);
  await expect(page.getByLabel("Titolo dell'articolo")).toBeVisible();
  await expect(page.locator("#content-client")).toHaveValue(data.blog.client.id);

  // A kind the client does not have: a notice, and the client is not offered.
  await page.goto(`/posts/new?kind=social&clientId=${data.blog.client.id}`);
  await expect(page.getByText(`Il servizio «Post social» non è attivo per ${data.blog.client.name}.`)).toBeVisible();
  await expect(page.locator("#post-client option", { hasText: data.blog.client.name })).toHaveCount(0);
  await expect(page.locator("#post-client option", { hasText: data.multi.client.name })).toHaveCount(1);
  await context.close();
});

test("agenzia: nuovo cliente con il solo servizio Articoli", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: DESKTOP });
  const page = await context.newPage();
  await page.goto("/clients/new");

  const social = page.getByRole("checkbox", { name: /Post social/ });
  await expect(social).toBeChecked();
  await expect(page.getByLabel("Brand su Metricool")).toBeVisible();
  // Metricool belongs to social posts only.
  await social.uncheck();
  await expect(page.getByLabel("Brand su Metricool")).toHaveCount(0);
  await expect(page.getByText("Reti social")).toHaveCount(0);

  // No service at all is refused.
  const name = `Libreria Pagine ${uniq()}`;
  await page.getByLabel("Nome del cliente").fill(name);
  await page.getByRole("button", { name: "Crea cliente" }).click();
  await expect(page.getByText("Scegli almeno un servizio per il cliente.")).toBeVisible();

  await page.getByRole("checkbox", { name: /Articoli/ }).check();
  await page.getByRole("button", { name: "Crea cliente" }).click();
  await page.waitForURL(/\/clients\/[a-z0-9]+\?nuovo=1$/);
  await expect(page.getByText("Servizi: articoli")).toBeVisible();
  await expect(page.getByTestId("service-blog")).toBeVisible();
  await expect(page.getByTestId("service-social")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Articoli/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Post social/ })).not.toBeChecked();
  const clientId = new URL(page.url()).pathname.split("/").pop();

  // Its only service: "Nuovo contenuto" goes straight to the article editor.
  await page.goto(`/posts/new?clientId=${clientId}`);
  await expect(page.getByLabel("Titolo dell'articolo")).toBeVisible();
  await context.close();
});

test("servizio: non si crea un tipo che il cliente non ha", async () => {
  const run = (clientId, kind) => {
    const out = execFileSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-content.ts", data.workspaceId, clientId, data.userId, kind],
      { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
    );
    return out.split("\n").find((l) => l.startsWith("RESULT "));
  };
  // Same code path as the agency's server actions (createPost).
  expect(run(data.blog.client.id, "SOCIAL_POST")).toBe(
    "RESULT ValidationError: Il servizio «Post social» non è attivo per questo cliente"
  );
  expect(run(data.ads.client.id, "BLOG_ARTICLE")).toBe(
    "RESULT ValidationError: Il servizio «Articoli» non è attivo per questo cliente"
  );
  expect(run(data.clients[0].id, "AD_CREATIVE")).toBe(
    "RESULT ValidationError: Il servizio «Creatività ads» non è attivo per questo cliente"
  );
});
