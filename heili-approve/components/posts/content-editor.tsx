"use client";

/**
 * Content Editor (blog articles and ad sets)
 *
 * The internal kinds' counterpart of PostEditor: client, title for the
 * client, planned date in the client's time zone, then the kind's own
 * editor — BlogEditor (Markdown, preview, SEO) or AdSetEditor (campaign,
 * variants, spec checks, previews) — and the note for the client once a
 * version has been sent.
 *
 * Saving is explicit, as for social posts: an autosave after the client has
 * seen a version would create versions and send the item back to draft
 * while the agency is still typing. A draft can be saved with open points;
 * sending it to the client cannot (validateBlogForReview /
 * validateAdsForReview, the same checks lib/posts applies on submit).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { PostStatus } from "@/app/generated/prisma/client";
import { createContentAction, submitForReviewAction, updateContentAction } from "@/app/(dashboard)/posts/actions";
import AdSetEditor from "@/components/ads/ad-set-editor";
import BlogEditor from "@/components/blog/blog-editor";
import { validateAdsForReview } from "@/lib/content/ads";
import { validateBlogForReview } from "@/lib/content/blog";
import type { AdContent, BlogContent } from "@/lib/content/types";
import { KIND_CONFIG, canTransition } from "@/lib/domain";
import { KIND_NOUNS, editWarning, localPartsToUtc, timeZoneAbbr } from "./helpers";
import type { ContentFormInput, EditorClient } from "./types";

export type InternalKind = "BLOG_ARTICLE" | "AD_CREATIVE";

export interface ContentEditorValues {
  clientId: string;
  title: string;
  /** "YYYY-MM-DD" in the client's zone. */
  date: string;
  /** "HH:mm" in the client's zone. */
  time: string;
  /** BlogContent for BLOG_ARTICLE, AdContent for AD_CREATIVE. */
  content: BlogContent | AdContent;
  changeNote: string;
}

interface ContentEditorProps {
  kind: InternalKind;
  mode: "create" | "edit";
  postId?: string;
  status?: PostStatus;
  /** The client has already been sent a version: a change note makes sense. */
  hasBeenSubmitted?: boolean;
  clients: EditorClient[];
  initial: ContentEditorValues;
  readOnly?: boolean;
  readOnlyReason?: string;
}

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40 disabled:opacity-60";
const labelClass = "mb-1.5 block text-sm font-medium text-foreground";

const TITLE_PLACEHOLDERS: Record<InternalKind, string> = {
  BLOG_ARTICLE: "Es. Articolo di ottobre: come scegliere il caffè in grani",
  AD_CREATIVE: "Es. Campagna saldi invernali · Meta",
};

function snapshot(values: ContentEditorValues): string {
  return JSON.stringify(values);
}

/** Title used when the agency leaves it empty: the headline or the campaign name. */
function fallbackTitle(kind: InternalKind, content: BlogContent | AdContent): string {
  return kind === "BLOG_ARTICLE"
    ? (content as BlogContent).headline.trim()
    : (content as AdContent).campaign.name.trim();
}

/** Open points that block sending to the client, as Italian messages. */
function reviewIssues(kind: InternalKind, content: BlogContent | AdContent): string[] {
  const issues =
    kind === "BLOG_ARTICLE" ? validateBlogForReview(content as BlogContent) : validateAdsForReview(content as AdContent);
  return issues.map((issue) => issue.message);
}

