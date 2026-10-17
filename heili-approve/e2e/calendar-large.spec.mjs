// D-04: the agency calendar with more than 1,000 items in view. A client of
// its own gets 1,050 posts on the 3rd of a month far ahead and one on the
// 20th; the month grid must show "+1046 altri" on the 3rd and the post of the
// 20th (with the old `take: 1000` the 20th was empty and the count stopped at
// 996). Rows are inserted with SQL (no media, no versions: the calendar reads
// only the post) and the client is deleted at the end.

import { DESKTOP, agencyContext, connectDb, expect, seed, test, uniq } from "./helpers.mjs";

let data;
let db;
const state = {};

test.beforeAll(async () => {
  data = seed();
  db = await connectDb();
  const ahead = new Date();
  ahead.setUTCMonth(ahead.getUTCMonth() + 26, 1);
  state.month = `${ahead.getUTCFullYear()}-${String(ahead.getUTCMonth() + 1).padStart(2, "0")}`;
  state.clientId = `e2ecal${uniq()}`;
  await db.query(
    `insert into "Client" (id, "workspaceId", name, networks, "updatedAt") values ($1, $2, $3, '{facebook}', now())`,
    [state.clientId, data.workspaceId, `E2E Calendario affollato ${uniq()}`]
  );
  await db.query(
    `insert into "Post" (id, "workspaceId", "clientId", title, "publishAt", networks, "updatedAt")
     select $1 || '-' || g, $2, $3, 'E2E affollato ' || g, ($4::date + time '09:00') + g * interval '1 second', '{facebook}', now()
     from generate_series(1, 1050) g`,
    [state.clientId, data.workspaceId, state.clientId, `${state.month}-03`]
  );
  await db.query(
    `insert into "Post" (id, "workspaceId", "clientId", title, "publishAt", networks, "updatedAt")
     values ($1, $2, $3, 'E2E ultimo del mese', $4::date + time '09:00', '{facebook}', now())`,
    [`${state.clientId}-last`, data.workspaceId, state.clientId, `${state.month}-20`]
  );
});

test.afterAll(async () => {
  if (state.clientId) await db?.query('delete from "Client" where id = $1', [state.clientId]);
  await db?.end();
});

test("calendario con più di 1.000 contenuti: conteggi giusti e nessun giorno perso (D-04)", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: DESKTOP });
  const page = await context.newPage();
  await page.goto(`/calendar?clientId=${state.clientId}&mese=${state.month}`);
  await expect(page.getByTestId(`calendar-more-${state.month}-03`)).toHaveText("+1046 altri");
  await expect(page.getByRole("link", { name: /E2E ultimo del mese/ }).first()).toBeVisible();
  // The cell lists the first four of the day, in time order.
  await expect(page.getByRole("link", { name: /E2E affollato 1$/ }).first()).toBeVisible();
  await context.close();
});
