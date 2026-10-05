/**
 * Anthropic engine for the review assistant (REVIEW_ASSISTANT_PROVIDER=anthropic).
 *
 * Requests go through the beta namespace so they can carry the server-side
 * refusal fallback (`fallbacks: "default"`), and use structured outputs
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
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import {
  ASSISTANT_ERROR_MESSAGES,
  AssistantError,
  parseStructured,
  type ReviewAssistantProvider,
  type StructuredRequest,
  type StructuredResult,
} from "./engine";
import type { PromptMessage } from "./prompt";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function getAnthropicModel(): string {
  return process.env.REVIEW_ASSISTANT_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  // One retry is enough for a chat: the client is waiting on the other side.
  cachedClient ??= new Anthropic({ maxRetries: 1 });
  return cachedClient;
}

/** Test hook: drop the cached SDK client (e.g. after changing env). */
export function resetAnthropicClient(): void {
  cachedClient = null;
}

/**
 * Maps SDK errors to friendly Italian messages. Details go to the server log
 * only (never the API key or the request body).
 */
export function toAnthropicAssistantError(error: unknown): AssistantError {
  if (error instanceof AssistantError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.rateLimited, 503);
  }
  // Timeout first: it is a subclass of APIConnectionError.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.timeout, 504);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.connection, 503);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error("[review-assistant] Claude API credentials rejected:", error.status, error.message);
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.unavailable, 503);
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error("[review-assistant] Claude API rejected the request:", error.message);
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.overloaded, 503);
  }
  if (error instanceof Anthropic.APIError) {
    console.error("[review-assistant] Claude API error:", error.status, error.message);
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
  }
  console.error("[review-assistant] Unexpected Claude error:", error);
  return new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 500);
}

/** Concatenated text of the response (fallback/thinking blocks are skipped). */
export function responseText(message: Pick<BetaMessage, "content">): string {
  let text = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

/** Provider-neutral messages → Messages API params (images as URL sources). */
export function toAnthropicMessages(messages: PromptMessage[]): BetaMessageParam[] {
  return messages.map((message): BetaMessageParam => {
    if (message.role === "assistant") {
      // No prefill: assistant turns are only replayed history.
      return { role: "assistant", content: message.parts.map((p) => (p.type === "text" ? p.text : "")).join("") };
    }
    const content: BetaContentBlockParam[] = message.parts.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : { type: "image", source: { type: "url", url: part.url } }
    );
    return { role: "user", content };
  });
}

async function generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.output<S>>> {
  let response: BetaMessage;
  try {
    response = await getClient().beta.messages.create(
      {
        model: getAnthropicModel(),
        max_tokens: request.maxTokens,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        // Thinking is left at the model default (adaptive); effort is the knob.
        output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
        // Caches the system prompt + conversation prefix across turns.
        cache_control: { type: "ephemeral" },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      },
      { timeout: request.timeoutMs }
    );
  } catch (error) {
    throw toAnthropicAssistantError(error);
  }

  if (response.stop_reason === "refusal") {
    return { kind: "refusal", detail: response.stop_details?.category ?? null, model: response.model };
  }
  if (response.stop_reason === "max_tokens") {
    console.warn("[review-assistant] Claude response hit max_tokens");
    throw new AssistantError(ASSISTANT_ERROR_MESSAGES.truncated, 502);
  }

  const output = parseStructured(request.schema, responseText(response));
  if (output === null) {
    console.error("[review-assistant] Claude structured output did not match the schema, stop_reason:", response.stop_reason);
    throw new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
  }
  return { kind: "ok", output, model: response.model };
}

export const anthropicProvider: ReviewAssistantProvider = {
  name: "anthropic",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  model: getAnthropicModel,
  generate,
};
