import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SLOW_PREPARATION_MS,
  VOICE_SUPPORT_MESSAGES,
  isSlowPreparation,
  microphoneErrorMessage,
  preparationLabel,
  voiceStartBlocker,
  voiceSupportProblem,
} from "@/components/voice/voice-rules";

const idle = { loading: false, busy: null, outOfSessions: false, messagesLeft: 10, draft: "", dictating: false } as const;

describe("«Parla a voce»: il browser", () => {
  it("dice prima che serve https, poi che manca il microfono o WebRTC", () => {
    const fn = () => undefined;
    expect(voiceSupportProblem({ isSecureContext: false, RTCPeerConnection: fn, getUserMedia: fn })).toBe("insecure");
    expect(voiceSupportProblem({ isSecureContext: true, RTCPeerConnection: undefined, getUserMedia: fn })).toBe("browser");
    expect(voiceSupportProblem({ isSecureContext: true, RTCPeerConnection: fn, getUserMedia: undefined })).toBe("browser");
    expect(voiceSupportProblem({ isSecureContext: true, RTCPeerConnection: fn, getUserMedia: fn })).toBeNull();
    expect(VOICE_SUPPORT_MESSAGES.insecure).toContain("https");
    for (const text of Object.values(VOICE_SUPPORT_MESSAGES)) expect(text).toMatch(/scrivi|detta/);
  });
});

describe("«Parla a voce»: un tocco ha sempre una risposta", () => {
  it("nessun motivo: la chiamata parte", () => {
    expect(voiceStartBlocker(idle)).toBeNull();
  });

  it("ogni motivo ha la sua frase, nell'ordine in cui il cliente può risolverlo", () => {
    expect(voiceStartBlocker({ ...idle, loading: true })).toContain("sto recuperando");
    expect(voiceStartBlocker({ ...idle, busy: "send" })).toContain("Attendi la risposta di Heili");
    expect(voiceStartBlocker({ ...idle, busy: "finalize" })).toContain("riepilogo");
    expect(voiceStartBlocker({ ...idle, busy: "approve" })).toContain("Attendi");
    expect(voiceStartBlocker({ ...idle, outOfSessions: true })).toContain("tutte le conversazioni");
    expect(voiceStartBlocker({ ...idle, messagesLeft: 0 })).toContain("numero massimo di messaggi");
    expect(voiceStartBlocker({ ...idle, dictating: true })).toContain("Ferma la dettatura");
    expect(voiceStartBlocker({ ...idle, draft: "  testo " })).toContain("Invia prima il messaggio scritto");
    expect(voiceStartBlocker({ ...idle, draft: "   " })).toBeNull();
    expect(voiceStartBlocker({ ...idle, messagesLeft: null })).toBeNull();
  });

  it("il pulsante non è mai disabilitato in silenzio", () => {
    const panel = readFileSync(path.join(process.cwd(), "components/review/assistant-panel.tsx"), "utf8");
    const button = panel.slice(panel.indexOf('data-testid="voice-start"') - 600, panel.indexOf('data-testid="voice-start"'));
    expect(button).toContain("onClick={startConversation}");
    expect(button).not.toMatch(/\sdisabled=\{/);
  });
});

describe("«Parla a voce»: l'avanzamento della preparazione", () => {
  it("dice cosa prepara e quanto manca", () => {
    expect(preparationLabel({ total: 3, ready: 2, videos: 0 })).toBe("Preparo le immagini: 2 di 3");
    expect(preparationLabel({ total: 2, ready: 0, videos: 2 })).toBe("Preparo i video: 0 di 2");
    expect(preparationLabel({ total: 4, ready: 1, videos: 1 })).toBe("Preparo immagini e video: 1 di 4");
    expect(preparationLabel({ total: 1, ready: 0, videos: 0 })).toBe("Preparo l’immagine…");
    expect(preparationLabel({ total: 1, ready: 0, videos: 1 })).toBe("Preparo il video…");
    expect(preparationLabel({ total: 0, ready: 0, videos: 0 })).toBe("Preparo la conversazione…");
    expect(preparationLabel(null)).toBe("Preparo la conversazione…");
    // Never more ready than the total, never negative.
    expect(preparationLabel({ total: 3, ready: 7, videos: 0 })).toBe("Preparo le immagini: 3 di 3");
    expect(preparationLabel({ total: 3, ready: -1, videos: 0 })).toBe("Preparo le immagini: 0 di 3");
  });

  it("un'attesa senza progressi ha una frase dopo 20 secondi", () => {
    expect(isSlowPreparation(1_000, 1_000 + SLOW_PREPARATION_MS - 1)).toBe(false);
    expect(isSlowPreparation(1_000, 1_000 + SLOW_PREPARATION_MS)).toBe(true);
  });
});

describe("«Parla a voce»: il microfono", () => {
  it("spiega permesso negato, microfono assente o occupato", () => {
    expect(microphoneErrorMessage({ name: "NotAllowedError" })).toContain("consentilo dalle impostazioni del sito");
    expect(microphoneErrorMessage({ name: "SecurityError" })).toContain("bloccato");
    expect(microphoneErrorMessage({ name: "NotFoundError" })).toContain("Non trovo un microfono");
    expect(microphoneErrorMessage({ name: "NotReadableError" })).toContain("un’altra app");
    expect(microphoneErrorMessage(new Error("altro"))).toBeNull();
    expect(microphoneErrorMessage(null)).toBeNull();
  });

  it("il microfono si chiede al tocco, prima di ogni attesa, e resta spento fino alla chiamata", () => {
    const hook = readFileSync(path.join(process.cwd(), "components/voice/use-live-conversation.ts"), "utf8");
    const start = hook.slice(hook.indexOf("const start = useCallback"));
    const firstAwait = start.indexOf("await ");
    expect(start.indexOf("getUserMedia(")).toBeGreaterThan(0);
    expect(start.indexOf("getUserMedia(")).toBeLessThan(firstAwait);
    expect(start.indexOf("getUserMedia(")).toBeLessThan(start.indexOf("/prepare"));
    expect(start).toContain("track.enabled = false");
  });
});
