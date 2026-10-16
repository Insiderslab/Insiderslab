// End-to-end test of «Approvato · Annulla»: the few seconds after a client
// approval in which it can be taken back. Against the running app
// (METRICOOL_FAKE=1) and worker, with E2E_WORKER_LOG pointing at the worker's
// stdout (where the fake Metricool client prints the payloads it would send).
//
// The approval is recorded at once, but scheduling and the agency email wait
// 15 seconds (queue "approval-finalize"):
// 1. Sfoglia (390 px): approve → toast «Approvato · Annulla» → Annulla → the
//    card is "Da approvare" again, the post is IN_REVIEW, the agency timeline
//    reads «Approvazione annullata dal cliente», and 17 seconds later nothing
//    was scheduled (no payload in the worker log).
// 2. Sfoglia: approve and leave it → the toast goes away by itself, the
//    post is still APPROVED inside the window and gets scheduled after it.
// 3. A refusal: scheduling starts under the toast → «Troppo tardi per
//    annullare: scrivi all'agenzia», the state is untouched.
// 4. The post page (390 px, reduced motion): sheet → «Sì, approva» → toast →
//    Annulla → decision bar back, "Da approvare".

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  MOBILE,
  agencyContext,
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

function monthInRome(delta) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** How many payloads the fake Metricool client has printed so far. */
function payloadCount() {
  const logPath = process.env.E2E_WORKER_LOG;
  if (!logPath || !existsSync(logPath)) {
    throw new Error("Imposta E2E_WORKER_LOG con il log del worker (METRICOOL_FAKE=1 npm run worker > worker.log)");
  }
  return readFileSync(logPath, "utf8").split("\n").filter((line) => line.includes("[Metricool fake] payload ")).length;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventTypes(postId) {
  const { rows } = await db.query('select type from "PostEvent" where "postId" = $1 order by "createdAt"', [postId]);
  return rows.map((row) => row.type);
}

const cardTitle = (page) => page.getByTestId("browse-card").getByRole("heading", { level: 2 });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  const out = execFileSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "e2e/support/create-month-fixture.ts",
      data.workspaceId,
      data.userId,
      monthInRome(1),
      monthInRome(2),
      monthInRome(3),
      uniq(),
    ],
    { cwd: root, env: { ...process.env, APP_VARIANT: "all" }, encoding: "utf8" }
  );
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`Fixture senza RESULT:\n${out}`);
  state.fixture = JSON.parse(line.slice("RESULT ".length));
  state.sfogliaUrl = `${state.fixture.a.reviewUrl}/piani/${state.fixture.planId}?vista=sfoglia`;
});

test.afterAll(async () => {
  if (state.fixture) {
    await db?.query('update "Client" set "archivedAt" = now() where id = any($1)', [[state.fixture.a.clientId, state.fixture.b.clientId]]);
  }
  await db?.end();
});

test("Sfoglia (390 px): approva, Annulla, il post torna «Da approvare» e non viene programmato", async ({ browser }) => {
  const [first] = state.fixture.planPosts;
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const before = payloadCount();

  await page.goto(state.sfogliaUrl);
  await expect(cardTitle(page)).toContainText(first.title);
  await page.getByTestId("browse-approve").click();
  await expect(cardTitle(page)).toContainText(state.fixture.planPosts[1].title);

  // The approval is recorded at once, tied to the version…
  const approved = await postRow(db, first.id);
  expect(approved.status).toBe("APPROVED");

  // …and the toast says so: a status region, 44 px button, the seconds left.
  const toast = page.getByTestId("undo-toast");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toHaveAttribute("aria-live", /polite|assertive/);
  await expect(toast.getByTestId("undo-label")).toContainText("Approvato");
  const button = toast.getByTestId("undo-button");
  await expect(button).toHaveText("Annulla");
  expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "undo-toast-sfoglia-mobile.png");

  await button.click();
  await expect(toast).toHaveCount(0);
  // The card comes back, waiting for a decision again.
  await expect(cardTitle(page)).toContainText(first.title);
  await expect(page.getByTestId("browse-state")).toHaveText("Da approvare");
  await expect(page.getByTestId("browse-approve")).toBeVisible();
  await expect(page.getByText("0 di 5 revisionati").first()).toBeVisible();

  const row = await postRow(db, first.id);
  expect(row.status).toBe("IN_REVIEW");
  const { rows } = await db.query('select "approvedAt", "approvedByReviewerId" from "Post" where id = $1', [first.id]);
  expect(rows[0]).toEqual({ approvedAt: null, approvedByReviewerId: null });
  const types = await eventTypes(first.id);
  expect(types).toContain("APPROVED");
  expect(types.at(-1)).toBe("APPROVAL_UNDONE");

  // The agency timeline says so.
  const agency = await agencyContext(browser, data);
  const agencyPage = await agency.newPage();
  await agencyPage.goto(`/posts/${first.id}?tab=attivita`);
  await expect(agencyPage.getByText("Approvazione annullata dal cliente").first()).toBeVisible();
  await agency.close();

  // Past the delay (15 s) nothing was scheduled or queued.
  await sleep(17_000);
  expect((await postRow(db, first.id)).status).toBe("IN_REVIEW");
  expect(await eventTypes(first.id)).not.toContain("SCHEDULE_REQUESTED");
  expect(payloadCount()).toBe(before);
  await context.close();
});

