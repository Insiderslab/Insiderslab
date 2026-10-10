// End-to-end test of the month views of the client portal: "Griglia" and
// "Sfoglia" (fast review) on a plan page, and the month route for posts
// without a plan. Against the running app (APP_VARIANT=all,
// METRICOOL_FAKE=1) and worker.
//
// A fresh client has a SENT plan of five posts next month (image, carousel,
// Reel, two networks, 23:30 on the last day) and three posts in review in
// the month after that, outside any plan. Another client has posts in a
// third month.
//
// 1. Home: the plan card and "Rivedi tutto <mese> insieme" for the loose posts.
// 2. Plan page at 390 px: the mode switch and "Rivedi in modalità veloce";
//    Sfoglia: approve one (next card, progress, status), comment another
//    (post page, "Torna a Sfoglia" lands on the same card), swipe and
//    keyboard, the summary and "Approva i rimanenti" (the commented post is
//    excluded); the worker schedules what was approved.
// 3. Griglia: every tile with its status chip, icons for carousel and video.
// 4. Month route: Griglia and Sfoglia for the posts without a plan; another
//    client's month, an empty month and a malformed one answer 404.

import { execFileSync } from "node:child_process";
import {
  DESKTOP,
  MOBILE,
  connectDb,
  expect,
  expectNoHorizontalScroll,
  postRow,
  root,
  seed,
  test,
  uniq,
  viewportShot,
  waitForStatus,
} from "./helpers.mjs";

let db;
let data;
const state = {};

/** "YYYY-MM" `delta` months after today in Rome. */
function monthInRome(delta) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const monthName = (month) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  state.planMonth = monthInRome(1);
  state.looseMonth = monthInRome(2);
  state.otherMonth = monthInRome(3);
  const out = execFileSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "e2e/support/create-month-fixture.ts",
      data.workspaceId,
      data.userId,
      state.planMonth,
      state.looseMonth,
      state.otherMonth,
      uniq(),
    ],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  state.fixture = JSON.parse(line.slice("RESULT ".length));
  const { a, planId } = state.fixture;
  state.planUrl = `${a.reviewUrl}/piani/${planId}`;
});

test.afterAll(async () => {
  if (state.fixture) {
    await db?.query('update "Client" set "archivedAt" = now() where id = any($1)', [[state.fixture.a.clientId, state.fixture.b.clientId]]);
  }
  await db?.end();
});

/** Title of the card on screen. */
const cardTitle = (page) => page.getByTestId("browse-card").getByRole("heading", { level: 2 });

test("home: il piano e «Rivedi tutto <mese> insieme» per i post senza piano", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  await page.goto(state.fixture.a.reviewUrl);
  await expect(page.getByTestId("portal-plan-card")).toContainText("5 post da approvare");
  const offers = page.getByTestId("portal-month-offer");
  // Only the three loose posts: the plan's five are not offered a second time.
  await expect(offers).toHaveCount(1);
  await expect(offers).toContainText(`Rivedi tutto ${monthName(state.looseMonth)}`);
  await expect(offers).toContainText("3 post da approvare");
  await expect(offers).toHaveAttribute("href", new RegExp(`/mese/${state.looseMonth}$`));
  await expectNoHorizontalScroll(page);
  await context.close();
});

