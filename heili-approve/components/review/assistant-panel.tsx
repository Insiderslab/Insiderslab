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
 *
 * The panel follows the content kind (docs/VARIANTI.md, rule 7): for an
 * article, getSelection() gives the passage selected in the text and the chip
 * "Usa il passaggio selezionato" quotes it; for an ads set, getContext() gives
 * the variant, placement and video moment on screen and the chip "Usa la
 * variante e il momento attuali" inserts them. The markers become chips in
 * the chat and tell the model exactly what the client means.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSpeechInput } from "@/components/voice/use-speech-input";
import { useSpeechOutput } from "@/components/voice/use-speech-output";
import HeiliAssistantIcon from "@/components/heili-assistant-icon";
import type { BlogAnchor } from "@/lib/content/types";
import { formatTimecode } from "@/lib/domain";
import {
  ACTION_AREA_LABELS,
  ACTION_PRIORITY_LABELS,
  ASSISTANT_KIND_COPY,
  MAX_CLIENT_MESSAGE_LENGTH,
  VERDICT_LABELS,
  actionItemPlaceTags,
  passageMarker,
  pointMarker,
  shortQuote,
  splitMessageMarkers,
  variantMarker,
  videoMomentMarker,
  type ActionItemLabels,
  type AssistantAdsContext,
  type AssistantContentKind,
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
  /** Content kind: picks the wording and the chips. Default: social post. */
  kind?: AssistantContentKind;
  /** Blog: the passage currently selected in the article, if any. */
  getSelection?: () => BlogAnchor | null;
  /** Ads: the variant (and placement, video moment) on screen, if any. */
  getContext?: () => AssistantAdsContext | null;
  /** Ads: variant names by id, for the summary's tags. */
  variantNames?: Record<string, string>;
  /** Point currently selected on an image or paused video frame. */
  getPointContext?: () => {
    mediaIndex: number;
    x: number;
    y: number;
    variantId?: string | null;
    timeSec?: number | null;
  } | null;
}

/** How often the chips re-read the player / selection / variant on screen. */
const POLL_MS = 500;

/** Polls a reader while mounted; re-renders only when its key changes. */
function usePolled<T>(read: (() => T | null) | undefined, key: (value: T) => string): T | null {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    if (!read) return;
    const tick = () => {
      let value: T | null = null;
      try {
        value = read();
      } catch {
        value = null;
      }
      setState((current) => {
        if (value === null) return current === null ? current : null;
        const next = keyRef.current(value);
        return current?.key === next ? current : { key: next, value };
      });
    };
    const timer = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(timer);
  }, [read]);
  return read ? (state?.value ?? null) : null;
}

