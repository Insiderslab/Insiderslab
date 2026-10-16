// Touch targets of the client portal (QA-11): the controls of the page (or of a scope)
// that are under 44 px, as «tag «name» WxH» strings. Same rule as agency-touch.spec.mjs.

/** Controls under 44 px on the current page; «altro» counts by its real tap area. */
export async function smallControls(page, scopeSelector = "body") {
  return page.evaluate((scopeSelector) => {
    const scope = document.querySelector(scopeSelector) ?? document.body;
    const out = [];
    const selector = "a[href], button, [role=button], [role=tab], summary, select, textarea, input:not([type=hidden]):not([type=file])";
    for (const e of scope.querySelectorAll(selector)) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none" || e.closest("[hidden]")) continue;
      if (e.closest("dialog:not([open])")) continue;
      if (e.tagName === "A" && s.display === "inline") continue; // inside a sentence
      const target = e.matches("input[type=checkbox], input[type=radio]") ? (e.closest("label") ?? e) : e;
      const t = target.getBoundingClientRect();
      let ok = t.height >= 43.5 && t.width >= 43.5;
      if (!ok && /mostra tutto il testo/.test(e.getAttribute("aria-label") ?? "")) {
        // The word is small on purpose; an invisible area around it takes the tap.
        e.scrollIntoView({ block: "center" });
        const c = e.getBoundingClientRect();
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        ok = [[-21, 0], [21, 0], [0, -21], [0, 21]].every(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy)?.closest("button") === e);
      }
      if (!ok) {
        const name = (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        out.push(`${e.tagName.toLowerCase()} «${name}» ${Math.round(t.width)}×${Math.round(t.height)}`);
      }
    }
    return out;
  }, scopeSelector);
}

