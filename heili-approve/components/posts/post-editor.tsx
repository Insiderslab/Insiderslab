"use client";

/**
 * Post Editor
 *
 * Create or edit a post: client, title, publication date and time in the
 * client's time zone, networks (only the client's), per-network format and
 * required options, caption with per-network counters, first comment, media
 * (upload, reorder, remove), Reel cover, and a live preview per network.
 *
 * The same rules the worker applies before calling Metricool
 * (validateForNetworks) run on every change, so problems show up here and
 * not as a failed schedule. A draft can be saved with warnings; sending it
 * to the client cannot.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { PostStatus } from "@/app/generated/prisma/client";
import {
  createPostAction,
  submitForReviewAction,
  updatePostAction,
} from "@/app/(dashboard)/posts/actions";
import { NetworkPreviewTabs } from "@/components/post-preview";
import {
  NETWORKS,
  NETWORK_FORMATS,
  NETWORK_LABELS,
  canTransition,
  formatTimecode,
  isNetwork,
  type MediaItem,
  type Network,
  type NetworkOptions,
} from "@/lib/domain";
import { getNetworkFormat, supportsVideoCover, validateForNetworks } from "@/lib/metricool/payload";
import {
  FORMAT_LABELS,
  captionCounters,
  formatCount,
  editWarning,
  localPartsToUtc,
  pruneNetworkOptions,
  setNetworkOption,
  timeZoneAbbr,
} from "./helpers";
import MediaUploader from "./media-uploader";
import type { EditorClient, PostFormInput } from "./types";
import VideoCoverPicker from "./video-cover-picker";

export interface PostEditorValues {
  clientId: string;
  title: string;
  /** "YYYY-MM-DD" in the client's zone. */
  date: string;
  /** "HH:mm" in the client's zone. */
  time: string;
  networks: Network[];
  networkOptions: NetworkOptions;
  text: string;
  firstCommentText: string;
  media: MediaItem[];
  videoCoverMs: number | null;
  changeNote: string;
}

interface PostEditorProps {
  mode: "create" | "edit";
  postId?: string;
  status?: PostStatus;
  /** The client has already been sent a version: a change note makes sense. */
  hasBeenSubmitted?: boolean;
  clients: EditorClient[];
  initial: PostEditorValues;
  readOnly?: boolean;
  /** Why the editor is read-only (shown above the form). */
  readOnlyReason?: string;
}

/** Networks where Metricool publishes the first comment. */
const FIRST_COMMENT_NETWORKS: readonly Network[] = ["instagram", "facebook", "linkedin"];

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40 disabled:opacity-60";
const labelClass = "mb-1.5 block text-sm font-medium text-foreground";

function snapshot(values: PostEditorValues): string {
  return JSON.stringify(values);
}

