// Media in the post editor (agency): a file dropped anywhere on the page is
// uploaded (the browser does not open it), a wrong format is said before
// uploading, a failed upload offers "Riprova", the order of a carousel can be
// changed. Then the editor's defaults: only the essentials in view, a post
// without a title takes the start of its text. Runs against the app
// (APP_VARIANT=all, METRICOOL_FAKE=1); the one draft it saves is deleted.

import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURES, agencyContext, connectDb, expect, seed, test } from "./helpers.mjs";

let data;
const IMAGE = readFileSync(path.join(FIXTURES, "post-image.png"));

test.beforeAll(() => {
  data = seed();
});

/** Drops files on `selector` the way a browser does (DataTransfer with File objects). */
async function dropFiles(page, selector, files) {
  const transfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    return dt;
  }, files.map((f) => ({ name: f.name, type: f.type, bytes: [...f.buffer] })));
  await page.dispatchEvent(selector, "dragover", { dataTransfer: transfer });
  await page.dispatchEvent(selector, "drop", { dataTransfer: transfer });
}

test("editor del post: trascina ovunque, formato sbagliato, Riprova e ordine del carosello", async ({ browser }) => {
  const aurora = data.clients.find((c) => c.name === "Caffè Aurora");
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/new?kind=social&clientId=${aurora.id}`);
  const media = page.locator("ol li", { has: page.getByText(/^Immagine/) });

  // Dropped on the page title, far from the zone: it lands in the post.
  await dropFiles(page, "h1", [{ name: "uno.png", type: "image/png", buffer: IMAGE }]);
  await expect(media).toHaveCount(1);
  await expect(page).toHaveURL(/\/posts\/new/);

  // A format the platform does not take: said at once, nothing uploaded, no "Riprova".
  await page.locator('input[type=file][accept*="image"]').first().setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert").filter({ hasText: "Formato non supportato (TXT)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Riprova" })).toHaveCount(0);
  await page.getByRole("button", { name: "Rimuovi" }).first().click();

  // The server fails once: the error stays with "Riprova", which then works.
  let fail = true;
  await page.route("**/api/uploads", (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: "Errore del server: riprova." }) });
    }
    return route.continue();
  });
  await page.locator('input[type=file][accept*="image"]').first().setInputFiles({ name: "due.png", mimeType: "image/png", buffer: IMAGE });
  await expect(page.getByRole("alert").filter({ hasText: "Errore del server: riprova." })).toBeVisible();
  await page.getByRole("button", { name: "Riprova" }).click();
  await expect(media).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Riprova" })).toHaveCount(0);

  // Carousel order: the second picture moves first.
  const first = await media.nth(0).locator("img").getAttribute("src");
  await page.getByRole("button", { name: "Sposta il media 2 prima" }).click();
  await expect(media.nth(1).locator("img")).toHaveAttribute("src", first);
  await context.close();
});

test("nuovo post: in vista solo l'essenziale, titolo dal testo, reti dell'ultimo post", async ({ browser }) => {
  const aurora = data.clients.find((c) => c.name === "Caffè Aurora");
  const db = await connectDb();
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/new?kind=social&clientId=${aurora.id}`);
  // Title and first comment wait in «Altre opzioni», closed.
  await expect(page.locator("#post-title")).toBeHidden();
  await expect(page.locator("#post-first-comment")).toBeHidden();
  await expect(page.getByLabel("Data di pubblicazione")).not.toHaveValue("");
  // The networks of Aurora's latest social post are already ticked.
  const { rows } = await db.query(
    `select networks from "Post" where "clientId" = $1 and kind = 'SOCIAL_POST' order by "createdAt" desc limit 1`,
    [aurora.id]
  );
  const labels = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };
  for (const network of rows[0].networks) {
    if (labels[network]) await expect(page.getByLabel(labels[network], { exact: true })).toBeChecked();
  }
  // Only Facebook, a text, no title: saved with the first words of the text.
  for (const label of ["Instagram", "LinkedIn"]) {
    const box = page.getByLabel(label, { exact: true });
    if (await box.isChecked()) await box.uncheck();
  }
  const facebook = page.getByLabel("Facebook", { exact: true });
  if (!(await facebook.isChecked())) await facebook.check();
  const text = `E2E titolo automatico ${Date.now()} per la colazione di domani`;
  await page.locator("#post-text").fill(text);
  await page.getByRole("button", { name: "Salva bozza" }).click();
  await page.waitForURL(/salvato=1/, { timeout: 30_000 });
  const postId = new URL(page.url()).pathname.split("/").pop();
  const { rows: saved } = await db.query('select title, status from "Post" where id = $1', [postId]);
  expect(saved[0].status).toBe("DRAFT");
  expect(text.startsWith(saved[0].title.replace(/…$/, ""))).toBe(true);
  await db.query('delete from "Post" where id = $1', [postId]);
  await db.end();
  await context.close();
});
