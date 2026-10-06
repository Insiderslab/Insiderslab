// End-to-end test of an ads creative set (APP_VARIANT=all or ads), against
// the running app. Run with: sh e2e/run.sh (see README).
//
// Agency builds a Meta set with three variants (A 1:1 image, B 9:16 video,
// C 4:5 image) and sends it → client (390px) approves A, discards B with a
// note plus a comment at a moment of its video, approves C and sends the
// decisions → APPROVED → agency sees decisions and notes, downloads the ZIP
// (only A and C files + copy.csv + README.txt) and marks it "Consegnato".
// Second set: every variant discarded → CHANGES_REQUESTED.

import path from "node:path";
import {
  FIXTURES,
  MOBILE,
  agencyContext,
  connectDb,
  download,
  expect,
  expectNoHorizontalScroll,
  require,
  romeDate,
  saveAndSubmit,
  seed,
  shot,
  test,
  uniq,
  viewportShot,
  waitForStatus,
} from "./helpers.mjs";

const JSZip = require("jszip");

const URL_OK = "https://www.palestrakinetik.it/prova-gratuita";
const B_NOTE = "Il video è troppo veloce e il logo non si legge: questa variante non la usiamo.";
const B_MOMENT = "Al terzo secondo la scritta copre la faccia dell'istruttore.";

let db;
let data;
const state = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  state.client = data.ads.client;
  db = await connectDb();
});

test.afterAll(async () => {
  await db?.end();
});

function reviewUrl(postId) {
  return `${state.client.reviewUrl}/posts/${postId}`;
}

/** Fills the selected variant of the AdSetEditor. */
async function fillVariant(page, { name, file, primaryText, headline, description, cta }) {
  await page.getByLabel("Nome della variante").fill(name);
  await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, file));
  await expect(page.getByLabel("Testo alternativo del media 1")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Caricamento in corso")).toHaveCount(0, { timeout: 30_000 });
  await page.getByPlaceholder("Il testo sopra (o sotto) l'immagine").fill(primaryText);
  await page.getByPlaceholder("Il titolo vicino al pulsante").fill(headline);
  await page.getByPlaceholder("Una riga in più, facoltativa").fill(description);
  await page.getByLabel("Pulsante (call to action)").fill(cta);
  await page.getByLabel("URL di destinazione").fill(URL_OK);
}

/** New Meta set for Palestra Kinetik with the given variants; returns its id. */
async function createAdSet(page, { title, variants, screenshot }) {
  await page.goto(`/posts/new?kind=ads&clientId=${state.client.id}`);
  await expect(page.locator("#content-client")).toHaveValue(state.client.id);
  await page.locator("#content-title").fill(title);
  await page.getByLabel("Inizio campagna").fill(romeDate(9));
  await page.getByLabel("Nome della campagna").fill("Iscrizioni d'autunno");
  await page.getByPlaceholder("Es. Vendite").fill("Contatti (lead)");

  for (const [index, variant] of variants.entries()) {
    if (index > 0) await page.getByRole("button", { name: "Aggiungi variante" }).click();
    await page.getByRole("tab", { name: new RegExp(`^Variante ${"ABCDEF"[index]}\\b`) }).click();
    await fillVariant(page, variant);
  }
  if (screenshot) await screenshot(page);
  return saveAndSubmit(page);
}

const THREE_VARIANTS = [
  {
    name: "Variante A — Sala pesi",
    file: "ad-square.png",
    primaryText: "Prova Kinetik gratis per 7 giorni, con un istruttore che ti segue.",
    headline: "7 giorni di prova gratuita",
    description: "Senza vincoli",
    cta: "Iscriviti",
  },
  {
    name: "Variante B — Video functional",
    file: "reel-test.mp4",
    primaryText: "45 minuti, tutto il corpo, zero noia. La prima settimana è gratis.",
    headline: "Functional training gratis",
    description: "7 giorni di prova",
    cta: "Iscriviti",
  },
  {
    name: "Variante C — Istruttore",
    file: "post-image.png",
    primaryText: "Allenarti con qualcuno che conosce il tuo nome fa la differenza.",
    headline: "Il tuo istruttore ti aspetta",
    description: "Prima settimana gratis",
    cta: "Scopri di più",
  },
];

