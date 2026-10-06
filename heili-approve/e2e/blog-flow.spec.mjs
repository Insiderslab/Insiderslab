// End-to-end test of a blog article (APP_VARIANT=all or blog), against the
// running app. Run with: sh e2e/run.sh (see README).
//
// Agency writes an article (Markdown, featured image, SEO fields) and sends
// it → client (390px) selects a sentence, comments on it and asks for changes
// → agency edits (version 2) and resends → client sees the word diff and
// approves → agency exports Markdown and HTML (content + sanitisation) and
// marks it "Pubblicato".

import path from "node:path";
import {
  FIXTURES,
  MOBILE,
  agencyContext,
  connectDb,
  download,
  expect,
  expectNoHorizontalScroll,
  postRow,
  romeDate,
  saveAndSubmit,
  seed,
  shot,
  test,
  uniq,
  viewportShot,
  waitForStatus,
} from "./helpers.mjs";

const COMMENTED = "il caffè macinato al momento perde gli aromi in pochi minuti";
const COMMENT = "Non sono minuti, sono secondi: correggete, è il punto chiave dell'articolo.";
const FIXED = "il caffè macinato al momento perde gran parte degli aromi in pochi secondi";

// Paragraphs long enough for the review minimum (100 words), with a list, a
// link, two H2s and some hostile markup the export must neutralise.
const BODY = `Chi entra in torrefazione ci chiede spesso perché insistiamo a macinare il caffè solo al momento. La risposta sta tutta nella chimica degli aromi, e vale per la moka come per l'espresso.

## Perché macinare al momento

Una volta rotto il chicco, ${COMMENTED}: le sostanze volatili che danno profumo alla tazza sono le prime ad andarsene. Per questo il caffè già macinato, anche se sottovuoto, non regge il confronto con quello appena macinato.

## Tre consigli per la moka di casa

- comprate il caffè in grani in piccole quantità, da finire in due settimane;
- conservatelo in un barattolo ermetico, lontano da luce e calore;
- usate una macinatura media, né troppo fine né troppo grossa.

Se volete provare, passate in negozio: vi prepariamo una macinatura su misura per la vostra moka. Trovate gli orari nella pagina [chi siamo](https://www.torrefazione-esempio.it/chi-siamo).

<script>alert("xss")</script>

<img src="x" onerror="alert('xss')">

Un [link pericoloso](javascript:alert('xss')) da neutralizzare.`;

let db;
let data;
const state = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  state.client = data.blog.client;
  db = await connectDb();
});

test.afterAll(async () => {
  await db?.end();
});

function reviewUrl(postId) {
  return `${state.client.reviewUrl}/posts/${postId}`;
}

test("blog, agenzia: scrive l'articolo con immagine e SEO e lo invia", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();

  await page.goto(`/posts/new?kind=blog&clientId=${state.client.id}`);
  await expect(page.getByRole("banner").getByRole("heading", { name: "Nuovo articolo" })).toBeVisible();
  await expect(page.locator("#content-client")).toHaveValue(state.client.id);

  state.title = `Macinare al momento ${uniq()}`;
  await page.locator("#content-title").fill(state.title);
  await page.getByLabel("Pubblicazione prevista").fill(romeDate(8));
  await page.getByLabel("Titolo dell'articolo").fill("Perché macinare il caffè al momento cambia tutto");
  // The slug follows the headline until it is edited by hand.
  await expect(page.getByLabel(/^Slug/)).toHaveValue("perche-macinare-il-caffe-al-momento-cambia-tutto");
  await page.getByLabel("Testo dell'articolo (Markdown)").fill(BODY);

  const featured = page.locator("section", { has: page.getByRole("heading", { name: "Immagine in evidenza" }) });
  await featured.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "blog-featured.png"));
  await expect(featured.getByLabel("Testo alternativo")).toBeVisible({ timeout: 30_000 });
  await featured.getByLabel("Testo alternativo").fill("Chicchi di caffè nel macinino della torrefazione");

  await page.getByLabel("Parola chiave principale").fill("macinare il caffè");
  await page.getByLabel(/^Titolo SEO/).fill("Macinare il caffè al momento: perché conviene");
  await page
    .getByLabel("Meta description")
    .fill("Perché il caffè va macinato al momento: cosa succede agli aromi e tre consigli pratici per la moka di casa.");

  await expect(page.getByText("Caricamento…")).toHaveCount(0, { timeout: 30_000 });
  await shot(page, "blog-agenzia-editor.png");

  state.postId = await saveAndSubmit(page);
  const row = await waitForStatus(db, state.postId, "IN_REVIEW", 15_000);
  expect(row.currentVersionNumber).toBe(1);
  await context.close();
});

