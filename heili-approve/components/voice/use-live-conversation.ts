"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribeCapabilities = () => () => {};
const browserSupportsVoice = () => Boolean(window.isSecureContext && window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
const serverSupportsVoice = () => false;

type Phase = "idle" | "preparing" | "connecting" | "active" | "closing";
type Call = { callId: string; sdp: string; expiresAt: string; sessionId: string };
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
  const response = await fetch(url, {
    method, cache: "no-store", keepalive,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: keepalive ? undefined : signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || "La connessione vocale non è riuscita. Riprova.");
  }
  return result.data as T;
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
  const supported = useSyncExternalStore(subscribeCapabilities, browserSupportsVoice, serverSupportsVoice);
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
    setError(null);
    setPhase("preparing");
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
      const preparationDeadline = Date.now() + 90_000;
      while (alive()) {
        const readiness = await request<{ status: "ready" | "pending" | "unavailable" }>(
          `${input.url}/prepare`, "POST", { postId: input.postId, versionNumber: input.versionNumber }, false, connection.preparationAbort.signal
        );
        if (!alive()) return;
        if (readiness.status === "ready") break;
        if (readiness.status !== "pending") throw new Error("Non riesco ad analizzare le immagini o i video di questo contenuto. Puoi usare i commenti scritti; l’agenzia può verificare i file caricati.");
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
      connection.timer = setTimeout(() => fail("La connessione vocale sta impiegando troppo tempo. Riprova."), 45_000);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!alive()) { stream.getTracks().forEach((track) => track.stop()); return; }
      connection.stream = stream;
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { peer.removeEventListener("icegatheringstatechange", check); reject(new Error("Impossibile connettere il microfono. Controlla la rete e riprova.")); }, 10_000);
          function check() {
            if (peer.iceGatheringState !== "complete") return;
            clearTimeout(timer); peer.removeEventListener("icegatheringstatechange", check); resolve();
          }
          peer.addEventListener("icegatheringstatechange", check); check();
        });
      }
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
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError");
      const absent = cause instanceof DOMException && cause.name === "NotFoundError";
      fail(denied ? "Consenti l’accesso al microfono nel browser per parlare con Heili." : absent ? "Non trovo un microfono collegato. Puoi usare la chat scritta." : cause instanceof Error ? cause.message : "Conversazione vocale non disponibile. Riprova.");
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
    catch { setError("Il browser non riesce a riprodurre l’audio. Controlla le impostazioni del dispositivo."); }
  }

  return {
    phase,
    supported,
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
