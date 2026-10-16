import { describe, expect, it } from "vitest";
import { assistantStep } from "@/components/review/assistant-panel";

/** U-03: l'indicatore «1 Parla · 2 Controlla · 3 Invia» segue il flusso. */
describe("passi del riepilogo", () => {
  it("evidenzia Parla, poi Controlla, poi Invia", () => {
    expect(assistantStep({ completed: false, submitting: false, done: false })).toBe(1);
    expect(assistantStep({ completed: true, submitting: false, done: false })).toBe(2);
    expect(assistantStep({ completed: true, submitting: true, done: false })).toBe(3);
    expect(assistantStep({ completed: true, submitting: false, done: true })).toBe(3);
    expect(assistantStep({ completed: false, submitting: true, done: false })).toBe(3);
  });
});

/** QA-17: il terzo passo ha il nome del gesto che chiude il flusso. */
describe("nome del terzo passo", () => {
  it("«Invia» prima della richiesta di modifiche, «Aggiungi» dopo (Aggiungi al feedback)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(path.join(__dirname, "..", "components", "review", "assistant-panel.tsx"), "utf8");
    expect(source).toContain('[3, feedbackMode ? "Aggiungi" : "Invia"]');
    expect(source).toContain('aria-label={feedbackMode ? "Passi: parla, controlla, aggiungi" : "Passi: parla, controlla, invia"}');
  });
});
