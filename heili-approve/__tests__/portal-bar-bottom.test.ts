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

/**
 * QA-12: su telefono il pulsante di Heili sta dentro il bordo destro della barra
 * delle decisioni, non sopra l'immagine. La barra misura e pubblica due distanze
 * (--decision-bar-h: bordo alto → fondo finestra; --decision-bar-b: bordo basso →
 * fondo finestra) e un attributo sull'<html>; il CSS del pulsante le legge.
 */
describe("pulsante di Heili e barra delle decisioni (telefono)", () => {
  const css = read("app", "globals.css");
  const pieces = read("components", "portal", "review-pieces.tsx");
  const dock = read("components", "portal", "heili", "heili-dock.tsx");

  it("la barra pubblica le due variabili e l'attributo, e li toglie quando se ne va", () => {
    expect(pieces).toContain('setProperty("--decision-bar-h"');
    expect(pieces).toContain('setProperty("--decision-bar-b"');
    expect(pieces).toContain('dataset.decisionBar = ""');
    expect(pieces).toContain('removeProperty("--decision-bar-b")');
    expect(pieces).toContain("delete document.documentElement.dataset.decisionBar");
  });

  it("sotto 640 px il pulsante si allinea ai pulsanti della barra e la barra gli lascia 72 px a destra", () => {
    expect(css).toMatch(/@media \(max-width: 639px\) \{\s*html\[data-decision-bar\] \.heili-launcher \{\s*right: 1rem;\s*bottom: calc\(var\(--decision-bar-b, 0px\) \+ max\(0\.75rem, env\(safe-area-inset-bottom\)\)\);/);
    expect(pieces).toContain("max-sm:pr-[4.5rem]");
    expect(dock).toContain('className="heili-launcher fixed');
    // Da 640 px in su resta sopra la barra, come prima.
    expect(css).toMatch(/\.heili-launcher \{\s*bottom: calc\(var\(--decision-bar-h, 0px\)/);
  });
});