function longDateLabel(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

export default function ContentEditor({
  kind,
  mode,
  postId,
  status,
  hasBeenSubmitted = false,
  clients,
  initial,
  readOnly = false,
  readOnlyReason,
}: ContentEditorProps) {
  const router = useRouter();
  const [values, setValues] = useState<ContentEditorValues>(initial);
  const [baseline, setBaseline] = useState(() => snapshot(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noun = KIND_NOUNS[kind];
  const client = clients.find((c) => c.id === values.clientId) ?? null;
  const timezone = client?.timezone ?? "Europe/Rome";
  const publishAt = localPartsToUtc(values.date, values.time, timezone);
  const dirty = snapshot(values) !== baseline;
  const disabled = readOnly || pending;
  const issues = reviewIssues(kind, values.content);

  // Leaving with unsaved changes asks for confirmation.
  useEffect(() => {
    if (!dirty || readOnly) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, readOnly]);

  function update<K extends keyof ContentEditorValues>(key: K, value: ContentEditorValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function buildInput(): ContentFormInput | string {
    if (!values.clientId) return "Scegli il cliente.";
    const title = values.title.trim() || fallbackTitle(kind, values.content);
    if (!title) {
      return kind === "BLOG_ARTICLE"
        ? "Inserisci un titolo (o il titolo dell'articolo)."
        : "Inserisci un titolo (o il nome della campagna).";
    }
    if (!publishAt) return `Inserisci data e ora (${KIND_CONFIG[kind].dateLabel.toLowerCase()}).`;
    return {
      ...(mode === "create" ? { kind } : {}),
      clientId: values.clientId,
      title,
      publishAt: publishAt.toISOString(),
      content: values.content,
      ...(mode === "edit" && hasBeenSubmitted ? { changeNote: values.changeNote.trim() } : {}),
    };
  }

  function save(sendToClient: boolean) {
    if (readOnly) return;
    setError(null);
    setNotice(null);
    if (busy) {
      setError("Attendi la fine del caricamento dei file.");
      return;
    }
    const input = buildInput();
    if (typeof input === "string") {
      setError(input);
      return;
    }
    if (sendToClient && issues.length > 0) {
      setError(`Sistema i punti elencati prima di inviare ${noun.the} al cliente.`);
      return;
    }

    startTransition(async () => {
      if (mode === "create") {
        const created = await createContentAction(input);
        if (!created.ok) {
          setError(created.error);
          return;
        }
        setBaseline(snapshot(values));
        if (sendToClient) {
          const sent = await submitForReviewAction([created.data.id]);
          router.push(`/posts/${created.data.id}?inviato=${sent.ok ? "1" : "errore"}`);
          return;
        }
        router.push(`/posts/${created.data.id}?tab=modifica&salvato=1`);
        return;
      }

      const saved = await updateContentAction(postId ?? "", input);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      if (!values.title.trim()) setValues((current) => ({ ...current, title: input.title }));
      setBaseline(snapshot({ ...values, title: values.title.trim() ? values.title : input.title }));
      if (!sendToClient) {
        setNotice(saved.message ?? "Modifiche salvate.");
        return;
      }
      const savedStatus = saved.data.status as PostStatus;
      if (!canTransition(savedStatus, "submit")) {
        setNotice(`${saved.message ?? "Modifiche salvate."} ${noun.It} non può essere inviato in questo stato.`);
        return;
      }
      const sent = await submitForReviewAction([postId ?? ""]);
      if (!sent.ok) setError(`${saved.message ?? "Modifiche salvate."} Invio non riuscito: ${sent.error}`);
      else setNotice(sent.message ?? "Inviato in revisione.");
    });
  }

  const warning = mode === "edit" && status ? editWarning(status, kind) : null;
  const canSend =
    mode === "create" ||
    (status !== undefined && (canTransition(status, "submit") || (dirty && canTransition(status, "edit"))));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(false);
      }}
      className="space-y-6"
    >
      {readOnly && readOnlyReason && <div className="panel rounded p-4 text-sm text-muted">{readOnlyReason}</div>}
      {!readOnly && warning && (
        <div className="panel rounded p-4 text-sm">
          <span className="text-warning">{warning}</span>
        </div>
      )}

      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        {/* ── Client, title, date ── */}
        <section className="panel grid gap-4 rounded p-4 sm:p-5 lg:grid-cols-3">
          <div>
            <label htmlFor="content-client" className={labelClass}>
              Cliente
            </label>
            {clients.length === 0 ? (
              <p className="text-sm text-muted">
                Nessun cliente attivo con questo servizio.{" "}
                <Link href="/clients/new" className="text-accent hover:underline">
                  Aggiungi un cliente
                </Link>{" "}
                oppure attiva il servizio nella scheda di un cliente.
              </p>
            ) : (
              <select
                id="content-client"
                value={values.clientId}
                onChange={(event) => update("clientId", event.target.value)}
                disabled={mode === "edit" && hasBeenSubmitted}
                className={inputClass}
              >
                <option value="">Scegli il cliente…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {mode === "edit" && hasBeenSubmitted && (
              <p className="mt-1 text-xs text-muted">Il cliente non si può cambiare dopo il primo invio.</p>
            )}
            {client && client.activeReviewers === 0 && (
              <p className="mt-1 text-xs text-warning">
                Nessun referente attivo: nessuno riceverà la richiesta di revisione.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="content-title" className={labelClass}>
              Titolo (visibile al cliente)
            </label>
            <input
              id="content-title"
              type="text"
              value={values.title}
              onChange={(event) => update("title", event.target.value)}
              maxLength={200}
              placeholder={TITLE_PLACEHOLDERS[kind]}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">
              {kind === "BLOG_ARTICLE"
                ? "Lo vede il cliente nel portale e nelle email. Se lo lasci vuoto usiamo il titolo dell'articolo."
                : "Lo vede il cliente nel portale e nelle email. Se lo lasci vuoto usiamo il nome della campagna."}
            </p>
          </div>

          <div>
            <span className={labelClass}>{KIND_CONFIG[kind].dateLabel}</span>
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                aria-label={KIND_CONFIG[kind].dateLabel}
                value={values.date}
                onChange={(event) => update("date", event.target.value)}
                className={`${inputClass} w-auto flex-1`}
              />
              <input
                type="time"
                aria-label="Ora"
                value={values.time}
                onChange={(event) => update("time", event.target.value)}
                className={`${inputClass} w-auto flex-1 sm:flex-none`}
              />
            </div>
            <p className="mt-1 text-xs text-muted">
              Ora del cliente: {timezone}
              {publishAt ? ` (${timeZoneAbbr(timezone, publishAt)})` : ""}
            </p>
          </div>
        </section>

        {/* ── The kind's editor ── */}
        {kind === "BLOG_ARTICLE" ? (
          <BlogEditor
            value={values.content as BlogContent}
            onChange={(next) => update("content", next)}
            disabled={disabled}
            onBusyChange={setBusy}
            dateLabel={longDateLabel(values.date)}
          />
        ) : (
          <AdSetEditor
            value={values.content as AdContent}
            onChange={(next) => update("content", next)}
            accountName={client?.name ?? "Cliente"}
            accountAvatarUrl={client?.logoUrl ?? null}
            disabled={disabled}
            onBusyChange={setBusy}
          />
        )}

        {mode === "edit" && hasBeenSubmitted && (
          <section className="panel rounded p-4 sm:p-5">
            <label htmlFor="content-change-note" className={labelClass}>
              Nota per il cliente <span className="font-normal text-muted">(facoltativa)</span>
            </label>
            <textarea
              id="content-change-note"
              value={values.changeNote}
              onChange={(event) => update("changeNote", event.target.value)}
              rows={2}
              maxLength={1000}
              className={`${inputClass} resize-y`}
              placeholder={
                kind === "BLOG_ARTICLE"
                  ? "Es. Abbiamo riscritto l'introduzione e accorciato il secondo paragrafo come richiesto"
                  : "Es. Nuova foto per la variante B e CTA più diretta"
              }
            />
            <p className="mt-1 text-xs text-muted">Il cliente la vede accanto a &quot;cosa è cambiato&quot;.</p>
          </section>
        )}
      </fieldset>

      {/* ── Save ── */}
      {!readOnly && (
        <div className="space-y-3">
          {/* The kind's editor already says when it is ready for the client. */}
          {issues.length > 0 && (
            <p className="text-sm text-warning">
              {`${issues.length === 1 ? "1 punto da sistemare" : `${issues.length} punti da sistemare`} prima dell'invio al cliente (vedi sopra). La bozza si può salvare comunque.`}
            </p>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
          {notice && <p className="text-sm text-success">{notice}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="submit"
              disabled={pending || busy || (mode === "edit" && !dirty)}
              className="rounded border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:border-border-hover disabled:opacity-50"
            >
              {pending ? "Salvataggio…" : mode === "create" ? "Salva bozza" : "Salva modifiche"}
            </button>
            {canSend && (
              <button
                type="button"
                onClick={() => save(true)}
                disabled={pending || busy}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {mode === "create" || dirty ? "Salva e invia in revisione" : "Invia in revisione"}
              </button>
            )}
            {mode === "edit" && dirty && (
              <button
                type="button"
                onClick={() => {
                  setValues(JSON.parse(baseline) as ContentEditorValues);
                  setError(null);
                }}
                disabled={pending}
                className="px-2 py-2 text-sm text-muted hover:text-foreground"
              >
                Annulla le modifiche
              </button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
