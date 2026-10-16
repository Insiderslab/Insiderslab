"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VOICE_COPY, type VoiceUnavailableReason } from "@/lib/review-assistant/shared";
import {
  isSlowPreparation,
  microphoneErrorMessage,
  voiceSupportProblem,
  type VoicePreparation,
  type VoiceSupportProblem,
} from "./voice-rules";

const subscribeCapabilities = () => () => {};
const browserVoiceProblem = (): VoiceSupportProblem | null =>
  voiceSupportProblem({
    isSecureContext: window.isSecureContext,
    RTCPeerConnection: window.RTCPeerConnection,
    getUserMedia: navigator.mediaDevices?.getUserMedia,
  });
// The panel only renders in the browser (inside the dock): the server value never shows.
const serverVoiceProblem = (): VoiceSupportProblem | null => "browser";

type Phase = "idle" | "preparing" | "connecting" | "active" | "closing";
/** Inside "preparing": first the microphone (asked at the tap), then the media context. */
export type PreparingStep = "microphone" | "context";
type Call = { callId: string; sdp: string; expiresAt: string; sessionId: string };
type Readiness = VoicePreparation & { status: "ready" | "pending" | "unavailable"; reason?: VoiceUnavailableReason | null };
type Connection = {
  generation: number;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  stream?: MediaStream;
  audio: HTMLAudioElement;
  call?: Call;
  timer?: ReturnType<typeof setTimeout>;
  closing?: Promise<void>;
  preparationAbort: AbortController;
};

async function request<T>(url: string, method: string, body: unknown, keepalive = false, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method, cache: "no-store", keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: keepalive ? undefined : signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError" && signal?.aborted) throw cause;
    throw new Error("Connessione non riuscita. Controlla la rete e riprova.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || "La connessione vocale non è riuscita. Riprova.");
  }
  return result.data as T;
}

/**
 * The offer goes out with the candidates gathered so far. Gathering may never
 * reach "complete" (several network interfaces, a VPN, some containers): it used
 * to wait 10 s and then fail with «Impossibile connettere il microfono». Host
 * candidates come within milliseconds; the provider also learns the client's
 * address from its connectivity checks, so a short settle is enough.
 */
export function settleIceCandidates(peer: RTCPeerConnection, idleMs = 600, maxMs = 2_500): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(idle);
      clearTimeout(cap);
      peer.removeEventListener("icecandidate", onCandidate);
      peer.removeEventListener("icegatheringstatechange", onState);
      resolve();
    };
    const cap = setTimeout(done, maxMs);
    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) return done();
      clearTimeout(idle);
      idle = setTimeout(done, idleMs);
    };
    const onState = () => {
      if (peer.iceGatheringState === "complete") done();
    };
    peer.addEventListener("icecandidate", onCandidate);
    peer.addEventListener("icegatheringstatechange", onState);
  });
}

function release(connection: Connection) {
  connection.preparationAbort.abort();
  clearTimeout(connection.timer);
  connection.stream?.getTracks().forEach((track) => track.stop());
  connection.audio.pause();
  connection.audio.srcObject = null;
  connection.channel.close();
  connection.peer.close();
}

