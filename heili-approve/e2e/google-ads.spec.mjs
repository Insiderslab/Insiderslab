// End-to-end test of a Google Ads creative set (APP_VARIANT=all or ads),
// against the running app. Run with: sh e2e/run.sh google-ads (see README).
//
// Agency builds a Google Ads set with a Search variant: titoli, descrizioni,
// percorsi and a pasted keyword list ("…" → a frase, […] → esatta) and sends
// it → client (390px) sees the search result mockup, rotates the
// combinations, comments one headline ("Commenta questo titolo"), approves
// and sends → APPROVED → agency sees the quoted comment and downloads the ZIP
// with the Google Ads Editor CSVs. The seeded Performance Max variant shows
// its surfaces (Display, YouTube, Gmail, Discover, Ricerca) to the client.

import {
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
const HEADLINES = ["Palestra Kinetik a Milano", "Prova gratis per 7 giorni", "Istruttore sempre con te", "Sala pesi rinnovata"];
const DESCRIPTIONS = [
  "Sala pesi, corsi e un istruttore che ti segue. La prima settimana è gratis.",
  "Prenota online la tua prova gratuita: scegli giorno e orario in un minuto.",
];
const KEYWORDS = 'palestra milano\n"prova gratuita palestra"\n[palestra kinetik]';
const HEADLINE_NOTE = "Direi «Prima settimana gratis»: più chiaro.";

let db;
let data;
const state = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  state.client = data.googleAds.client;
  db = await connectDb();
});

test.afterAll(async () => {
  await db?.end();
});

function reviewUrl(postId) {
  return `${state.client.reviewUrl}/posts/${postId}`;
}

test("google ads, agenzia: set Ricerca con titoli, descrizioni e parole chiave", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  state.title = `Google Ads ${uniq()}`;

  await page.goto(`/posts/new?kind=ads&clientId=${state.client.id}`);
  await expect(page.locator("#content-client")).toHaveValue(state.client.id);
  await page.locator("#content-title").fill(state.title);
  await page.getByLabel("Inizio campagna").fill(romeDate(9));
  await page.getByLabel("Nome della campagna").fill("Prenotazioni d'autunno");
  await page.getByLabel("Piattaforma").selectOption("google");

  // A new Google variant starts on Search: text only, the Google section is open.
  await expect(page.getByLabel(/Google Ricerca/)).toBeChecked();
  await expect(page.getByRole("heading", { name: "Google Ads: titoli, descrizioni e parole chiave" })).toBeVisible();
  await page.getByLabel("Nome della variante").fill("Variante A — Rete di ricerca");
  await page.getByLabel("URL di destinazione").fill(URL_OK);

  for (const [i, text] of HEADLINES.entries()) {
    await page.getByRole("button", { name: "Aggiungi titolo" }).click();
    await page.getByRole("textbox", { name: `Titoli ${i + 1}`, exact: true }).fill(text);
  }
  await expect(page.getByText(`${HEADLINES[1].length}/30`).first()).toBeVisible();
  for (const [i, text] of DESCRIPTIONS.entries()) {
    await page.getByRole("button", { name: "Aggiungi descrizione" }).click();
    await page.getByRole("textbox", { name: `Descrizioni ${i + 1}`, exact: true }).fill(text);
  }
  await page.getByLabel("Percorso URL 1").fill("prova");
  await page.getByLabel("Percorso URL 2").fill("gratis");
  await page.getByLabel("Aggiungi parole chiave, una per riga").fill(KEYWORDS);
  await page.getByRole("button", { name: "Aggiungi all'elenco" }).click();
  await expect(page.getByText("Aggiunte 3 parole chiave.")).toBeVisible();
  await expect(page.getByLabel('Corrispondenza di "prova gratuita palestra"')).toHaveValue("phrase");
  await expect(page.getByLabel("Corrispondenza di [palestra kinetik]")).toHaveValue("exact");
  await page.getByLabel("Parole chiave escluse").fill("lavoro");

  // Live preview: the search result with the first headlines.
  const preview = page.getByRole("complementary", { name: "Anteprima e controlli" });
  await expect(preview.getByText(`${HEADLINES[0]} | ${HEADLINES[1]} | ${HEADLINES[2]}`)).toBeVisible();
  await expect(page.getByText("Nessun errore bloccante")).toBeVisible();
  await shot(page, "google-ads-agenzia-editor.png", { maxHeight: 6000 });

  state.postId = await saveAndSubmit(page);
  await waitForStatus(db, state.postId, "IN_REVIEW", 15_000);
  const { rows } = await db.query('select content from "PostVersion" where "postId" = $1 and number = 1', [state.postId]);
  const google = rows[0].content.variants[0].google;
  expect(rows[0].content.campaign.platform).toBe("google");
  expect(rows[0].content.variants[0].placements).toEqual(["google_search"]);
  expect(google.headlines).toEqual(HEADLINES);
  expect(google.keywords).toEqual([
    { text: "palestra milano", match: "broad" },
    { text: "prova gratuita palestra", match: "phrase" },
    { text: "palestra kinetik", match: "exact" },
  ]);
  expect(google.negativeKeywords).toEqual(["lavoro"]);
  await context.close();
});

