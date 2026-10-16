// Agency panel on a phone (390 px): every control that can be tapped is at least 44 px high
// (QA-09). Links, buttons, fields, disclosure rows and checkboxes (their label counts) of the
// pages an agency uses most are measured with their real text; the run also checks that the
// fields keep a 16 px font (no iOS zoom).
//
// Left out on purpose: inline links inside a sentence, the visually hidden file input, and the
// «altro» expander inside the network mockups (it imitates the network's own control).

import { MOBILE, agencyContext, expect, seed, test } from "./helpers.mjs";

let data;

test.beforeAll(() => {
  data = seed();
});

/** Controls under 44 px (width or height) on the current page. */
async function smallControls(page) {
  return page.evaluate(() => {
    const out = [];
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden]");
    };
    const selector = "a[href], button, [role=button], [role=tab], summary, select, textarea, input:not([type=hidden]):not([type=file])";
    for (const e of document.querySelectorAll(selector)) {
      if (!visible(e)) continue;
      if (e.tagName === "A" && getComputedStyle(e).display === "inline") continue; // inside a sentence
      if (/mostra tutto il testo/.test(e.getAttribute("aria-label") ?? "")) continue; // network mockup
      const target = e.matches("input[type=checkbox], input[type=radio]") ? (e.closest("label") ?? e) : e;
      const r = target.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) {
        const name = (e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        out.push(`${e.tagName.toLowerCase()} «${name}» ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      if (e.matches("input:not([type=checkbox]):not([type=radio]), select, textarea") && parseFloat(getComputedStyle(e).fontSize) < 16) {
        out.push(`${e.tagName.toLowerCase()} font ${getComputedStyle(e).fontSize} (sotto 16 px)`);
      }
    }
    return out;
  });
}

test("agenzia a 390 px: nessun controllo sotto i 44 px nelle pagine principali", async ({ browser }) => {
  const context = await agencyContext(browser, data, { options: MOBILE });
  const page = await context.newPage();
  const aurora = data.clients.find((c) => c.name === "Caffè Aurora");
  const social = data.posts.find((p) => p.client === "Caffè Aurora" && p.status === "IN_REVIEW");
  const draft = data.posts.find((p) => p.status === "DRAFT");
  const pages = [
    ["dashboard", "/dashboard"],
    ["elenco post", "/posts"],
    ["clienti", "/clients"],
    ["scheda cliente", `/clients/${aurora.id}`],
    ["piani", "/plans"],
    ["piano", `/plans/${data.plan.id}`],
    ["impostazioni", "/settings"],
    ["post in revisione", `/posts/${social.id}`],
    ["bozza", `/posts/${draft.id}`],
    ["nuovo post", "/posts/new"],
    ["annuncio", `/posts/${data.ads.posts[0].id}`],
    ["articolo", `/posts/${data.blog.posts[0].id}`],
    ["calendario", "/calendar"],
  ];
  const failures = [];
  for (const [name, url] of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    // Disclosure rows count too: open them, the summary is what is tapped either way.
    for (const found of await smallControls(page)) failures.push(`${name}: ${found}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
  await context.close();
});
