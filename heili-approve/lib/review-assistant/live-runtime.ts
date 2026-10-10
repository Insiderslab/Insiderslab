import OpenAI from "openai";
import type { ServerEvent } from "openai/resources/live/live";
import { SidebandWS } from "openai/resources/live/sideband/ws";
import { prisma } from "@/lib/db/client";
import { AssistantError } from "./provider";

type PersistedCall = {
  id: string;
  providerSessionId: string;
  expiresAt: Date;
  currentContextMarker?: string | null;
};

type Runtime = {
  ws: SidebandWS;
  queue: Promise<void>;
  timer: ReturnType<typeof setTimeout>;
  terminal: Promise<void>;
  resolveTerminal: () => void;
  configurationReady: Promise<void>;
  resolveConfigurationReady: () => void;
  currentContextMarker: string | null;
  greeted: boolean;
};

type RuntimeGlobals = typeof globalThis & {
  __approveLiveRuntimes?: Map<string, Runtime>;
  __approveLiveAttachPromises?: Map<string, Promise<Runtime>>;
};

const runtimeGlobals = globalThis as RuntimeGlobals;
const runtimes = (runtimeGlobals.__approveLiveRuntimes ??= new Map());
const attachPromises = (runtimeGlobals.__approveLiveAttachPromises ??= new Map());

let openAIClient: OpenAI | null = null;

export function liveOpenAIClient(): OpenAI {
  // Session creation is billable and not idempotent: never retry an ambiguous
  // timeout automatically, because it could create a second live call.
  openAIClient ??= new OpenAI({ maxRetries: 0, timeout: 20_000 });
  return openAIClient;
}

export function resetLiveOpenAIClient(): void {
  openAIClient = null;
}

function logRuntimeError(callId: string, label: string, error: unknown): void {
  const category = error instanceof Error ? error.name : "UnknownError";
  console.error(`[review-assistant-live] ${label} for call ${callId}: ${category}`);
}

async function persistTranscriptEvent(callId: string, event: ServerEvent, contextMarker: string | null): Promise<void> {
  if (event.type !== "session.input_transcript.delta" && event.type !== "session.output_transcript.delta") return;
  if (!event.delta || !Number.isSafeInteger(event.start_ms) || !Number.isSafeInteger(event.end_ms)) return;
  await prisma.reviewVoiceTranscriptFragment.createMany({
    data: [
      {
        callId,
        eventId: event.event_id,
        speaker: event.type === "session.input_transcript.delta" ? "user" : "assistant",
        delta: event.delta,
        startMs: event.start_ms,
        endMs: event.end_ms,
        contextMarker: event.type === "session.input_transcript.delta" ? contextMarker : null,
      },
    ],
    skipDuplicates: true,
  });
}

async function persistUsage(callId: string, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  await prisma.reviewVoiceCall.updateMany({
    where: { id: callId },
    data: { audioSeconds: Math.max(0, Math.ceil(seconds)) },
  });
}

type GroupedSegment = {
  speaker: "user" | "assistant";
  text: string;
  startMs: number;
  endMs: number;
  contextMarker: string | null;
};

export function groupLiveTranscriptFragments(
  fragments: Array<{
    speaker: string;
    delta: string;
    startMs: number;
    endMs: number;
    contextMarker: string | null;
  }>
): GroupedSegment[] {
  const segments: GroupedSegment[] = [];
  // Full-duplex transcript deltas interleave, sometimes in the middle of a
  // word. Keep each speaker's current phrase independent of the other stream.
  const latest = new Map<GroupedSegment["speaker"], GroupedSegment>();
  for (const fragment of fragments) {
    if (!fragment.delta) continue;
    const speaker = fragment.speaker === "user" ? "user" : "assistant";
    const contextMarker = speaker === "user" ? fragment.contextMarker : null;
    const previous = latest.get(speaker);
    if (
      previous &&
      previous.contextMarker === contextMarker &&
      fragment.startMs - previous.endMs <= 2_000
    ) {
      previous.text += fragment.delta;
      previous.endMs = Math.max(previous.endMs, fragment.endMs);
    } else {
      const segment: GroupedSegment = {
        speaker,
        text: fragment.delta,
        startMs: fragment.startMs,
        endMs: fragment.endMs,
        contextMarker,
      };
      segments.push(segment);
      latest.set(speaker, segment);
    }
  }
  return segments.filter((segment) => segment.text.trim().length > 0);
}

export function canProjectLiveTranscriptStatus(status: string): boolean {
  return status === "CLOSED" || status === "EXPIRED" || status === "FAILED";
}

