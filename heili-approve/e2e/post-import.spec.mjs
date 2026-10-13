// "Importa post": creating social drafts from a sheet in the agency panel,
// against the running app (APP_VARIANT=all, METRICOOL_FAKE=1). Run with: sh e2e/run.sh (see README).
//
// 1. From the posts list: "Importa da Excel", the client picker, the template (.xlsx / .csv).
// 2. The downloaded template is uploaded back with its pictures: the row is read and ready.
// 3. Pasted rows (tab separated): one row is wrong (date in the past, unknown network, missing
//    picture) and is red with the reasons; the others are ready. After fixing it, "Crea 3 bozze"
//    with the month's plan creates DRAFTs only, uploads the picture and opens the plan.
// 4. The same rows again are "Già importata": nothing is duplicated.
// 5. Rows in two months: the plan option explains why it is not offered.
// 6. At 390 px nothing scrolls sideways.
//
// Posts are titled "E2E import …" and sit a year and more ahead; they (and the plan) are removed before and after.

import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURES, MOBILE, agencyContext, connectDb, download, expect, expectNoHorizontalScroll, romeDate, seed, test } from "./helpers.mjs";

let data;
let db;
let client;
const state = {};

test.describe.configure({ mode: "serial" });

/** DD/MM/YYYY, `days` from now (Rome). */
function dmy(days) {
  const [y, m, d] = romeDate(days).split("-");
  return `${d}/${m}/${y}`;
}

async function cleanup() {
  await db.query(`delete from "ContentPlan" where id in (select "planId" from "Post" where title like 'E2E import %' and "planId" is not null)`);
  await db.query(`delete from "Post" where title like 'E2E import %'`);
}

const IMAGE = { name: "e2e-foto.png", mimeType: "image/png", buffer: readFileSync(path.join(FIXTURES, "post-image.png")) };

/** TSV with a header: [date, time, networks, text, images] per row. */
function sheet(rows) {
  return ["Data\tOra\tReti\tTesto\tPrimo commento\tTitolo\tImmagini", ...rows.map(([date, time, networks, title, images = ""]) => `${date}\t${time}\t${networks}\tTesto di ${title}\t\t${title}\t${images}`)].join("\n");
}

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  client = data.clients.find((c) => c.name === "Caffè Aurora");
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
  await db.end();
});

test("dalla lista dei post: scelta cliente e modello scaricabile", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto("/posts");
  await page.getByTestId("posts-import-link").click();
  await page.waitForURL(/\/posts\/import$/);

  // No client picked in the menu: the page asks for one.
  await expect(page.getByTestId("import-pick-client")).toBeVisible();
  await page.getByTestId("import-client-option").filter({ hasText: "Caffè Aurora" }).click();
  await expect(page.getByRole("heading", { name: "Importa post per Caffè Aurora" })).toBeVisible();

  const xlsx = await download(page, page.getByTestId("import-template-xlsx"));
  expect(xlsx.name).toBe("modello-importa-post.xlsx");
  expect(xlsx.buffer.subarray(0, 2).toString()).toBe("PK");
  const csv = await download(page, page.getByTestId("import-template-csv"));
  expect(csv.name).toBe("modello-importa-post.csv");
  expect(csv.buffer.toString("utf8")).toContain("Data,Ora,Reti,Testo,Primo commento,Titolo,Immagini");
  state.template = xlsx.buffer;
  await context.close();
});

