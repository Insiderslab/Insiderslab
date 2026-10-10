// Connecting Metricool and importing the clients from its brands (METRICOOL_FAKE=1),
// against the running app. Run with: sh e2e/run.sh (see README).
//
// - Settings: guided connection (token, then user ID), "Collega e verifica",
//   "Collegato: 10 brand trovati" with the first logos and the way on;
// - the import page lists the 10 fake brands; the one whose name matches an
//   existing client ("Pharmera" ↔ "PHARMERA  ") is preselected as a link;
// - one click imports the rest; running it again shows everything as
//   "Già collegato" (nothing is duplicated);
// - the client form picks a brand from what is typed and has a searchable list.
//
// The fake brands are the only ones with a "fake-" id: they (and the client made
// here) are removed before and after, so the other specs' clients are untouched.

import { MOBILE, agencyContext, connectDb, expect, expectNoHorizontalScroll, seed, shot, test } from "./helpers.mjs";

let data;
let db;

test.describe.configure({ mode: "serial" });

async function cleanup() {
  await db.query(`delete from "Client" where "metricoolBlogId" like 'fake-%' or name = 'PHARMERA  '`);
}

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
  await db.end();
});

test("impostazioni: collegamento guidato, brand trovati e invito a importare", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/settings");

  // Already connected by the seed: replace the credentials.
  await page.getByRole("button", { name: "Sostituisci credenziali" }).click();

  // The guide, then token first and user ID second.
  const guide = page.getByRole("list", { name: "Come collegare Metricool" });
  await expect(guide.getByText("Apri Metricool")).toBeVisible();
  await expect(guide.getByRole("link", { name: "app.metricool.com" })).toHaveAttribute("href", "https://app.metricool.com/");
  await expect(guide.getByText("Si trovano nella stessa pagina")).toBeVisible();
  await expect(page.getByLabel("Token API")).toBeVisible();
  await expect(page.getByLabel("ID utente")).toBeVisible();
  expect(await page.locator("#metricool-token").evaluate((el) => el.compareDocumentPosition(document.querySelector("#metricool-user")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await shot(page, "agenzia-collega-metricool.png");

  // The user ID is a number.
  const button = page.getByRole("button", { name: "Collega e verifica" });
  await expect(button).toBeDisabled();
  await page.getByLabel("Token API").fill("token-di-prova-12345678");
  await page.getByLabel("ID utente").fill("12ab");
  await page.getByLabel("ID utente").blur();
  await expect(page.getByText("L'ID utente è un numero, per esempio 1234567.")).toBeVisible();
  await button.click();
  await expect(page.getByTestId("metricool-found")).toHaveCount(0);

  // A pasted address is reduced to the number.
  await page.getByLabel("ID utente").fill("https://app.metricool.com/evolution/web?userId=1234567&blogId=1");
  await button.click();
  const found = page.getByTestId("metricool-found");
  await expect(found.getByText("Collegato: 10 brand trovati")).toBeVisible();
  await expect(found.getByRole("list", { name: "Primi brand trovati" }).getByRole("listitem")).toHaveCount(9);
  await expect(page.getByText("ID utente 1234567")).toBeVisible();
  // The token never comes back, only its last four characters.
  await expect(page.getByText("••••5678")).toBeVisible();
  expect(await page.content()).not.toContain("token-di-prova-12345678");
  await shot(page, "agenzia-metricool-collegato.png");

  await page.getByRole("link", { name: "Importa i clienti da Metricool" }).click();
  await page.waitForURL(/\/clients\/import$/);
  await context.close();
});

test("importa: abbinamento per nome, un clic per il resto, seconda volta tutto già collegato", async ({ browser }) => {
  // An existing client with the brand's name (other case, other spaces).
  await db.query(
    `insert into "Client" (id, "workspaceId", name, timezone, networks, "autoSchedule", services, "updatedAt")
     values ('cl_e2e_pharmera', $1, 'PHARMERA  ', 'Europe/Rome', '{}', true, '{SOCIAL_POST}', now())`,
    [data.workspaceId]
  );

  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Importa da Metricool" })).toBeVisible();
  await page.getByRole("link", { name: "Importa da Metricool" }).click();
  await page.waitForURL(/\/clients\/import$/);

  const rows = page.getByTestId("import-row");
  await expect(rows).toHaveCount(10);
  await expect(page.getByText("10 brand su Metricool")).toBeVisible();

  // Brand without label, logo, networks in words, time zone.
  await expect(rows.filter({ hasText: "Brand fake-1005" })).toHaveCount(1);
  const osteria = rows.filter({ hasText: "Osteria del Borgo" });
  await expect(osteria.getByRole("listitem").filter({ hasText: /^(Instagram|Facebook|TikTok)$/ })).toHaveCount(3);
  await expect(osteria.getByText("Fuso orario Europe/Rome")).toBeVisible();
  await expect(osteria.getByRole("img")).toHaveCount(0); // decorative logo: no alt text
  await expect(osteria.locator("img")).toHaveAttribute("src", /\/fake-brands\/brand-2\.svg$/);
  await expect(osteria.getByRole("radio", { name: "Crea nuovo cliente" })).toBeChecked();

  // Name match: linked to the existing client, not created.
  const pharmera = rows.filter({ hasText: "Pharmera" });
  await expect(pharmera.getByRole("radio", { name: "Collega a cliente esistente" })).toBeChecked();
  await expect(pharmera.getByLabel("Cliente da collegare a Pharmera")).toHaveValue("cl_e2e_pharmera");
  await expect(pharmera.getByText("collegamento suggerito")).toBeVisible();

  // Search, select none / all, ignore one.
  await page.getByLabel("Cerca un brand").fill("tiktok");
  await expect(rows).toHaveCount(3); // Gelateria Nuvola, Officina Verde, Osteria del Borgo (not the TikTok *ads* brand)
  await page.getByLabel("Cerca un brand").fill("");
  await expect(rows).toHaveCount(10);
  await page.getByRole("button", { name: "Seleziona nessuno" }).click();
  await expect(page.getByRole("button", { name: "Importa clienti" })).toBeDisabled();
  await page.getByRole("button", { name: "Seleziona tutti" }).click();
  await expect(page.getByRole("button", { name: "Importa 10 clienti" })).toBeEnabled();
  await expect(pharmera.getByRole("radio", { name: "Collega a cliente esistente" })).toBeChecked();
  const tech = rows.filter({ hasText: "Tech4Kids Academy" });
  await tech.getByText("Ignora", { exact: true }).click();
  await expect(tech.getByRole("radio", { name: "Ignora" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Importa 9 clienti" })).toBeEnabled();

  await shot(page, "agenzia-importa-metricool.png");
  await page.getByRole("button", { name: "Importa 9 clienti" }).click();

  const result = page.getByTestId("import-result");
  await expect(result.getByTestId("import-headline")).toHaveText("8 clienti creati, 1 collegato");
  await expect(result.getByText("Ora crea il link per chi approva")).toBeVisible();
  await expect(result.getByRole("link", { name: "Crea il link" })).toHaveCount(9);
  await shot(page, "agenzia-importa-metricool-risultato.png");

  const { rows: dbRows } = await db.query(
    `select name, "metricoolBlogId", "logoUrl", timezone, networks, "autoSchedule", services::text[] as services from "Client"
     where "workspaceId" = $1 and "metricoolBlogId" like 'fake-%' order by "metricoolBlogId"`,
    [data.workspaceId]
  );
  expect(dbRows).toHaveLength(9);
  const linked = dbRows.find((r) => r.metricoolBlogId === "fake-1001");
  expect(linked.name).toBe("PHARMERA  "); // the client keeps its own name
  expect(linked.logoUrl).toMatch(/brand-1\.svg$/);
  expect(linked.networks).toEqual(["instagram", "facebook", "linkedin"]);
  const created = dbRows.find((r) => r.metricoolBlogId === "fake-1004");
  expect(created).toMatchObject({ name: "Casa Mediterranea", timezone: "Europe/Madrid", autoSchedule: true, services: ["SOCIAL_POST"] });
  expect(dbRows.find((r) => r.metricoolBlogId === "fake-1005").name).toBe("Brand fake-1005");
  expect(dbRows.find((r) => r.metricoolBlogId === "fake-1008")).toBeUndefined(); // ignored

  // Second visit: all but the ignored brand are linked.
  await page.goto("/clients/import");
  await expect(rows).toHaveCount(10);
  await expect(page.getByText("9 già collegati")).toBeVisible();
  await expect(page.getByText("Già collegato", { exact: true })).toHaveCount(9);
  await expect(rows.filter({ hasText: "Casa Mediterranea" }).getByRole("link", { name: "Casa Mediterranea" })).toBeVisible();
  await expect(rows.filter({ hasText: "Casa Mediterranea" }).getByRole("radio")).toHaveCount(0);
  await shot(page, "agenzia-importa-metricool-rifatto.png");

  // Import the last one: now nothing is left to import, and nothing is duplicated.
  await page.getByRole("button", { name: "Importa 1 cliente" }).click();
  await expect(page.getByTestId("import-headline")).toHaveText("1 cliente creato");
  await page.goto("/clients/import");
  await expect(page.getByText("Già collegato", { exact: true })).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Importa clienti" })).toBeDisabled();
  const count = await db.query(`select count(*)::int as n from "Client" where "workspaceId" = $1 and "metricoolBlogId" like 'fake-%'`, [data.workspaceId]);
  expect(count.rows[0].n).toBe(10);

  // The Clienti list shows the new clients.
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Casa Mediterranea", exact: true })).toBeVisible();
  await context.close();
});

test("importa: da telefono, senza scorrimento orizzontale", async ({ browser }) => {
  await cleanup();
  const context = await agencyContext(browser, data, { options: MOBILE });
  const page = await context.newPage();
  await page.goto("/clients/import");
  await expect(page.getByTestId("import-row")).toHaveCount(10);
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Importa 10 clienti" }).scrollIntoViewIfNeeded();
  await shot(page, "agenzia-importa-metricool-mobile.png");
  await context.close();
});

test("scheda cliente: il brand si sceglie da un elenco con ricerca e si propone dal nome", async ({ browser }) => {
  await cleanup();
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto("/clients/new");

  const brand = page.getByLabel("Brand su Metricool");
  await expect(brand).toBeVisible();

  // Typing a name that matches a brand picks it and fills what is empty.
  await page.getByLabel("Nome del cliente").fill("osteria del borgo ");
  await expect(page.getByTestId("brand-auto-match")).toContainText("Trovato su Metricool: Osteria del Borgo");
  await expect(brand).toHaveValue("Osteria del Borgo");
  await expect(page.getByLabel(/URL del logo/)).toHaveValue(/fake-brands\/brand-2\.svg$/);
  await expect(page.getByRole("checkbox", { name: /Instagram/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /TikTok/ })).toBeChecked();
  await expect(page.getByTestId("selected-brand")).toContainText("Fuso orario Europe/Rome");
  await shot(page, "agenzia-cliente-brand-trovato.png");

  // The searchable list: logo, name, networks.
  await brand.click();
  await brand.fill("bluesky");
  const options = page.getByRole("listbox", { name: "Brand disponibili" }).getByRole("option");
  await expect(options).toHaveCount(2); // "Nessun brand collegato" + Tech4Kids
  await expect(options.nth(1)).toContainText("Tech4Kids Academy");
  await expect(options.nth(1)).toContainText("Bluesky");
  await shot(page, "agenzia-cliente-brand-elenco.png");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(brand).toHaveValue("Tech4Kids Academy");
  await page.getByRole("button", { name: "Scollega il brand" }).click();
  await expect(brand).toHaveValue("");
  await expect(page.getByTestId("selected-brand")).toHaveCount(0);

  // A name that matches nothing leaves the brand empty.
  await page.getByLabel("Nome del cliente").fill("Nome inventato");
  await expect(brand).toHaveValue("");
  await context.close();
});
