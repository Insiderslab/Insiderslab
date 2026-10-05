/**
 * Claude API calls for the review assistant.
 *
 * Both calls go through the beta namespace so they can carry the server-side
 * refusal fallback (`fallbacks: "default"`), and both use structured outputs
 * (output_config.format built from the zod schemas in ./shared).
 *
 * We call `beta.messages.create` and validate the JSON ourselves instead of
 * `beta.messages.parse`: in SDK 0.131 `parse()` throws as soon as the text is
 * not valid JSON, which is exactly what a refusal or a max_tokens cut-off
 * produces, so stop_reason could never be inspected. Same schema, same
 * request — just a parse step we control.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import {
  buildFinalizeMessages,
  buildFinalizeSystemPrompt,
  buildTurnMessages,
  buildTurnSystemPrompt,
  type AssistantPostContext,
  type HistoryMessage,
} from "./prompt";
import { finalOutputSchema, turnOutputSchema, type FinalOutput, type TurnOutput } from "./shared";

export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const TURN_MAX_TOKENS = 8000;
const FINAL_MAX_TOKENS = 16000;
const TURN_TIMEOUT_MS = 60_000;
const FINAL_TIMEOUT_MS = 120_000;

/** Shown (and stored) when the model declines to answer a client message. */
export const REFUSAL_REPLY =
  "Mi dispiace, su questo non riesco ad aiutarti. Se vuoi, scrivi pure cosa cambiare e invialo all'agenzia con il pulsante «Invia le modifiche all'agenzia».";

/** The assistant is optional: without an API key the portal simply hides it. */
export function isAssistantEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAssistantModel(): string {
  return process.env.REVIEW_ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
}

/**
 * Error with an Italian message that is safe to show to the client as-is and
 * the HTTP status the route should answer with.
 */
