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
