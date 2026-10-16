import { describe, expect, it } from "vitest";
import { liveStatus } from "@/components/review/assistant-panel";

/** H-04: stato della chiamata con parola e tinta, senza animazioni. */
describe("stati della conversazione vocale", () => {
  it("una parola chiara per ogni fase", () => {
    // The microphone is asked for at the tap: the first word says so.
    expect(liveStatus("preparing", { muted: false, speaking: false, step: "microphone" })).toEqual({
      label: "Attivo il microfono: se il browser lo chiede, tocca «Consenti».",
      tone: "waiting",
    });
    // Then the media context, with the count from /voice/prepare.
    expect(liveStatus("preparing", { muted: false, speaking: false, step: "context", preparation: { total: 3, ready: 2, videos: 0 } })).toEqual({
      label: "Preparo le immagini: 2 di 3",
      tone: "waiting",
    });
    expect(liveStatus("preparing", { muted: false, speaking: false })).toEqual({
      label: "Preparo la conversazione…",
      tone: "waiting",
    });
    expect(liveStatus("connecting", { muted: false, speaking: false })).toEqual({
      label: "Mi collego a Heili…",
      tone: "waiting",
    });
    expect(liveStatus("closing", { muted: false, speaking: false })).toEqual({
      label: "Salvo la conversazione…",
      tone: "waiting",
    });
    expect(liveStatus("active", { muted: false, speaking: false })).toEqual({ label: "In ascolto", tone: "listening" });
    expect(liveStatus("active", { muted: false, speaking: true })).toEqual({ label: "Heili sta parlando", tone: "speaking" });
    // Con il microfono silenziato la parola giusta è «In pausa», anche se Heili parla.
    expect(liveStatus("active", { muted: true, speaking: false })).toEqual({ label: "In pausa", tone: "paused" });
    expect(liveStatus("active", { muted: true, speaking: true })).toEqual({ label: "In pausa", tone: "paused" });
  });
});
