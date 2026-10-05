"use client";

/**
 * Assistant Panel
 *
 * Client-portal chat with the AI review assistant. The client types or
 * dictates (Web Speech API, it-IT, when the browser has it) what they think of
 * the post; the assistant asks one question at a time until the feedback is
 * actionable, then the client prepares the summary and decides with the
 * buttons. The assistant never approves or sends anything by itself.
 *
 * For videos the parent passes getVideoTime(): the chip "Usa il momento
 * attuale (0:07)" inserts the player's current time into the message.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatTimecode } from "@/lib/domain";
import {
  ACTION_AREA_LABELS,
  ACTION_PRIORITY_LABELS,
  MAX_CLIENT_MESSAGE_LENGTH,
  VERDICT_LABELS,
  formatActionItemTime,
  mediaLabel,
  splitVideoMoments,
  videoMomentMarker,
  type AssistantFinalizeResponse,
  type AssistantMessageView,
  type AssistantSessionView,
  type AssistantStateResponse,
  type AssistantTurnResponse,
  type Readiness,
  type ReviewInputModeValue,
} from "@/lib/review-assistant/shared";

export interface AssistantPanelProps {
  token: string;
  postId: string;
  versionNumber: number;
  onSubmitChanges(input: { message: string; reviewSessionId: string }): Promise<void>;
  onApprove(): Promise<void>;
  /** Current time of the post's video player, null when nothing is loaded. */
  getVideoTime?: () => number | null;
}

const INTRO_MESSAGE =
  "Ciao! Dimmi pure cosa ne pensi di questo post: cosa ti piace e cosa cambieresti. Puoi scrivere o dettare a voce.";

// ─── Speech recognition (not in every browser, not in TS's DOM lib) ──────────

interface SpeechRecognitionResultLike {
  isFinal: boolean;
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

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

function useVoiceSupported(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => getSpeechRecognition() !== null,
    () => false
  );
}

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "Per dettare devi consentire l'uso del microfono al browser.",
  "service-not-allowed": "Per dettare devi consentire l'uso del microfono al browser.",
  "audio-capture": "Non trovo nessun microfono su questo dispositivo.",
  network: "La dettatura non è disponibile senza connessione.",
};

