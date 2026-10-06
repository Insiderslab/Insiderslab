"use client";

/**
 * Post Actions
 *
 * The status buttons of the post page, limited to what the state machine
 * allows (availableCommands): Invia in revisione (with an optional deadline
 * for the client), Programma ora, Riprova (social), Segna come pubblicato /
 * consegnato (blog, ads), Annulla. Cancelling and delivering ask first.
 */

import { useState, useTransition } from "react";
import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import {
  cancelPostAction,
  deliverPostAction,
  schedulePostAction,
  submitForReviewAction,
} from "@/app/(dashboard)/posts/actions";
import { KIND_CONFIG } from "@/lib/domain";
import { KIND_NOUNS, availableCommands, localPartsToUtc, timeZoneAbbr } from "./helpers";

interface PostActionsProps {
  postId: string;
  status: PostStatus;
  timezone: string;
  /** Problems found on the current version (validateForNetworks, or the blog/ads review checks). */
  issueCount: number;
  activeReviewers: number;
  hasMetricoolBrand: boolean;
  /** Default SOCIAL_POST. */
  kind?: ContentKind;
}

const CANCEL_LABELS: Record<ContentKind, string> = {
  SOCIAL_POST: "Annulla post",
  BLOG_ARTICLE: "Annulla articolo",
  AD_CREATIVE: "Annulla set",
};

export default function PostActions({
  postId,
  status,
  timezone,
  issueCount,
  activeReviewers,
  hasMetricoolBrand,
  kind = "SOCIAL_POST",
}: PostActionsProps) {
  const commands = availableCommands(status, kind);
  const internal = KIND_CONFIG[kind].internal;
  const noun = KIND_NOUNS[kind];
  const [panel, setPanel] = useState<"submit" | "cancel" | "deliver" | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (commands.length === 0 && !notice && !error) return null;

  function run(action: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPanel(null);
      setNotice(result.message ?? null);
    });
  }

  function submit() {
    let reviewDueAt: string | null = null;
    if (dueDate) {
      // "Entro il giorno X" = 18:00 of that day in the client's time zone.
      const due = localPartsToUtc(dueDate, "18:00", timezone);
      if (!due) {
        setError("Scadenza non valida.");
        return;
      }
      reviewDueAt = due.toISOString();
    }
    run(() => submitForReviewAction([postId], { reviewDueAt }));
  }

  const primary = "rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50";
  const secondary =
    "rounded border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:border-border-hover disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {commands.includes("submit") && (
          <button type="button" className={primary} disabled={pending} onClick={() => setPanel(panel === "submit" ? null : "submit")}>
            Invia in revisione
          </button>
        )}
        {commands.includes("schedule") && (
          <button
            type="button"
            className={primary}
            disabled={pending}
            onClick={() => run(() => schedulePostAction(postId))}
            title={hasMetricoolBrand ? undefined : "Il cliente non ha un brand Metricool collegato"}
          >
            {pending ? "Attendi…" : "Programma ora"}
          </button>
        )}
        {commands.includes("retry") && (
          <button type="button" className={primary} disabled={pending} onClick={() => run(() => schedulePostAction(postId))}>
            {pending ? "Attendi…" : "Riprova"}
          </button>
        )}
        {commands.includes("deliver") && (
          <button
            type="button"
            className={primary}
            disabled={pending}
            onClick={() => setPanel(panel === "deliver" ? null : "deliver")}
          >
            {KIND_CONFIG[kind].deliverLabel}
          </button>
        )}
        {commands.includes("cancel") && (
          <button
            type="button"
            className={`${secondary} text-error`}
            disabled={pending}
            onClick={() => setPanel(panel === "cancel" ? null : "cancel")}
          >
            {CANCEL_LABELS[kind]}
          </button>
        )}
      </div>

      {panel === "submit" && (
        <div className="panel space-y-3 rounded p-4 text-sm">
          <p>Il cliente riceverà un&apos;email con il link per rivedere e approvare {noun.the}.</p>
          {activeReviewers === 0 && (
            <p className="text-warning">
              Il cliente non ha referenti attivi: nessuno riceverà l&apos;email. Aggiungili nella scheda del cliente.
            </p>
          )}
          {issueCount > 0 &&
            (internal ? (
              <p className="text-warning">
                {noun.It} ha {issueCount === 1 ? "un punto da sistemare" : `${issueCount} punti da sistemare`} prima
                dell&apos;invio al cliente: correggili nella scheda Modifica.
              </p>
            ) : (
              <p className="text-warning">
                Il post ha {issueCount === 1 ? "un problema" : `${issueCount} problemi`} che ne impedirebbero la
                pubblicazione: correggili nella scheda Modifica prima di inviarlo.
              </p>
            ))}
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Risposta entro (facoltativo)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent/40"
            />
            {dueDate && (
              <span className="text-xs text-muted">
                alle 18:00 ({timeZoneAbbr(timezone)}): dopo, il cliente riceve un sollecito
              </span>
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={pending} onClick={submit}>
              {pending ? "Invio…" : "Invia al cliente"}
            </button>
            <button type="button" className={secondary} disabled={pending} onClick={() => setPanel(null)}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      {panel === "deliver" && (
        <div className="panel space-y-3 rounded p-4 text-sm">
          <p>
            {kind === "BLOG_ARTICLE"
              ? "Segna l'articolo come pubblicato quando è online sul sito del cliente. Dopo non si potrà più modificare."
              : "Segna il set come consegnato quando le creatività approvate sono state caricate nella campagna. Dopo non si potrà più modificare."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={pending} onClick={() => run(() => deliverPostAction(postId))}>
              {pending ? "Attendi…" : `Sì, ${KIND_CONFIG[kind].deliverLabel.toLowerCase()}`}
            </button>
            <button type="button" className={secondary} disabled={pending} onClick={() => setPanel(null)}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      {panel === "cancel" && (
        <div className="panel space-y-3 rounded p-4 text-sm">
          <p>
            {internal
              ? `${noun.It} verrà annullato: il cliente non lo vedrà più. L'operazione non si può annullare.`
              : "Il post verrà annullato: il cliente non lo vedrà più e non sarà programmato. L'operazione non si può annullare."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-error px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              disabled={pending}
              onClick={() => run(() => cancelPostAction(postId))}
            >
              {pending ? "Attendi…" : `Sì, annulla ${noun.the}`}
            </button>
            <button type="button" className={secondary} disabled={pending} onClick={() => setPanel(null)}>
              No, tienilo
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-error">{error}</p>}
      {notice && <p className="text-sm text-success">{notice}</p>}
    </div>
  );
}
