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

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useSpeechInput } from "@/components/voice/use-speech-input";
import { useLiveConversation, type PreparingStep } from "@/components/voice/use-live-conversation";
import {
  PLAYBACK_BLOCKED_MESSAGE,
  SLOW_PREPARATION_MESSAGE,
  VOICE_STEP_LABELS,
  VOICE_SUPPORT_MESSAGES,
  preparationLabel,
  voiceStartBlocker,
  type VoicePreparation,
} from "@/components/voice/voice-rules";
import HeiliAssistantIcon from "@/components/heili-assistant-icon";
import type { BlogAnchor } from "@/lib/content/types";
import { formatTimecode } from "@/lib/domain";
import {
  ACTION_AREA_LABELS,
  ACTION_PRIORITY_LABELS,
  ASSISTANT_BAR_HINT,
  ASSISTANT_BUTTONS,
  ASSISTANT_FEEDBACK_COPY,
  ASSISTANT_KIND_COPY,
  MAX_CLIENT_MESSAGE_LENGTH,
  VERDICT_LABELS,
  actionItemPlaceTags,
  barHintText,
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
  type AssistantMode,
  type AssistantSessionView,
  type AssistantStateResponse,
  type AssistantTurnResponse,
  type AssistantVoiceAvailability,
  type Readiness,
  type ReviewInputModeValue,
  voiceUnavailableMessage,
} from "@/lib/review-assistant/shared";

export interface AssistantPanelProps {
  token: string;
  postId: string;
  versionNumber: number;
  /**
   * Sends the conclusion: the change request ("decision" mode) or the
   * additional feedback ("feedback" mode, after «Chiedi modifiche»).
   */
  onSubmitChanges(input: { message: string; reviewSessionId: string }): Promise<void>;
  /** Only in "decision" mode: after «Chiedi modifiche» there is nothing left to approve. */
  onApprove?(): Promise<void>;
  /**
   * "decision" (default): the post waits for the client's decision.
   * "feedback": the changes were already requested; Heili only adds to that
   * feedback, with no «Approva» and with «Aggiungi al feedback» as conclusion.
   */
  mode?: AssistantMode;
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
  /** Lets the persistent portal footer reuse this panel's guarded actions. */
  controlRef?: Ref<AssistantPanelHandle>;
  /** Existing saved-comment flow, used when this assistant has no feedback yet. */
  onRequestSavedChanges?: () => Promise<void>;
  /** False when the dock around the panel shows title and help itself. */
  showHeader?: boolean;
  /**
   * «Indica un punto sull'immagine»: chiude il dock e trasforma il prossimo
   * tocco sull'immagine nel marcatore di un punto, dentro il messaggio.
   */
  onPickPoint?: () => void;
  /** Come sopra, per il momento del video. */
  onPickMoment?: () => void;
  /**
   * Heili holds feedback that «Chiedi modifiche» would send (a message in the
   * field, a conversation, dictation). The portal reads it to decide which
   * button of the decision bar is the primary one.
   */
  onPendingFeedbackChange?: (pending: boolean) => void;
  /**
   * Set when the panel covers the page's decision bar (the modal sheet on a
   * phone): the hint under the summary then asks to close Heili first and
   * offers this way back to the bar (QA-06).
   */
  onBackToPage?: () => void;
}

export interface AssistantPanelHandle {
  isLoadingFeedback(): boolean;
  hasPendingFeedback(): boolean;
  requestChanges(): Promise<void>;
  approve(): Promise<void>;
  close(): Promise<boolean>;
  /** Aggiunge un marcatore al messaggio in bozza (flusso «Indica un punto»). */
  insertMarker(marker: string): void;
}

type ComposerAction = "prepare" | "send" | "approve" | "add";

export function composerBlockingMessage(
  draft: string,
  listening: boolean,
  action: ComposerAction
): string | null {
  if (!draft.trim() && !listening) return null;
  const next =
    action === "approve"
      ? "approvare"
      : action === "send"
        ? "inviare le modifiche"
        : action === "add"
          ? "aggiungere al feedback"
          : "preparare il riepilogo";
  if (listening) {
    return `Ferma la dettatura, poi invia o svuota il messaggio prima di ${next}.`;
  }
  return `Invia o svuota il messaggio ancora in bozza prima di ${next}: non è ancora incluso nel riepilogo.`;
}

