// End-to-end test of the monthly plan ("Piano del mese"), against the
// running app (APP_VARIANT=all, METRICOOL_FAKE=1) and worker.
//
// 1. A fresh social client with four draft posts next month (one at 23:30
//    on the last day, still that month in Rome). The agency opens the plan
//    from the calendar's "Prepara il piano di …", checks the Instagram grid,
//    writes the message and sends the plan: every post goes to review, the
//    plan link with WhatsApp appears.
// 2. The client (390 px) opens the plan link: heading, message, progress,
//    grid, posts in calendar order. On one post (plan navigation "Post 4 di
//    4", "Torna al piano") they leave a comment; back on the plan, "Approva
//    tutto il piano" approves the other three and lists the commented one.
// 3. The worker schedules the three approved posts on (fake) Metricool; the
//    client approves the last one by itself and the plan becomes approved.
// 4. Another client's link cannot open the plan (404).

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
  viewportShot,
  waitForStatus,
} from "./helpers.mjs";

let db;
let data;
const state = {};

/** "YYYY-MM" of next month in Rome. */
function nextMonthInRome() {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const index = y * 12 + (m - 1) + 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

async function planRow(id) {
  const { rows } = await db.query('select status, "sentAt", "completedNotifiedAt", intro from "ContentPlan" where id = $1', [id]);
  return rows[0];
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  state.month = nextMonthInRome();
  state.monthName = MONTH_NAMES[Number(state.month.slice(5, 7)) - 1];
  const out = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "e2e/support/create-plan-fixture.ts", data.workspaceId, data.userId, state.month, uniq()],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  state.fixture = JSON.parse(line.slice("RESULT ".length));
});

test.afterAll(async () => {
  // The run's client is archived so it does not pile up in the menu.
  if (state.fixture) await db?.query('update "Client" set "archivedAt" = now() where id = $1', [state.fixture.clientId]);
  await db?.end();
});

test("agenzia: apre il piano dal calendario, controlla la griglia e lo invia", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: DESKTOP });
  const page = await context.newPage();
  const { clientId, posts } = state.fixture;

  await page.goto(`/calendar?clientId=${clientId}&mese=${state.month}`);
  const link = page.getByTestId("calendar-plan-link");
  await expect(link).toHaveText(`Prepara il piano di ${state.monthName}`);
  await link.click();
  await page.waitForURL(/\/plans\?/);
  await page.getByRole("button", { name: "Apri e prepara il piano" }).click();
  await page.waitForURL(/\/plans\/[a-z0-9]+$/, { timeout: 30_000 });
  state.planId = new URL(page.url()).pathname.split("/").pop();

  await expect(page.getByTestId("plan-title")).toHaveText(`Piano social ${state.monthName} ${state.month.slice(0, 4)}`);
  await expect(page.getByTestId("plan-posts").getByTestId("plan-post-row")).toHaveCount(4);
  // Calendar order, the 23:30 post of the last day included.
  await expect(page.getByTestId("plan-posts").getByTestId("plan-post-row").last()).toContainText(posts[3].title);
  await expect(page.getByTestId("instagram-grid").locator("li")).toHaveCount(4);
  // Instagram order: newest first.
  await expect(page.getByTestId("instagram-grid").locator("li").first()).toHaveAttribute("title", new RegExp(posts[3].title));
  await expect(page.getByTestId("plan-share-hint")).toBeVisible();

  await page.getByLabel(/Messaggio per/).fill("Ciao Chiara! Questo mese raccontiamo la cucina e il team. Un post a settimana.");
  await page.getByTestId("plan-send").click();
  await expect(page.getByText(/Stai per inviare 4 post a Piano e2e/)).toBeVisible();
  await page.getByTestId("plan-send-confirm").click();
  await expect(page.getByTestId("plan-notice")).toContainText("Piano inviato: 4 post da rivedere");

  for (const post of posts) expect((await postRow(db, post.id)).status).toBe("IN_REVIEW");
  const plan = await planRow(state.planId);
  expect(plan.status).toBe("IN_REVIEW");
  expect(plan.sentAt).not.toBeNull();

  const share = page.getByTestId("plan-share-row");
  await expect(share).toHaveCount(1);
  const planUrl = `${state.fixture.reviewUrl}/piani/${state.planId}`;
  await expect(share.getByTestId("share-link-url")).toHaveValue(planUrl);
  const whatsapp = await share.getByTestId("share-whatsapp").getAttribute("href");
  expect(decodeURIComponent(whatsapp.split("text=")[1])).toBe(
    `Ciao Chiara, ecco il piano social di ${state.monthName}${state.month.slice(0, 4) === String(new Date().getFullYear()) ? "" : ` ${state.month.slice(0, 4)}`} per ${state.fixture.clientName}: 4 post da rivedere. ${planUrl}`
  );
  await shot(page, "piano-agenzia.png");

  // The calendar now links to the plan.
  await page.goto(`/calendar?clientId=${clientId}&mese=${state.month}`);
  await expect(page.getByTestId("calendar-plan-link")).toHaveAttribute("href", `/plans/${state.planId}`);
  await context.close();
});

