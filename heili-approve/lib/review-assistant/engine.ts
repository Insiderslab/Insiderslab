/**
 * Contract between the review assistant and its engines (./openai, ./claude):
 * one structured request in, a parsed object or a refusal out, and an
 * AssistantError carrying a friendly Italian message on any failure.
 * Kept separate from ./provider so the engines can import it without a cycle.
 */

import type { z } from "zod";
import type { PromptMessage } from "./prompt";

export type AssistantProviderName = "openai" | "anthropic";

/** One structured-output request, identical for every engine. */
export interface StructuredRequest<S extends z.ZodType> {
  schema: S;
  /** Name of the JSON schema (OpenAI requires one). */
  schemaName: string;
  system: string;
  messages: PromptMessage[];
  /** "low" for chat turns (latency), "medium" for the final summary. */
  effort: "low" | "medium";
  maxTokens: number;
  timeoutMs: number;
}

export type StructuredResult<T> =
  | { kind: "ok"; output: T; model: string }
  | { kind: "refusal"; detail: string | null; model: string };

export interface ReviewAssistantProvider {
  readonly name: AssistantProviderName;
  /** Whether the engine's credentials are present. */
  isConfigured(): boolean;
  /** Model id recorded on ReviewSession.model. */
  model(): string;
  /** Throws AssistantError (friendly Italian message) on any failure. */
  generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.output<S>>>;
}

// ─── Errors and shared messages ──────────────────────────────────────────────

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

/** Friendly messages shared by both engines' error mapping. */
export const ASSISTANT_ERROR_MESSAGES = {
  rateLimited: "L'assistente è molto richiesto in questo momento. Riprova tra un minuto.",
  timeout: "L'assistente ci sta mettendo troppo a rispondere. Riprova tra poco.",
  connection: "Non riesco a contattare l'assistente. Controlla la connessione e riprova.",
  unavailable: "L'assistente non è disponibile al momento. Puoi comunque approvare o chiedere modifiche.",
  overloaded: "L'assistente è momentaneamente sovraccarico. Riprova tra poco.",
  truncated: "La risposta dell'assistente si è interrotta. Riprova.",
  generic: "L'assistente non è riuscito a rispondere. Riprova tra poco.",
} as const;

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
