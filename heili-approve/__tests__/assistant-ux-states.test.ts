import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** U-07: attesa con i puntini (fermi con reduced motion) ed errore con «Riprova». */
describe("stati di attesa e di errore della chat", () => {
  const panel = readFileSync(path.join(__dirname, "..", "components", "review", "assistant-panel.tsx"), "utf8");
  const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");

  it("mentre Heili risponde: «Heili sta scrivendo» con tre puntini", () => {
    expect(panel).toContain("Heili sta scrivendo");
    expect(panel).toContain("typing-dots");
    expect(panel).not.toContain("L&apos;assistente sta scrivendo");
  });

  it("i puntini si muovono solo con prefers-reduced-motion: no-preference", () => {
    expect(css).toContain(".typing-dots");
    const gate = css.indexOf("prefers-reduced-motion: no-preference");
    const animation = css.indexOf("animation: typing-dot");
    expect(gate).toBeGreaterThan(-1);
    expect(animation).toBeGreaterThan(gate);
  });

  it("in errore: una riga con il testo conservato e «Riprova»", () => {
    expect(panel).toContain("Riprova");
    // Il testo torna nella casella quando il server non l'ha salvato.
    expect(panel).toContain("setDraft(message)");
  });
});
