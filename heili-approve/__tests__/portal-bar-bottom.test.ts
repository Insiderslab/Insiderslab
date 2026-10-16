import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(path.join(__dirname, "..", ...parts), "utf8");

/**
 * QA-14: a fine pagina la barra delle decisioni resta attaccata al bordo
 * inferiore. Il riempimento del layout (spazio per il pulsante di Heili) e il
 * margine inferiore di `space-y` la tenevano ~120 px più in alto. La misura vera
 * è in e2e/portal-layout.spec.mjs; qui il contratto tra layout e barra.
 */
describe("fondo della pagina con la barra delle decisioni", () => {
  const layout = read("app", "review", "[token]", "layout.tsx");
  const pieces = read("components", "portal", "review-pieces.tsx");
  const bar = pieces.slice(pieces.indexOf("export function DecisionBar"), pieces.indexOf("/** Why the saved-feedback decision"));

  it("il layout lascia 6rem sotto la pagina solo finché nessuna barra imposta --portal-pb", () => {
    expect(layout).toContain("pb-[var(--portal-pb,6rem)]");
    expect(layout).not.toContain("px-4 pb-24");
  });

  it("la barra azzera --portal-pb finché è montata e lo toglie quando se ne va", () => {
    expect(bar).toContain('setProperty("--portal-pb", "0px")');
    expect(bar).toContain('removeProperty("--portal-pb")');
  });

  it("la barra non eredita il margine inferiore di space-y e porta il suo spazio sopra", () => {
    expect(bar).toContain("mb-0");
    expect(bar).toContain("mt-14");
    expect(bar).toContain("sticky bottom-0");
  });
});