/** Projects provider-authenticated fragments into the normal append-only assistant transcript. */
export async function flushLiveTranscript(callId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review-live-transcript:${callId}`}))`;
    const call = await tx.reviewVoiceCall.findUnique({
      where: { id: callId },
      include: {
        fragments: { orderBy: [{ startMs: "asc" }, { endMs: "asc" }, { createdAt: "asc" }] },
        segments: { select: { ordinal: true } },
      },
    });
    if (!call) return;
    // Never project a partial CLOSING transcript. A later fragment can extend
    // the current segment; ordinal-based idempotency is safe only after the
    // trusted terminal state has been recorded.
    if (!canProjectLiveTranscriptStatus(call.status)) return;
    const existing = new Set(call.segments.map((segment) => segment.ordinal));
    const segments = groupLiveTranscriptFragments(call.fragments);
    for (const [ordinal, segment] of segments.entries()) {
      if (existing.has(ordinal)) continue;
      const createdAt = new Date(call.startedAt.getTime() + segment.startMs);
      const message = await tx.reviewMessage.create({
        data: {
          sessionId: call.sessionId,
          role: segment.speaker === "user" ? "CLIENT" : "ASSISTANT",
          content:
            segment.speaker === "user" && segment.contextMarker
              ? `${segment.contextMarker}\n${segment.text.trim()}`
              : segment.text.trim(),
          inputMode: "VOICE",
          createdAt,
        },
        select: { id: true },
      });
      await tx.reviewVoiceTranscriptSegment.create({
        data: {
          callId,
          ordinal,
          messageId: message.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          createdAt,
        },
      });
    }
  });
}

async function finishCall(
  callId: string,
  input: { reason: string; seconds?: number; failed?: boolean }
): Promise<void> {
  if (typeof input.seconds === "number") await persistUsage(callId, input.seconds);
  await prisma.reviewVoiceCall.updateMany({
    where: { id: callId, status: { in: ["STARTING", "ACTIVE", "CLOSING"] } },
    data: {
      status: input.failed ? "FAILED" : input.reason === "expired" ? "EXPIRED" : "CLOSED",
      closedAt: new Date(),
      closeReason: input.reason.slice(0, 80),
      ...(input.failed ? { failureCode: "sideband" } : {}),
    },
  });
  await flushLiveTranscript(callId);
}

async function recordControlFailure(callId: string, code: string): Promise<void> {
  await prisma.reviewVoiceCall.updateMany({
    where: { id: callId, status: { in: ["STARTING", "ACTIVE", "CLOSING"] } },
    data: { status: "CLOSING", failureCode: code.slice(0, 80) },
  });
}

function waitForOpen(ws: SidebandWS, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.socket.readyState === 1) {
      resolve();
      return;
    }
    let settled = false;
    const timer = setTimeout(() => done(new Error("Timeout apertura canale di controllo")), timeoutMs);
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.socket.off("open", onOpen);
      ws.socket.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onOpen = () => done();
    const onError = (error: Error) => done(error);
    ws.socket.on("open", onOpen);
    ws.socket.on("error", onError);
  });
}

async function attachRuntime(call: PersistedCall): Promise<Runtime> {
  const ws = new SidebandWS(
    liveOpenAIClient(),
    { session_id: call.providerSessionId, graceful_close: true },
    {
      maxQueueSize: 32,
      reconnect: {
        maxRetries: 3,
        onReconnecting: () => ({ parameters: { session_id: call.providerSessionId, graceful_close: true } }),
      },
    }
  );
  let resolveTerminal = () => {};
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  let resolveConfigurationReady = () => {};
  const configurationReady = new Promise<void>((resolve) => {
    resolveConfigurationReady = resolve;
  });
  const runtime: Runtime = {
    ws,
    queue: Promise.resolve(),
    timer: setTimeout(() => {}, 0),
    terminal,
    resolveTerminal,
    configurationReady,
    resolveConfigurationReady,
    currentContextMarker: call.currentContextMarker ?? null,
    greeted: false,
  };

  ws.on("event", (event) => {
    const contextMarker = runtime.currentContextMarker;
    runtime.queue = runtime.queue
      .then(async () => {
        await persistTranscriptEvent(call.id, event, contextMarker);
        if (event.type === "session.started" || event.type === "session.updated") {
          await prisma.reviewVoiceCall.updateMany({
            where: { id: call.id },
            data: { providerExpiresAt: new Date(event.session.expires_at * 1_000) },
          });
          runtime.resolveConfigurationReady();
        }
        if (event.type === "session.usage.updated") await persistUsage(call.id, event.usage.seconds);
        if (event.type === "session.closed") {
          await finishCall(call.id, { reason: event.reason, seconds: event.usage.seconds });
          clearTimeout(runtime.timer);
          runtimes.delete(call.id);
          runtime.resolveTerminal();
        }
      })
      .catch((error) => logRuntimeError(call.id, "evento sideband", error));
  });
  ws.on("error", (error) => logRuntimeError(call.id, "sideband", error));
  ws.on("close", () => {
    if (runtimes.get(call.id) === runtime) runtimes.delete(call.id);
    clearTimeout(runtime.timer);
    void runtime.queue.finally(() => runtime.resolveTerminal());
  });

  await waitForOpen(ws);
  // A sideband attaches after startup and is not guaranteed to replay
  // session.started. A no-op Responses update yields session.updated with the
  // authoritative provider expires_at, which makes restart recovery durable.
  ws.send({
    type: "session.update",
    event_id: `sync_${call.id}`,
    session: { delegation: { type: "responses", responses: {} } },
  });
  await Promise.race([
    runtime.configurationReady,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout sincronizzazione sessione Live")), 4_000);
      timer.unref?.();
    }),
  ]);
  const remaining = Math.max(0, call.expiresAt.getTime() - Date.now());
  runtime.timer = setTimeout(() => {
    void requestRuntimeClose(call.id, "expired");
  }, remaining);
  runtime.timer.unref?.();
  runtimes.set(call.id, runtime);
  return runtime;
}