/** How often the chips re-read the player / selection / variant on screen. */
const POLL_MS = 500;

/**
 * A send is refused while another one is running (a ref guard, not just the
 * `busy` state: Enter and a click in the same instant both see the old state),
 * and when the message is empty unless it is a retry.
 */
export function sendBlocked(state: {
  sending: boolean;
  busy: boolean;
  voiceBusy: boolean;
  retry: boolean;
  message: string;
}): boolean {
  if (state.sending || state.busy || state.voiceBusy) return true;
  return !state.retry && !state.message;
}

/**
 * The optimistic bubble to show for a message just sent: hidden as soon as the
 * server's own copy is the last message (no duplicated bubble), so
 * "message in sending" and "message saved" never show together.
 */
export function visiblePendingMessage(
  pending: string | null,
  messages: ReadonlyArray<{ role: string; content: string }>
): string | null {
  if (pending === null) return null;
  const last = messages.at(-1);
  return last?.role === "CLIENT" && last.content === pending ? null : pending;
}

/** Parola di stato della chiamata vocale (H-04), con la sua tinta. */
export type LiveTone = "waiting" | "listening" | "speaking" | "paused";

export function liveStatus(
  phase: "preparing" | "connecting" | "active" | "closing",
  state: { muted: boolean; speaking: boolean; step?: PreparingStep | null; preparation?: VoicePreparation | null }
): { label: string; tone: LiveTone } {
  if (phase === "preparing") {
    return {
      label: state.step === "microphone" ? VOICE_STEP_LABELS.microphone : preparationLabel(state.preparation ?? null),
      tone: "waiting",
    };
  }
  if (phase === "connecting") return { label: VOICE_STEP_LABELS.connecting, tone: "waiting" };
  if (phase === "closing") return { label: VOICE_STEP_LABELS.closing, tone: "waiting" };
  if (state.muted) return { label: "In pausa", tone: "paused" };
  if (state.speaking) return { label: "Heili sta parlando", tone: "speaking" };
  return { label: "In ascolto", tone: "listening" };
}

/** Quanto resta acceso «Heili sta parlando» dopo l'ultimo frammento ricevuto. */
const SPEAKING_MS = 1600;

