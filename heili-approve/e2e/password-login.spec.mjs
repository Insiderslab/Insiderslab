// Email + password sign-in: an invited teammate creates the password from the
// invitation link (no email needed), signs out, signs back in with email and
// password, and a wrong password gets one generic message. Phone width.

import { createHash, randomBytes } from "node:crypto";
import { MOBILE, connectDb, expect, expectNoHorizontalScroll, seed, shot, test, uniq } from "./helpers.mjs";

test.describe("accesso con email e password", () => {
  let db;
  let data;

  test.beforeAll(async () => {
    data = seed();
    db = await connectDb();
  });

  test.afterAll(async () => {
    await db?.end();
  });

  test("l'invitata crea la password dal link e poi accede con email e password", async ({ browser }) => {
    const email = `invitata-${uniq()}@example.com`;
    const password = "una password lunga 42";
    const token = randomBytes(18).toString("base64url");
    await db.query(
      `insert into "WorkspaceInvitation" (id, "workspaceId", email, role, token, status, "expiresAt", "updatedAt")
       values ($1, $2, $3, 'MEMBER', $4, 'PENDING', now() + interval '7 days', now())`,
      [`inv_${uniq()}`, data.workspaceId, email, token]
    );

    const context = await browser.newContext({ ...MOBILE, baseURL: data.baseUrl });
    const page = await context.newPage();

    await page.goto(`/invite/${token}`);
    await expect(page.getByLabel("Scegli una password")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "invito-password-mobile.png");

    await page.getByLabel("Scegli una password").fill(password);
    await page.getByLabel("Ripeti la password").fill("un'altra password 42");
    await page.getByRole("button", { name: "Crea la password ed entra" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Le due password non coincidono." })).toBeVisible();

    await page.getByLabel("Scegli una password").fill(password);
    await page.getByLabel("Ripeti la password").fill(password);
    await page.getByRole("button", { name: "Crea la password ed entra" }).click();
    await page.waitForURL(/\/dashboard/);

    const member = await db.query(
      `select m.role from "WorkspaceMember" m join "User" u on u.id = m."userId"
       where u.email = $1 and m."workspaceId" = $2`,
      [email, data.workspaceId]
    );
    expect(member.rows).toEqual([{ role: "MEMBER" }]);
    const invitation = await db.query(`select status from "WorkspaceInvitation" where token = $1`, [token]);
    expect(invitation.rows[0].status).toBe("ACCEPTED");

    // The link is spent: it cannot create a second password.
    await context.clearCookies();
    await page.goto(`/invite/${token}`);
    await expect(page.getByLabel("Scegli una password")).toHaveCount(0);

    await page.goto("/login");
    await page.getByLabel("Email di lavoro").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("password sbagliata");
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Email o password non corretti." })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "login-password-mobile.png");

    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "La tua password" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cambia password" })).toBeVisible();

    // The magic link is still there as the alternative.
    await context.clearCookies();
    await page.goto("/login");
    await page.getByRole("button", { name: "Accedi senza password, con un link via email" }).click();
    await expect(page.getByRole("button", { name: "Inviami il link di accesso" })).toBeVisible();

    // «Password dimenticata?»: the request answers without revealing anything.
    await page.goto("/login");
    await page.getByLabel("Email di lavoro").fill(email);
    await page.getByRole("button", { name: "Password dimenticata?" }).click();
    await expect(page.getByLabel("Email di lavoro")).toHaveValue(email);
    await expectNoHorizontalScroll(page);
    await shot(page, "login-password-dimenticata-mobile.png");
    await page.getByRole("button", { name: "Mandami il link" }).click();
    await expect(page.getByRole("heading", { name: "Controlla la tua email" })).toBeVisible();

    // The emailed link carries a random token stored hashed: replace it with a known one.
    const resetToken = randomBytes(32).toString("base64url");
    const identifier = `password-reset:${email}`;
    const pending = await db.query(`select count(*)::int as n from "VerificationToken" where identifier = $1`, [identifier]);
    expect(pending.rows[0].n).toBe(1);
    await db.query(`delete from "VerificationToken" where identifier = $1`, [identifier]);
    await db.query(`insert into "VerificationToken" (identifier, token, expires) values ($1, $2, now() + interval '1 hour')`, [
      identifier,
      createHash("sha256").update(resetToken).digest("hex"),
    ]);

    const newPassword = "nuova password lunga 7";
    await page.goto(`/nuova-password/${resetToken}`);
    await page.getByLabel("Nuova password").fill(newPassword);
    await page.getByLabel("Ripeti la password").fill(newPassword);
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Salva ed entra" }).click();
    await page.waitForURL(/\/dashboard/);

    // Used once: the same link now offers a new one.
    await context.clearCookies();
    await page.goto(`/nuova-password/${resetToken}`);
    await expect(page.getByRole("link", { name: "Chiedi un nuovo link" })).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email di lavoro").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Email o password non corretti." })).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    await page.waitForURL(/\/dashboard/);

    await context.close();
  });

  test("chi ha già un account non può farsi creare la password da un invito", async ({ browser }) => {
    const owner = await db.query(`select email from "User" where id = $1`, [data.userId]);
    const token = randomBytes(18).toString("base64url");
    await db.query(
      `insert into "WorkspaceInvitation" (id, "workspaceId", email, role, token, status, "expiresAt", "updatedAt")
       values ($1, $2, $3, 'MEMBER', $4, 'PENDING', now() + interval '7 days', now())`,
      [`inv_${uniq()}`, data.workspaceId, owner.rows[0].email, token]
    );
    const context = await browser.newContext({ ...MOBILE, baseURL: data.baseUrl });
    const page = await context.newPage();
    await page.goto(`/invite/${token}`);
    await expect(page.getByRole("link", { name: "Accedi per accettare" })).toBeVisible();
    await expect(page.getByLabel("Scegli una password")).toHaveCount(0);
    await db.query(`delete from "WorkspaceInvitation" where token = $1`, [token]);
    await context.close();
  });
});