/** "Variante B · Storie e Reels · 0:07" for the ads chip. */
function adsContextLabel(context: AssistantAdsContext): string {
  return [
    context.variantName?.trim() || `Variante ${context.variantId}`,
    context.placementLabel?.trim() || null,
    context.timeSec !== null && Number.isFinite(context.timeSec) ? formatTimecode(context.timeSec) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

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
  kind = "SOCIAL_POST",
  getSelection,
  getContext,
  variantNames,
  getPointContext,
}: AssistantPanelProps) {
  const copy = ASSISTANT_KIND_COPY[kind];
  const labels: ActionItemLabels = { variantNames };
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
  const [conversationMode, setConversationMode] = useState<"off" | "active" | "paused">("off");
  const conversationModeRef = useRef<"off" | "active" | "paused">("off");

  const [videoTime, setVideoTime] = useState<number | null>(null);
  const selection = usePolled(getSelection, (anchor) => `${anchor.blockIndex}|${anchor.prefix}|${anchor.quote}`);
  const adsContext = usePolled(
    getContext,
    (c) => `${c.variantId}|${c.placement}|${c.timeSec === null ? "" : Math.floor(c.timeSec)}|${c.variantName}`
  );
  const pointContext = usePolled(
    getPointContext,
    (point) =>
      `${point.variantId ?? ""}|${point.mediaIndex}|${point.x.toFixed(4)}|${point.y.toFixed(4)}|${point.timeSec ?? ""}`
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef(draft);
  const contextRef = useRef({ videoTime, selection, adsContext, pointContext });
  const speechInput = useSpeechInput({
    value: draft,
    onChange: (value) => {
      draftRef.current = value;
      setDraft(value);
      setDictated(true);
    },
    onConversationTurn: sendConversationTurn,
    maxLength: MAX_CLIENT_MESSAGE_LENGTH,
  });
  const speechOutput = useSpeechOutput();
  const cancelSpeechInput = speechInput.cancel;
  const cancelSpeechOutput = speechOutput.cancel;

  useEffect(() => {
    draftRef.current = draft;
    contextRef.current = { videoTime, selection, adsContext, pointContext };
  }, [adsContext, draft, pointContext, selection, videoTime]);

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

  // The parent keys this panel by post/version. Cleanup makes sure a route or
  // version change never leaves the microphone or a spoken reply running.
  useEffect(
    () => () => {
      conversationModeRef.current = "off";
      cancelSpeechInput();
      cancelSpeechOutput();
    },
    [cancelSpeechInput, cancelSpeechOutput, postId, versionNumber]
  );

  const messages = session?.messages ?? [];
  const lastMessage = messages.at(-1);
  const hasClientMessages = messages.some((m) => m.role === "CLIENT");
  const completed = session?.status === "COMPLETED" && Boolean(session.summary);
  const canRetry =
    !busy && session?.status === "OPEN" && lastMessage?.role === "CLIENT" && pendingMessage === null;
  const messagesLeft = session ? session.clientMessagesLeft : null;
  const outOfSessions = !session && sessionsLeft === 0;
  const composerDisabled = !canChat || done !== null || busy !== null || outOfSessions || messagesLeft === 0;
  const composerDisabledRef = useRef(composerDisabled);

  useEffect(() => {
    composerDisabledRef.current = composerDisabled;
  }, [composerDisabled]);

  // ─── Voice ─────────────────────────────────────────────────────────────────

  function setVoiceMode(mode: "off" | "active" | "paused") {
    conversationModeRef.current = mode;
    setConversationMode(mode);
  }

  function currentContextMarker(): string {
    const {
      adsContext: currentAdsContext,
      selection: currentSelection,
      videoTime: currentVideoTime,
      pointContext: currentPointContext,
    } = contextRef.current;
    const markers: string[] = [];
    if (currentAdsContext) {
      markers.push(
        variantMarker({
          variantId: currentAdsContext.variantId,
          variantName: currentAdsContext.variantName,
          placementLabel: currentAdsContext.placementLabel,
          timeSec: currentAdsContext.timeSec,
        })
      );
    }
    if (currentSelection) markers.push(passageMarker(currentSelection.quote));
    if (currentPointContext) {
      markers.push(pointMarker(currentPointContext));
    } else if (!currentAdsContext && currentVideoTime !== null) {
      markers.push(videoMomentMarker(currentVideoTime));
    }
    return markers.join(" ");
  }

  function contextualVoiceDraft(): string {
    const current = draftRef.current.trim();
    const marker = currentContextMarker();
    if (!marker || current.includes(marker)) return current;
    return current ? `${marker} ${current}` : `${marker} `;
  }

  function startVoiceTurn() {
    if (conversationModeRef.current !== "active" || composerDisabledRef.current) {
      if (conversationModeRef.current === "active") setVoiceMode("paused");
      return;
    }
    speechOutput.cancel();
    speechInput.start({ baseText: contextualVoiceDraft(), continuous: false, submitOnEnd: true });
  }

  function sendConversationTurn(message: string) {
    if (conversationModeRef.current !== "active") return;
    void sendMessage(false, { message, inputMode: "VOICE", conversation: true });
  }

  function startConversation() {
    if (!speechInput.supported || !speechOutput.supported || composerDisabled) return;
    speechInput.cancel();
    speechOutput.cancel();
    setVoiceMode("active");
    speechOutput.speak(
      `${copy.intro} Quando hai finito di parlare, ti rispondo e poi torno ad ascoltare.`,
      startVoiceTurn
    );
  }

  function pauseConversation() {
    speechInput.cancel();
    speechOutput.cancel();
    setVoiceMode("paused");
  }

  function resumeConversation() {
    if (composerDisabled) return;
    setVoiceMode("active");
    window.setTimeout(startVoiceTurn, 0);
  }

  function endConversation() {
    speechInput.cancel();
    speechOutput.cancel();
    setVoiceMode("off");
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  function insertMarker(marker: string) {
    setDraft((current) =>
      `${current.trimEnd() ? `${current.trimEnd()} ` : ""}${marker} `.slice(0, MAX_CLIENT_MESSAGE_LENGTH)
    );
    textareaRef.current?.focus();
  }

  function insertVideoMoment() {
    if (videoTime === null) return;
    insertMarker(videoMomentMarker(videoTime));
  }

  function insertPassage() {
    if (!selection) return;
    insertMarker(passageMarker(selection.quote));
  }

  function insertAdsContext() {
    if (!adsContext) return;
    insertMarker(
      variantMarker({
        variantId: adsContext.variantId,
        variantName: adsContext.variantName,
        placementLabel: adsContext.placementLabel,
        timeSec: adsContext.timeSec,
      })
    );
  }

  function insertPointContext() {
    if (!pointContext) return;
    insertMarker(pointMarker(pointContext));
  }

  async function sendMessage(
    retry = false,
    voiceTurn?: { message: string; inputMode: ReviewInputModeValue; conversation: boolean }
  ) {
    const message = (voiceTurn?.message ?? draft).trim();
    if (busy || (!retry && !message)) return;
    speechInput.cancel();
    const inputMode: ReviewInputModeValue = voiceTurn?.inputMode ?? (dictated ? "VOICE" : "TEXT");

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
      if (voiceTurn?.conversation && conversationModeRef.current === "active") {
        const reply = [...turn.session.messages].reverse().find((item) => item.role === "ASSISTANT");
        if (reply) {
          speechOutput.speak(reply.content, () => {
            if (conversationModeRef.current === "active") startVoiceTurn();
          });
        } else {
          setVoiceMode("paused");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'assistente non è riuscito a rispondere. Riprova.");
      if (voiceTurn?.conversation) setVoiceMode("paused");
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
    endConversation();
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
    endConversation();
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
      <header className="flex items-start gap-3">
        <HeiliAssistantIcon className="h-9 w-9" />
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold">Assistente di revisione</h2>
          <p className="text-xs text-muted">
            Ti aiuta a spiegare all&apos;agenzia cosa cambiare. Non approva e non invia nulla al posto tuo.
          </p>
        </div>
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
            <Bubble role="ASSISTANT" content={copy.intro} />
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
      {done === "approved" && <p className="text-sm text-success">{copy.approvedText}</p>}

      {completed && session && done === null && (
        <SummaryCard
          session={session}
          changesDraft={changesDraft ?? session.changesMessage ?? ""}
          onChangesDraft={setChangesDraft}
          disabled={busy !== null || !canChat}
          labels={labels}
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
            {(videoTime !== null || selection || adsContext || pointContext) && (
              <div className="flex flex-wrap gap-2">
                {videoTime !== null && (
                  <Chip onClick={insertVideoMoment} disabled={composerDisabled}>
                    Usa il momento attuale ({formatTimecode(videoTime)})
                  </Chip>
                )}
                {selection && (
                  <Chip onClick={insertPassage} disabled={composerDisabled}>
                    Usa il passaggio selezionato{" "}
                    <span className="text-muted">{shortQuote(selection.quote, 40)}</span>
                  </Chip>
                )}
                {adsContext && (
                  <Chip onClick={insertAdsContext} disabled={composerDisabled}>
                    Usa la variante e il momento attuali{" "}
                    <span className="text-muted">({adsContextLabel(adsContext)})</span>
                  </Chip>
                )}
                {pointContext && (
                  <Chip onClick={insertPointContext} disabled={composerDisabled}>
                    Usa il punto selezionato ({Math.round(pointContext.x * 100)}%, {Math.round(pointContext.y * 100)}%)
                  </Chip>
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                draftRef.current = e.target.value;
                setDraft(e.target.value);
                setDictated(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (conversationMode === "active") pauseConversation();
                  void sendMessage();
                }
              }}
              maxLength={MAX_CLIENT_MESSAGE_LENGTH}
              rows={3}
              disabled={composerDisabled}
              placeholder={completed ? "Vuoi aggiungere qualcosa? Scrivilo qui…" : copy.placeholder}
              aria-label="Messaggio per l'assistente"
              className="w-full resize-y rounded border border-border bg-background p-3 text-base outline-none focus:border-accent disabled:opacity-60"
            />
            {speechInput.error && (
              <p className="text-xs text-error" role="alert">
                {speechInput.error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {speechInput.supported && conversationMode === "off" && (
                <button
                  type="button"
                  onClick={() =>
                    speechInput.listening
                      ? speechInput.stop()
                      : speechInput.start({ continuous: true, submitOnEnd: false })
                  }
                  disabled={!speechInput.listening && composerDisabled}
                  aria-pressed={speechInput.listening}
                  className={`min-h-11 rounded border px-3 text-sm disabled:opacity-50 ${
                    speechInput.listening ? "border-accent text-accent" : "border-border hover:border-border-hover"
                  }`}
                >
                  {speechInput.listening ? "Ferma dettatura" : "Detta il messaggio"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (conversationMode === "active") pauseConversation();
                  void sendMessage();
                }}
                disabled={composerDisabled || !draft.trim()}
                className="min-h-11 rounded bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy === "send" ? "Invio…" : "Invia"}
              </button>
              {messagesLeft !== null && messagesLeft <= 5 && messagesLeft > 0 && (
                <span className="text-xs text-muted">Messaggi rimasti: {messagesLeft}</span>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">Parla con Heili</p>
                <p className="text-xs text-muted">
                  Conversazione vocale sul contenuto che stai guardando. Heili ascolta un turno, risponde a voce e
                  prepara il feedback; non approva e non invia modifiche.
                </p>
              </div>
              {!speechInput.supported || !speechOutput.supported ? (
                <p className="text-xs text-muted">
                  La conversazione vocale non è disponibile in questo browser. La chat scritta resta sempre utilizzabile.
                </p>
              ) : conversationMode === "off" ? (
                <button
                  type="button"
                  onClick={startConversation}
                  disabled={composerDisabled}
                  className="min-h-11 rounded-md border border-accent bg-background px-4 text-sm font-semibold text-accent hover:bg-surface disabled:opacity-50"
                >
                  Inizia conversazione vocale
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm" aria-live="polite">
                    {conversationMode === "paused"
                      ? "Conversazione in pausa."
                      : speechInput.listening
                        ? "Ti ascolto…"
                        : speechOutput.speaking
                          ? "Heili sta rispondendo…"
                          : busy === "send"
                            ? "Heili sta preparando la risposta…"
                            : "Conversazione attiva. Puoi iniziare il prossimo turno."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {conversationMode === "active" && speechInput.listening && (
                      <button
                        type="button"
                        onClick={speechInput.stop}
                        className="min-h-11 rounded-md bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover"
                      >
                        Ho finito, rispondi
                      </button>
                    )}
                    {conversationMode === "active" && !speechInput.listening && !speechOutput.speaking && !busy && (
                      <button
                        type="button"
                        onClick={startVoiceTurn}
                        className="min-h-11 rounded-md bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover"
                      >
                        Parla ora
                      </button>
                    )}
                    {conversationMode === "active" ? (
                      <button
                        type="button"
                        onClick={pauseConversation}
                        className="min-h-11 rounded-md border border-border bg-background px-3 text-sm hover:border-border-hover"
                      >
                        Pausa
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={resumeConversation}
                        disabled={composerDisabled}
                        className="min-h-11 rounded-md border border-accent bg-background px-3 text-sm font-medium text-accent disabled:opacity-50"
                      >
                        Riprendi
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={endConversation}
                      className="min-h-11 rounded-md border border-border bg-background px-3 text-sm hover:border-border-hover"
                    >
                      Termina
                    </button>
                  </div>
                </div>
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
                {busy === "approve" ? (kind === "AD_CREATIVE" ? "Invio…" : "Approvazione…") : copy.approveLabel}
              </ActionButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Chip({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 max-w-full truncate rounded-full border border-border px-3 py-1 text-left text-xs hover:border-border-hover disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Message text with the inserted markers (moments, passages, variants) as chips. */
function MessageText({ content }: { content: string }) {
  const chip = "mx-0.5 inline-block max-w-full rounded-full border border-border px-2 text-xs";
  return (
    <>
      {splitMessageMarkers(content).map((segment, i) => {
        if (segment.type === "text") return <span key={i}>{segment.value}</span>;
        if (segment.type === "moment") {
          return (
            <span key={i} className={chip}>
              Momento {segment.label}
            </span>
          );
        }
        if (segment.type === "passage") {
          return (
            <span key={i} className={`${chip} italic`} title={segment.quote}>
              Passaggio {shortQuote(segment.quote, 60)}
            </span>
          );
        }
        if (segment.type === "point") {
          return (
            <span key={i} className={chip}>
              {segment.label}
            </span>
          );
        }
        return (
          <span key={i} className={chip}>
            {segment.label}
          </span>
        );
      })}
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
  labels,
}: {
  session: AssistantSessionView;
  changesDraft: string;
  onChangesDraft: (value: string) => void;
  disabled: boolean;
  labels: ActionItemLabels;
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
            return (
              <li key={i} className="flex gap-2">
                <span className="text-muted">•</span>
                <span className="min-w-0 break-words">
                  <span className="text-xs text-muted">
                    {[ACTION_AREA_LABELS[item.area], ...actionItemPlaceTags(item, labels), ACTION_PRIORITY_LABELS[item.priority]].join(
                      " · "
                    )}
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
          className="w-full resize-y rounded border border-border bg-background p-2 text-base outline-none focus:border-accent disabled:opacity-60"
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
      className={`min-h-11 rounded border px-4 py-2 text-sm font-medium disabled:opacity-50 ${tone}`}
    >
      {children}
    </button>
  );
}

export default AssistantPanel;