test("il modello compilato si rilegge, con le immagini abbinate per nome", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/import?clientId=${client.id}`);
  await page.getByTestId("import-drop-input").setInputFiles([
    { name: "modello.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: state.template },
    { ...IMAGE, name: "Collezione-1.JPG" },
    { ...IMAGE, name: "collezione-2.jpg" },
  ]);
  await expect(page.getByTestId("import-source")).toContainText("modello.xlsx · 1 riga");
  const row = page.getByTestId("import-row");
  // Sheet and pictures dropped together: the debounced server check must see the
  // pictures too (QA-01). The row is "Controllo…" until the answer, then stays ready.
  await expect(page.getByTestId("import-summary")).toContainText("Controllo le righe…");
  await expect(page.getByTestId("import-summary")).not.toContainText("Controllo le righe…");
  await expect(row).toHaveAttribute("data-state", "ready");
  await expect(row.getByText("Trovato")).toHaveCount(2);
  await expect(row.getByText("Immagine non trovata")).toHaveCount(0);
  await expect(row.getByLabel("Reti")).toHaveValue("Instagram, Facebook");
  await expect(page.getByTestId("import-create")).toHaveText("Crea 1 bozza");
  await expect(page.getByTestId("import-create")).toBeEnabled();
  await context.close();
});

test("righe incollate: errori per riga, correzione, bozze e piano del mese", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/import?clientId=${client.id}`);

  const good = dmy(420);
  await page.getByTestId("import-paste").fill(
    sheet([
      [good, "10:30", "Instagram, Facebook", "E2E import A", "e2e-foto.png"],
      ["01/01/2020", "09:00", "Snapchat", "E2E import B", "manca.jpg"],
      [good, "18:00", "facebook", "E2E import C"],
    ])
  );
  await page.getByTestId("import-paste-read").click();
  const rows = page.getByTestId("import-row");
  await expect(rows).toHaveCount(3);

  // The picture is not there yet: row A is red too until it is dropped.
  await expect(rows.nth(0)).toHaveAttribute("data-state", "invalid");
  await page.getByTestId("import-media-drop-input").setInputFiles(IMAGE);
  await expect(rows.nth(0)).toHaveAttribute("data-state", "ready");
  await expect(rows.nth(0).getByText("Trovato")).toBeVisible();

  const bad = rows.nth(1);
  await expect(bad).toHaveAttribute("data-state", "invalid");
  await expect(bad.getByText("Da correggere")).toBeVisible();
  await expect(bad.getByTestId("import-row-issues")).toContainText("Rete non riconosciuta: «Snapchat»");
  await expect(bad.getByTestId("import-row-issues")).toContainText("già passata");
  await expect(bad.getByTestId("import-row-issues")).toContainText("Immagine non trovata: «manca.jpg»");
  await expect(page.getByTestId("import-summary")).toContainText("2 righe pronte");
  await expect(page.getByTestId("import-summary")).toContainText("1 riga da correggere");
  await expect(page.getByTestId("import-create")).toHaveText("Crea 2 bozze");

  // Long sheets: filter to the rows to fix, and jump to the next one (QA-08).
  await page.getByTestId("import-only-invalid").check();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toHaveAttribute("data-state", "invalid");
  await page.getByTestId("import-only-invalid").uncheck();
  await expect(rows).toHaveCount(3);
  await page.getByTestId("import-goto-invalid").click();
  await expect(rows.nth(1)).toBeInViewport();

  // Fix the row in the grid.
  await bad.getByLabel("Data").fill(good);
  await bad.getByLabel("Reti").fill("Instagram|Facebook");
  await bad.getByLabel("Immagini", { exact: true }).fill("E2E-FOTO.PNG");
  await expect(bad).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("import-create")).toHaveText("Crea 3 bozze");

  await page.getByTestId("import-plan-check").check();
  await expect(page.getByText(/Crea anche il piano di \w+ \d{4}/)).toBeVisible();
  await page.getByTestId("import-create").click();

  await expect(page.getByTestId("import-result-title")).toHaveText("Create 3 bozze", { timeout: 60_000 });
  // The agency shell scrolls inside <main>: after creating, the result is at the top (QA-03).
  await expect(page.getByTestId("import-result-title")).toBeInViewport();
  await expect(page.getByTestId("import-result-list").getByText("Bozza creata")).toHaveCount(3);
  await expect(page.getByTestId("import-plan-note")).toContainText("Piano social");

  const { rows: posts } = await db.query(
    `select status, "importKey", "planId", "submittedAt", "approvedAt", (select jsonb_array_length(media) from "PostVersion" v where v."postId" = p.id and v.number = 1) as media
     from "Post" p where title like 'E2E import %' order by title`
  );
  expect(posts).toHaveLength(3);
  expect(posts.every((p) => p.status === "DRAFT" && !p.submittedAt && !p.approvedAt && /^panel:/.test(p.importKey))).toBe(true);
  expect(posts.map((p) => p.media)).toEqual([1, 1, 0]);
  expect(new Set(posts.map((p) => p.planId)).size).toBe(1);
  expect(posts[0].planId).toBeTruthy();

  // "Manda in revisione" goes to the plan, where the plan is sent to the client.
  const href = await page.getByTestId("import-send-review").getAttribute("href");
  expect(href).toBe(`/plans/${posts[0].planId}`);
  await page.getByTestId("import-send-review").click();
  await page.waitForURL(new RegExp(`/plans/${posts[0].planId}$`));
  await context.close();
});

