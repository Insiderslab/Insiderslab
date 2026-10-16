/**
 * Pure rules of «Parla a voce» (GPT-Live in the portal): what the browser
 * lacks, why a tap cannot start a call, and the words shown while it starts.
 * Rule of the portal: a tap always answers within 300 ms, with a state
 * («Preparo…») or a sentence that says why not and what to do instead.
 * Tested in __tests__/voice-rules.test.ts.
 */

// ─── Browser ─────────────────────────────────────────────────────────────────

export type VoiceSupportProblem = "insecure" | "browser";

/** What this browser lacks for a WebRTC call with the microphone (null: nothing). */
export function voiceSupportProblem(env: {
  isSecureContext?: boolean;
  RTCPeerConnection?: unknown;
  getUserMedia?: unknown;
}): VoiceSupportProblem | null {
  // Without https the browser hides the microphone API altogether: say that first.
  if (!env.isSecureContext) return "insecure";
  if (!env.RTCPeerConnection || !env.getUserMedia) return "browser";
  return null;
}

export const VOICE_SUPPORT_MESSAGES: Record<VoiceSupportProblem, string> = {
  insecure:
    "La voce funziona solo con un collegamento sicuro (https): apri il link dell’email così com’è. Intanto puoi scrivere o dettare il messaggio qui sotto.",
  browser:
    "Questo browser non permette di usare il microfono per parlare con Heili. Apri il link in Safari o Chrome, oppure scrivi o detta il messaggio qui sotto.",
};

// ─── Why a tap cannot start a call ───────────────────────────────────────────

/** The first reason a tap on «Parla a voce» cannot start a call now, in words; null when it can. */
export function voiceStartBlocker(state: {
  loading: boolean;
  busy: null | "send" | "finalize" | "submit" | "approve";
  outOfSessions: boolean;
  messagesLeft: number | null;
  draft: string;
  dictating: boolean;
}): string | null {
  if (state.loading) return "Un momento: sto recuperando la conversazione, poi puoi parlare con Heili.";
  if (state.busy === "send") return "Attendi la risposta di Heili, poi puoi parlare a voce.";
  if (state.busy === "finalize") return "Sto preparando il riepilogo: attendi qualche secondo.";
  if (state.busy !== null) return "Attendi che l’invio finisca.";
  if (state.outOfSessions) {
    return "Hai già usato tutte le conversazioni disponibili per questo contenuto. Puoi lasciare un commento scritto o dettato.";
  }
  if (state.messagesLeft === 0) {
    return "Questa conversazione ha raggiunto il numero massimo di messaggi: prepara il riepilogo per l’agenzia.";
  }
  if (state.dictating) return "Ferma la dettatura, poi avvia la conversazione vocale.";
  if (state.draft.trim()) return "Invia prima il messaggio scritto oppure svuotalo, poi avvia la conversazione vocale.";
  return null;
}

// ─── While the call starts ───────────────────────────────────────────────────

export interface VoicePreparation {
  total: number;
  ready: number;
  videos: number;
}

/** «Preparo le immagini: 2 di 3», naming what the content holds. */
export function preparationLabel(preparation: VoicePreparation | null): string {
  if (!preparation) return "Preparo la conversazione…";
  const { total, videos } = preparation;
  if (total <= 0) return "Preparo la conversazione…";
  const ready = Math.max(0, Math.min(total, preparation.ready));
  const what = videos <= 0 ? "le immagini" : videos >= total ? "i video" : "immagini e video";
  if (total === 1) return `Preparo ${videos >= 1 ? "il video" : "l’immagine"}…`;
  return `Preparo ${what}: ${ready} di ${total}`;
}

export const VOICE_STEP_LABELS = {
  microphone: "Attivo il microfono: se il browser lo chiede, tocca «Consenti».",
  connecting: "Mi collego a Heili…",
  closing: "Salvo la conversazione…",
} as const;

/** After this long with no item getting ready, the wait gets a sentence of its own. */
export const SLOW_PREPARATION_MS = 20_000;

export const SLOW_PREPARATION_MESSAGE =
  "Ci vuole più del solito. Puoi aspettare oppure annullare e scrivere il messaggio.";

/** The analysis is not moving: true when nothing got ready for SLOW_PREPARATION_MS. */
export function isSlowPreparation(lastProgressAt: number, now: number): boolean {
  return now - lastProgressAt >= SLOW_PREPARATION_MS;
}

// ─── Microphone errors ───────────────────────────────────────────────────────

/** getUserMedia failures in words that say what to do. */
export function microphoneErrorMessage(cause: unknown): string | null {
  const name = (cause as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Il microfono è bloccato: consentilo dalle impostazioni del sito (l’icona accanto all’indirizzo) e riprova, oppure scrivi il messaggio.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "Non trovo un microfono su questo dispositivo. Puoi scrivere il messaggio qui sotto.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "Il microfono è usato da un’altra app (per esempio una chiamata). Chiudila e riprova, oppure scrivi il messaggio.";
  }
  return null;
}

export const PLAYBACK_BLOCKED_MESSAGE = "Il browser ha bloccato l’audio di Heili: tocca «Attiva audio» per sentirla.";