test("piano (390 px): interruttore, Sfoglia: approva, commenta e torna, riepilogo e «Approva i rimanenti»", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const { planPosts } = state.fixture;

  // Panoramica stays the default; the phone gets the quick way in.
  await page.goto(state.planUrl);
  const modes = page.getByTestId("month-view-switch");
  await expect(modes.getByRole("link", { name: "Panoramica" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("plan-heading")).toContainText(`Piano social di ${monthName(state.planMonth)}`);
  await expect(page.getByTestId("plan-post-card")).toHaveCount(5);
  await expect(page.getByTestId("quick-review")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "mese-piano-interruttore-mobile.png");

  await page.getByTestId("quick-review").click();
  await page.waitForURL(/vista=sfoglia/);

  // First card: the real preview, date, state and the two big buttons.
  const card = page.getByTestId("browse-card");
  await expect(cardTitle(page)).toContainText(planPosts[0].title);
  await expect(page.getByTestId("browse-slot")).toContainText("4 novembre".replace("novembre", monthName(state.planMonth)));
  await expect(page.getByTestId("browse-state")).toHaveText("Da approvare");
  await expect(card.getByRole("img").first()).toBeVisible();
  await expect(page.getByTestId("browse-position")).toHaveText("Post 1 di 5");
  await expect(page.getByText("0 di 5 approvati").first()).toBeVisible();
  for (const id of ["browse-comment", "browse-approve"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "mese-sfoglia-mobile.png");

  // Approva: that post, at the version shown, then the next card.
  await page.getByTestId("browse-approve").click();
  await expect(cardTitle(page)).toContainText(planPosts[1].title);
  await expect(page.getByTestId("browse-position")).toHaveText("Post 2 di 5");
  await expect(page.getByText("1 di 5 approvati").first()).toBeVisible();
  expect(["APPROVED", "SCHEDULING", "SCHEDULED"]).toContain((await postRow(db, planPosts[0].id)).status);
  await expect(page).toHaveURL(/i=2/);

  // The carousel card: its own swipe is not a card swipe.
  await expect(page.getByTestId("browse-card").locator('[aria-roledescription="carosello"]')).toBeVisible();

  // Commenta: the post's own review page, with the way back to this card.
  await page.getByTestId("browse-comment").click();
  await page.waitForURL(new RegExp(`/posts/${planPosts[1].id}\\?da=sfoglia&i=2`));
  const nav = page.getByTestId("plan-nav");
  await expect(nav).toContainText("Post 2 di 5");
  await page.getByPlaceholder("Per esempio: darei più spazio al titolo…").fill("Il secondo scatto è un po' scuro.");
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento salvato")).toBeVisible();
  await nav.getByRole("link", { name: "← Torna a Sfoglia" }).click();
  await page.waitForURL(/vista=sfoglia&i=2/);
  await expect(cardTitle(page)).toContainText(planPosts[1].title);
  await expect(page.getByTestId("browse-state")).toHaveText("Hai lasciato commenti");
  // With comments left the post is decided from its page, never in one tap.
  await expect(page.getByTestId("browse-approve")).toHaveCount(0);
  await expect(page.getByTestId("browse-open-post")).toBeVisible();
  expect((await postRow(db, planPosts[1].id)).status).toBe("IN_REVIEW");

  // Swipe left on the card (touch) moves on; swiping right goes back.
  const cdp = await context.newCDPSession(page);
  await page.getByTestId("browse-card").getByRole("heading", { level: 2 }).scrollIntoViewIfNeeded();
  // A real swipe: down on the title area, 150 px to the left, up.
  const title = await page.getByTestId("browse-card").getByRole("heading", { level: 2 }).boundingBox();
  const y = title.y + title.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 320, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 120, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByTestId("browse-position")).toHaveText("Post 3 di 5");
  await expect(cardTitle(page)).toContainText(planPosts[2].title);
  // Reel: the video player, not a card swipe on its controls.
  await expect(page.getByTestId("browse-card").locator("video")).toBeVisible();
  await page.getByTestId("browse-prev").click();
  await expect(page.getByTestId("browse-position")).toHaveText("Post 2 di 5");
  await page.getByTestId("browse-skip").click();
  await expect(page.getByTestId("browse-position")).toHaveText("Post 3 di 5");

  // To the summary by the arrows: 1 approved, 1 with comments, 3 to decide.
  for (const n of [4, 5]) {
    await page.getByTestId("browse-next").click();
    await expect(page.getByTestId("browse-position")).toHaveText(`Post ${n} di 5`);
  }
  await page.getByTestId("browse-next").click();
  const summary = page.getByTestId("browse-summary");
  await expect(summary).toBeVisible();
  await expect(page.getByTestId("browse-summary-text")).toHaveText("1 approvato, 1 con commento, 3 da decidere");
  await expect(summary).toContainText(planPosts[1].title);
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "mese-sfoglia-riepilogo-mobile.png");

  // "Approva i rimanenti": the plan's approve-all, the commented post stays out.
  await page.getByTestId("browse-approve-rest").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Approvi 3 post rimasti?" })).toBeVisible();
  await expect(sheet.getByTestId("browse-skipped")).toContainText(planPosts[1].title);
  await sheet.getByRole("button", { name: "Sì, approva 3 post" }).click();
  await expect(page.getByTestId("browse-outcome")).toContainText("Fatto! 3 post approvati.");
  await expect(page.getByTestId("browse-summary-text")).toHaveText("4 approvati, 1 con commento");
  await expect(page.getByText("4 di 5 approvati").first()).toBeVisible();
  await viewportShot(page, "mese-sfoglia-fine-mobile.png");

  // The same approval as one by one: scheduling on (fake) Metricool through the worker.
  for (const post of [planPosts[0], planPosts[2], planPosts[3], planPosts[4]]) {
    const row = await waitForStatus(db, post.id, "SCHEDULED", 60_000);
    expect(row.metricoolPostId).toBeTruthy();
  }
  expect((await postRow(db, planPosts[1].id)).status).toBe("IN_REVIEW");

  // "Torna al piano" is the overview.
  await page.getByTestId("browse-back").click();
  await page.waitForURL(new RegExp(`/piani/${state.fixture.planId}$`));
  await context.close();
});