test("importare di nuovo lo stesso foglio non duplica i post", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/import?clientId=${client.id}`);
  const good = dmy(420);
  await page.getByTestId("import-paste").fill(
    sheet([
      [good, "10:30", "Instagram, Facebook", "E2E import A", "e2e-foto.png"],
      [good, "18:00", "facebook", "E2E import C"],
    ])
  );
  await page.getByTestId("import-paste-read").click();
  await page.getByTestId("import-media-drop-input").setInputFiles(IMAGE);
  const rows = page.getByTestId("import-row");
  await expect(rows.nth(0)).toHaveAttribute("data-state", "existing");
  await expect(rows.nth(1)).toHaveAttribute("data-state", "existing");
  await expect(rows.nth(0).getByText("Già importata")).toBeVisible();
  await expect(page.getByTestId("import-create")).toBeDisabled();
  const { rows: count } = await db.query(`select count(*)::int as n from "Post" where title like 'E2E import %'`);
  expect(count[0].n).toBe(3);
  await context.close();
});

test("righe in due mesi: il piano non viene proposto", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/import?clientId=${client.id}`);
  await page.getByTestId("import-paste").fill(
    sheet([
      [dmy(500), "10:30", "Facebook", "E2E import D"],
      [dmy(540), "10:30", "Facebook", "E2E import E"],
    ])
  );
  await page.getByTestId("import-paste-read").click();
  await expect(page.getByTestId("import-plan-multi")).toContainText("mesi diversi");
  await expect(page.getByTestId("import-plan-check")).toHaveCount(0);
  await expect(page.getByTestId("import-create")).toHaveText("Crea 2 bozze");
  await context.close();
});

test("a 390 px niente scorrimento laterale", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: MOBILE });
  const page = await context.newPage();
  await page.goto(`/posts/import?clientId=${client.id}`);
  await expectNoHorizontalScroll(page);

  // On phones fields are 16px tall text (no iOS zoom) and at least 44px high (QA-11).
  const pasteBox = page.getByTestId("import-paste");
  const fontSize = await pasteBox.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  const height = (await pasteBox.boundingBox()).height;
  expect(height).toBeGreaterThanOrEqual(44);

  // The closed drawer stays out of keyboard reach; Escape closes it and the
  // focus returns to its button (QA-12).
  const drawer = page.locator("aside");
  await expect(drawer).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Apri menu" }).click();
  await expect(drawer).not.toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Apri menu" })).toBeFocused();

  // Touch targets of the shell are at least 44×44 (QA-13).
  const menuBox = await page.getByRole("button", { name: "Apri menu" }).boundingBox();
  expect(menuBox.width).toBeGreaterThanOrEqual(44);
  expect(menuBox.height).toBeGreaterThanOrEqual(44);

  await page.getByTestId("import-paste").fill(sheet([["01/01/2020", "09:00", "Snapchat", "E2E import F", "manca.jpg"]]));
  await page.getByTestId("import-paste-read").click();
  await expect(page.getByTestId("import-row")).toHaveAttribute("data-state", "invalid");
  await expectNoHorizontalScroll(page);
  await context.close();
});