test("Sfoglia: lasciata l'approvazione, il toast sparisce e dopo 15 s il post viene programmato", async ({ browser }) => {
  const [first] = state.fixture.planPosts;
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  const before = payloadCount();

  await page.goto(state.sfogliaUrl);
  await expect(cardTitle(page)).toContainText(first.title);
  const clickedAt = Date.now();
  await page.getByTestId("browse-approve").click();
  await expect(page.getByTestId("undo-toast")).toBeVisible();

  // Inside the window: approved, nothing queued yet.
  await sleep(6_000);
  expect((await postRow(db, first.id)).status).toBe("APPROVED");
  expect(await eventTypes(first.id)).not.toContain("SCHEDULE_REQUESTED");
  expect(payloadCount()).toBe(before);

  // The toast lasts 10 s, then it is gone by itself.
  await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 8_000 });
  expect(Date.now() - clickedAt).toBeGreaterThanOrEqual(9_000);

  // After the window the worker schedules it, like before the undo existed.
  const scheduled = await waitForStatus(db, first.id, "SCHEDULED", 40_000);
  expect(Date.now() - clickedAt).toBeGreaterThanOrEqual(14_000);
  expect(scheduled.metricoolPostId).toMatch(/^fake-/);
  expect(payloadCount()).toBe(before + 1);
  expect(await eventTypes(first.id)).toContain("SCHEDULED");
  await context.close();
});

test("Annulla troppo tardi: lo stato resta quello e il messaggio è chiaro", async ({ browser }) => {
  const target = state.fixture.planPosts[2];
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(`${state.sfogliaUrl}&i=3`);
  await expect(cardTitle(page)).toContainText(target.title);
  await page.getByTestId("browse-approve").click();
  const toast = page.getByTestId("undo-toast");
  await expect(toast).toBeVisible();

  // The agency (or a sweep) starts scheduling under the toast.
  await db.query('update "Post" set status = \'SCHEDULING\' where id = $1', [target.id]);
  await toast.getByTestId("undo-button").click();
  await expect(toast.getByTestId("undo-error")).toHaveText("Troppo tardi per annullare: scrivi all'agenzia");
  await expect(toast.getByRole("button", { name: "Chiudi" })).toBeVisible();
  await viewportShot(page, "undo-toast-troppo-tardi-mobile.png");

  const row = await postRow(db, target.id);
  expect(row.status).toBe("SCHEDULING");
  expect(await eventTypes(target.id)).not.toContain("APPROVAL_UNDONE");
  await toast.getByRole("button", { name: "Chiudi" }).click();
  await expect(toast).toHaveCount(0);
  await context.close();
});

test("pagina del post (390 px): conferma, toast «Approvato · Annulla», Annulla riapre la decisione", async ({ browser }) => {
  const target = state.fixture.loosePosts[0];
  const context = await browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  const page = await context.newPage();
  const before = payloadCount();

  await page.goto(`${state.fixture.a.reviewUrl}/posts/${target.id}`);
  await page.getByTestId("decision-approve").click();
  await page.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Post approvato.")).toBeVisible();
  expect((await postRow(db, target.id)).status).toBe("APPROVED");

  const toast = page.getByTestId("undo-toast");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("role", "status");
  expect((await toast.getByTestId("undo-button").boundingBox()).height).toBeGreaterThanOrEqual(44);
  await viewportShot(page, "undo-toast-post-mobile.png");

  await toast.getByTestId("undo-button").click();
  await expect(toast).toHaveCount(0);
  // The page is as it was: waiting for a decision, the bar is back.
  await expect(page.getByText("Fatto! Post approvato.")).toHaveCount(0);
  await expect(page.getByTestId("decision-approve")).toBeVisible();
  await expect(page.getByText("Da approvare", { exact: true }).first()).toBeVisible();
  expect((await postRow(db, target.id)).status).toBe("IN_REVIEW");
  expect((await eventTypes(target.id)).at(-1)).toBe("APPROVAL_UNDONE");

  // Approving again works and is scheduled once, after its own window.
  await page.getByTestId("decision-approve").click();
  await page.getByRole("button", { name: "Sì, approva" }).click();
  await expect(page.getByText("Fatto! Post approvato.")).toBeVisible();
  await waitForStatus(db, target.id, "SCHEDULED", 40_000);
  expect(payloadCount()).toBe(before + 1);
  await context.close();
});