export default function PostEditor({
  mode,
  postId,
  status,
  hasBeenSubmitted = false,
  clients,
  initial,
  readOnly = false,
  readOnlyReason,
}: PostEditorProps) {
  const router = useRouter();
  const [values, setValues] = useState<PostEditorValues>(initial);
  const [baseline, setBaseline] = useState(() => snapshot(initial));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const client = clients.find((c) => c.id === values.clientId) ?? null;
  const timezone = client?.timezone ?? "Europe/Rome";
  const clientNetworks = (client?.networks ?? []).filter(isNetwork);
  // Same rule as lib/posts: a client with no networks set allows them all.
  const allowedNetworks: Network[] = clientNetworks.length > 0 ? clientNetworks : [...NETWORKS];
  const publishAt = localPartsToUtc(values.date, values.time, timezone);
  const dirty = snapshot(values) !== baseline;
  const firstVideoIndex = values.media.findIndex((m) => m.type === "video");
  const firstVideo = firstVideoIndex >= 0 ? values.media[firstVideoIndex] : null;
  const coverApplies =
    firstVideo !== null && values.networks.some((n) => supportsVideoCover(n, values.networkOptions));
  const disabled = readOnly || pending;

  const issues = validateForNetworks({
    networks: values.networks,
    networkOptions: values.networkOptions,
    text: values.text,
    firstCommentText: values.firstCommentText,
    media: values.media,
    ...(publishAt ? { publishAt } : {}),
    timezone,
  });
  const counters = captionCounters(values.text, values.networks, values.networkOptions);

  // Leaving with unsaved changes asks for confirmation.
  useEffect(() => {
    if (!dirty || readOnly) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, readOnly]);

  function update<K extends keyof PostEditorValues>(key: K, value: PostEditorValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function changeClient(clientId: string) {
    const next = clients.find((c) => c.id === clientId);
    const nextAllowed = (next?.networks ?? []).filter(isNetwork);
    setValues((current) => {
      const networks =
        nextAllowed.length > 0 ? current.networks.filter((n) => nextAllowed.includes(n)) : current.networks;
      return {
        ...current,
        clientId,
        networks,
        networkOptions: pruneNetworkOptions(current.networkOptions, networks),
      };
    });
    setNotice(null);
  }

  function toggleNetwork(network: Network) {
    setValues((current) => {
      const networks = current.networks.includes(network)
        ? current.networks.filter((n) => n !== network)
        : allowedNetworks.filter((n) => n === network || current.networks.includes(n));
      return { ...current, networks, networkOptions: pruneNetworkOptions(current.networkOptions, networks) };
    });
    setNotice(null);
  }

  function setOption(network: Network, key: string, value: string) {
    setValues((current) => ({
      ...current,
      networkOptions: setNetworkOption(current.networkOptions, network, key, value),
    }));
    setNotice(null);
  }

  function buildInput(): PostFormInput | string {
    if (!values.clientId) return "Scegli il cliente.";
    if (!values.title.trim()) return "Inserisci un titolo.";
    if (!publishAt) return "Inserisci data e ora di pubblicazione.";
    if (values.networks.length === 0) return "Scegli almeno una rete.";
    return {
      clientId: values.clientId,
      title: values.title.trim(),
      publishAt: publishAt.toISOString(),
      networks: values.networks,
      networkOptions: pruneNetworkOptions(values.networkOptions, values.networks),
      text: values.text,
      firstCommentText: values.firstCommentText.trim() ? values.firstCommentText : null,
      media: values.media,
      videoCoverMs: firstVideo ? values.videoCoverMs : null,
      ...(mode === "edit" && hasBeenSubmitted ? { changeNote: values.changeNote.trim() } : {}),
    };
  }

  function save(sendToClient: boolean) {
    if (readOnly) return;
    setError(null);
    setNotice(null);
    if (uploading) {
      setError("Attendi la fine del caricamento dei media.");
      return;
    }
    const input = buildInput();
    if (typeof input === "string") {
      setError(input);
      return;
    }
    if (sendToClient && issues.length > 0) {
      setError("Correggi gli avvisi qui sotto prima di inviare il post al cliente.");
      return;
    }

    startTransition(async () => {
      if (mode === "create") {
        const created = await createPostAction(input);
        if (!created.ok) {
          setError(created.error);
          return;
        }
        setBaseline(snapshot(values));
        if (sendToClient) {
          const sent = await submitForReviewAction([created.data.id]);
          if (!sent.ok) {
            router.push(`/posts/${created.data.id}?inviato=errore`);
            return;
          }
          router.push(`/posts/${created.data.id}?inviato=1`);
          return;
        }
        router.push(`/posts/${created.data.id}?tab=modifica&salvato=1`);
        return;
      }

      const saved = await updatePostAction(postId ?? "", input);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setBaseline(snapshot(values));
      if (!sendToClient) {
        setNotice(saved.message ?? "Modifiche salvate.");
        return;
      }
      const savedStatus = saved.data.status as PostStatus;
      if (!canTransition(savedStatus, "submit")) {
        setNotice(`${saved.message ?? "Modifiche salvate."} Il post non può essere inviato in questo stato.`);
        return;
      }
      const sent = await submitForReviewAction([postId ?? ""]);
      if (!sent.ok) setError(`${saved.message ?? "Modifiche salvate."} Invio non riuscito: ${sent.error}`);
      else setNotice(sent.message ?? "Inviato in revisione.");
    });
  }

  const warning = mode === "edit" && status ? editWarning(status) : null;
  const canSend =
    mode === "create" ||
    (status !== undefined && (canTransition(status, "submit") || (dirty && canTransition(status, "edit"))));
  const globalIssues = issues.filter((i) => i.network === null);
  const networkIssues = issues.filter((i) => i.network !== null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(false);
      }}
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(460px,600px)] xl:items-start"
    >
      <div className="min-w-0 space-y-6">
        {readOnly && readOnlyReason && (
          <div className="panel rounded p-4 text-sm text-muted">{readOnlyReason}</div>
        )}
        {!readOnly && warning && (
          <div className="panel rounded p-4 text-sm">
            <span className="text-warning">{warning}</span>
          </div>
        )}

        <fieldset disabled={disabled} className="space-y-5">
          <section className="panel studio-panel space-y-5">
            <div className="studio-section-heading">
              <div><h2>Dove e quando</h2><p>Definisci il cliente, il titolo, la pubblicazione e i canali del contenuto.</p></div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="post-client" className={labelClass}>Cliente</label>
                {clients.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nessun cliente attivo con questo servizio.{" "}
                    <Link href="/clients/new" className="text-accent hover:underline">Aggiungi un cliente</Link>{" "}
                    oppure attiva il servizio nella scheda di un cliente.
                  </p>
                ) : (
                  <select
                    id="post-client"
                    value={values.clientId}
                    onChange={(event) => changeClient(event.target.value)}
                    disabled={mode === "edit" && hasBeenSubmitted}
                    className={inputClass}
                  >
                    <option value="">Scegli il cliente…</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {mode === "edit" && hasBeenSubmitted && <p className="mt-1 text-xs text-muted">Il cliente non si può cambiare dopo il primo invio.</p>}
                {client && (
                  <p className="mt-1 text-xs text-muted">
                    {client.activeReviewers === 0 && <span className="text-warning">Nessun referente attivo: nessuno riceverà la richiesta di revisione. </span>}
                    {!client.hasMetricoolBrand && <span className="text-warning">Brand Metricool non collegato: il post non potrà essere programmato. </span>}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="post-title" className={labelClass}>Titolo (visibile al cliente)</label>
                <input
                  id="post-title"
                  type="text"
                  value={values.title}
                  onChange={(event) => update("title", event.target.value)}
                  maxLength={200}
                  placeholder="Es. Carosello lancio collezione autunno"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-muted">Serve nel portale e nelle email; non viene pubblicato.</p>
              </div>
            </div>

            <div className="grid gap-5 border-t border-border pt-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
              <div>
                <span className={labelClass}>Pubblicazione</span>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <input
                    type="date"
                    aria-label="Data di pubblicazione"
                    value={values.date}
                    onChange={(event) => update("date", event.target.value)}
                    className={inputClass}
                  />
                  <input
                    type="time"
                    aria-label="Ora di pubblicazione"
                    value={values.time}
                    onChange={(event) => update("time", event.target.value)}
                    className={inputClass}
                  />
                </div>
                <p className="mt-1 text-xs text-muted">Ora del cliente: {timezone}{publishAt ? ` (${timeZoneAbbr(timezone, publishAt)})` : ""}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <span className={labelClass}>Canali</span>
                  {!client ? (
                    <p className="text-sm text-muted">Scegli prima il cliente.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {allowedNetworks.map((network) => {
                          const checked = values.networks.includes(network);
                          return (
                            <label key={network} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors ${checked ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border bg-background text-muted hover:border-border-hover"}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleNetwork(network)} className="accent-accent" />
                              {NETWORK_LABELS[network]}
                            </label>
                          );
                        })}
                      </div>
                      {clientNetworks.length === 0 && (
                        <p className="mt-1 text-xs text-muted">Il cliente non ha reti impostate: sono mostrate tutte. Puoi limitarle nella <Link href={`/clients/${client.id}`} className="text-accent hover:underline">scheda del cliente</Link>.</p>
                      )}
                      {values.networks.some((n) => !allowedNetworks.includes(n)) && <p className="mt-1 text-xs text-error">Alcune reti del post non sono più abilitate per il cliente: deselezionale.</p>}
                    </>
                  )}
                </div>

                {values.networks.map((network) => {
                  const formats = NETWORK_FORMATS[network];
                  const format = getNetworkFormat(network, values.networkOptions);
                  const options = values.networkOptions[`${network}Data`] ?? {};
                  const needsTitle = network === "youtube";
                  const needsBoard = network === "pinterest";
                  if (!formats && !needsTitle && !needsBoard) return null;
                  return (
                    <div key={network} className="grid gap-2 sm:grid-cols-[100px_minmax(0,1fr)] sm:items-center">
                      <span className="text-sm text-muted">{NETWORK_LABELS[network]}</span>
                      <div className="flex flex-wrap gap-2">
                        {formats && (
                          <select aria-label={`Formato per ${NETWORK_LABELS[network]}`} value={format ?? formats[0]} onChange={(event) => setOption(network, "type", event.target.value)} className={`${inputClass} w-auto`}>
                            {formats.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f] ?? f}</option>)}
                          </select>
                        )}
                        {needsTitle && <input type="text" aria-label="Titolo del video YouTube" placeholder="Titolo del video (obbligatorio)" maxLength={100} value={typeof options.title === "string" ? options.title : ""} onChange={(event) => setOption(network, "title", event.target.value)} className={`${inputClass} min-w-0 flex-1`} />}
                        {needsBoard && <input type="text" aria-label="Bacheca Pinterest" placeholder="ID della bacheca Pinterest (obbligatorio)" maxLength={100} value={typeof options.boardId === "string" ? options.boardId : ""} onChange={(event) => setOption(network, "boardId", event.target.value)} className={`${inputClass} min-w-0 flex-1`} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="panel studio-panel space-y-5">
            <div className="studio-section-heading">
              <div><h2>Il contenuto</h2><p>Carica i media e completa il testo che il cliente vedrà nell’anteprima.</p></div>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-4">
                <div><span className={labelClass}>Media</span>
                  <MediaUploader
                    media={values.media}
                    onChange={(updater) => {
                      setValues((current) => ({ ...current, media: updater(current.media) }));
                      setNotice(null);
                    }}
                    onBusyChange={setUploading}
                    disabled={disabled}
                  />
                </div>
                {firstVideo && (
                  <div className="border-t border-border pt-4">
                    <span className={labelClass}>Copertina del video</span>
                    {firstVideo.durationSec ? <p className="mb-2 text-xs text-muted">Video {firstVideoIndex + 1} · durata {formatTimecode(firstVideo.durationSec)}</p> : null}
                    {coverApplies ? (
                      <VideoCoverPicker video={firstVideo} coverMs={values.videoCoverMs} onChange={(ms) => update("videoCoverMs", ms)} disabled={disabled} />
                    ) : (
                      <p className="text-xs text-muted">Nessuna delle reti scelte usa una copertina personalizzata (serve un Reel, TikTok, YouTube, LinkedIn o un post video di Facebook).</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="post-text" className={labelClass}>Testo del post</label>
                <textarea id="post-text" value={values.text} onChange={(event) => update("text", event.target.value)} rows={7} className={`${inputClass} resize-y`} placeholder="Didascalia del post, con #hashtag e @menzioni" />
                {counters.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {counters.map((c) => (
                      <li key={c.network} className={c.over ? "text-error" : "text-muted"}>
                        {c.label}: {c.noCaption ? "le Storie non mostrano il testo" : c.limit !== null ? `${formatCount(c.count)} / ${formatCount(c.limit)}` : formatCount(c.count)}
                      </li>
                    ))}
                  </ul>
                )}

                <details className="mt-4 rounded-xl bg-surface-hover px-4 py-3" open={values.firstCommentText.length > 0 ? true : undefined}>
                  <summary className="cursor-pointer text-sm font-semibold">Primo commento <span className="font-normal text-muted">(facoltativo)</span></summary>
                  <div className="pt-3">
                    <label htmlFor="post-first-comment" className="sr-only">Primo commento</label>
                    <textarea id="post-first-comment" value={values.firstCommentText} onChange={(event) => update("firstCommentText", event.target.value)} rows={2} className={`${inputClass} resize-y`} placeholder="Es. gli hashtag, per tenere pulita la didascalia" />
                    <p className="mt-1 text-xs text-muted">Pubblicato come commento su {FIRST_COMMENT_NETWORKS.map((n) => NETWORK_LABELS[n]).join(", ")}.</p>
                  </div>
                </details>

                {mode === "edit" && hasBeenSubmitted && (
                  <details className="mt-3 rounded-xl bg-surface-hover px-4 py-3" open={values.changeNote.length > 0 ? true : undefined}>
                    <summary className="cursor-pointer text-sm font-semibold">Nota per il cliente <span className="font-normal text-muted">(facoltativa)</span></summary>
                    <div className="pt-3">
                      <label htmlFor="post-change-note" className="sr-only">Nota per il cliente</label>
                      <textarea id="post-change-note" value={values.changeNote} onChange={(event) => update("changeNote", event.target.value)} rows={2} maxLength={1000} className={`${inputClass} resize-y`} placeholder="Es. Abbiamo accorciato il testo e cambiato la seconda immagine come richiesto" />
                      <p className="mt-1 text-xs text-muted">Il cliente la vede accanto a &quot;cosa è cambiato&quot;.</p>
                    </div>
                  </details>
                )}
              </div>
            </div>
          </section>
        </fieldset>

        {/* ── Validation ── */}
        {issues.length > 0 ? (
          <section className="rounded-2xl bg-warning-soft p-4" aria-live="polite">
            <h3 className="text-sm font-medium text-warning">Da sistemare prima della pubblicazione</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {[...globalIssues, ...networkIssues].map((issue, i) => (
                <li key={`${issue.network ?? "all"}-${issue.field}-${i}`} className="text-foreground">
                  <span className="text-muted">{issue.network ? `${NETWORK_LABELS[issue.network]}: ` : ""}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          values.networks.length > 0 && (
            <p className="text-sm text-success">Il post rispetta le regole di tutte le reti scelte.</p>
          )
        )}

        {/* ── Save ── */}
        {!readOnly && (
          <footer className="space-y-2 border-t border-border pt-4">
            {error && <p className="text-sm text-error">{error}</p>}
            {notice && <p className="text-sm text-success">{notice}</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="submit"
                disabled={pending || uploading || (mode === "edit" && !dirty)}
                className="btn"
              >
                {pending ? "Salvataggio…" : mode === "create" ? "Salva bozza" : "Salva modifiche"}
              </button>
              {canSend && (
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={pending || uploading}
                  className="btn btn-primary"
                >
                  {mode === "create" || dirty ? "Salva e invia in revisione" : "Invia in revisione"}
                </button>
              )}
              {mode === "edit" && dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setValues(JSON.parse(baseline) as PostEditorValues);
                    setError(null);
                  }}
                  disabled={pending}
                  className="btn btn-quiet"
                >
                  Annulla le modifiche
                </button>
              )}
            </div>
          </footer>
        )}
      </div>

      {/* ── Live preview ── */}
      <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Anteprima cliente</h2><span className="chip chip-node">Live</span></div>
        <NetworkPreviewTabs
          networks={values.networks}
          networkOptions={values.networkOptions}
          text={values.text}
          firstCommentText={values.firstCommentText || null}
          media={values.media}
          accountName={client?.name ?? "Cliente"}
          accountAvatarUrl={client?.logoUrl ?? null}
          publishAt={publishAt ?? undefined}
          timeZone={timezone}
        />
      </aside>
    </form>
  );
}
