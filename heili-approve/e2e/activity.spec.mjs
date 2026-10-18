// End-to-end test of «Attività» (docs/ATTIVITA.md), against the running app
// (METRICOOL_FAKE=1) and worker. Run with: sh e2e/run.sh (see README).
//
// The whole story, once at 390 px and once at 1366 px for the agency (the
// client always uses a phone):
//   1. the agency picks the client's social media manager on the client sheet
//      (and sees the name in the client list);
//   2. the client writes a comment and asks for changes from the portal → in
//      «Attività» › «Da fare» there is ONE task with client, title, excerpt and
//      assignee; the number in the menu goes up; «Apri» leads to the post;
//   3. the agency uploads a new version and sends it → the task is closed
//      («Mostra completate»), the number goes back;
//   4. the client approves → an «Approvato» entry appears in «Notifiche»;
//      «Segna tutte come lette» empties the unread count;
//   5. a comment with no decision → a task; «Fatto» and «Riapri»;
//      «Assegna a…» moves it to another member (visible under «Tutti», and in
//      «Solo i miei» of that member);
//   6. another agency's tasks never show up (and ours never show up there);
//      an agency with nothing sees the empty states.
// No horizontal scroll at 390 px on any of these pages.

import { execFileSync } from "node:child_process";
import {
  DESKTOP,
  MOBILE,
  agencyContext,
  connectDb,
  expect,
  expectNoHorizontalScroll,
  postRow,
  root,
  seed,
  shot,
  test,
  uniq,
} from "./helpers.mjs";

let db;
let data;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
});

test.afterAll(async () => {
  await db?.end();
});

function createFixture(suffix) {
  const out = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-activity-fixture.ts", data.workspaceId, data.userId, suffix],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  return JSON.parse(line.slice("RESULT ".length));
}

/** A browser context logged in with the session token of another agency member. */
async function contextWithToken(browser, token, options) {
  const context = await browser.newContext(options);
  await context.addCookies([{ name: "authjs.session-token", value: token, url: data.baseUrl }]);
  return context;
}

/** The number next to «Attività» in the menu (0 when there is no badge). */
async function menuCount(page, mobile) {
  if (mobile) await page.getByRole("button", { name: "Apri menu" }).click();
  const link = page.getByRole("navigation", { name: "Menu principale" }).getByRole("link", { name: /^Attività/ });
  await expect(link).toBeVisible();
  const match = (await link.innerText()).trim().match(/(\d+)$/);
  if (mobile) await page.keyboard.press("Escape");
  return match ? Number(match[1]) : 0;
}

/** The row of the list that mentions `title`. */
const rowOf = (page, title) => page.getByRole("listitem").filter({ hasText: title });

