import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * U-04: a 390 px i pulsanti della barra delle decisioni restano su una riga,
 * con testo 16 px e altezza 48 px. Quale dei due è il principale non cambia
 * (decisione di Stefano, QA-09): cambia solo l'aspetto della riga.
 */
describe("barra delle decisioni su telefono", () => {
  const files = ["post-review.tsx", "blog-review.tsx", "ads-review.tsx"].map((name) => ({
    name,
    source: readFileSync(path.join(__dirname, "..", "components", "portal", name), "utf8"),
  }));

  it("ogni pulsante: 48 px, 16 px e niente ritorno a capo", () => {
    for (const { name, source } of files) {
      const bar = source.slice(source.indexOf("<DecisionBar>"), source.indexOf("</DecisionBar>"));
      const buttons = bar.match(/className="[^"]*min-h-12[^"]*"/g) ?? [];
      expect(buttons.length, name).toBeGreaterThanOrEqual(2);
      for (const button of buttons) {
        expect(button, name).toContain("min-h-12");
        expect(button, name).toContain("text-base");
        expect(button, name).toContain("whitespace-nowrap");
      }
    }
  });

  it("la riga usa un gap stretto e lascia respirare il pulsante lungo", () => {
    const ads = files.find((file) => file.name === "ads-review.tsx")!.source;
    // Il pulsante principale può restare della sua larghezza: nessun ritorno a capo.
    expect(ads).toContain("min-h-12 shrink-0 whitespace-nowrap");
  });
});