test("blog, cliente (390px): commenta una frase selezionata e chiede modifiche", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(state.client.reviewUrl);
  await expect(page.getByText(state.title)).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto(reviewUrl(state.postId));
  const article = page.getByRole("region", { name: "Articolo" });
  await expect(article.getByRole("heading", { name: "Perché macinare il caffè al momento cambia tutto" })).toBeVisible();
  // Sanitised: the hostile markup does not reach the page.
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("[onerror]")).toHaveCount(0);
  await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // Select the sentence as a long press + drag would on a phone.
  await page.evaluate((quote) => {
    const root = document.querySelector('section[aria-label="Articolo"]');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf(quote);
      if (at === -1) continue;
      node.parentElement.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + quote.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`Frase non trovata: ${quote}`);
  }, COMMENTED);
  // The touch bubble sits above the sticky decision bar and takes the tap.
  const bubble = page.getByRole("button", { name: "Commenta questa frase" });
  await expect(bubble).toBeVisible();
  const box = await bubble.boundingBox();
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent?.trim() ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe("Commenta questa frase");
  await bubble.tap();

  const sheet = page.getByRole("dialog", { name: "Commenta il passaggio" });
  await expect(sheet.getByText(COMMENTED)).toBeVisible();
  await sheet.getByPlaceholder("Cosa vorresti cambiare in questo passaggio?").fill(COMMENT);
  await sheet.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento inviato")).toBeVisible();

  // The passage is highlighted with its number.
  const mark = article.locator("mark[data-comment-id]").first();
  await expect(mark).toContainText("perde gli aromi");
  await mark.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -200));
  await viewportShot(page, "blog-cliente-evidenziazione-mobile.png");

  await page.getByRole("button", { name: "Chiedi modifiche" }).click();
  await page.getByPlaceholder(/Per esempio/).fill("Vedi il commento sulla frase degli aromi, per il resto va bene.");
  await page.getByRole("button", { name: "Invia la richiesta" }).click();
  await expect(page.getByText("Richiesta inviata all'agenzia.")).toBeVisible();

  const row = await waitForStatus(db, state.postId, "CHANGES_REQUESTED", 10_000);
  expect(row.currentVersionNumber).toBe(1);
  const { rows } = await db.query('select anchor from "PostComment" where "postId" = $1 and anchor is not null', [state.postId]);
  expect(rows).toHaveLength(1);
  expect(rows[0].anchor.quote).toBe(COMMENTED);
  await context.close();
});

test("blog, agenzia: vede il commento sulla frase, corregge (versione 2) e reinvia", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();

  await page.goto(`/posts/${state.postId}?tab=revisione`);
  await expect(page.getByText(COMMENT).first()).toBeVisible();
  await expect(page.locator("mark[data-comment-id]").first()).toContainText("perde gli aromi");
  await shot(page, "blog-agenzia-revisione.png");

  await page.goto(`/posts/${state.postId}?tab=modifica`);
  const body = page.getByLabel("Testo dell'articolo (Markdown)");
  await expect(body).toHaveValue(/perde gli aromi/);
  await body.fill(BODY.replace(COMMENTED, FIXED));
  await page.locator("#content-change-note").fill("Corretto: gli aromi si perdono in pochi secondi.");
  await page.getByRole("button", { name: "Salva e invia in revisione" }).click();

  await expect.poll(async () => (await postRow(db, state.postId)).status, { timeout: 15_000 }).toBe("IN_REVIEW");
  expect((await postRow(db, state.postId)).currentVersionNumber).toBe(2);
  await context.close();
});