test("ads, agenzia: crea un set con tre varianti (una video) e lo invia", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  state.title = `Prova gratuita ${uniq()}`;
  state.postId = await createAdSet(page, {
    title: state.title,
    variants: THREE_VARIANTS,
    screenshot: async (p) => {
      // Variant B (the video) with the Stories/Reels safe zones on.
      await p.getByRole("tab", { name: /^Variante B\b/ }).click();
      const previews = p.getByRole("complementary", { name: "Anteprima e controlli" });
      const storiesTab = previews.getByRole("tab", { name: /Storie e Reels/ });
      if (await storiesTab.count()) await storiesTab.first().click();
      const zones = previews.getByLabel("Zone di sicurezza");
      await expect(zones.first()).toBeVisible();
      await zones.first().check();
      await shot(p, "ads-agenzia-editor-zone-sicurezza.png");
    },
  });
  const row = await waitForStatus(db, state.postId, "IN_REVIEW", 15_000);
  expect(row.currentVersionNumber).toBe(1);

  const { rows } = await db.query(
    'select content from "PostVersion" where "postId" = $1 and number = 1',
    [state.postId]
  );
  const content = rows[0].content;
  expect(content.variants.map((v) => v.id)).toEqual(["A", "B", "C"]);
  expect(content.variants[1].media[0]).toMatchObject({ type: "video", width: 540, height: 960 });
  expect(content.variants[0].media[0]).toMatchObject({ width: 1080, height: 1080 });
  await context.close();
});

test("ads, cliente (390px): approva A, scarta B con nota e commento al video, approva C", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(state.client.reviewUrl);
  await expect(page.getByText(state.title)).toBeVisible();
  await page.goto(reviewUrl(state.postId));
  await expect(page.getByRole("heading", { name: "0 di 3 varianti decise" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const variant = (id) => page.locator(`[data-variant-id="${id}"]`);

  await variant("A").getByRole("button", { name: "Approva variante" }).click();
  await expect(page.getByRole("heading", { name: "1 di 3 varianti decise" })).toBeVisible();

  // B: a comment at 0:03 of the video, then discard with a note.
  const b = variant("B");
  const forward = b.getByRole("button", { name: "Avanti di 1 secondo" }).first();
  await forward.scrollIntoViewIfNeeded();
  for (let i = 0; i < 3; i++) await forward.click();
  await b.getByRole("button", { name: "Commenta a 0:03" }).first().click();
  await expect(b.getByLabel("Al momento")).toHaveValue("0:03");
  await b.getByPlaceholder("Cosa non ti convince in questo momento del video?").fill(B_MOMENT);
  await b.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento inviato")).toBeVisible();
  await expect(b.getByText(B_MOMENT)).toBeVisible();

  // Safe zones on the 9:16 preview (Stories/Reels).
  await b.getByRole("tab", { name: /Storie e Reels/ }).click();
  const zones = b.getByLabel("Zone di sicurezza");
  await zones.check();
  await expect(b.getByText("Testo e pulsante dell'annuncio").first()).toBeVisible();
  // Frame the whole 9:16 preview: tabs at the top of the screen.
  await zones.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -80));
  await viewportShot(page, "ads-cliente-video-zone-sicurezza-mobile.png");

  await b.getByRole("button", { name: "Scarta" }).click();
  // Discarding without a note is not possible.
  await expect(b.getByRole("button", { name: "Conferma: scarta" })).toBeDisabled();
  await b.getByPlaceholder(/Per esempio: il prodotto si vede poco/).fill(B_NOTE);
  await b.getByRole("button", { name: "Conferma: scarta" }).click();
  await expect(page.getByRole("heading", { name: "2 di 3 varianti decise" })).toBeVisible();

  await variant("C").getByRole("button", { name: "Approva variante" }).click();
  await expect(page.getByRole("heading", { name: "3 di 3 varianti decise" })).toBeVisible();
  await page.getByRole("heading", { name: "3 di 3 varianti decise" }).scrollIntoViewIfNeeded();
  await viewportShot(page, "ads-cliente-decisioni-mobile.png");

  await page.getByRole("button", { name: "Invia le mie decisioni" }).click();
  await page.getByRole("button", { name: "Sì, invia" }).click();
  await expect(page.getByText("Decisioni inviate all'agenzia.")).toBeVisible();
  await waitForStatus(db, state.postId, "APPROVED", 10_000);

  const { rows } = await db.query(
    'select "variantId", verdict, note from "CreativeDecision" where "postId" = $1 order by "variantId"',
    [state.postId]
  );
  expect(rows.map((r) => [r.variantId, r.verdict])).toEqual([
    ["A", "APPROVED"],
    ["B", "REJECTED"],
    ["C", "APPROVED"],
  ]);
  expect(rows[1].note).toBe(B_NOTE);
  await context.close();
});