export async function ensureLiveRuntime(call: PersistedCall): Promise<Runtime> {
  const existing = runtimes.get(call.id);
  if (existing && (existing.ws.socket.readyState === 0 || existing.ws.socket.readyState === 1)) return existing;
  if (existing) {
    runtimes.delete(call.id);
    clearTimeout(existing.timer);
  }
  const pending = attachPromises.get(call.id);
  if (pending) return pending;
  const promise = attachRuntime(call).finally(() => attachPromises.delete(call.id));
  attachPromises.set(call.id, promise);
  return promise;
}

export async function requestRuntimeClose(callId: string, reason = "close_requested"): Promise<void> {
  const call = await prisma.reviewVoiceCall.findUnique({
    where: { id: callId },
    select: { id: true, providerSessionId: true, expiresAt: true, status: true, currentContextMarker: true },
  });
  if (!call?.providerSessionId) return;
  if (call.status === "CLOSED" || call.status === "EXPIRED" || call.status === "FAILED") {
    await flushLiveTranscript(callId);
    return;
  }
  await prisma.reviewVoiceCall.updateMany({
    where: { id: callId, status: { in: ["STARTING", "ACTIVE"] } },
    data: { status: "CLOSING", closeReason: reason },
  });
  let runtime: Runtime;
  try {
    runtime = await ensureLiveRuntime({
      id: call.id,
      providerSessionId: call.providerSessionId,
      expiresAt: call.expiresAt,
      currentContextMarker: call.currentContextMarker,
    });
  } catch (error) {
    await recordControlFailure(callId, "sideband_unavailable");
    throw error;
  }
  runtime.ws.send({ type: "session.close", event_id: `close_${callId}` });
  await Promise.race([
    runtime.terminal,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 8_000);
      timer.unref?.();
    }),
  ]);
  await runtime.queue;
  const afterGraceful = await prisma.reviewVoiceCall.findUnique({
    where: { id: callId },
    select: { status: true, providerSessionId: true },
  });
  if (afterGraceful?.status === "CLOSING" && afterGraceful.providerSessionId) {
    // The unified endpoint currently documents hangup for SIP; some projects also
    // accept it for WebRTC. Try it only as a fallback and keep CLOSING unless a
    // trusted session.closed event confirms termination.
    await liveOpenAIClient().live.sessions.hangup(afterGraceful.providerSessionId).catch(() => {});
    await Promise.race([
      runtime.terminal,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        timer.unref?.();
      }),
    ]);
    await runtime.queue;
  }
  await flushLiveTranscript(callId);
}

export async function appendLiveContext(
  call: PersistedCall,
  contextMarker: string | null,
  content: string
): Promise<void> {
  const runtime = await ensureLiveRuntime(call);
  runtime.currentContextMarker = contextMarker;
  runtime.ws.send({
    type: "session.thinking.append",
    delegation_id: null,
    event_id: `ctx_${Date.now()}`,
    content,
  });
}

export async function attachNewLiveRuntime(call: PersistedCall): Promise<void> {
  try {
    await ensureLiveRuntime(call);
  } catch {
    await recordControlFailure(call.id, "sideband_unavailable");
    throw new AssistantError("La conversazione vocale non è disponibile in questo momento. Riprova tra poco.", 503);
  }
}

/** Called only after the browser reports the WebRTC peer as connected. */
export async function confirmLiveConnected(call: PersistedCall): Promise<void> {
  const runtime = await ensureLiveRuntime(call);
  if (runtime.greeted) return;
  runtime.greeted = true;
  runtime.ws.send({
    type: "session.commentary.append",
    delegation_id: null,
    event_id: `hello_${call.id}`,
    content: "Saluta brevemente e invita il cliente a dire cosa vorrebbe cambiare nel contenuto che sta guardando.",
  });
}
