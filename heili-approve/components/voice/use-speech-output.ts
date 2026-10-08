"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

export function useSpeechOutput() {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    () => false
  );
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!supported || !text.trim()) return false;
      cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "it-IT";
      utterance.rate = 1;
      utterance.onend = () => {
        utteranceRef.current = null;
        setSpeaking(false);
        onEnd?.();
      };
      utterance.onerror = () => {
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utteranceRef.current = utterance;
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
      return true;
    },
    [cancel, supported]
  );

  useEffect(() => cancel, [cancel]);

  return { supported, speaking, speak, cancel };
}