test("blog, cliente: vede le parole cambiate e approva", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(reviewUrl(state.postId));
  const changes = page.locator("section", { has: page.getByRole("heading", { name: "Cosa è cambiato" }) }).first();
  await expect(changes).toBeVisible();
  await expect(changes.getByText("Corretto: gli aromi si perdono in pochi secondi.")).toBeVisible();
  await expect(changes.locator("ins", { hasText: "secondi" }).first()).toBeVisible();
  await expect(changes.locator("del", { hasText: "minuti" }).first()).toBeVisible();
  await changes.scrollIntoViewIfNeeded();
  await shot(page, "blog-cliente-diff-mobile.png");

  // The open note of version 1 is re-anchored on the rewritten sentence.
  const carried = page.locator("li", { hasText: COMMENT });
  await expect(carried.getByText(/sulla versione 1/)).toBeVisible();
  await expect(carried.getByText(/Il passaggio è stato modificato/)).toBeVisible();

  await page.getByRole("button", { name: "Approva", exact: true }).click();
  await page.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Articolo approvato.")).toBeVisible();
  await waitForStatus(db, state.postId, "APPROVED", 10_000);
  await context.close();
});

test("blog, agenzia: esporta Markdown e HTML e segna come pubblicato", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/${state.postId}`);
  await expect(page.getByText(/versione approvata dal cliente \(versione 2\)/)).toBeVisible();

  const md = await download(page, page.getByRole("link", { name: "Scarica Markdown" }));
  expect(md.name).toBe("perche-macinare-il-caffe-al-momento-cambia-tutto.md");
  const markdown = md.buffer.toString("utf8");
  expect(markdown).toMatch(/^---\n/);
  expect(markdown).toContain('title: "Perché macinare il caffè al momento cambia tutto"');
  expect(markdown).toContain('slug: "perche-macinare-il-caffe-al-momento-cambia-tutto"');
  expect(markdown).toContain('meta_title: "Macinare il caffè al momento: perché conviene"');
  expect(markdown).toContain("approved: true");
  expect(markdown).toContain("version: 2");
  expect(markdown).toContain("## Tre consigli per la moka di casa");
  expect(markdown).toContain(FIXED);
  expect(markdown).not.toContain(COMMENTED);
  // The Markdown is sanitised like the page the client approved.
  expect(markdown).not.toMatch(/<script|onerror|javascript:/i);

  const html = await download(page, page.getByRole("link", { name: "Scarica HTML per WordPress" }));
  expect(html.name).toBe("perche-macinare-il-caffe-al-momento-cambia-tutto.html");
  const body = html.buffer.toString("utf8");
  expect(body).toContain("<h2");
  expect(body).toContain("Tre consigli per la moka di casa");
  expect(body).toContain(FIXED);
  expect(body).toMatch(/<li>comprate il caffè in grani/);
  expect(body).toMatch(/<a [^>]*href="https:\/\/www\.torrefazione-esempio\.it\/chi-siamo"[^>]*rel="noopener noreferrer"/);
  // Sanitisation: nothing executable survives.
  expect(body).not.toMatch(/<script/i);
  expect(body).not.toMatch(/onerror/i);
  expect(body).not.toMatch(/javascript:/i);
  expect(body).not.toContain("non approvat");

  await page.getByRole("button", { name: "Segna come pubblicato" }).click();
  await page.getByRole("button", { name: "Sì, segna come pubblicato" }).click();
  await waitForStatus(db, state.postId, "DELIVERED", 10_000);
  await page.reload();
  await expect(page.getByText("Pubblicato").first()).toBeVisible();
  await context.close();
});