export class AssistantError extends Error {
  constructor(
    message: string,
    public status: number = 502
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  // One retry is enough for a chat: the client is waiting on the other side.
  cachedClient ??= new Anthropic({ maxRetries: 1 });
  return cachedClient;
}

/** Test hook: drop the cached SDK client (e.g. after changing env). */
export function resetAssistantClient(): void {
  cachedClient = null;
}

/**
 * Maps SDK errors to friendly Italian messages. Details go to the server log
 * only (never the API key or the request body).
 */
export function toAssistantError(error: unknown): AssistantError {
  if (error instanceof AssistantError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new AssistantError("L'assistente è molto richiesto in questo momento. Riprova tra un minuto.", 503);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AssistantError("L'assistente ci sta mettendo troppo a rispondere. Riprova tra poco.", 504);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AssistantError("Non riesco a contattare l'assistente. Controlla la connessione e riprova.", 503);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error("[review-assistant] Claude API credentials rejected:", error.status, error.message);
    return new AssistantError("L'assistente non è disponibile al momento. Puoi comunque approvare o chiedere modifiche.", 503);
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error("[review-assistant] Claude API rejected the request:", error.message);
    return new AssistantError("L'assistente non è riuscito a rispondere. Riprova tra poco.", 502);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new AssistantError("L'assistente è momentaneamente sovraccarico. Riprova tra poco.", 503);
  }
  if (error instanceof Anthropic.APIError) {
    console.error("[review-assistant] Claude API error:", error.status, error.message);
    return new AssistantError("L'assistente non è riuscito a rispondere. Riprova tra poco.", 502);
  }
  console.error("[review-assistant] Unexpected error:", error);
  return new AssistantError("L'assistente non è riuscito a rispondere. Riprova tra poco.", 500);
}

/** Concatenated text of the response (fallback/thinking blocks are skipped). */
export function responseText(message: Pick<BetaMessage, "content">): string {
  let text = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

/** JSON + schema validation of a structured-output text; null when invalid. */
export function parseStructured<S extends z.ZodType>(schema: S, text: string): z.output<S> | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

type StructuredResult<T> =
  | { kind: "ok"; output: T; model: string }
  | { kind: "refusal"; category: string | null; model: string };

async function callStructured<S extends z.ZodType>(params: {
  schema: S;
  system: string;
  messages: BetaMessageParam[];
  effort: "low" | "medium";
  maxTokens: number;
  timeoutMs: number;
}): Promise<StructuredResult<z.output<S>>> {
  let response: BetaMessage;
  try {
    response = await getClient().beta.messages.create(
      {
        model: getAssistantModel(),
        max_tokens: params.maxTokens,
        system: params.system,
        messages: params.messages,
        // Thinking is left at the model default (adaptive); effort is the knob.
        output_config: { effort: params.effort, format: betaZodOutputFormat(params.schema) },
        // Caches the system prompt + conversation prefix across turns.
        cache_control: { type: "ephemeral" },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      },
      { timeout: params.timeoutMs }
    );
  } catch (error) {
    throw toAssistantError(error);
  }

  if (response.stop_reason === "refusal") {
    return { kind: "refusal", category: response.stop_details?.category ?? null, model: response.model };
  }
  if (response.stop_reason === "max_tokens") {
    console.warn("[review-assistant] Response hit max_tokens");
    throw new AssistantError("La risposta dell'assistente si è interrotta. Riprova.", 502);
  }

  const output = parseStructured(params.schema, responseText(response));
  if (output === null) {
    console.error("[review-assistant] Structured output did not match the schema, stop_reason:", response.stop_reason);
    throw new AssistantError("L'assistente non è riuscito a rispondere. Riprova tra poco.", 502);
  }
  return { kind: "ok", output, model: response.model };
}

export interface TurnResult extends TurnOutput {
  refused: boolean;
  model: string;
}

/** One chat turn. The history must end with a client message. */
export async function runAssistantTurn(ctx: AssistantPostContext, history: HistoryMessage[]): Promise<TurnResult> {
  const result = await callStructured({
    schema: turnOutputSchema,
    system: buildTurnSystemPrompt(ctx),
    messages: buildTurnMessages(ctx, history),
    effort: "low",
    maxTokens: TURN_MAX_TOKENS,
    timeoutMs: TURN_TIMEOUT_MS,
  });

  if (result.kind === "refusal") {
    console.warn("[review-assistant] Turn refused, category:", result.category);
    return { reply: REFUSAL_REPLY, readiness: "exploring", refused: true, model: result.model };
  }

  const reply = result.output.reply.trim();
  if (!reply) throw new AssistantError("L'assistente non è riuscito a rispondere. Riprova tra poco.", 502);
  return { reply, readiness: result.output.readiness, refused: false, model: result.model };
}

export interface FinalResult extends FinalOutput {
  refused: boolean;
  model: string;
}

/**
 * Final structured summary for the agency. On refusal it degrades to an
 * "unclear" verdict whose summary quotes the client's own messages, so the
 * agency still gets the feedback.
 */
export async function runAssistantFinalize(ctx: AssistantPostContext, history: HistoryMessage[]): Promise<FinalResult> {
  const result = await callStructured({
    schema: finalOutputSchema,
    system: buildFinalizeSystemPrompt(ctx),
    messages: buildFinalizeMessages(history),
    effort: "medium",
    maxTokens: FINAL_MAX_TOKENS,
    timeoutMs: FINAL_TIMEOUT_MS,
  });

  if (result.kind === "refusal") {
    console.warn("[review-assistant] Summary refused, category:", result.category);
    return { ...fallbackSummary(history), refused: true, model: result.model };
  }
  return { ...result.output, refused: false, model: result.model };
}

/** Summary built without the model: the client's messages, verbatim. */
export function fallbackSummary(history: HistoryMessage[]): FinalOutput {
  const clientLines = history.filter((m) => m.role === "CLIENT").map((m) => `- ${m.content.trim()}`);
  return {
    verdict: "unclear",
    summary: ["Riepilogo automatico non disponibile. Messaggi del cliente:", ...clientLines].join("\n"),
    actionItems: [],
  };
}