/** Il passo del flusso 1 Parla · 2 Controlla · 3 Invia (U-03). */
export function assistantStep(state: { completed: boolean; submitting: boolean; done: boolean }): 1 | 2 | 3 {
  if (state.done || state.submitting) return 3;
  if (state.completed) return 2;
  return 1;
}

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
  mode = "decision",
  getVideoTime,
  kind = "SOCIAL_POST",
  getSelection,
  getContext,
  variantNames,
  getPointContext,
  controlRef,
  onRequestSavedChanges,
  showHeader = true,
  onPickPoint,
  onPickMoment,
  onPendingFeedbackChange,
  onBackToPage,
}: AssistantPanelProps) {
  const copy = ASSISTANT_KIND_COPY[kind];
  const feedbackMode = mode === "feedback";
  // The portal's sticky «Chiedi modifiche» / «Approva» bar drives the panel only while the client decides.
  const barDrives = Boolean(controlRef) && !feedbackMode;
  const labels: ActionItemLabels = { variantNames };
  const baseUrl = `/api/review/${encodeURIComponent(token)}/assistant`;

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AssistantSessionView | null>(null);
  const [sessionsLeft, setSessionsLeft] = useState<number | null>(null);
  const [canChat, setCanChat] = useState(true);
  const [voice, setVoice] = useState<AssistantVoiceAvailability>({ available: true, reason: null });
  /** True after a tap on «Parla a voce» that could not start: the reason stays in view. */
  const [voiceTapRefused, setVoiceTapRefused] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  const [draft, setDraft] = useState("");
  const [dictated, setDictated] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "send" | "finalize" | "submit" | "approve">(null);
  const [error, setError] = useState<string | null>(null);
  const [changesDraft, setChangesDraft] = useState<string | null>(null);
  const [done, setDone] = useState<null | "changes" | "approved">(null);

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
  const panelRef = useRef<HTMLElement | null>(null);
  /** Synchronous guard: one in-flight send, whatever the button/key timing. */
  const sendingRef = useRef(false);
  const draftRef = useRef(draft);
  const contextRef = useRef({ videoTime, selection, adsContext, pointContext });
  const speechInput = useSpeechInput({
    value: draft,
    onChange: (value) => {
      draftRef.current = value;
      setDraft(value);
      setDictated(true);
    },
    maxLength: MAX_CLIENT_MESSAGE_LENGTH,
  });
  const cancelSpeechInput = speechInput.cancel;

  useEffect(() => {
    draftRef.current = draft;
    contextRef.current = { videoTime, selection, adsContext, pointContext };
  }, [adsContext, draft, pointContext, selection, videoTime]);

  const applyState = useCallback((state: AssistantStateResponse) => {
    setSession(state.session);
    setSessionsLeft(state.sessionsLeft);
    setCanChat(state.canChat);
    // An older server without the field: let the tap try (it explains on failure).
    setVoice(state.voice ?? { available: true, reason: null });
  }, []);

  const stateUrl = `${baseUrl}?postId=${encodeURIComponent(postId)}&versionNumber=${versionNumber}`;

  const reload = useCallback(async () => {
    const state = await callApi<AssistantStateResponse>(stateUrl);
    applyState(state);
    return state;
  }, [applyState, stateUrl]);

  const reloadAfterVoice = useCallback(async () => {
    const state = await reload();
    // A new voice call can create a new review session. Never keep the
    // editable text from the previously completed session over the new one.
    if (state.session?.status !== "COMPLETED" || state.session.id !== session?.id || state.session.changesMessage !== session?.changesMessage) {
      setChangesDraft(null);
    }
    setReadiness(null);
    return state;
  }, [reload, session?.id, session?.changesMessage]);

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
      cancelSpeechInput();
    },
    [cancelSpeechInput, postId, versionNumber]
  );

  const live = useLiveConversation({ url: `${baseUrl}/voice`, postId, versionNumber, onClosed: reloadAfterVoice });
  const voiceBusy = live.phase !== "idle";

  // «Heili sta parlando»: si accende quando arrivano frammenti della risposta
  // e si spegne da solo dopo l'ultimo (nessun cambio dentro useLiveConversation).
  const assistantTextRef = useRef(live.assistantText);
  const lastAssistantDeltaRef = useRef(0);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  useEffect(() => {
    if (!live.assistantText) return;
    assistantTextRef.current = live.assistantText;
    lastAssistantDeltaRef.current = Date.now();
  }, [live.assistantText]);
  useEffect(() => {
    if (live.phase !== "active") {
      const reset = window.setTimeout(() => setAssistantSpeaking(false), 0);
      return () => window.clearTimeout(reset);
    }
    const poll = window.setInterval(() => {
      setAssistantSpeaking(assistantTextRef.current.length > 0 && Date.now() - lastAssistantDeltaRef.current < SPEAKING_MS);
    }, 400);
    return () => window.clearInterval(poll);
  }, [live.phase]);
  const messages = session?.messages ?? [];
  const pendingVisible = visiblePendingMessage(pendingMessage, messages);
  const lastMessage = messages.at(-1);
  const hasClientMessages = messages.some((m) => m.role === "CLIENT");
  const completed = session?.status === "COMPLETED" && Boolean(session.summary);
  const canRetry =
    !busy && session?.status === "OPEN" && lastMessage?.role === "CLIENT" && pendingMessage === null;
  const messagesLeft = session ? session.clientMessagesLeft : null;
  const outOfSessions = !session && sessionsLeft === 0;
  const composerDisabled = voiceBusy || !canChat || done !== null || busy !== null || outOfSessions || messagesLeft === 0;

  function guardComposer(action: ComposerAction): boolean {
    if (loading) {
      setError("Sto recuperando i tuoi commenti e la conversazione. Attendi il caricamento prima di concludere la revisione.");
      return false;
    }
    const message = composerBlockingMessage(draftRef.current, speechInput.listening, action);
    if (!message) return true;
    setError(message);
    textareaRef.current?.focus();
    return false;
  }
  function currentContextMarker(context = contextRef.current): string {
    const {
      adsContext: currentAdsContext,
      selection: currentSelection,
      videoTime: currentVideoTime,
      pointContext: currentPointContext,
    } = context;
    const markers: string[] = [];
    if (currentAdsContext && !currentPointContext) {
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

  const selectedContextMarker = currentContextMarker({ adsContext, selection, videoTime, pointContext });
  const updateVoiceContext = live.updateContext;
  useEffect(() => {
    if (live.phase !== "active") return;
    const timer = window.setTimeout(() => { void updateVoiceContext(selectedContextMarker); }, 1000);
    return () => window.clearTimeout(timer);
  }, [live.phase, selectedContextMarker, updateVoiceContext]);

  // Why a tap on «Parla a voce» cannot start now (null: it can). Never a silent,
  // disabled button: the tap shows this sentence (rule: an answer within 300 ms).
  const voiceBlocker = voiceStartBlocker({
    loading,
    busy,
    outOfSessions,
    messagesLeft,
    draft,
    dictating: speechInput.listening,
  });
  const voiceNotice = voiceTapRefused ? voiceBlocker : null;

  function startConversation() {
    if (voiceBusy) return;
    if (voiceBlocker) {
      setVoiceTapRefused(true);
      if (draft.trim()) textareaRef.current?.focus();
      return;
    }
    setVoiceTapRefused(false);
    speechInput.cancel();
    setError(null);
    setReadiness(null);
    void live.start(currentContextMarker());
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
  ) {
    const message = draft.trim();
    if (sendBlocked({ sending: sendingRef.current, busy: busy !== null, voiceBusy, retry, message })) return;
    sendingRef.current = true;
    speechInput.cancel();
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
      // The server's copy replaces the optimistic bubble in the same update.
      setPendingMessage(null);
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
        if (last?.role === "CLIENT" && last.content === message) {
          setPendingMessage(null);
        } else if (!retry) {
          setPendingMessage(null);
          setDraft(message);
          setDictated(inputMode === "VOICE");
        }
      } catch {
        setPendingMessage(null);
        if (!retry) setDraft(message);
      }
    } finally {
      setPendingMessage(null);
      sendingRef.current = false;
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

  async function prepareSummary(): Promise<boolean> {
    if (busy || !guardComposer("prepare")) return false;
    setBusy("finalize");
    setError(null);
    try {
      await live.stop();
      await finalize();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Non sono riuscito a preparare il riepilogo. Riprova.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitChanges() {
    if (busy || !session || !guardComposer(feedbackMode ? "add" : "send")) return;
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
    if (feedbackMode || !onApprove) {
      setError("Hai già chiesto modifiche: non c'è nulla da approvare.");
      return;
    }
    if (busy || !guardComposer("approve")) return;
    setBusy("approve");
    setError(null);
    try {
      await live.stop();
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

  async function requestChanges() {
    if (busy || !guardComposer(feedbackMode ? "add" : "send")) return;
    if (voiceBusy || (session?.status === "OPEN" && hasClientMessages)) {
      const prepared = await prepareSummary();
      if (prepared) {
        window.requestAnimationFrame(() =>
          panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        );
      }
      return;
    }
    if (completed) {
      await submitChanges();
      return;
    }
    if (onRequestSavedChanges) {
      await onRequestSavedChanges();
      return;
    }
    setError("Scrivi un messaggio o aggiungi un commento al contenuto prima di chiedere modifiche.");
    textareaRef.current?.focus();
  }

  async function close(): Promise<boolean> {
    if (busy) return false;
    speechInput.cancel();
    try {
      await live.stop();
      return true;
    } catch {
      return false;
    }
  }

  function hasPendingFeedback(): boolean {
    if (done !== null) return false;
    return Boolean(
      draftRef.current.trim() ||
        pendingMessage !== null ||
        busy !== null ||
        voiceBusy ||
        speechInput.listening ||
        hasClientMessages ||
        completed ||
        live.clientText.trim()
    );
  }

  // Same condition as hasPendingFeedback, as state the page can react to.
  const pendingFeedback =
    done === null &&
    Boolean(
      draft.trim() ||
        pendingMessage !== null ||
        busy !== null ||
        voiceBusy ||
        speechInput.listening ||
        hasClientMessages ||
        completed ||
        live.clientText.trim()
    );
  useEffect(() => {
    onPendingFeedbackChange?.(pendingFeedback);
  }, [onPendingFeedbackChange, pendingFeedback]);
  useEffect(() => () => onPendingFeedbackChange?.(false), [onPendingFeedbackChange]);

  useImperativeHandle(controlRef, () => ({
    isLoadingFeedback: () => loading,
    hasPendingFeedback,
    requestChanges,
    approve,
    close,
    insertMarker,
  }));

  // ─── Render ────────────────────────────────────────────────────────────────

  const sendHighlighted = completed ? session?.verdict === "changes" : readiness === "ready_changes";
  const approveHighlighted = completed ? session?.verdict === "approve" : readiness === "ready_approve";
  const callStatus = liveStatus(voiceBusy && live.phase !== "idle" ? live.phase : "connecting", {
    muted: live.muted,
    speaking: assistantSpeaking,
    step: live.step,
    preparation: live.preparation,
  });

  return (
    <section ref={panelRef} className="space-y-3 rounded-xl border border-border bg-background p-3" aria-label="Assistente di revisione">
      {showHeader && (
        <header className="flex items-start gap-2">
          <HeiliAssistantIcon className="h-7 w-7" />
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold">Heili</h2>
            <p className="text-xs text-muted">
              {feedbackMode
                ? ASSISTANT_FEEDBACK_COPY.header
                : "Ti aiuta a spiegare all'agenzia cosa cambiare. Non approva e non invia nulla al posto tuo."}
            </p>
          </div>
        </header>
      )}

      {/* No voice on this instance at all: nothing to offer, nothing to explain. */}
      {!loading && done === null && canChat && voice.reason !== "not-configured" && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-3" aria-label="Parla a voce" data-testid="voice-box">
          {!voice.available && voice.reason ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold">Parla a voce</p>
              <p className="text-xs text-muted" data-testid="voice-unavailable">
                {voiceUnavailableMessage(voice.reason)}
              </p>
            </div>
          ) : live.supportProblem ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold">Parla a voce</p>
              <p className="text-xs text-muted" data-testid="voice-unsupported">
                {VOICE_SUPPORT_MESSAGES[live.supportProblem]}
              </p>
            </div>
          ) : !voiceBusy ? (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={startConversation}
                // Not `disabled`: a tap must always answer, here with the reason below.
                aria-disabled={voiceBlocker ? true : undefined}
                aria-describedby={voiceNotice ? "voice-notice" : undefined}
                data-testid="voice-start"
                className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-base font-semibold text-white hover:bg-accent-hover ${
                  voiceBlocker ? "opacity-50" : ""
                }`}
              >
                <MicrophoneIcon />
                Parla a voce
              </button>
              {voiceNotice ? (
                <p id="voice-notice" className="text-sm text-warning" role="alert" data-testid="voice-notice">
                  {voiceNotice}
                </p>
              ) : (
                <p className="text-xs text-muted">
                  Oppure scrivi: Heili risponde qui sotto. La voce è generata dall&apos;AI e la decisione resta sempre tua.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold" role="status" aria-live="polite" data-testid="live-status">
                <LiveToneDot tone={callStatus.tone} />
                {callStatus.label}
              </p>
              {live.phase === "preparing" && live.slow && (
                <p className="text-xs text-muted" data-testid="live-slow">
                  {SLOW_PREPARATION_MESSAGE}
                </p>
              )}
              {live.playbackBlocked && (
                <p className="text-sm text-warning" role="alert">
                  {PLAYBACK_BLOCKED_MESSAGE}
                </p>
              )}
              {live.phase === "active" && live.remainingSeconds !== null && (
                <p className="text-xs text-muted" role="timer" aria-live="off">
                  Tempo rimasto: {formatCountdown(live.remainingSeconds)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {live.phase === "active" && (
                  <button
                    type="button"
                    onClick={live.toggleMicrophone}
                    aria-pressed={live.muted}
                    className="min-h-11 rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {live.muted ? "Riattiva microfono" : "Silenzia"}
                  </button>
                )}
                {live.playbackBlocked && (
                  <button type="button" onClick={() => void live.enablePlayback()} className="min-h-11 rounded-md border border-accent px-3 text-sm text-accent">
                    Attiva audio
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void live.stop().catch(() => {})}
                  disabled={live.phase === "closing"}
                  className="min-h-11 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50"
                >
                  {live.phase === "preparing" ? "Annulla preparazione" : live.phase === "connecting" ? "Annulla collegamento" : "Termina"}
                </button>
              </div>
              {(live.clientText || live.assistantText) && (
                <div className="max-h-40 space-y-2 overflow-y-auto rounded border border-border bg-background p-2 text-sm" aria-live="off" aria-label="Sottotitoli">
                  {live.clientText && <p><strong>Tu: </strong>{live.clientText}</p>}
                  {live.assistantText && <p><strong>Heili: </strong>{live.assistantText}</p>}
                </div>
              )}
              <p className="text-xs text-muted">Al termine ritrovi il dialogo qui e puoi preparare il riepilogo per l&apos;agenzia.</p>
            </div>
          )}
          {live.error && (
            <p className="text-sm text-error" role="alert">
              {live.error}
            </p>
          )}
        </div>
      )}

      {!loading && done === null && (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label={feedbackMode ? "Passi: parla, controlla, aggiungi" : "Passi: parla, controlla, invia"} data-testid="assistant-steps">
          {(
            [
              [1, "Parla"],
              [2, "Controlla"],
              [3, feedbackMode ? "Aggiungi" : "Invia"],
            ] as const
          ).map(([step, label], index) => {
            const current = assistantStep({ completed, submitting: busy === "submit", done: done !== null }) === step;
            return (
              <li key={step} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true" className="text-border">·</span>}
                <span
                  aria-current={current ? "step" : undefined}
                  className={current ? "font-semibold text-accent" : "text-muted"}
                >
                  {step} {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div
        ref={scrollRef}
        className="max-h-[50vh] min-h-32 overflow-y-auto space-y-2 rounded border border-border bg-background p-3"
        aria-live="polite"
      >
        {loading ? (
          <p className="text-sm text-muted">Caricamento…</p>
        ) : (
          <>
            {messages.length === 0 && !voiceBusy && !live.clientText && !live.assistantText && (
              <Bubble role="ASSISTANT" content={feedbackMode ? ASSISTANT_FEEDBACK_COPY.intro : copy.intro} />
            )}
            {messages.map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} inputMode={m.inputMode} />
            ))}
            {pendingVisible !== null && <Bubble role="CLIENT" content={pendingVisible} pending />}
            {busy === "send" && (
              <p className="flex items-center gap-1 text-xs text-muted" role="status">
                Heili sta scrivendo
                <span className="typing-dots inline-flex gap-0.5" aria-hidden="true">
                  <span>·</span>
                  <span>·</span>
                  <span>·</span>
                </span>
              </p>
            )}
            {busy === "finalize" && <p className="text-xs text-muted">Preparo il riepilogo per l&apos;agenzia…</p>}
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 border-l-2 border-error pl-2 text-sm text-error" role="alert">
          <span className="min-w-0 flex-1">{error}</span>
          {canRetry && (
            <button type="button" onClick={() => sendMessage(true)} className="min-h-11 shrink-0 font-medium underline underline-offset-2">
              Riprova
            </button>
          )}
        </div>
      )}

      {done === "changes" && (
        <p className="text-sm text-success">
          {feedbackMode ? ASSISTANT_FEEDBACK_COPY.doneText : "Modifiche inviate all'agenzia. Grazie!"}
        </p>
      )}
      {done === "approved" && <p className="text-sm text-success">{copy.approvedText}</p>}

      {completed && session && done === null && (
        <SummaryCard
          session={session}
          changesDraft={changesDraft ?? session.changesMessage ?? ""}
          onChangesDraft={setChangesDraft}
          disabled={busy !== null || !canChat || voiceBusy || Boolean(draft.trim()) || speechInput.listening}
          disabledReason={
            voiceBusy
              ? "Termina la conversazione vocale: il riepilogo verrà aggiornato con ciò che state dicendo."
              : draft.trim() || speechInput.listening
                ? "Invia o svuota il messaggio qui sotto: questa bozza non è ancora inclusa nel riepilogo."
                : !canChat
                  ? "La revisione non è più modificabile."
                  : null
          }
          labels={labels}
          draftLabel={feedbackMode ? ASSISTANT_FEEDBACK_COPY.draftLabel : undefined}
          showVerdict={!feedbackMode}
        />
      )}

      {!loading && done === null && canChat && (
        <>
          {outOfSessions && (
            <p className="text-xs text-muted">
              {feedbackMode
                ? ASSISTANT_FEEDBACK_COPY.exhausted
                : "Hai già usato tutte le conversazioni con l'assistente per questo post. Puoi comunque approvarlo o chiedere modifiche direttamente."}
            </p>
          )}
          {messagesLeft === 0 && !completed && (
            <p className="text-xs text-muted">
              {feedbackMode
                ? ASSISTANT_FEEDBACK_COPY.messagesLimit
                : "La conversazione ha raggiunto la lunghezza massima: prepara il riepilogo per l'agenzia."}
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
            {(onPickPoint || onPickMoment) && (
              <div className="flex flex-wrap gap-2">
                {onPickPoint && (
                  <Chip onClick={onPickPoint} disabled={composerDisabled}>
                    Indica un punto sull&apos;immagine
                  </Chip>
                )}
                {onPickMoment && (
                  <Chip onClick={onPickMoment} disabled={composerDisabled}>
                    Indica il momento sul video
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
              {speechInput.supported && !voiceBusy && (
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
          </div>

          {(hasClientMessages || completed || live.clientText) && (
            <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap">
              {completed && barDrives ? (
                <div className="flex basis-full flex-col gap-2">
                  <p className="text-sm text-muted" data-testid="assistant-bar-hint">
                    {barHintText(Boolean(onBackToPage))}
                  </p>
                  {onBackToPage && (
                    <ActionButton onClick={onBackToPage} disabled={busy !== null} primary>
                      {ASSISTANT_BAR_HINT.back}
                    </ActionButton>
                  )}
                </div>
              ) : completed ? (
                <ActionButton onClick={submitChanges} disabled={busy !== null || voiceBusy} primary={feedbackMode || sendHighlighted}>
                  {busy === "submit"
                    ? feedbackMode
                      ? ASSISTANT_FEEDBACK_COPY.submitting
                      : "Invio…"
                    : feedbackMode
                      ? ASSISTANT_FEEDBACK_COPY.submitLabel
                      : ASSISTANT_BUTTONS.submitChanges}
                </ActionButton>
              ) : (
                <ActionButton
                  onClick={prepareSummary}
                  disabled={busy !== null || live.phase === "preparing" || live.phase === "connecting" || live.phase === "closing" || (!voiceBusy && session?.status !== "OPEN")}
                  primary={readiness === "ready_changes"}
                >
                  {busy === "finalize" ? "Preparo il riepilogo…" : ASSISTANT_BUTTONS.prepareSummary}
                </ActionButton>
              )}
              {!controlRef && !feedbackMode && onApprove && <ActionButton onClick={approve} disabled={busy !== null || voiceBusy} primary={approveHighlighted} success>
                {busy === "approve" ? (kind === "AD_CREATIVE" ? "Invio…" : "Approvazione…") : copy.approveLabel}
              </ActionButton>}
              {(voiceBusy || draft.trim() || speechInput.listening) && (
                <p className="basis-full text-xs text-muted">
                  {voiceBusy
                    ? feedbackMode
                      ? "Termina la conversazione vocale prima di aggiungere il feedback."
                      : "Termina la conversazione vocale prima di inviare o approvare."
                    : "Il messaggio in bozza va inviato o svuotato prima dell’azione finale."}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  );
}

/** Parola + punto di stato: nessuna animazione, leggibile anche con reduced motion. */
function LiveToneDot({ tone }: { tone: LiveTone }) {
  const colors: Record<LiveTone, string> = {
    waiting: "bg-warning",
    listening: "bg-accent",
    speaking: "bg-success",
    paused: "bg-border",
  };
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colors[tone]}`} aria-hidden="true" />;
}

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
  disabledReason,
  labels,
  draftLabel,
  showVerdict = true,
}: {
  session: AssistantSessionView;
  changesDraft: string;
  onChangesDraft: (value: string) => void;
  disabled: boolean;
  disabledReason: string | null;
  labels: ActionItemLabels;
  draftLabel?: string;
  /** False after «Chiedi modifiche»: there is no outcome left to propose. */
  showVerdict?: boolean;
}) {
  return (
    <div className="space-y-3 rounded border border-border bg-background p-3">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Riepilogo per l&apos;agenzia{showVerdict && session.verdict ? ` · ${VERDICT_LABELS[session.verdict]}` : ""} · Non ancora inviato
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
        <span className="text-xs text-muted">
          {draftLabel ?? "Messaggio da inviare all'agenzia (non ancora inviato; puoi modificarlo qui)"}
        </span>
        <textarea
          value={changesDraft}
          onChange={(e) => onChangesDraft(e.target.value)}
          rows={5}
          maxLength={5000}
          disabled={disabled}
          className="w-full resize-y rounded border border-border bg-background p-2 text-base outline-none focus:border-accent disabled:opacity-60"
        />
        {disabled && disabledReason && <span className="block text-xs text-muted">{disabledReason}</span>}
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

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}