test("cliente (390px): rivede il piano, commenta un post e approva tutto il resto", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const { posts, reviewUrl } = state.fixture;

  // The portal home highlights the plan.
  await page.goto(reviewUrl);
  await expect(page.getByTestId("portal-plan-card")).toContainText("4 post da approvare");
  await page.getByTestId("portal-plan-card").click();
  await page.waitForURL(new RegExp(`/piani/${state.planId}$`));

  await expect(page.getByTestId("plan-heading")).toContainText(`Piano social di ${state.monthName}`);
  await expect(page.getByText("Questo mese raccontiamo la cucina e il team.")).toBeVisible();
  await expect(page.getByText("0 di 4 approvati").first()).toBeVisible();
  await expect(page.getByTestId("plan-post-card")).toHaveCount(4);
  await expect(page.getByTestId("plan-post-card").first()).toContainText(posts[0].title);
  await expectNoHorizontalScroll(page);
  await shot(page, "piano-cliente-mobile.png");

  // The last post of the month: plan navigation, then a general comment.
  await page.getByTestId("plan-post-card").last().click();
  await page.waitForURL(new RegExp(`/posts/${posts[3].id}$`));
  const nav = page.getByTestId("plan-nav");
  await expect(nav).toContainText("Post 4 di 4");
  await expect(nav.getByRole("link", { name: "‹ Post precedente" })).toHaveAttribute("href", new RegExp(`/posts/${posts[2].id}$`));
  await expect(nav.getByText("Ultimo del piano")).toBeVisible();
  await page.getByRole("button", { name: "Scrivi un commento" }).click();
  await page.getByPlaceholder("Scrivi il tuo commento per l'agenzia").fill("Possiamo spostarlo al mattino?");
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento inviato")).toBeVisible();
  await viewportShot(page, "piano-cliente-post-mobile.png");
  await nav.getByRole("link", { name: "← Torna al piano" }).click();
  await page.waitForURL(new RegExp(`/piani/${state.planId}$`));

  await page.getByTestId("plan-approve-all").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Approvi 3 post del piano?" })).toBeVisible();
  await expect(sheet.getByTestId("plan-skipped")).toContainText(posts[3].title);
  await expect(sheet.getByTestId("plan-skipped")).toContainText("commento aperto");
  await viewportShot(page, "piano-cliente-approva-tutto-mobile.png");
  await sheet.getByRole("button", { name: "Sì, approva 3 post" }).click();
  await expect(page.getByTestId("plan-outcome")).toContainText("Fatto! 3 post approvati.");
  await expect(page.getByText("3 di 4 approvati").first()).toBeVisible();

  // Same approval as one by one: Metricool scheduling through the worker.
  for (const post of posts.slice(0, 3)) {
    const row = await waitForStatus(db, post.id, "SCHEDULED", 60_000);
    expect(row.metricoolPostId).toBeTruthy();
  }
  expect((await postRow(db, posts[3].id)).status).toBe("IN_REVIEW");
  expect((await planRow(state.planId)).status).toBe("IN_REVIEW");

  // The last one, approved by itself, completes the plan (agency told once).
  await page.getByTestId("plan-post-card").last().click();
  await page.waitForURL(new RegExp(`/posts/${posts[3].id}$`));
  await page.getByRole("button", { name: "Approva", exact: true }).click();
  await page.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Post approvato.")).toBeVisible();
  await waitForStatus(db, posts[3].id, "SCHEDULED", 60_000);
  const plan = await planRow(state.planId);
  expect(plan.status).toBe("APPROVED");
  expect(plan.completedNotifiedAt).not.toBeNull();
  await context.close();
});

test("un altro cliente non apre il piano", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const response = await page.goto(`${data.clients[0].reviewUrl}/piani/${state.planId}`);
  expect(response.status()).toBe(404);
  await expect(page.getByText(/non è disponibile/)).toBeVisible();
  await context.close();
});