test("griglia: tutti i post con il loro stato; un tocco apre il post con il ritorno alla griglia", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const { planPosts } = state.fixture;
  await page.goto(`${state.planUrl}?vista=griglia`);
  const grid = page.getByTestId("month-grid");
  const tiles = grid.getByRole("listitem");
  await expect(tiles).toHaveCount(5);
  // Newest first, like the profile.
  await expect(tiles.first()).toContainText(planPosts[4].title);
  await expect(tiles.last()).toContainText(planPosts[0].title);
  // One waiting (the commented post), four approved or scheduled.
  await expect(grid.locator(".chip", { hasText: "Da approvare" })).toHaveCount(1);
  await expect(grid.locator(".chip", { hasText: /^(Approvato|Programmato)$/ })).toHaveCount(4);
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "mese-griglia-mobile.png");

  await tiles.nth(3).getByRole("link").click(); // the carousel
  await page.waitForURL(new RegExp(`/posts/${planPosts[1].id}\\?da=griglia`));
  await page.getByTestId("plan-nav").getByRole("link", { name: "← Torna alla griglia" }).click();
  await page.waitForURL(/vista=griglia/);
  await expect(page.getByTestId("month-grid")).toBeVisible();
  await context.close();
});

test("desktop: frecce della tastiera, movimento ridotto e URL che segue la scheda", async ({ browser }) => {
  const context = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  const page = await context.newPage();
  const { planPosts } = state.fixture;
  await page.goto(`${state.planUrl}?vista=sfoglia&i=3`);
  await expect(cardTitle(page)).toContainText(planPosts[2].title);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("browse-position")).toHaveText("Post 4 di 5");
  await expect(page).toHaveURL(/i=4/);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("browse-position")).toHaveText("Post 2 di 5");
  // Approved posts show their state, not the two buttons.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("browse-state")).toHaveText(/Programmato|Approvato/);
  await expect(page.getByTestId("browse-approve")).toHaveCount(0);
  await expect(page.getByTestId("browse-notice")).toBeVisible();
  // prefers-reduced-motion: no slide animation.
  const animation = await page.getByTestId("browse-card").evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("none");
  await viewportShot(page, "mese-sfoglia-desktop.png");
  await page.goto(`${state.planUrl}?vista=griglia`);
  await viewportShot(page, "mese-griglia-desktop.png");
  await context.close();
});