test("ads, agenzia: decisioni e note, ZIP con solo A e C, segna come consegnato", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/${state.postId}`);

  const overview = page.locator("section", { has: page.getByRole("heading", { name: /Decisioni del cliente/ }) }).first();
  await expect(overview).toBeVisible();
  await expect(overview.getByText("2 approvate · 1 scartata")).toBeVisible();
  await expect(overview.getByText(B_NOTE)).toBeVisible();
  await expect(page.getByText(B_MOMENT).first()).toBeVisible();
  await shot(page, "ads-agenzia-decisioni.png", { maxHeight: 6000 });

  const zip = await download(page, page.getByRole("link", { name: "Scarica pacchetto ZIP" }));
  expect(zip.name).toMatch(/\.zip$/);
  const archive = await JSZip.loadAsync(zip.buffer);
  const names = Object.keys(archive.files).filter((n) => !archive.files[n].dir).sort();
  const media = names.filter((n) => n !== "copy.csv" && n !== "README.txt");
  expect(names).toContain("copy.csv");
  expect(names).toContain("README.txt");
  expect(media).toHaveLength(2);
  expect(media.some((n) => /_a_[^/]*\.png$/.test(n))).toBe(true);
  expect(media.some((n) => /_c_[^/]*\.png$/.test(n))).toBe(true);
  expect(media.some((n) => /_b_|\.mp4$/.test(n))).toBe(false);

  const csv = await archive.file("copy.csv").async("string");
  expect(csv).toContain("7 giorni di prova gratuita");
  expect(csv).toContain("Il tuo istruttore ti aspetta");
  expect(csv).not.toContain("Functional training gratis");
  const readme = await archive.file("README.txt").async("string");
  expect(readme).toContain(B_NOTE);
  expect(readme).toMatch(/Variante B — Video functional: scartata/i);

  await page.getByRole("button", { name: "Segna come consegnato" }).click();
  await page.getByRole("button", { name: "Sì, segna come consegnato" }).click();
  await waitForStatus(db, state.postId, "DELIVERED", 10_000);
  await page.reload();
  await expect(page.getByText("Consegnato").first()).toBeVisible();
  await context.close();
});

test("ads: tutte le varianti scartate → modifiche richieste", async ({ browser }) => {
  const agency = await agencyContext(browser, data);
  const agencyPage = await agency.newPage();
  const title = `Set da rifare ${uniq()}`;
  const postId = await createAdSet(agencyPage, { title, variants: [THREE_VARIANTS[0], THREE_VARIANTS[2]] });
  await waitForStatus(db, postId, "IN_REVIEW", 15_000);

  const client = await browser.newContext(MOBILE);
  const page = await client.newPage();
  await page.goto(reviewUrl(postId));
  for (const [id, note] of [
    ["A", "La foto della sala è troppo buia."],
    ["B", "Preferiamo un'istruttrice diversa."],
  ]) {
    const v = page.locator(`[data-variant-id="${id}"]`);
    await v.getByRole("button", { name: "Scarta" }).click();
    await v.getByPlaceholder(/Per esempio: il prodotto si vede poco/).fill(note);
    await v.getByRole("button", { name: "Conferma: scarta" }).click();
  }
  await expect(page.getByRole("heading", { name: "2 di 2 varianti decise" })).toBeVisible();
  await page.getByRole("button", { name: "Invia le mie decisioni" }).click();
  await page.getByRole("button", { name: "Sì, invia" }).click();
  await expect(page.getByText("Decisioni inviate all'agenzia.")).toBeVisible();
  await waitForStatus(db, postId, "CHANGES_REQUESTED", 10_000);

  await agencyPage.goto(`/posts/${postId}`);
  await expect(agencyPage.getByText("La foto della sala è troppo buia.").first()).toBeVisible();
  await expect(agencyPage.getByText("Preferiamo un'istruttrice diversa.").first()).toBeVisible();
  await expect(agencyPage.getByText("Scarica pacchetto ZIP")).toHaveCount(0);

  // Resent without a new version: a new review round, no verdicts carried over.
  await agencyPage.getByRole("button", { name: "Invia in revisione" }).click();
  await agencyPage.getByRole("button", { name: "Invia al cliente" }).click();
  const resent = await waitForStatus(db, postId, "IN_REVIEW", 15_000);
  expect(resent.currentVersionNumber).toBe(1);
  const { rows: left } = await db.query('select 1 from "CreativeDecision" where "postId" = $1', [postId]);
  expect(left).toHaveLength(0);
  await page.goto(reviewUrl(postId));
  await expect(page.locator('[data-variant-id="A"]').getByRole("button", { name: "Scarta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invia le mie decisioni" })).toBeDisabled();
  await client.close();
  await agency.close();
});
