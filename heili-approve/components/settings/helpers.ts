/**
 * Pure helpers for the settings page (no I/O, safe in client components).
 */

import type { WorkspaceRole } from "@/app/generated/prisma/client";

/**
 * Last characters of a secret, the only part ever shown back to the browser.
 * Short secrets show nothing: the tail would reveal too much of them.
 */
export function secretTail(secret: string, length = 4): string {
  const trimmed = secret.trim();
  if (trimmed.length <= length * 2) return "";
  return trimmed.slice(-length);
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "Titolare",
  ADMIN: "Amministratore",
  MEMBER: "Membro",
};

/**
 * app/api/workspace/members comes from heili-dm and answers in English;
 * the team panel shows these messages in Italian.
 */
const MEMBER_API_ERRORS: Record<string, string> = {
  Unauthorized: "Sessione scaduta: accedi di nuovo.",
  "Only owners and admins can invite members": "Solo titolari e amministratori possono invitare persone.",
  "Only owners and admins can update roles": "Solo titolari e amministratori possono cambiare i ruoli.",
  "Only owners and admins can remove members": "Solo titolari e amministratori possono rimuovere persone.",
  "Invalid invitation": "Indirizzo email non valido.",
  "Invalid member update": "Modifica non valida.",
  "Member cannot be updated": "Il ruolo di questa persona non si può cambiare.",
  "Member cannot be removed": "Questa persona non si può rimuovere.",
  "Missing member or invitation ID": "Richiesta non valida.",
};

export function translateMemberApiError(error: unknown, fallback: string): string {
  if (typeof error === "string" && MEMBER_API_ERRORS[error]) return MEMBER_API_ERRORS[error];
  return fallback;
}

/** Metricool userId: the numeric id from the app URL (…?userId=1234567). */
export function normalizeMetricoolUserId(value: string): string {
  const trimmed = value.trim();
  // People paste the whole URL or "userId=123": keep only the id.
  const fromQuery = trimmed.match(/userId=(\d+)/i);
  return fromQuery ? fromQuery[1] : trimmed;
}