test("mese senza piano: griglia, Sfoglia e «Approva i rimanenti»", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const { a, loosePosts } = state.fixture;
  const monthUrl = `${a.reviewUrl}/mese/${state.looseMonth}`;

  await page.goto(a.reviewUrl);
  await page.getByTestId("portal-month-offer").click();
  await page.waitForURL(new RegExp(`/mese/${state.looseMonth}$`));
  await expect(page.getByTestId("month-heading")).toContainText(`Post di ${monthName(state.looseMonth)}`);
  // Two views here: no Panoramica; Griglia is the default.
  const modes = page.getByTestId("month-view-switch");
  await expect(modes.getByRole("link")).toHaveCount(2);
  await expect(modes.getByRole("link", { name: "Griglia" })).toHaveAttribute("aria-current", "page");
  const tiles = page.getByTestId("month-grid").getByRole("listitem");
  await expect(tiles).toHaveCount(3);
  await expect(tiles.first()).toContainText(loosePosts[2].title);
  await expect(page.getByTestId("month-grid").locator(".chip", { hasText: "Da approvare" })).toHaveCount(3);
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "mese-senza-piano-mobile.png");

  await page.getByTestId("quick-review").click();
  await page.waitForURL(/vista=sfoglia/);
  await expect(cardTitle(page)).toContainText(loosePosts[0].title);
  await page.getByTestId("browse-approve").click();
  await expect(cardTitle(page)).toContainText(loosePosts[1].title);
  expect(["APPROVED", "SCHEDULING", "SCHEDULED"]).toContain((await postRow(db, loosePosts[0].id)).status);

  // Commenta: the way back comes to the month route, not to a plan.
  await page.getByTestId("browse-comment").click();
  await page.waitForURL(new RegExp(`/posts/${loosePosts[1].id}\\?da=sfoglia&i=2&mese=${state.looseMonth}`));
  await page.getByTestId("plan-nav").getByRole("link", { name: "← Torna a Sfoglia" }).click();
  await page.waitForURL(new RegExp(`/mese/${state.looseMonth}\\?vista=sfoglia&i=2`));
  await expect(cardTitle(page)).toContainText(loosePosts[1].title);

  // Approve the rest by the summary.
  await page.getByTestId("browse-next").click();
  await expect(cardTitle(page)).toContainText(loosePosts[2].title);
  await page.getByTestId("browse-next").click();
  await expect(page.getByTestId("browse-summary-text")).toHaveText("1 approvato, 2 da decidere");
  await page.getByTestId("browse-approve-rest").click();
  await page.getByRole("dialog").getByRole("button", { name: "Sì, approva 2 post" }).click();
  await expect(page.getByTestId("browse-outcome")).toContainText("Fatto! 2 post approvati.");
  for (const post of loosePosts) {
    const row = await waitForStatus(db, post.id, "SCHEDULED", 60_000);
    expect(row.metricoolPostId).toBeTruthy();
  }
  await page.goto(monthUrl);
  await expect(page.getByTestId("month-grid").locator(".chip", { hasText: /^(Approvato|Programmato)$/ })).toHaveCount(3);
  await context.close();
});

test("il mese di un altro cliente, un mese vuoto o malformato rispondono 404", async ({ browser }) => {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const { a, b } = state.fixture;
  // The other client sees its own month…
  const own = await page.goto(`${b.reviewUrl}/mese/${state.otherMonth}`);
  expect(own.status()).toBe(200);
  await expect(page.getByTestId("month-grid").getByRole("listitem")).toHaveCount(2);
  // …this client's link does not open it, nor an empty or malformed month.
  for (const month of [state.otherMonth, monthInRome(5), "2026-13", "ottobre", "2026-1"]) {
    const response = await page.goto(`${a.reviewUrl}/mese/${month}`);
    expect(response.status(), month).toBe(404);
  }
  await context.close();
});