/** Microphone and speaker stay connected simultaneously; GPT-Live handles interruptions. */
export function useLiveConversation(input: {
  url: string;
  postId: string;
  versionNumber: number;
  onClosed: () => Promise<unknown>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const supportProblem = useSyncExternalStore(subscribeCapabilities, browserVoiceProblem, serverVoiceProblem);
  const [step, setStep] = useState<PreparingStep | null>(null);
  const [preparation, setPreparation] = useState<VoicePreparation | null>(null);
  const [slow, setSlow] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientText, setClientText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const current = useRef<Connection | null>(null);
  const generation = useRef(0);
  const closedCallback = useRef(input.onClosed);
  useEffect(() => { closedCallback.current = input.onClosed; }, [input.onClosed]);

  useEffect(() => {
    if (phase !== "active" || expiresAtMs === null) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1_000)));
    const firstTick = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1_000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, [expiresAtMs, phase]);

  const stop = useCallback(async () => {
    const connection = current.current;
    if (!connection) return;
    if (connection.closing) return connection.closing;
    generation.current++;
    connection.preparationAbort.abort();
    setPhase("closing");
    setStep(null);
    connection.stream?.getTracks().forEach((track) => track.stop());
    connection.audio.pause();
    connection.closing = (async () => {
      try {
        if (connection.call) {
          const result = await request<{ closed: boolean }>(input.url, "DELETE", { callId: connection.call.callId });
          if (!result.closed) throw new Error("Il salvataggio della conversazione è ancora in corso. Attendi qualche secondo e ricarica il dialogo prima del riepilogo.");
        }
        await closedCallback.current();
        setClientText("");
        setAssistantText("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Non riesco a recuperare la conversazione. Riprova.");
        throw cause;
      } finally {
        release(connection);
        if (current.current === connection) current.current = null;
        setPhase("idle");
        setPreparation(null);
        setSlow(false);
        setExpiresAtMs(null);
        setRemainingSeconds(null);
        setMuted(false);
        setPlaybackBlocked(false);
      }
    })();
    return connection.closing;
  }, [input.url]);
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  useEffect(() => {
    const detach = () => {
      generation.current++;
      const connection = current.current;
      if (!connection) return;
      current.current = null;
      release(connection);
      if (connection.call) void request(input.url, "DELETE", { callId: connection.call.callId }, true).catch(() => {});
    };
    window.addEventListener("pagehide", detach);
    return () => { window.removeEventListener("pagehide", detach); detach(); };
  }, [input.url, input.postId, input.versionNumber]);

  const start = useCallback(async (contextMarker: string) => {
    if (current.current) return;
    // The microphone is asked for right here, inside the tap, before any wait:
    // mobile browsers (iOS Safari above all) may refuse a request that comes
    // seconds later, and the permission prompt is the tap's first answer. The
    // track stays disabled (nothing is captured or sent) until the call starts.
    let microphone: Promise<MediaStream>;
    try {
      microphone = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (cause) {
      microphone = Promise.reject(cause);
    }
    setError(null);
    setPhase("preparing");
    setStep("microphone");
    setPreparation(null);
    setSlow(false);
    setExpiresAtMs(null);
    setRemainingSeconds(null);
    setClientText("");
    setAssistantText("");
    const id = ++generation.current;
    const peer = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    const channel = peer.createDataChannel("oai-events");
    const connection: Connection = { generation: id, peer, audio, channel, preparationAbort: new AbortController() };
    current.current = connection;
    const alive = () => current.current === connection && generation.current === id;
    const fail = (message: string) => {
      if (!alive()) return;
      setError(message);
      void stopRef.current().catch(() => {});
    };
    peer.ontrack = (event) => {
      if (!alive()) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => { if (alive()) setPlaybackBlocked(true); });
    };
    peer.onconnectionstatechange = () => {
      if (alive() && peer.connectionState === "connected") {
        clearTimeout(connection.timer);
        setPhase("active");
        if (connection.call) {
          void request(input.url, "PATCH", { callId: connection.call.callId, contextMarker }).catch(() => {
            if (alive()) setError("Non riesco ad aggiornare il contesto selezionato. Specifica a voce a quale parte ti riferisci.");
          });
        }
        const remaining = new Date(connection.call?.expiresAt ?? 0).getTime() - Date.now();
        connection.timer = setTimeout(() => {
          setError("Questa conversazione è terminata. Puoi rileggere il dialogo e preparare il riepilogo.");
          void stopRef.current().catch(() => {});
        }, Math.max(1_000, remaining));
      }
      if (peer.connectionState === "failed") fail("La chiamata si è interrotta. Puoi riprenderla avviando una nuova conversazione.");
    };
    const seenEvents = new Set<string>();
    channel.onmessage = ({ data }) => {
      if (!alive() || typeof data !== "string") return;
      let event: { type?: string; event_id?: string; delta?: string };
      try { event = JSON.parse(data); } catch { return; }
      if (event.event_id) {
        if (seenEvents.has(event.event_id)) return;
        seenEvents.add(event.event_id);
      }
      if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
        setClientText((text) => (text + event.delta).slice(-12_000));
      } else if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
        setAssistantText((text) => (text + event.delta).slice(-12_000));
      } else if (event.type === "session.closed") {
        void stopRef.current().catch(() => {});
      } else if (event.type === "error") {
        fail("La conversazione vocale ha incontrato un problema. I messaggi già ricevuti restano nel dialogo.");
      }
    };
    channel.onclose = () => { if (alive()) fail("Connessione vocale chiusa. Puoi continuare nella chat."); };
    try {
      const stream = await microphone;
      if (!alive()) { stream.getTracks().forEach((track) => track.stop()); return; }
      connection.stream = stream;
      stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      setStep("context");

      const preparationDeadline = Date.now() + 90_000;
      let lastReady = -1;
      let lastProgressAt = Date.now();
      while (alive()) {
        const readiness = await request<Readiness>(
          `${input.url}/prepare`, "POST", { postId: input.postId, versionNumber: input.versionNumber }, false, connection.preparationAbort.signal
        );
        if (!alive()) return;
        setPreparation({ total: readiness.total ?? 0, ready: readiness.ready ?? 0, videos: readiness.videos ?? 0 });
        if (readiness.status === "ready") break;
        if (readiness.status !== "pending") {
          throw new Error(readiness.reason === "media-analysis-off" ? VOICE_COPY.mediaAnalysisOff : VOICE_COPY.analysisFailed);
        }
        if ((readiness.ready ?? 0) > lastReady) {
          lastReady = readiness.ready ?? 0;
          lastProgressAt = Date.now();
        }
        setSlow(isSlowPreparation(lastProgressAt, Date.now()));
        if (Date.now() >= preparationDeadline) throw new Error("L’analisi del contenuto sta richiedendo più tempo del previsto. Riprova tra poco: la conversazione vocale non è ancora iniziata.");
        await new Promise<void>((resolve, reject) => {
          const signal = connection.preparationAbort.signal;
          const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2_000);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
      if (!alive()) return;
      setPhase("connecting");
      setStep(null);
      setSlow(false);
      connection.timer = setTimeout(() => fail("La connessione vocale sta impiegando troppo tempo. Riprova."), 45_000);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
        peer.addTrack(track, stream);
      });
      await peer.setLocalDescription(await peer.createOffer());
      await settleIceCandidates(peer);
      if (!alive()) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Impossibile avviare la connessione audio.");
      const call = await request<Call>(input.url, "POST", { postId: input.postId, versionNumber: input.versionNumber, sdp, contextMarker });
      connection.call = call;
      if (!alive()) {
        await request(input.url, "DELETE", { callId: call.callId }, true).catch(() => {});
        return;
      }
      const callExpiresAt = new Date(call.expiresAt).getTime();
      if (Number.isFinite(callExpiresAt)) setExpiresAtMs(callExpiresAt);
      await peer.setRemoteDescription({ type: "answer", sdp: call.sdp });
    } catch (cause) {
      if (!alive()) return;
      fail(microphoneErrorMessage(cause) ?? (cause instanceof Error ? cause.message : "Conversazione vocale non disponibile. Riprova."));
    }
  }, [input.url, input.postId, input.versionNumber]);

  const updateContext = useCallback(async (contextMarker: string) => {
    const connection = current.current;
    if (!connection?.call || connection.closing) return;
    try { await request(input.url, "PATCH", { callId: connection.call.callId, contextMarker }); }
    catch { if (current.current === connection) setError("Non riesco ad aggiornare il punto selezionato. Specifica a voce a quale parte ti riferisci."); }
  }, [input.url]);

  function toggleMicrophone() {
    const stream = current.current?.stream;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  async function enablePlayback() {
    try { await current.current?.audio.play(); setPlaybackBlocked(false); }
    catch { setError("Il browser non riesce a riprodurre l’audio. Controlla il volume e le impostazioni del dispositivo."); }
  }

  return {
    phase,
    supported: supportProblem === null,
    supportProblem,
    step,
    preparation,
    slow,
    muted,
    playbackBlocked,
    error,
    clientText,
    assistantText,
    remainingSeconds,
    start,
    stop,
    updateContext,
    toggleMicrophone,
    enablePlayback,
  };
}
