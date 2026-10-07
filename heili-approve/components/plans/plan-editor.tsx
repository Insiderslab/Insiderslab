"use client";

/**
 * Agency side of a monthly plan: title, the message for the client (strategy
 * and notes of the month), the due date, and the main action "Invia il piano
 * al cliente" — every draft and changes-requested post of the plan goes to
 * the client in one go, with one email per reviewer.
 */

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { sendPlanAction, updatePlanAction } from "@/app/(dashboard)/plans/actions";
import { localPartsToUtc, timeZoneAbbr } from "@/components/posts/helpers";

export interface PlanEditorCounts {
  /** Drafts that will be sent for the first time (or again after an edit). */
  drafts: number;
  /** Posts with changes requested that will be sent again. */
  changes: number;
  inReview: number;
  approved: number;
  /** Posts of the month not in the plan yet: sending adds them. */
  outside: number;
}

export default function PlanEditor({
  planId,
  title,
  intro,
  dueDate,
  timeZone,
  clientName,
  monthName,
  counts,
  sent,
}: {
  planId: string;
  title: string;
  intro: string;
  /** "YYYY-MM-DD" in the client's zone, "" when none. */
  dueDate: string;
  timeZone: string;
  clientName: string;
  /** "ottobre". */
  monthName: string;
  counts: PlanEditorCounts;
  sent: boolean;
}) {
  const router = useRouter();
  const ids = { title: useId(), intro: useId(), due: useId() };
  const [values, setValues] = useState({ title, intro, dueDate });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const toSend = counts.drafts + counts.changes + counts.outside;
  const dirty = values.title !== title || values.intro !== intro || values.dueDate !== dueDate;

  function dueIso(): string | null | undefined {
    if (!values.dueDate) return null;
    const due = localPartsToUtc(values.dueDate, "18:00", timeZone);
    if (!due) {
      setError("Scadenza non valida.");
      return undefined;
    }
    return due.toISOString();
  }

  function save() {
    setError(null);
    setNotice(null);
    const reviewDueAt = dueIso();
    if (reviewDueAt === undefined) return;
    startTransition(async () => {
      const result = await updatePlanAction(planId, { title: values.title, intro: values.intro, reviewDueAt });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(result.message ?? "Piano salvato.");
      router.refresh();
    });
  }

  function send() {
    setError(null);
    setNotice(null);
    const reviewDueAt = dueIso();
    if (reviewDueAt === undefined) return;
    startTransition(async () => {
      const result = await sendPlanAction(planId, { title: values.title, intro: values.intro, reviewDueAt });
      setConfirming(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(result.message ?? "Piano inviato.");
      router.refresh();
    });
  }

  const parts = [
    counts.drafts > 0 ? `${counts.drafts} ${counts.drafts === 1 ? "bozza" : "bozze"}` : null,
    counts.outside > 0 ? `${counts.outside} post del mese ancora fuori dal piano` : null,
    counts.changes > 0 ? `${counts.changes} con modifiche richieste` : null,
  ].filter(Boolean);

  return (
    <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby="plan-editor" data-testid="plan-editor">
      <div className="space-y-1">
        <h2 id="plan-editor" className="text-lg font-semibold">
          Messaggio e invio
        </h2>
        <p className="text-sm text-muted">
          Il cliente legge questo messaggio in cima al piano, prima dei post.
        </p>
      </div>

      <label htmlFor={ids.title} className="block space-y-1">
        <span className="label-caps block">Titolo</span>
        <input
          id={ids.title}
          value={values.title}
          maxLength={200}
          onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
          className="field"
        />
      </label>

      <label htmlFor={ids.intro} className="block space-y-1">
        <span className="label-caps block">Messaggio per {clientName}</span>
        <textarea
          id={ids.intro}
          value={values.intro}
          maxLength={5000}
          rows={6}
          onChange={(e) => setValues((v) => ({ ...v, intro: e.target.value }))}
          placeholder={`Per esempio: a ${monthName} puntiamo sulla stagionalità e sui volti del team. Tre post a settimana, il martedì un Reel.`}
          className="field resize-y"
        />
      </label>

      <label htmlFor={ids.due} className="block space-y-1">
        <span className="label-caps block">Risposta entro</span>
        <span className="flex flex-wrap items-center gap-2">
          <input
            id={ids.due}
            type="date"
            value={values.dueDate}
            onChange={(e) => setValues((v) => ({ ...v, dueDate: e.target.value }))}
            className="field !w-auto"
          />
          {values.dueDate && (
            <span className="text-xs text-muted">
              alle 18:00 ({timeZoneAbbr(timeZone)})
            </span>
          )}
        </span>
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending || toSend === 0}
          className="btn btn-primary"
          data-testid="plan-send"
        >
          Invia il piano al cliente
        </button>
        <button type="button" onClick={save} disabled={pending || !dirty} className="btn">
          {pending && !confirming ? "Salvataggio…" : "Salva"}
        </button>
      </div>
      <p className="text-sm text-muted">
        {toSend === 0
          ? counts.inReview > 0
            ? "Tutti i post sono già dal cliente: niente di nuovo da inviare."
            : counts.approved > 0
              ? "Tutti i post del piano sono approvati."
              : "Prepara i post del mese nel calendario: compariranno qui."
          : `Da inviare: ${parts.join(", ")}.`}
      </p>

      {confirming && (
        <div className="inset space-y-3 p-3" role="alertdialog" aria-labelledby="plan-send-confirm">
          <p id="plan-send-confirm" className="text-sm">
            {`Invii ${toSend === 1 ? "1 post" : `${toSend} post`} a ${clientName} in un unico piano`}
            {sent ? " (i post già approvati o in revisione restano come sono)" : ""}. Chi approva riceve una sola email con il
            link al piano.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={send} disabled={pending} className="btn btn-primary" data-testid="plan-send-confirm">
              {pending ? "Invio…" : `Sì, invia ${toSend === 1 ? "1 post" : `${toSend} post`}`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="btn btn-quiet">
              Annulla
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-success" role="status" data-testid="plan-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
