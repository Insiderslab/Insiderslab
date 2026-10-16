// End-to-end test of the primary button of the decision bar (post page, 390 px).
// Against the running app (METRICOOL_FAKE=1). Rule: «Approva» is the primary
// button as long as the client has no feedback on the version they are
// looking at (saved comments, an unsent draft with text, Heili feedback that
// «Chiedi modifiche» would send); then «Chiedi modifiche» is. Only the
// emphasis changes: order, confirmation and what each button does stay.
// The blog and ads specs check the same rule on articles and ads sets.

import { execFileSync } from "node:child_process";
import {
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
});

test.afterAll(async () => {
  if (state.fixture) {
    await db?.query('update "Client" set "archivedAt" = now() where id = any($1)', [[state.fixture.a.clientId, state.fixture.b.clientId]]);
  }
  await db?.end();
});

test("pagina del post (390 px): il pulsante principale segue il feedback; l'ordine e le conferme restano", async ({ browser }) => {
  const target = state.fixture.planPosts[3];
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(`${state.fixture.a.reviewUrl}/posts/${target.id}`);
  const approve = page.getByTestId("decision-approve");
  const changes = page.getByTestId("decision-changes");
  await expect(approve).toBeVisible();

  // D1: no feedback → «Approva» is the primary button; one line at 390 px.
  await expect(approve).toHaveAttribute("data-primary", "true");
  await expect(changes).toHaveAttribute("data-primary", "false");
  const [approveBox, changesBox] = [await approve.boundingBox(), await changes.boundingBox()];
  expect(Math.abs(approveBox.y - changesBox.y)).toBeLessThanOrEqual(1);
  expect(approveBox.height).toBeGreaterThanOrEqual(48);
  expect(changesBox.height).toBeGreaterThanOrEqual(48);
  expect(approveBox.x + approveBox.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "decisione-senza-commento-mobile.png");

  // A comment typed but not sent yet already counts as feedback…
  const field = page.getByPlaceholder("Per esempio: darei più spazio al titolo…");
  await field.fill("Il titolo è un po' lungo.");
  await expect(changes).toHaveAttribute("data-primary", "true");
  await expect(approve).toHaveAttribute("data-primary", "false");
  // …and so does an emptied draft the other way round.
  await field.fill("");
  await expect(approve).toHaveAttribute("data-primary", "true");

  // A saved comment: «Chiedi modifiche» is the primary button.
  await field.fill("Il titolo è un po' lungo.");
  await page.getByRole("button", { name: "Invia commento" }).click();
  await expect(page.getByText("Commento salvato")).toBeVisible();
  await expect(changes).toHaveAttribute("data-primary", "true");
  await expect(approve).toHaveAttribute("data-primary", "false");
  const [approve2, changes2] = [await approve.boundingBox(), await changes.boundingBox()];
  expect(Math.abs(approve2.y - changes2.y)).toBeLessThanOrEqual(1);
  expect(approve2.x).toBeGreaterThan(changes2.x); // same order: changes first, then approve
  await expectNoHorizontalScroll(page);
  await viewportShot(page, "decisione-con-commento-mobile.png");
  // What the buttons do has not changed: «Approva» still asks for confirmation.
  await approve.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Approvi questo post?" })).toBeVisible();
  await expect(sheet.getByText(/1 commento aperto/)).toBeVisible();
  await sheet.getByRole("button", { name: "Annulla" }).click();
  await expect(sheet).toBeHidden();
  expect((await postRow(db, target.id)).status).toBe("IN_REVIEW");
  await context.close();
});
