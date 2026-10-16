"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface SpeechRecognitionResultLike {
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  onaudiostart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type StartOptions = {
  /** Text kept before the new speech. Defaults to the current field value. */
  baseText?: string;
  /** A normal dictation can stay open; a conversation turn ends after one phrase. */
  continuous?: boolean;
  /** Only the explicitly enabled conversation mode uses this. */
  submitOnEnd?: boolean;
};

const SPEECH_ERRORS: Record<string, string> = {
  "not-allowed": "Il microfono è bloccato: consentilo dalle impostazioni del sito e riprova, oppure scrivi il messaggio.",
  "service-not-allowed": "Il microfono è bloccato: consentilo dalle impostazioni del sito e riprova, oppure scrivi il messaggio.",
  "no-speech": "Non ti ho sentito: riprova, oppure scrivi il messaggio.",
  "audio-capture": "Non trovo un microfono disponibile su questo dispositivo.",
  network: "Il riconoscimento vocale non è disponibile senza connessione.",
};

/** No dictation in this browser: the tap says so and what to do instead. */
export const SPEECH_UNSUPPORTED_MESSAGE =
  "La dettatura non è disponibile in questo browser. Puoi usare il microfono della tastiera del telefono oppure scrivere il messaggio.";
/** The recognizer accepted start() but never started (some in-app browsers, no speech service). */
export const SPEECH_NO_START_MESSAGE =
  "Il microfono non risponde: la dettatura non è partita. Riprova, usa il microfono della tastiera del telefono oppure scrivi il messaggio.";
/**
 * How long start() may go without onstart/onaudiostart before we say it did not
 * start: short when the microphone is already allowed, long while the browser
 * may be showing its permission prompt (the client is reading it, not stuck).
 */
export const SPEECH_START_TIMEOUT_MS = 5_000;
export const SPEECH_PROMPT_TIMEOUT_MS = 30_000;

/** The watchdog for a microphone permission state ("granted", "prompt", … or unknown). */
export function speechStartTimeout(permission: string | null): number {
  return permission === "granted" ? SPEECH_START_TIMEOUT_MS : SPEECH_PROMPT_TIMEOUT_MS;
}

async function microphonePermission(): Promise<string | null> {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return status?.state ?? null;
  } catch {
    return null; // Firefox and older Safari do not know "microphone"
  }
}
/** How long stop() may go without onend before the hook ends the dictation itself. */
export const SPEECH_STOP_TIMEOUT_MS = 2_000;

const noopSubscribe = () => () => {};

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browser = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

/** True when this browser can dictate (SSR-safe). */
export function useSpeechSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, () => getSpeechRecognitionConstructor() !== null, () => false);
}

export function speechErrorMessage(code: string): string {
  return SPEECH_ERRORS[code] ?? "La dettatura si è interrotta. Riprova o scrivi il messaggio.";
}

export function mergeSpeechText(baseText: string, transcript: string, maxLength: number): string {
  const base = baseText.trimEnd();
  const spoken = transcript.trim();
  return (base && spoken ? `${base} ${spoken}` : base || spoken).slice(0, maxLength);
}

export function shouldSubmitSpeechTurn({
  cancelled,
  submitOnEnd,
  spoken,
}: {
  cancelled: boolean;
  submitOnEnd: boolean;
  spoken: string;
}): boolean {
  return !cancelled && submitOnEnd && spoken.trim().length > 0;
}

