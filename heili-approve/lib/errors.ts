/**
 * Domain errors thrown by the services in lib/ (posts, clients, reviewers).
 *
 * Messages are Italian and safe to show to the user as-is: routes and server
 * actions can map any of these to a response with `httpStatusForError` and
 * `publicErrorMessage`, and never leak internal details for anything else.
 */

import type { z } from "zod";
import { InvalidTransitionError } from "@/lib/domain";

export { InvalidTransitionError };

/** The record does not exist, or exists in another workspace / client. */
export class NotFoundError extends Error {
  constructor(message = "Elemento non trovato") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The caller is authenticated but not allowed to perform the action. */
export class ForbiddenError extends Error {
  constructor(message = "Operazione non consentita") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Input is well-formed but violates a business rule (e.g. network not enabled). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * The record changed under the caller: stale version on approve, a concurrent
 * status change, or a duplicate. The UI should reload and retry.
 */
export class ConflictError extends Error {
  constructor(message = "I dati sono cambiati nel frattempo: ricarica la pagina e riprova") {
    super(message);
    this.name = "ConflictError";
  }
}

export type DomainError =
  | InvalidTransitionError
  | NotFoundError
  | ForbiddenError
  | ValidationError
  | ConflictError
  | RateLimitError;

export class RateLimitError extends Error {
  constructor(message: string) { super(message); this.name = "RateLimitError"; }
}

/** A plan-wide approval found feedback that needs an individual decision. */
export class BulkApprovalFeedbackConflictError extends ConflictError {
  constructor(message = "Il post ha commenti o una conversazione da verificare") {
    super(message);
    this.name = "BulkApprovalFeedbackConflictError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof InvalidTransitionError ||
    error instanceof NotFoundError ||
    error instanceof ForbiddenError ||
    error instanceof ValidationError ||
    error instanceof ConflictError || error instanceof RateLimitError
  );
}

export function httpStatusForError(error: unknown): number {
  if (error instanceof RateLimitError) return 429;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof ValidationError) return 400;
  if (error instanceof ConflictError || error instanceof InvalidTransitionError) return 409;
  return 500;
}

/** Message to show to the user; unknown errors get a generic one. */
export function publicErrorMessage(error: unknown): string {
  if (error instanceof InvalidTransitionError) {
    return "Questa azione non è più disponibile per il post: ricarica la pagina";
  }
  if (isDomainError(error)) return error.message;
  return "Si è verificato un errore imprevisto. Riprova tra poco.";
}

/**
 * zod parse that throws a ValidationError carrying the first issue's message,
 * so service functions validate their own input and callers get one error type.
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(result.error.issues[0]?.message || "Dati non validi");
}