async function scenario(browser, { label, agencyOptions }) {
  const mobile = agencyOptions === MOBILE;
  const suffix = `${uniq()}${mobile ? "m" : "d"}`;
  const fx = createFixture(suffix);
  const shots = (name) => `attivita-${label}-${name}.png`;

  // ── 1. The agency picks the social media manager on the client sheet ──
  const agency = await agencyContext(browser, data, { options: agencyOptions });
  const page = await agency.newPage();
  await page.goto("/dashboard");
  const before = await menuCount(page, mobile);

  await page.goto(`/clients/${fx.clientId}`);
  const owner = page.getByLabel("Social media manager");
  await expect(owner).toHaveValue("");
  await owner.selectOption({ label: "Stefano Finoti" });
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText("Modifiche salvate.", { exact: true })).toBeVisible();
  const saved = await db.query('select "ownerUserId" from "Client" where id = $1', [fx.clientId]);
  expect(saved.rows[0].ownerUserId).toBe(data.userId);
  if (mobile) await expectNoHorizontalScroll(page);
  await shot(page, shots("scheda-cliente"));

  await page.goto("/clients");
  await expect(page.locator(".panel").filter({ hasText: fx.clientName }).getByText("Social media manager: Stefano Finoti")).toBeVisible();
  if (mobile) await expectNoHorizontalScroll(page);

  // ── 2. The client comments and asks for changes ──
  const phone = await browser.newContext(MOBILE);
  const portal = await phone.newPage();
  await portal.goto(`${fx.reviewUrl}/posts/${fx.postId}`);
  const comment = "Il titolo è troppo lungo: puoi accorciarlo e togliere l'hashtag?";
  await portal.getByPlaceholder("Per esempio: darei più spazio al titolo…").fill(comment);
  await portal.getByRole("button", { name: "Invia commento" }).click();
  await expect(portal.getByText("Commento salvato")).toBeVisible();
  await portal.getByRole("button", { name: "Chiedi modifiche" }).click();
  await expect(portal.getByText("Modifiche inviate all'agenzia.", { exact: true })).toBeVisible();
  expect((await postRow(db, fx.postId)).status).toBe("CHANGES_REQUESTED");

  // ── The agency finds ONE task, assigned, with client, title and excerpt ──
  await page.goto("/attivita");
  await expect(page.getByRole("navigation", { name: "Attività" })).toBeVisible();
  const task = rowOf(page, fx.postTitle);
  await expect(task).toHaveCount(1);
  await expect(task.getByText(fx.clientName, { exact: false }).first()).toBeVisible();
  await expect(task.getByText(`Modifiche richieste: ${fx.postTitle}`, { exact: true })).toBeVisible();
  await expect(task.getByText(comment, { exact: false })).toBeVisible();
  await expect(task.getByText(/Assegnato a Stefano Finoti/)).toBeVisible();
  if (mobile) await expectNoHorizontalScroll(page);
  await shot(page, shots("da-fare"));
  expect(await menuCount(page, mobile)).toBe(before + 1);
  // The «N da gestire» chip of the top bar leads here too.
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Hai \d+ compit/ })).toHaveAttribute("href", "/attivita");
  const chip = page.getByRole("link", { name: /da gestire/ });
  if (await chip.count()) await expect(chip.first()).toHaveAttribute("href", "/attivita");

  // «Apri» leads to the post, on the tab with the comments.
  await page.goto("/attivita");
  await rowOf(page, fx.postTitle).getByRole("link", { name: "Apri", exact: true }).click();
  await page.waitForURL(new RegExp(`/posts/${fx.postId}\\?tab=revisione`));
  await expect(page.getByText(comment, { exact: false }).first()).toBeVisible();

  // ── 3. The agency sends version 2 → the task is closed ──
  await page.goto(`/posts/${fx.postId}?tab=modifica`);
  await page.locator("#post-text").fill("Il menu d'autunno è arrivato. Da giovedì, a pranzo.");
  await page.getByText("Nota per il cliente", { exact: false }).first().click();
  await page.locator("#post-change-note").fill("Titolo accorciato, tolto l'hashtag.");
  await page.getByRole("button", { name: "Salva e invia in revisione" }).click();
  await expect.poll(async () => (await postRow(db, fx.postId)).status, { timeout: 15_000 }).toBe("IN_REVIEW");
  expect((await postRow(db, fx.postId)).currentVersionNumber).toBe(2);

  await page.goto("/attivita");
  await expect(rowOf(page, fx.postTitle)).toHaveCount(0);
  expect(await menuCount(page, mobile)).toBe(before);
  await page.getByRole("link", { name: "Mostra completate" }).click();
  const closed = rowOf(page, fx.postTitle);
  await expect(closed).toHaveCount(1);
  await expect(closed.getByRole("button", { name: "Riapri" })).toBeVisible();
  await expect(closed.getByRole("button", { name: "Fatto" })).toHaveCount(0);
  if (mobile) await expectNoHorizontalScroll(page);

  // ── 4. The client approves → a notification ──
  await portal.goto(`${fx.reviewUrl}/posts/${fx.postId}`);
  await portal.getByRole("button", { name: "Approva", exact: true }).click();
  await portal.getByRole("button", { name: "Sì, approva" }).click();
  await expect(portal.getByText("Fatto! Post approvato.")).toBeVisible();

  // The notification is written when the approval becomes final (the undo window).
  await expect
    .poll(
      async () => {
        await page.goto("/attivita?tab=notifiche");
        return rowOf(page, `Approvato: ${fx.postTitle}`).count();
      },
      { timeout: 60_000, intervals: [2_000] }
    )
    .toBe(1);
  const notification = rowOf(page, `Approvato: ${fx.postTitle}`);
  await expect(notification.getByText(fx.clientName, { exact: false }).first()).toBeVisible();
  await expect(notification.getByRole("link", { name: "Apri", exact: true })).toBeVisible();
  // Information only: no «Fatto» / «Assegna a».
  await expect(notification.getByRole("button", { name: "Fatto" })).toHaveCount(0);
  // Unread entries say so with a word.
  await expect(notification.getByText("Nuova", { exact: true })).toBeVisible();
  const unreadTab = page.getByRole("navigation", { name: "Attività" }).getByRole("link", { name: /^Notifiche/ });
  expect(Number((await unreadTab.innerText()).match(/\((\d+)\)/)[1])).toBeGreaterThanOrEqual(1);
  if (mobile) await expectNoHorizontalScroll(page);
  await shot(page, shots("notifiche"));
  await page.getByRole("button", { name: "Segna tutte come lette" }).click();
  await expect(unreadTab).toHaveText(/Notifiche \(0\)/);
  await expect(page.getByRole("button", { name: "Segna tutte come lette" })).toHaveCount(0);
  // The entry stays in the list: read, not deleted.
  await expect(rowOf(page, `Approvato: ${fx.postTitle}`)).toHaveCount(1);
  await expect(rowOf(page, `Approvato: ${fx.postTitle}`).getByText("Nuova", { exact: true })).toHaveCount(0);

  // ── 5. A comment with no decision: task, «Fatto», «Riapri», «Assegna a…» ──
  await portal.goto(`${fx.reviewUrl}/posts/${fx.secondId}`);
  const note = "Bello, ma sposterei la pubblicazione al venerdì.";
  await portal.getByPlaceholder("Per esempio: darei più spazio al titolo…").fill(note);
  await portal.getByRole("button", { name: "Invia commento" }).click();
  await expect(portal.getByText("Commento salvato")).toBeVisible();
  expect((await postRow(db, fx.secondId)).status).toBe("IN_REVIEW");

  await page.goto("/attivita");
  const second = rowOf(page, fx.secondTitle);
  await expect(second).toHaveCount(1);
  await expect(second.getByText(`Commento del cliente: ${fx.secondTitle}`, { exact: true })).toBeVisible();
  await expect(second.getByText(note, { exact: false })).toBeVisible();
  expect(await menuCount(page, mobile)).toBe(before + 1);

  // «Fatto» → leaves «Da fare»; «Mostra completate» → «Riapri» brings it back.
  await second.getByRole("button", { name: "Fatto" }).click();
  await expect(rowOf(page, fx.secondTitle)).toHaveCount(0);
  await page.getByRole("link", { name: "Mostra completate" }).click();
  await rowOf(page, fx.secondTitle).getByRole("button", { name: "Riapri" }).click();
  await expect(rowOf(page, fx.secondTitle)).toHaveCount(0);
  await page.getByRole("link", { name: "Torna ai compiti aperti" }).click();
  await expect(rowOf(page, fx.secondTitle)).toHaveCount(1);
  expect(await menuCount(page, mobile)).toBe(before + 1);

  // «Assegna a…» Marta: gone from «Solo i miei», there under «Tutti».
  await rowOf(page, fx.secondTitle).getByLabel("Assegna a").selectOption({ label: fx.marta.name });
  await expect(rowOf(page, fx.secondTitle)).toHaveCount(0);
  expect(await menuCount(page, mobile)).toBe(before);
  await page.getByRole("link", { name: "Tutti", exact: true }).click();
  await expect(rowOf(page, fx.secondTitle).getByText(`Assegnato a ${fx.marta.name}`)).toBeVisible();
  if (mobile) await expectNoHorizontalScroll(page);
  await shot(page, shots("tutti"));

  // Marta sees it as hers (and in her menu).
  const martaContext = await contextWithToken(browser, fx.marta.sessionToken, agencyOptions);
  const martaPage = await martaContext.newPage();
  await martaPage.goto("/attivita");
  await expect(rowOf(martaPage, fx.secondTitle).getByText(`Assegnato a ${fx.marta.name}`)).toBeVisible();
  expect(await menuCount(martaPage, mobile)).toBeGreaterThanOrEqual(1);
  // The client filter narrows the list.
  await martaPage.getByLabel("Filtra per cliente").selectOption({ label: fx.clientName });
  await expect(martaPage).toHaveURL(new RegExp(`clientId=${fx.clientId}`));
  await expect(rowOf(martaPage, fx.secondTitle)).toHaveCount(1);
  await martaContext.close();

  // ── 6. Workspaces never mix ──
  for (const url of ["/attivita?scope=all", "/attivita?scope=all&tab=notifiche", `/attivita?scope=all&clientId=${fx.other.clientId}`]) {
    await page.goto(url);
    await expect(page.getByRole("navigation", { name: "Attività" })).toBeVisible();
    await expect(page.getByText(fx.other.taskTitle)).toHaveCount(0);
    await expect(page.getByText(fx.other.infoTitle)).toHaveCount(0);
    await expect(page.getByText("Testo riservato dell'altra agenzia")).toHaveCount(0);
    await expect(page.getByText("Cliente dell'altra agenzia")).toHaveCount(0);
  }
  const otherContext = await contextWithToken(browser, fx.other.sessionToken, agencyOptions);
  const otherPage = await otherContext.newPage();
  await otherPage.goto("/attivita?scope=all");
  await expect(rowOf(otherPage, fx.other.taskTitle)).toHaveCount(1);
  await expect(otherPage.getByText(fx.clientName)).toHaveCount(0);
  await expect(otherPage.getByText(fx.secondTitle)).toHaveCount(0);
  await otherPage.goto("/attivita?scope=all&tab=notifiche");
  await expect(rowOf(otherPage, fx.other.infoTitle)).toHaveCount(1);
  await expect(otherPage.getByText(`Approvato: ${fx.postTitle}`)).toHaveCount(0);
  if (mobile) await expectNoHorizontalScroll(otherPage);
  await otherContext.close();

  // An agency with nothing yet: the empty states say what to expect.
  const emptyContext = await contextWithToken(browser, fx.empty.sessionToken, agencyOptions);
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto("/attivita");
  await expect(emptyPage.getByText("Nessun compito aperto. Quando un cliente chiede modifiche, lo trovi qui.")).toBeVisible();
  if (mobile) await expectNoHorizontalScroll(emptyPage);
  await shot(emptyPage, shots("vuota"));
  await emptyPage.goto("/attivita?tab=notifiche");
  await expect(emptyPage.getByText("Nessuna notifica.")).toBeVisible();

  // A long list shows 30 at a time; an unbreakable word stays inside its card.
  const emptyRows = emptyPage.getByRole("listitem").filter({ hasText: "Cliente dell'agenzia vuota" });
  await db.query(`delete from "AgencyActivity" where "dedupeKey" like 'e2e-page:%'`);
  await db.query(
    `insert into "AgencyActivity" (id, "workspaceId", "clientId", type, kind, status, title, summary, "dedupeKey", "createdAt", "updatedAt")
     select 'e2e-page-' || i || '-' || $3::text, $1::text, $2::text, 'CLIENT_COMMENT', 'TASK', 'OPEN', 'Compito ' || i,
            case when i = 1 then repeat('x', 200) else 'Nota ' || i end,
            'e2e-page:' || i || ':' || $3::text, now() - (i || ' minutes')::interval, now()
     from generate_series(1, 35) i`,
    [fx.empty.workspaceId, fx.empty.clientId, suffix]
  );
  try {
    await emptyPage.goto("/attivita");
    await expect(emptyPage.getByRole("navigation", { name: "Attività" }).getByRole("link", { name: /^Da fare/ })).toHaveText("Da fare (35)");
    await expect(emptyRows).toHaveCount(30);
    const overflow = await emptyPage.evaluate(() => {
      const card = [...document.querySelectorAll("main li")].find((li) => li.textContent.includes("xxxxxxxxxx"));
      const right = card.getBoundingClientRect().right;
      return [...card.querySelectorAll("p")].map((p) => p.getBoundingClientRect().right - right).filter((d) => d > 1);
    });
    expect(overflow).toEqual([]);
    if (mobile) await expectNoHorizontalScroll(emptyPage);
    await emptyPage.getByRole("link", { name: "Mostra altre" }).click();
    await expect(emptyPage).toHaveURL(/dopo=/);
    await expect(emptyRows).toHaveCount(5);
    await expect(emptyPage.getByRole("link", { name: "Mostra altre" })).toHaveCount(0);
    await emptyPage.getByRole("link", { name: "Torna all'inizio" }).click();
    await expect(emptyPage.getByRole("link", { name: "Mostra altre" })).toBeVisible();
    // «Mostra completate» is a real touch target on a phone.
    if (mobile) {
      const box = await emptyPage.getByRole("link", { name: "Mostra completate" }).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await db.query(`delete from "AgencyActivity" where "dedupeKey" like 'e2e-page:%'`);
  }
  await emptyContext.close();

  await phone.close();
  await agency.close();
}

test("Attività a 390 px: dal commento del cliente al compito chiuso, notifiche e assegnazione", async ({ browser }) => {
  await scenario(browser, { label: "390", agencyOptions: MOBILE });
});

test("Attività a 1366 px: dal commento del cliente al compito chiuso, notifiche e assegnazione", async ({ browser }) => {
  await scenario(browser, { label: "1366", agencyOptions: DESKTOP });
});