// ─── API ─────────────────────────────────────────────────────────────────────

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new Error("Connessione non riuscita. Controlla la rete e riprova.");
  }
  const json = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: string }
    | null;
  if (!response.ok || !json || !json.success) {
    throw new Error((json && !json.success && json.error) || "Si è verificato un errore. Riprova.");
  }
  return json.data;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AssistantPanel({
  token,
  postId,
  versionNumber,
  onSubmitChanges,
  onApprove,
  getVideoTime,
}: AssistantPanelProps) {
  const baseUrl = `/api/review/${encodeURIComponent(token)}/assistant`;

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AssistantSessionView | null>(null);
  const [sessionsLeft, setSessionsLeft] = useState<number | null>(null);
  const [canChat, setCanChat] = useState(true);
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  const [draft, setDraft] = useState("");
  const [dictated, setDictated] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "send" | "finalize" | "submit" | "approve">(null);
  const [error, setError] = useState<string | null>(null);
  const [changesDraft, setChangesDraft] = useState<string | null>(null);
  const [done, setDone] = useState<null | "changes" | "approved">(null);

  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceSupported = useVoiceSupported();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const draftBeforeVoiceRef = useRef("");

  const [videoTime, setVideoTime] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const applyState = useCallback((state: AssistantStateResponse) => {
    setSession(state.session);
    setSessionsLeft(state.sessionsLeft);
    setCanChat(state.canChat);
  }, []);

  const stateUrl = `${baseUrl}?postId=${encodeURIComponent(postId)}&versionNumber=${versionNumber}`;

  const reload = useCallback(async () => {
    const state = await callApi<AssistantStateResponse>(stateUrl);
    applyState(state);
    return state;
  }, [applyState, stateUrl]);

  // Resume the conversation for this version, if any.
  useEffect(() => {
    let cancelled = false;
    callApi<AssistantStateResponse>(stateUrl)
      .then((state) => {
        if (!cancelled) applyState(state);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Impossibile caricare l'assistente.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyState, stateUrl]);

  // Follow the video player so the chip shows the current moment.
  useEffect(() => {
    if (!getVideoTime) return;
    const read = () => {
      const t = getVideoTime();
      setVideoTime(typeof t === "number" && Number.isFinite(t) ? t : null);
    };
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, [getVideoTime]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages.length, pendingMessage, busy]);

  // Stop dictation when the panel goes away.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  const messages = session?.messages ?? [];
  const lastMessage = messages.at(-1);
  const hasClientMessages = messages.some((m) => m.role === "CLIENT");
  const completed = session?.status === "COMPLETED" && Boolean(session.summary);
  const canRetry =
    !busy && session?.status === "OPEN" && lastMessage?.role === "CLIENT" && pendingMessage === null;
  const messagesLeft = session ? session.clientMessagesLeft : null;
  const outOfSessions = !session && sessionsLeft === 0;
  const composerDisabled = !canChat || done !== null || busy !== null || outOfSessions || messagesLeft === 0;

  // ─── Voice ─────────────────────────────────────────────────────────────────

  function startListening() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    setVoiceError(null);
    const recognition = new Recognition();
    recognition.lang = "it-IT";
    recognition.continuous = true;
    recognition.interimResults = true;
    draftBeforeVoiceRef.current = draft.trimEnd();
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      const base = draftBeforeVoiceRef.current;
      const spoken = transcript.trim();
      setDraft((base && spoken ? `${base} ${spoken}` : base || spoken).slice(0, MAX_CLIENT_MESSAGE_LENGTH));
      if (spoken) setDictated(true);
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setVoiceError(VOICE_ERRORS[event.error] ?? "La dettatura si è interrotta. Riprova o scrivi il messaggio.");
      }
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setVoiceError("Non riesco ad avviare la dettatura. Riprova o scrivi il messaggio.");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  function insertVideoMoment() {
    if (videoTime === null) return;
    const marker = videoMomentMarker(videoTime);
    setDraft((current) => `${current.trimEnd() ? `${current.trimEnd()} ` : ""}${marker} `);
    textareaRef.current?.focus();
  }

  async function sendMessage(retry = false) {
    const message = draft.trim();
    if (busy || (!retry && !message)) return;
    stopListening();
    const inputMode: ReviewInputModeValue = dictated ? "VOICE" : "TEXT";

    setBusy("send");
    setError(null);
    if (!retry) {
      setPendingMessage(message);
      setDraft("");
      setDictated(false);
    }
    try {
      const turn = await callApi<AssistantTurnResponse>(baseUrl, {
        method: "POST",
        body: JSON.stringify(
          retry ? { postId, versionNumber, inputMode: "TEXT", retry: true } : { postId, versionNumber, message, inputMode }
        ),
      });
      setSession(turn.session);
      setSessionsLeft(turn.sessionsLeft);
      setReadiness(turn.readiness);
      setChangesDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'assistente non è riuscito a rispondere. Riprova.");
      // The message may have been stored before the engine failed: show what
      // the server has, and give the text back only if it was not saved.
      try {
        const state = await reload();
        const last = state.session?.messages.at(-1);
        if (!retry && !(last?.role === "CLIENT" && last.content === message)) {
          setDraft(message);
          setDictated(inputMode === "VOICE");
        }
      } catch {
        if (!retry) setDraft(message);
      }
    } finally {
      setPendingMessage(null);
      setBusy(null);
    }
  }

  async function finalize(): Promise<AssistantFinalizeResponse> {
    const result = await callApi<AssistantFinalizeResponse>(`${baseUrl}/finalize`, {
      method: "POST",
      body: JSON.stringify({ postId, versionNumber }),
    });
    setSession(result.session);
    setChangesDraft(result.changesMessage);
    return result;
  }

  async function prepareSummary() {
    if (busy) return;
    stopListening();
    setBusy("finalize");
    setError(null);
    try {
      await finalize();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Non sono riuscito a preparare il riepilogo. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  async function submitChanges() {
    if (busy || !session) return;
    const message = (changesDraft ?? session.changesMessage ?? "").trim();
    if (!message) {
      setError("Il messaggio per l'agenzia è vuoto.");
      return;
    }
    setBusy("submit");
    setError(null);
    try {
      await onSubmitChanges({ message, reviewSessionId: session.id });
      setDone("changes");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invio non riuscito. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (busy) return;
    stopListening();
    setBusy("approve");
    setError(null);
    try {
      // Best effort: leave the agency a summary of the conversation too.
      if (session?.status === "OPEN" && hasClientMessages) {
        await finalize().catch(() => undefined);
      }
      await onApprove();
      setDone("approved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approvazione non riuscita. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const sendHighlighted = completed ? session?.verdict === "changes" : readiness === "ready_changes";
  const approveHighlighted = completed ? session?.verdict === "approve" : readiness === "ready_approve";

  return (
    <section className="panel rounded-lg p-4 space-y-3" aria-label="Assistente di revisione">
      <header className="space-y-1">
        <h2 className="text-sm font-semibold">Assistente di revisione</h2>
        <p className="text-xs text-muted">
          Ti aiuta a spiegare all&apos;agenzia cosa cambiare. Non approva e non invia nulla al posto tuo.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="max-h-[50vh] min-h-32 overflow-y-auto space-y-2 rounded border border-border bg-background p-3"
        aria-live="polite"
      >
        {loading ? (
          <p className="text-sm text-muted">Caricamento…</p>
        ) : (
          <>
            <Bubble role="ASSISTANT" content={INTRO_MESSAGE} />
            {messages.map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} inputMode={m.inputMode} />
            ))}
            {pendingMessage !== null && <Bubble role="CLIENT" content={pendingMessage} pending />}
            {busy === "send" && <p className="text-xs text-muted">L&apos;assistente sta scrivendo…</p>}
            {busy === "finalize" && <p className="text-xs text-muted">Preparo il riepilogo per l&apos;agenzia…</p>}
          </>
        )}
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-error" role="alert">
          <span>{error}</span>
          {canRetry && (
            <button type="button" onClick={() => sendMessage(true)} className="underline underline-offset-2">
              Riprova
            </button>
          )}
        </div>
      )}

      {done === "changes" && (
        <p className="text-sm text-success">Modifiche inviate all&apos;agenzia. Grazie!</p>
      )}
      {done === "approved" && <p className="text-sm text-success">Post approvato. Grazie!</p>}

      {completed && session && done === null && (
        <SummaryCard
          session={session}
          changesDraft={changesDraft ?? session.changesMessage ?? ""}
          onChangesDraft={setChangesDraft}
          disabled={busy !== null || !canChat}
        />
      )}

      {!loading && done === null && canChat && (
        <>
          {outOfSessions && (
            <p className="text-xs text-muted">
              Hai già usato tutte le conversazioni con l&apos;assistente per questo post. Puoi comunque approvarlo o
              chiedere modifiche direttamente.
            </p>
          )}
          {messagesLeft === 0 && !completed && (
            <p className="text-xs text-muted">
              La conversazione ha raggiunto la lunghezza massima: prepara il riepilogo per l&apos;agenzia.
            </p>
          )}

          <div className="space-y-2">
            {videoTime !== null && (
              <button
                type="button"
                onClick={insertVideoMoment}
                disabled={composerDisabled}
                className="rounded-full border border-border px-3 py-1 text-xs hover:border-border-hover disabled:opacity-50"
              >
                Usa il momento attuale ({formatTimecode(videoTime)})
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              maxLength={MAX_CLIENT_MESSAGE_LENGTH}
              rows={3}
              disabled={composerDisabled}
              placeholder={
                completed ? "Vuoi aggiungere qualcosa? Scrivilo qui…" : "Es. «Il testo mi convince, la seconda foto meno»"
              }
              aria-label="Messaggio per l'assistente"
              className="w-full resize-y rounded border border-border bg-background p-3 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
            {listening && <p className="text-xs text-accent">Ti ascolto… tocca «Stop» quando hai finito.</p>}
            {voiceError && <p className="text-xs text-error">{voiceError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {voiceSupported && (
                <button
                  type="button"
                  onClick={listening ? stopListening : startListening}
                  disabled={!listening && composerDisabled}
                  aria-pressed={listening}
                  className={`rounded border px-3 py-2 text-sm disabled:opacity-50 ${
                    listening ? "border-accent text-accent" : "border-border hover:border-border-hover"
                  }`}
                >
                  {listening ? "Stop" : "Detta a voce"}
                </button>
              )}
              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={composerDisabled || !draft.trim()}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy === "send" ? "Invio…" : "Invia"}
              </button>
              {messagesLeft !== null && messagesLeft <= 5 && messagesLeft > 0 && (
                <span className="text-xs text-muted">Messaggi rimasti: {messagesLeft}</span>
              )}
            </div>
          </div>

          {(hasClientMessages || completed) && (
            <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap">
              {completed ? (
                <ActionButton onClick={submitChanges} disabled={busy !== null} primary={sendHighlighted}>
                  {busy === "submit" ? "Invio…" : "Invia le modifiche all'agenzia"}
                </ActionButton>
              ) : (
                <ActionButton
                  onClick={prepareSummary}
                  disabled={busy !== null || session?.status !== "OPEN"}
                  primary={readiness === "ready_changes"}
                >
                  {busy === "finalize" ? "Preparo il riepilogo…" : "Prepara il riepilogo per l'agenzia"}
                </ActionButton>
              )}
              <ActionButton onClick={approve} disabled={busy !== null} primary={approveHighlighted} success>
                {busy === "approve" ? "Approvazione…" : "Approva"}
              </ActionButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function MessageText({ content }: { content: string }) {
  return (
    <>
      {splitVideoMoments(content).map((segment, i) =>
        segment.type === "text" ? (
          <span key={i}>{segment.value}</span>
        ) : (
          <span key={i} className="mx-0.5 inline-block rounded-full border border-border px-2 text-xs">
            Momento {segment.label}
          </span>
        )
      )}
    </>
  );
}

function Bubble({
  role,
  content,
  inputMode,
  pending,
}: {
  role: AssistantMessageView["role"];
  content: string;
  inputMode?: ReviewInputModeValue;
  pending?: boolean;
}) {
  const isClient = role === "CLIENT";
  return (
    <div className={`flex ${isClient ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
          isClient ? "border border-accent/40 bg-background" : "bg-surface"
        } ${pending ? "opacity-60" : ""}`}
      >
        <MessageText content={content} />
        {isClient && inputMode === "VOICE" && <span className="mt-1 block text-[11px] text-muted">Dettato a voce</span>}
      </div>
    </div>
  );
}

function SummaryCard({
  session,
  changesDraft,
  onChangesDraft,
  disabled,
}: {
  session: AssistantSessionView;
  changesDraft: string;
  onChangesDraft: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3 rounded border border-border bg-background p-3">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Riepilogo{session.verdict ? ` · ${VERDICT_LABELS[session.verdict]}` : ""}
        </p>
        <p className="whitespace-pre-wrap text-sm">{session.summary}</p>
      </div>
      {session.actionItems.length > 0 && (
        <ul className="space-y-1 text-sm">
          {session.actionItems.map((item, i) => {
            const time = formatActionItemTime(item);
            return (
              <li key={i} className="flex gap-2">
                <span className="text-muted">•</span>
                <span>
                  <span className="text-xs text-muted">
                    {[
                      ACTION_AREA_LABELS[item.area],
                      item.mediaIndex !== null ? mediaLabel(item.mediaIndex) : null,
                      time,
                      ACTION_PRIORITY_LABELS[item.priority],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <br />
                  {item.request}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <label className="block space-y-1">
        <span className="text-xs text-muted">Messaggio che riceverà l&apos;agenzia (puoi modificarlo)</span>
        <textarea
          value={changesDraft}
          onChange={(e) => onChangesDraft(e.target.value)}
          rows={5}
          maxLength={5000}
          disabled={disabled}
          className="w-full resize-y rounded border border-border bg-background p-2 text-sm outline-none focus:border-accent disabled:opacity-60"
        />
      </label>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  primary,
  success,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  primary: boolean;
  success?: boolean;
  children: ReactNode;
}) {
  const tone = primary
    ? success
      ? "bg-success text-white border-success"
      : "bg-accent text-white border-accent hover:bg-accent-hover"
    : "border-border hover:border-border-hover";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-4 py-2 text-sm font-medium disabled:opacity-50 ${tone}`}
    >
      {children}
    </button>
  );
}

export default AssistantPanel;
