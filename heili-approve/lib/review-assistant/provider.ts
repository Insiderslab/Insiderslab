/**
 * Review assistant engines.
 *
 * The conversation logic is provider-agnostic: prompts come from ./prompt,
 * outputs are validated against the zod schemas in ./shared, and refusals /
 * errors become the same Italian messages whichever engine answered. Each
 * engine (./openai, ./claude) only implements `generate`: one structured
 * request in, a parsed object or a refusal out, AssistantError on failure.
 *
 * Selection (REVIEW_ASSISTANT_PROVIDER = "openai" | "anthropic"; when unset,
 * OpenAI if OPENAI_API_KEY is present, else Anthropic if ANTHROPIC_API_KEY is).
 */

import { anthropicProvider } from "./claude";
import {
  ASSISTANT_ERROR_MESSAGES,
  AssistantError,
  type AssistantProviderName,
  type ReviewAssistantProvider,
} from "./engine";
import { openaiProvider } from "./openai";
import {
  buildFinalizeMessages,
  buildFinalizeSystemPrompt,
  buildTurnMessages,
  buildTurnSystemPrompt,
  type AssistantPostContext,
  type HistoryMessage,
} from "./prompt";
import { finalOutputSchema, turnOutputSchema, type FinalOutput, type TurnOutput } from "./shared";

export { AssistantError, type AssistantProviderName, type ReviewAssistantProvider } from "./engine";

/** Shown (and stored) when the model declines to answer a client message. */
export const REFUSAL_REPLY =
  "Mi dispiace, su questo non riesco ad aiutarti. Se vuoi, scrivi pure cosa cambiare e invialo all'agenzia con il pulsante «Invia le modifiche all'agenzia».";

// ─── Selection ───────────────────────────────────────────────────────────────

const PROVIDERS: Record<AssistantProviderName, ReviewAssistantProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

/**
 * The engine to use, or null when none is configured. An explicit
 * REVIEW_ASSISTANT_PROVIDER whose key is missing disables the assistant
 * rather than silently switching engine.
 */
export function getAssistantProvider(): ReviewAssistantProvider | null {
  const explicit = process.env.REVIEW_ASSISTANT_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "anthropic") {
    const provider = PROVIDERS[explicit];
    return provider.isConfigured() ? provider : null;
  }
  if (explicit) {
    console.warn(`[review-assistant] Unknown REVIEW_ASSISTANT_PROVIDER "${explicit}", falling back to auto-detection`);
  }
  if (openaiProvider.isConfigured()) return openaiProvider;
  if (anthropicProvider.isConfigured()) return anthropicProvider;
  return null;
}

/** The assistant is optional: without a configured engine the portal hides it. */
export function isAssistantEnabled(): boolean {
  return getAssistantProvider() !== null;
}

function requireProvider(provider?: ReviewAssistantProvider | null): ReviewAssistantProvider {
  const resolved = provider ?? getAssistantProvider();
  if (!resolved) throw new AssistantError(ASSISTANT_ERROR_MESSAGES.unavailable, 404);
  return resolved;
}

// ─── Conversation calls ──────────────────────────────────────────────────────

const TURN_MAX_TOKENS = 8000;
const FINAL_MAX_TOKENS = 16000;
const TURN_TIMEOUT_MS = 60_000;
const FINAL_TIMEOUT_MS = 120_000;

export interface TurnResult extends TurnOutput {
  refused: boolean;
  model: string;
}

/** One chat turn. The history must end with a client message. */
export async function runAssistantTurn(
  ctx: AssistantPostContext,
  history: HistoryMessage[],
  provider?: ReviewAssistantProvider | null
): Promise<TurnResult> {
  const result = await requireProvider(provider).generate({
    schema: turnOutputSchema,
    schemaName: "review_turn",
    system: buildTurnSystemPrompt(ctx),
    messages: buildTurnMessages(ctx, history),
    effort: "low",
    maxTokens: TURN_MAX_TOKENS,
    timeoutMs: TURN_TIMEOUT_MS,
  });

  if (result.kind === "refusal") {
    console.warn("[review-assistant] Turn refused:", result.detail);
    return { reply: REFUSAL_REPLY, readiness: "exploring", refused: true, model: result.model };
  }

  const reply = result.output.reply.trim();
  if (!reply) throw new AssistantError(ASSISTANT_ERROR_MESSAGES.generic, 502);
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
export async function runAssistantFinalize(
  ctx: AssistantPostContext,
  history: HistoryMessage[],
  provider?: ReviewAssistantProvider | null
): Promise<FinalResult> {
  const result = await requireProvider(provider).generate({
    schema: finalOutputSchema,
    schemaName: "review_summary",
    system: buildFinalizeSystemPrompt(ctx),
    messages: buildFinalizeMessages(history, ctx),
    effort: "medium",
    maxTokens: FINAL_MAX_TOKENS,
    timeoutMs: FINAL_TIMEOUT_MS,
  });

  if (result.kind === "refusal") {
    console.warn("[review-assistant] Summary refused:", result.detail);
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