export function useSpeechInput({
  value,
  onChange,
  onConversationTurn,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Called only when start({ submitOnEnd: true }) was explicitly used. */
  onConversationTurn?: (value: string) => void;
  maxLength: number;
}) {
  const supported = useSpeechSupported();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const spokenRef = useRef("");
  const submitOnEndRef = useRef(false);
  const cancelledRef = useRef(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const onConversationTurnRef = useRef(onConversationTurn);

  useEffect(() => {
    onChangeRef.current = onChange;
    onConversationTurnRef.current = onConversationTurn;
  });

  const clearTimers = useCallback(() => {
    clearTimeout(startTimerRef.current);
    clearTimeout(stopTimerRef.current);
  }, []);

  const cancel = useCallback(() => {
    clearTimers();
    cancelledRef.current = true;
    submitOnEndRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }, [clearTimers]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setListening(false);
      return;
    }
    recognition.stop();
    // Some browsers never send onend after stop(): the button would stay on
    // «Ferma dettatura» for good. The text already in the field is kept.
    clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      if (recognitionRef.current !== recognition) return;
      recognition.abort();
      recognitionRef.current = null;
      submitOnEndRef.current = false;
      setListening(false);
    }, SPEECH_STOP_TIMEOUT_MS);
  }, []);

  const start = useCallback(
    (options: StartOptions = {}) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition) {
        setError(SPEECH_UNSUPPORTED_MESSAGE);
        return false;
      }
      // A recognizer left over (its onend never came) must not swallow the tap.
      if (recognitionRef.current) {
        const stale = recognitionRef.current;
        recognitionRef.current = null;
        stale.onend = null;
        stale.onerror = null;
        stale.onresult = null;
        stale.abort();
      }
      clearTimers();

      setError(null);
      cancelledRef.current = false;
      submitOnEndRef.current = options.submitOnEnd === true;
      baseRef.current = options.baseText ?? value;
      spokenRef.current = "";
      if (options.baseText !== undefined) onChangeRef.current(options.baseText.slice(0, maxLength));

      const recognition = new Recognition();
      recognition.lang = "it-IT";
      recognition.continuous = options.continuous ?? true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
        spokenRef.current = transcript.trim();
        onChangeRef.current(mergeSpeechText(baseRef.current, transcript, maxLength));
      };
      recognition.onerror = (event) => {
        clearTimeout(startTimerRef.current);
        // Browsers often fire onend after an error. Never let that trailing
        // event submit a partial transcript as a conversation turn.
        cancelledRef.current = true;
        submitOnEndRef.current = false;
        // "aborted" is our own cancel(); "no-speech" deserves a message too.
        if (event.error !== "aborted") setError(speechErrorMessage(event.error));
      };
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        clearTimers();
        recognitionRef.current = null;
        setListening(false);
        const spoken = spokenRef.current;
        if (
          shouldSubmitSpeechTurn({
            cancelled: cancelledRef.current,
            submitOnEnd: submitOnEndRef.current,
            spoken,
          })
        ) {
          onConversationTurnRef.current?.(mergeSpeechText(baseRef.current, spoken, maxLength));
        }
        submitOnEndRef.current = false;
      };
      recognitionRef.current = recognition;

      try {
        recognition.start();
        setListening(true);
        // «Ti ascolto…» must not stay on forever when nothing really started.
        let begun = false;
        const markStarted = () => {
          begun = true;
          clearTimeout(startTimerRef.current);
        };
        recognition.onstart = markStarted;
        recognition.onaudiostart = markStarted;
        void microphonePermission().then((permission) => {
          if (begun || recognitionRef.current !== recognition) return;
          startTimerRef.current = setTimeout(() => {
            if (begun || recognitionRef.current !== recognition) return;
            cancelledRef.current = true;
            submitOnEndRef.current = false;
            recognition.abort();
            recognitionRef.current = null;
            setListening(false);
            setError(SPEECH_NO_START_MESSAGE);
          }, speechStartTimeout(permission));
        });
        return true;
      } catch {
        recognitionRef.current = null;
        submitOnEndRef.current = false;
        setError("Non riesco ad avviare il microfono. Riprova o scrivi il messaggio.");
        return false;
      }
    },
    [clearTimers, maxLength, value]
  );

  useEffect(() => cancel, [cancel]);

  return { supported, listening, error, setError, start, stop, cancel };
}
