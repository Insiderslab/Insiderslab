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
  "not-allowed": "Consenti l’uso del microfono al browser, oppure scrivi il messaggio.",
  "service-not-allowed": "Consenti l’uso del microfono al browser, oppure scrivi il messaggio.",
  "audio-capture": "Non trovo un microfono disponibile su questo dispositivo.",
  network: "Il riconoscimento vocale non è disponibile senza connessione.",
};

const noopSubscribe = () => () => {};

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browser = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
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
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getSpeechRecognitionConstructor() !== null,
    () => false
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const spokenRef = useRef("");
  const submitOnEndRef = useRef(false);
  const cancelledRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onConversationTurnRef = useRef(onConversationTurn);

  useEffect(() => {
    onChangeRef.current = onChange;
    onConversationTurnRef.current = onConversationTurn;
  });

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    submitOnEndRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(
    (options: StartOptions = {}) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition || recognitionRef.current) return false;

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
        // Browsers often fire onend after an error. Never let that trailing
        // event submit a partial transcript as a conversation turn.
        cancelledRef.current = true;
        submitOnEndRef.current = false;
        if (event.error !== "aborted" && event.error !== "no-speech") setError(speechErrorMessage(event.error));
      };
      recognition.onend = () => {
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
        return true;
      } catch {
        recognitionRef.current = null;
        submitOnEndRef.current = false;
        setError("Non riesco ad avviare il microfono. Riprova o scrivi il messaggio.");
        return false;
      }
    },
    [maxLength, value]
  );

  useEffect(() => cancel, [cancel]);

  return { supported, listening, error, setError, start, stop, cancel };
}
