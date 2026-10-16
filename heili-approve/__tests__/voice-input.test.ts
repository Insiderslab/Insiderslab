import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SPEECH_NO_START_MESSAGE,
  SPEECH_PROMPT_TIMEOUT_MS,
  SPEECH_START_TIMEOUT_MS,
  SPEECH_UNSUPPORTED_MESSAGE,
  mergeSpeechText,
  shouldSubmitSpeechTurn,
  speechErrorMessage,
  speechStartTimeout,
} from "@/components/voice/use-speech-input";

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
    expect(speechErrorMessage("not-allowed")).toContain("impostazioni del sito");
    expect(speechErrorMessage("no-speech")).toContain("Non ti ho sentito");
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

describe("dettatura: un tocco ha sempre una risposta", () => {
  it("senza riconoscimento vocale o se non parte, la frase dice cosa fare", () => {
    expect(SPEECH_UNSUPPORTED_MESSAGE).toContain("non è disponibile in questo browser");
    expect(SPEECH_UNSUPPORTED_MESSAGE).toContain("microfono della tastiera");
    expect(SPEECH_NO_START_MESSAGE).toContain("non risponde");
    expect(SPEECH_NO_START_MESSAGE).toMatch(/scrivi il messaggio/);
  });

  it("aspetta poco se il microfono è già consentito, a lungo mentre il browser chiede il permesso", () => {
    expect(speechStartTimeout("granted")).toBe(SPEECH_START_TIMEOUT_MS);
    expect(speechStartTimeout("prompt")).toBe(SPEECH_PROMPT_TIMEOUT_MS);
    expect(speechStartTimeout(null)).toBe(SPEECH_PROMPT_TIMEOUT_MS);
    expect(SPEECH_START_TIMEOUT_MS).toBeLessThan(SPEECH_PROMPT_TIMEOUT_MS);
  });

  it("il microfono senza dettatura non è un'icona disabilitata e muta", () => {
    const source = readFileSync(path.join(process.cwd(), "components/voice/dictation-button.tsx"), "utf8");
    const start = source.indexOf("if (!speech.supported)");
    const unsupported = source.slice(start, source.indexOf("La dettatura non è supportata", start));
    expect(unsupported).toContain("onClick={() => speech.start()}");
    expect(unsupported).not.toMatch(/\sdisabled\s*\n/);
  });
});
