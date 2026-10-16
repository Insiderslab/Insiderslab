import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_BAR_HINT, barHintText } from "@/lib/review-assistant/shared";

const read = (...parts: string[]) => readFileSync(path.join(__dirname, "..", ...parts), "utf8");

/**
 * QA-06: su telefono Heili è un foglio modale che copre la barra «Chiedi
 * modifiche / Approva». Il testo sotto il riepilogo non può mandare a premere un
 * pulsante che non si vede: chiede di chiudere Heili e offre la via del ritorno.
 */
describe("indicazione sotto il riepilogo di Heili", () => {
  it("con la barra coperta dal foglio dice di chiudere Heili prima", () => {
    const text = barHintText(true);
    expect(text).toMatch(/chiudi Heili/i);
    expect(text).toContain("«Chiedi modifiche»");
    expect(text.indexOf("chiudi Heili")).toBeLessThan(text.indexOf("«Chiedi modifiche»"));
  });

  it("con la barra visibile accanto al pannello rimanda alla barra", () => {
    const text = barHintText(false);
    expect(text).toContain("nella barra in basso");
    expect(text).not.toMatch(/chiudi/i);
  });

  it("il pannello mostra il pulsante di ritorno solo quando la barra è coperta; il dock lo passa sotto i 1280 px", () => {
    const panel = read("components", "review", "assistant-panel.tsx");
    expect(panel).toContain("barHintText(Boolean(onBackToPage))");
    expect(panel).toContain("{onBackToPage && (");
    expect(panel).toContain("ASSISTANT_BAR_HINT.back");
    expect(ASSISTANT_BAR_HINT.back).toBe("Torna alla pagina");
    const dock = read("components", "portal", "heili", "heili-dock.tsx");
    expect(dock).toContain("onBackToPage={desktop ? undefined : heili.closeDock}");
  });
});
