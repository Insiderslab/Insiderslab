import { describe, expect, it } from "vitest";
import { mergeSpeechText, shouldSubmitSpeechTurn, speechErrorMessage } from "@/components/voice/use-speech-input";

describe("voice input helpers", () => {
  it("appends speech without discarding an existing draft", () => {
    expect(mergeSpeechText("Mantieni questo testo", " e aggiungi questo ", 200)).toBe(
      "Mantieni questo testo e aggiungi questo"
    );
  });

  it("keeps a context marker with the dictated feedback", () => {
    expect(mergeSpeechText("[Momento 0:07]", "Il titolo entra troppo presto", 200)).toBe(
      "[Momento 0:07] Il titolo entra troppo presto"
    );
  });

  it("enforces the field limit on speech just like typed text", () => {
    expect(mergeSpeechText("1234", "56789", 7)).toBe("1234 56");
  });

  it("returns useful browser and permission fallbacks", () => {
    expect(speechErrorMessage("not-allowed")).toContain("microfono");
    expect(speechErrorMessage("audio-capture")).toContain("microfono");
    expect(speechErrorMessage("unknown")).toContain("scrivi");
  });

  it("auto-submits only an explicit, non-cancelled conversation turn", () => {
    expect(shouldSubmitSpeechTurn({ cancelled: false, submitOnEnd: true, spoken: "cambia il titolo" })).toBe(true);
    expect(shouldSubmitSpeechTurn({ cancelled: false, submitOnEnd: false, spoken: "solo dettatura" })).toBe(false);
    expect(shouldSubmitSpeechTurn({ cancelled: true, submitOnEnd: true, spoken: "bozza da conservare" })).toBe(false);
    expect(shouldSubmitSpeechTurn({ cancelled: false, submitOnEnd: true, spoken: "   " })).toBe(false);
  });
});