test("google ads, cliente (390px): anteprima, commento su un titolo, approva", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  await page.goto(reviewUrl(state.postId));
  await expectNoHorizontalScroll(page);

  const search = page.getByRole("article", { name: "Anteprima Google, rete di ricerca, annuncio adattivo" });
  await expect(search.getByText("Sponsorizzato")).toBeVisible();
  await expect(search.getByText("palestrakinetik.it › prova › gratis")).toBeVisible();
  await page.getByRole("button", { name: "Mostra un'altra combinazione" }).click();
  await expect(search.getByText(HEADLINES[3], { exact: false })).toBeVisible();

  // The list in words, then a comment on headline 2.
  await expect(page.getByText("a frase").first()).toBeVisible();
  await expect(page.getByText("esatta").first()).toBeVisible();
  await page.getByRole("button", { name: `Titolo 2: ${HEADLINES[1]}` }).click();
  await page.getByRole("button", { name: "Commenta questo titolo" }).click();
  const form = page.getByRole("form", { name: "Commenta questo titolo" });
  await expect(form.getByText(`«${HEADLINES[1]}»`)).toBeVisible();
  await form.getByLabel("Il tuo commento").fill(HEADLINE_NOTE);
  await viewportShot(page, "google-ads-cliente-commento-titolo-mobile.png");
  await form.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento inviato")).toBeVisible();
  await expect(page.getByText("commentato", { exact: true })).toBeVisible();

  const { rows } = await db.query('select body, "variantId" from "PostComment" where "postId" = $1', [state.postId]);
  expect(rows).toEqual([{ body: `[Titolo 2] «${HEADLINES[1]}»\n${HEADLINE_NOTE}`, variantId: "A" }]);

  await page.getByRole("button", { name: "Approva variante" }).click();
  await expect(page.getByRole("heading", { name: "Variante decisa" })).toBeVisible();
  await page.getByRole("button", { name: "Invia le mie decisioni" }).click();
  await page.getByRole("button", { name: "Sì, invia" }).click();
  await expect(page.getByText("Decisioni inviate all'agenzia.")).toBeVisible();
  await waitForStatus(db, state.postId, "APPROVED", 10_000);
  await context.close();
});

test("google ads, agenzia: commento citato e ZIP con i CSV per Google Ads Editor", async ({ browser }) => {
  const context = await agencyContext(browser, data);
  const page = await context.newPage();
  await page.goto(`/posts/${state.postId}`);
  await expect(page.getByText(HEADLINE_NOTE, { exact: false }).first()).toBeVisible();

  const zip = await download(page, page.getByRole("link", { name: "Scarica pacchetto ZIP" }));
  const archive = await JSZip.loadAsync(zip.buffer);
  const names = Object.keys(archive.files).sort();
  expect(names).toEqual(["README.txt", "copy.csv", "google-ads-keywords.csv", "google-ads-rsa.csv"]);

  const rsa = await archive.file("google-ads-rsa.csv").async("string");
  const [header, row] = rsa.replace(/^﻿/, "").split("\r\n");
  expect(header.startsWith("Campaign,Ad group,Ad type,Headline 1,")).toBe(true);
  expect(row).toContain(`Responsive search ad,${HEADLINES.join(",")}`);
  expect(row.endsWith(`prova,gratis,${URL_OK}`)).toBe(true);

  const keywords = await archive.file("google-ads-keywords.csv").async("string");
  expect(keywords).toContain("prova gratuita palestra,Phrase");
  expect(keywords).toContain("palestra kinetik,Exact");
  expect(keywords).toContain("lavoro,Negative Broad");

  const readme = await archive.file("README.txt").async("string");
  expect(readme).toContain("google-ads-rsa.csv");
  expect(readme).toContain(`    2. ${HEADLINES[1]}`);
  await context.close();
});

test("google ads, cliente (390px): Performance Max nelle sue superfici", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  await page.goto(reviewUrl(data.googleAds.post.id));
  await expectNoHorizontalScroll(page);

  const pmax = page.getByRole("article", { name: "Anteprima Performance Max, gruppo di asset" });
  await pmax.scrollIntoViewIfNeeded();
  for (const surface of ["Display", "YouTube", "Gmail", "Discover", "Ricerca"]) {
    await pmax.getByRole("button", { name: surface, exact: true }).click();
    await expect(pmax.getByRole("button", { name: surface, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await pmax.getByRole("button", { name: "YouTube", exact: true }).click();
  await expect(pmax.getByText("Google ne crea uno automaticamente")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Titoli lunghi (2)" })).toBeVisible();
  await pmax.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await viewportShot(page, "google-ads-cliente-pmax-mobile.png");
  await context.close();
});
