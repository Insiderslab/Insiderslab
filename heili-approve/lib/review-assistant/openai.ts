/**
 * OpenAI engine for the review assistant (the default when OPENAI_API_KEY is
 * set, or REVIEW_ASSISTANT_PROVIDER=openai).
 *
 * Uses the Responses API with structured outputs: `client.responses.parse`
 * with `zodTextFormat`, so `output_parsed` is already validated against the
 * same zod schemas the Anthropic engine uses. The parser only runs on
 * completed responses; incomplete ones (max_output_tokens, content filter)
 * and refusal items come back with `output_parsed === null` and are mapped
 * here to the shared refusal / truncation handling.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  ParsedResponse,
  ResponseInputContent,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { z } from "zod";
import {
  ASSISTANT_ERROR_MESSAGES,
  AssistantError,
  type ReviewAssistantProvider,
  type StructuredRequest,
  type StructuredResult,
} from "./engine";
import type { PromptMessage } from "./prompt";

/** Used when OPENAI_MODEL is not set. Override it in .env to change engine model. */
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

/**
 * `reasoning.effort` is only accepted by reasoning models (gpt-5 family,
 * o-series); chat models such as gpt-4o or *-chat-latest reject it.
 */
export function supportsReasoningEffort(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model) && !model.includes("chat-latest");
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  // One retry is enough for a chat: the client is waiting on the other side.
  cachedClient ??= new OpenAI({ maxRetries: 1 });
  return cachedClient;
}

/** Test hook: drop the cached SDK client (e.g. after changing env). */
export function resetOpenAIClient(): void {
  cachedClient = null;
}

/**
 * Maps SDK errors to the same friendly Italian messages as the Anthropic
 * engine. Details go to the server log only (never the key or the body).
 */
export function toOpenAIAssistantError(error: unknown): AssistantError {
  if (error instanceof AssistantError) return error;
  if (error instanceof OpenAI.RateLimitError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.rateLimited, 503);
  }
  // Timeout first: it is a subclass of APIConnectionError.
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.timeout, 504);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.connection, 503);
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    console.error("[review-assistant] OpenAI credentials rejected:", error.status, error.message);
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.unavailable, 503);
  }
  if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.NotFoundError) {
    // 404 here usually means an OPENAI_MODEL the key cannot use.
    console.error("[review-assistant] OpenAI rejected the request:", error.status, error.message);
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
  }
  if (error instanceof OpenAI.InternalServerError) {
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.overloaded, 503);
  }
  if (error instanceof OpenAI.APIError) {
    console.error("[review-assistant] OpenAI API error:", error.status, error.message);
    return new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
  }
  // The SDK's parser throws (SyntaxError / ZodError) when a completed
  // response does not match the schema.
  console.error("[review-assistant] OpenAI structured output could not be parsed:", error);
  return new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
}

/** Provider-neutral messages → Responses API input items. */
export function toOpenAIInput(messages: PromptMessage[]): ResponseInputItem[] {
  return messages.map((message): ResponseInputItem => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.parts.map((p) => (p.type === "text" ? p.text : "")).join(""),
      };
    }
    const content: ResponseInputContent[] = message.parts.map((part) =>
      part.type === "text"
        ? { type: "input_text", text: part.text }
        : { type: "input_image", image_url: part.url, detail: "auto" }
    );
    return { role: "user", content };
  });
}

/** The model's refusal text, if the response contains one. */
export function findRefusal(response: Pick<ParsedResponse<unknown>, "output">): string | null {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type === "refusal") return content.refusal;
    }
  }
  return null;
}

async function generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.output<S>>> {
  const model = getOpenAIModel();
  let response: ParsedResponse<z.output<S>>;
  try {
    response = await getClient().responses.parse(
      {
        model,
        instructions: request.system,
        input: toOpenAIInput(request.messages),
        text: { format: zodTextFormat(request.schema, request.schemaName) },
        max_output_tokens: request.maxTokens,
        ...(supportsReasoningEffort(model) ? { reasoning: { effort: request.effort } } : {}),
        // The transcript is stored in our DB; nothing to keep on OpenAI's side.
        store: false,
      },
      { timeout: request.timeoutMs }
    );
  } catch (error) {
    throw toOpenAIAssistantError(error);
  }

  const refusal = findRefusal(response);
  if (refusal !== null) {
    return { kind: "refusal", detail: refusal, model: response.model };
  }
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? null;
    if (reason === "content_filter") return { kind: "refusal", detail: "content_filter", model: response.model };
    console.warn("[review-assistant] OpenAI response incomplete:", reason);
    throw new AssistantError(ASSISTANT_ERROR_MESSAGES.truncated, 502);
  }

  const output = response.output_parsed;
  if (output === null || output === undefined) {
    console.error("[review-assistant] OpenAI structured output missing, status:", response.status);
    throw new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
  }
  return { kind: "ok", output, model: response.model };
}

export const openaiProvider: ReviewAssistantProvider = {
  name: "openai",
  isConfigured: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
  model: getOpenAIModel,
  generate,
};
