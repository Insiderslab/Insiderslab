"use client";

/**
 * "Importa post" — the page's working part.
 *
 * 1. The sheet (.xlsx / .csv) is dropped or picked, or the cells copied from
 *    Excel / Google Sheets are pasted. It is read here, in the browser
 *    (lib/post-import/table.ts): the file itself never leaves the computer.
 *    Pictures and videos are dropped with it or after it and matched to the
 *    rows by file name.
 * 2. Every row is shown as editable cells with what was understood from them
 *    and, when it cannot be a draft, why. The rules are lib/post-import/rows.ts
 *    here and again on the server, which adds the database checks and tells
 *    which rows were already imported (checkImportAction).
 * 3. "Crea N bozze": the pictures of the ready rows are uploaded through
 *    /api/uploads, then the server validates once more and creates DRAFTS
 *    (createImportAction). Nothing is sent to the client or scheduled.
 *
 * A sheet longer than one server request (MAX_IMPORT_ROWS) is read whole and
 * checked and created in batches, with a progress bar (QA-11). Each batch is
 * the same action with the same checks; a batch that fails stops the run, and
 * "Riprova" goes on from there: rows already created are recognised, not
 * duplicated.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkImportAction, createImportAction } from "@/app/(dashboard)/posts/import/actions";
import DropZone from "@/components/posts/import/drop-zone";
import ImportSummary, { importSummaryLine, plural } from "@/components/posts/import/import-summary";
import ImportRow, { type DroppedFile, type EditableRow } from "@/components/posts/import/import-row";
import TemplateHelp from "@/components/posts/import/template-help";
import { formatBytes } from "@/components/posts/helpers";
import { ToneChip } from "@/components/status-badge";
import { ACCEPTED_MEDIA, readVideoDuration, uploadMedia } from "@/components/posts/upload";
import type { MediaItem } from "@/lib/domain";
import { planMonthLabel } from "@/lib/plan-rules";
import { batchProgressLabel, mergeImportResults, type BatchResult } from "@/lib/post-import/batches";
import { MAX_IMPORT_ROWS, describeFile, draftMonth, evaluateRow, fileKey, importBatches, sheetDuplicates, type RawRow } from "@/lib/post-import/rows";
import { ImportParseError, parsePastedRows, parseSheetFile, type ParsedSheet } from "@/lib/post-import/table";
import type { ImportResult, PlanOutcome, RowCheck } from "@/lib/post-import/service";

interface Props {
  client: { id: string; name: string; timezone: string; networks: string[] };
  /** "Incolla righe dal foglio" (from Carica contenuti): the paste box comes first, focused. */
  startWith?: "file" | "paste";
}

type Notice = { tone: "info" | "warning"; text: string };

interface ResultItem {
  id: number;
  sourceRow: number;
  title: string;
  status: "created" | "existing" | "failed";
  postId?: string;
  error?: string;
}

interface Finished {
  items: ResultItem[];
  created: number;
  existing: number;
  failed: number;
  plan: PlanOutcome | null;
}

const SHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv", "tsv", "txt"]);
const ACCEPT = `.xlsx,.csv,.tsv,.txt,${ACCEPTED_MEDIA}`;
const UPLOAD_PARALLEL = 3;

const extensionOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";

/** The cells of a row, without the id the page keeps for it. */
function toRaw(row: EditableRow): RawRow {
  return {
    sourceRow: row.sourceRow, date: row.date, time: row.time, networks: row.networks, text: row.text,
    firstComment: row.firstComment, title: row.title, images: row.images, kind: row.kind, format: row.format, networkOptions: row.networkOptions,
  };
}

export default function ImportWizard({ client, startWith = "file" }: Props) {
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [serverChecks, setServerChecks] = useState<Record<number, RowCheck>>({});
  const [withPlan, setWithPlan] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Rows created so far over the rows being created, while a long sheet goes in batches. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  // Read once: what "past" means for this session (the server decides again on its own clock).
  const [now] = useState(() => new Date());

  const nextId = useRef(1);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const checkRun = useRef(0);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    const created = urls.current;
    return () => {
      clearTimeout(checkTimer.current);
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, []);

  // The agency shell scrolls inside <main>, not on the window: once the result
  // is rendered, bring it (and the focus) to its title.
  useEffect(() => {
    if (!finished) return;
    document.querySelector("main")?.scrollTo({ top: 0 });
    document.getElementById("import-done")?.focus();
  }, [finished]);

  const fileMap = useMemo(() => new Map(files.map((f) => [f.key, f])), [files]);
  const fileRefs = useMemo(() => files.map((f) => f.ref), [files]);

  const evaluations = useMemo(
    () =>
      rows.map((row) =>
        evaluateRow(row, { timeZone: client.timezone, now, clientNetworks: client.networks, files: fileRefs })
      ),
    [rows, client.timezone, client.networks, now, fileRefs]
  );

  // ── What the server said about each row (debounced), and the totals ──
  function scheduleCheck(nextRows: EditableRow[], nextFiles: DroppedFile[]) {
    clearTimeout(checkTimer.current);
    const run = ++checkRun.current;
    if (nextRows.length === 0) return;
    checkTimer.current = setTimeout(async () => {
      // One request per batch of rows (a long sheet is checked in several).
      const checks: Record<number, RowCheck> = {};
      for (const batch of importBatches(nextRows)) {
        const result = await checkImportAction({
          clientId: client.id,
          rows: batch.map(toRaw),
          files: nextFiles.map((f) => f.ref),
        });
        if (run !== checkRun.current) return;
        if (!result.ok) return setError(result.error);
        batch.forEach((row, i) => (checks[row.id] = result.data[i]));
      }
      setServerChecks(checks);
    }, 600);
  }

  // The server flags identical rows within a batch; this covers the whole sheet.
  const duplicates = useMemo(() => sheetDuplicates(client.id, evaluations.map((e) => e.draft)), [client.id, evaluations]);
  const states = rows.map((row, i) => {
    const check = serverChecks[row.id];
    const evaluation = evaluations[i];
    const dup = duplicates[i];
    const dupIssue = dup === null ? [] : [{ field: "row" as const, message: `Uguale alla riga ${rows[dup].sourceRow}: creerebbe una bozza identica` }];
    const serverIssues = check && !check.existing ? check.issues : [];
    const extra = [...serverIssues, ...dupIssue.filter((d) => !serverIssues.some((x) => x.message === d.message))];
    const invalid = evaluation.issues.length > 0 || extra.some((x) => !evaluation.issues.some((y) => y.message === x.message));
    return { row, evaluation, extra, existing: Boolean(check?.existing) && !invalid, invalid };
  });
  const ready = states.filter((s) => !s.invalid && !s.existing);
  const already = states.filter((s) => s.existing);
  const invalidCount = states.filter((s) => s.invalid).length;
  const sendable = states.filter((s) => !s.invalid);
  // Long sheets: jump to the rows that need fixing, or hide the ready ones.
  const [onlyInvalid, setOnlyInvalid] = useState(false);
  const invalidCursor = useRef(0);
  const visibleStates = onlyInvalid ? states.filter((s) => s.invalid) : states;

  function gotoNextInvalid() {
    const invalids = states.filter((s) => s.invalid);
    if (invalids.length === 0) return;
    const target = invalids[invalidCursor.current % invalids.length];
    invalidCursor.current += 1;
    const row = document.getElementById(`import-row-${target.row.id}`);
    if (!row) return;
    // Top of the row (its red reasons and first fields) at the top of the page: a row is
    // taller than the room a phone leaves above the bar, so centring hid half of it under
    // the bar. Focus moves to the row so keyboard and screen reader follow.
    row.scrollIntoView({ block: "start", behavior: "smooth" });
    row.focus({ preventScroll: true });
  }
  // A sendable row without the server's answer yet (check scheduled or in flight):
  // creating now would trust a stale picture of the rows.
  const isChecking = (s: (typeof states)[number]) => !s.invalid && !s.existing && serverChecks[s.row.id] === undefined;
  const awaiting = states.some(isChecking);

  const months = [...new Set(sendable.flatMap((s) => (s.evaluation.draft ? [draftMonth(s.evaluation.draft)] : [])))];
  const planMonth = months.length === 1 ? months[0] : null;
  const usedKeys = new Set(states.flatMap((s) => s.evaluation.images.flatMap((img) => (img.file ? [fileKey(img.file.name)] : []))));
  const unused = files.filter((f) => !usedKeys.has(f.key));
  const totalBytes = files.reduce((sum, f) => sum + f.ref.size, 0);

  // ── Reading files and pasted cells ──
  // `filesNow` must be the list the server check should see: inside handleFiles the
  // `files` state is still the previous render's, so the caller passes the merged list.
  function loadSheet(parsed: ParsedSheet, label: string, filesNow: DroppedFile[]) {
    const next: EditableRow[] = parsed.rows.map((row) => ({ ...row, id: nextId.current++ }));
    const messages: Notice[] = [];
    if (parsed.assumedOrder) {
      messages.push({ tone: "info", text: "Non ho trovato le intestazioni: ho letto le colonne nell'ordine del modello (Data, Ora, Reti, Testo, Primo commento, Titolo, Immagini)." });
    }
    if (parsed.ignoredColumns.length > 0) {
      messages.push({ tone: "info", text: `Colonne non usate: ${parsed.ignoredColumns.join(", ")}.` });
    }
    setRows(next);
    setSource(label);
    setNotices(messages);
    setServerChecks({});
    setWithPlan(false);
    setFinished(null);
    setError(null);
    scheduleCheck(next, filesNow);
  }

  async function handleFiles(dropped: File[]) {
    if (busy) return;
    const added: DroppedFile[] = [];
    const messages: Notice[] = [];
    const sheets = dropped.filter((f) => SHEET_EXTENSIONS.has(extensionOf(f.name)));
    for (const file of dropped) {
      if (SHEET_EXTENSIONS.has(extensionOf(file.name))) continue;
      const ref = describeFile(file);
      if (!ref) {
        messages.push({ tone: "warning", text: `«${file.name}»: formato non supportato (si accettano JPG, PNG, WebP, GIF, MP4, MOV, WebM e fogli .xlsx / .csv).` });
        continue;
      }
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      added.push({ key: fileKey(file.name), file, ref, url });
    }

    const merged = [...files.filter((f) => !added.some((a) => a.key === f.key)), ...added];
    if (added.length > 0) {
      setFiles(merged);
      setServerChecks({});
    }

    let sheetNotice: Notice | null = null;
    if (sheets.length > 0) {
      const sheet = sheets[0];
      try {
        const parsed = await parseSheetFile(sheet.name, await sheet.arrayBuffer());
        loadSheet(parsed, sheet.name, merged);
        if (sheets.length > 1) sheetNotice = { tone: "warning", text: `Ho letto solo «${sheet.name}»: gli altri fogli sono stati ignorati.` };
      } catch (e) {
        setError(e instanceof ImportParseError ? e.message : "Non riesco a leggere questo file. Controlla che sia un .xlsx o un .csv.");
        return;
      }
    } else if (rows.length > 0 && added.length > 0) {
      scheduleCheck(rows, merged);
    }
    if (messages.length > 0 || sheetNotice) setNotices((current) => [...current, ...(sheetNotice ? [sheetNotice] : []), ...messages]);
  }

  function readPasted() {
    try {
      loadSheet(parsePastedRows(paste), "Righe incollate", files);
      setPaste("");
    } catch (e) {
      setError(e instanceof ImportParseError ? e.message : "Non riesco a leggere le righe incollate.");
    }
  }

  function updateRow(id: number, patch: Partial<RawRow>) {
    const next = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    setRows(next);
    setServerChecks((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });
    setError(null);
    scheduleCheck(next, files);
  }

  function removeRow(id: number) {
    const next = rows.filter((row) => row.id !== id);
    setRows(next);
    scheduleCheck(next, files);
  }

  function startOver() {
    clearTimeout(checkTimer.current);
    checkRun.current++;
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setRows([]);
    setFiles([]);
    setSource(null);
    setNotices([]);
    setServerChecks({});
    setError(null);
    setFinished(null);
    setWithPlan(false);
  }

  // ── Creating the drafts ──
  async function create() {
    setError(null);
    const toSend = states.filter((s) => !s.invalid);
    if (ready.length === 0) return;
    const batches = importBatches(toSend);
    const total = toSend.length;
    const uploaded: Record<string, MediaItem> = {};
    const failedUploads = new Map<string, string>();
    const items: ResultItem[] = [];
    const sentAll: typeof toSend = [];
    const answers: BatchResult[] = [];
    let done = 0;
    setBusy("Controllo le righe…");
    if (batches.length > 1) setProgress({ done: 0, total });
    try {
      for (const batch of batches) {
        const request = { clientId: client.id, rows: batch.map((s) => toRaw(s.row)), files: fileRefs };
        // The server's word, with nothing written yet: what the person saw must still hold.
        const checked = await checkImportAction(request);
        if (!checked.ok) return setError(stoppedMessage(checked.error, done, total));
        const refused = batch.filter((_, i) => !checked.data[i].ok);
        if (refused.length > 0) {
          setServerChecks((current) => ({ ...current, ...Object.fromEntries(batch.map((s, i) => [s.row.id, checked.data[i]])) }));
          return setError(stoppedMessage("Alcune righe non passano i controlli del server: le ho segnate in rosso.", done, total));
        }

        // Upload each needed file once (a file shared by two batches goes up once); rows whose file fails are left out.
        const needed = new Map<string, DroppedFile>();
        batch.forEach((s, i) => {
          if (checked.data[i].existing) return;
          for (const file of s.evaluation.draft?.files ?? []) {
            const dropped = fileMap.get(fileKey(file.name));
            if (dropped && !uploaded[dropped.key] && !failedUploads.has(dropped.key)) needed.set(dropped.key, dropped);
          }
        });
        const queue = [...needed.values()];
        let uploadedNow = 0;
        const worker = async () => {
          for (let dropped = queue.shift(); dropped; dropped = queue.shift()) {
            try {
              const durationSec = await readVideoDuration(dropped.file);
              uploaded[dropped.key] = await uploadMedia(dropped.file, { durationSec });
            } catch (e) {
              failedUploads.set(dropped.key, e instanceof Error ? e.message : "Caricamento non riuscito.");
            }
            setBusy(`Carico le immagini: ${++uploadedNow} di ${needed.size}…`);
          }
        };
        if (needed.size > 0) {
          setBusy(`Carico le immagini: 0 di ${needed.size}…`);
          await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, needed.size) }, worker));
        }

        const sent: typeof toSend = [];
        batch.forEach((s, i) => {
          const missing = checked.data[i].existing
            ? undefined
            : (s.evaluation.draft?.files ?? []).find((file) => failedUploads.has(fileKey(file.name)));
          if (missing) {
            items.push({
              id: s.row.id,
              sourceRow: s.row.sourceRow,
              title: s.evaluation.title,
              status: "failed",
              error: `«${missing.name}» non è stato caricato: ${failedUploads.get(fileKey(missing.name))}`,
            });
          } else sent.push(s);
        });

        setBusy(batches.length > 1 ? batchProgressLabel(done, total) : "Creo le bozze…");
        if (sent.length > 0) {
          const result = await createImportAction({
            clientId: client.id,
            rows: sent.map((s) => toRaw(s.row)),
            files: fileRefs,
            uploaded,
            plan: withPlan && planMonth !== null,
          });
          if (!result.ok) return setError(stoppedMessage(result.error, done, total));
          answers.push({ offset: sentAll.length, result: result.data });
          sentAll.push(...sent);
        }
        done += batch.length;
        if (batches.length > 1) {
          setProgress({ done, total });
          setBusy(batchProgressLabel(done, total));
        }
      }
      sendOutcome(mergeImportResults(answers), sentAll, items);
    } catch {
      setError(stoppedMessage("Qualcosa è andato storto. Controlla la connessione e riprova: le bozze già create non si duplicano.", done, total));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  /** The error of a stopped run, saying how far a long sheet got. */
  function stoppedMessage(message: string, done: number, total: number): string {
    if (done === 0) return message;
    return `${message} Le prime ${done} righe su ${total} sono già bozze: premi di nuovo «Crea» per continuare, non si duplicano.`;
  }

  function sendOutcome(result: ImportResult, sent: typeof states, items: ResultItem[]) {
    for (const outcome of result.outcomes) {
      const s = sent[outcome.index];
      items.push(
        outcome.status === "failed"
          ? { id: s.row.id, sourceRow: s.row.sourceRow, title: s.evaluation.title, status: "failed", error: outcome.error }
          : { id: s.row.id, sourceRow: s.row.sourceRow, title: outcome.title, status: outcome.status, postId: outcome.postId }
      );
    }
    items.sort((a, b) => a.sourceRow - b.sourceRow);
    setFinished({
      items,
      created: result.created,
      existing: result.existing,
      failed: items.filter((i) => i.status === "failed").length,
      plan: result.plan,
    });
  }

  // ── Result ──
  if (finished) {
    const reviewHref =
      finished.plan?.status === "ok" ? `/plans/${finished.plan.id}` : `/posts?clientId=${client.id}&status=DRAFT`;
    return (
      <section className="space-y-5" aria-labelledby="import-done" data-testid="import-result">
        <div className="panel space-y-4 p-5 sm:p-6">
          <div className="space-y-1">
            <h2 id="import-done" tabIndex={-1} className="text-xl font-semibold outline-none" data-testid="import-result-title">
              {finished.created === 0 ? "Nessuna nuova bozza" : finished.created === 1 ? "Creata 1 bozza" : `Create ${finished.created} bozze`}
            </h2>
            <p className="text-base font-semibold" data-testid="import-result-summary">
              {importSummaryLine(finished)}
            </p>
            <p className="text-sm text-muted">
              Per {client.name}.
              {finished.existing > 0 ? ` ${plural(finished.existing, "riga era", "righe erano")} già importata: non ${finished.existing === 1 ? "è stata duplicata" : "sono state duplicate"}.` : ""}
              {finished.failed > 0 ? ` ${plural(finished.failed, "riga non è stata creata", "righe non sono state create")}: le trovi in rosso qui sotto.` : ""}
            </p>
          </div>
          <p className="inset p-3 text-sm">
            <strong className="font-semibold">Passo successivo:</strong>{" "}
            {finished.plan?.status === "ok"
              ? "apri il piano e premi «Invia il piano al cliente»: riceve un solo messaggio per tutto il mese."
              : "controlla le bozze e inviale al cliente (puoi sceglierle tutte insieme nell'elenco)."}{" "}
            Fino ad allora il cliente non vede nulla.
          </p>

          {finished.plan?.status === "ok" && (
            <p className="text-sm" data-testid="import-plan-note">
              {finished.plan.created ? "Ho creato" : "Ho usato"} il piano <strong>{finished.plan.title}</strong>: le bozze del mese sono lì dentro.
            </p>
          )}
          {finished.plan?.status === "error" && <p className="text-sm text-warning">{finished.plan.message}</p>}

          <div className="flex flex-wrap gap-2">
            <Link href={reviewHref} className="btn btn-primary" data-testid="import-send-review">
              {finished.plan?.status === "ok" ? "Apri il piano e invialo al cliente" : "Invia al cliente"}
            </Link>
            {finished.plan?.status === "ok" ? (
              <Link href={`/posts?clientId=${client.id}`} className="btn">
                Vedi i post
              </Link>
            ) : null}
            <button type="button" className="btn btn-quiet" onClick={startOver}>
              Importa altri post
            </button>
            {finished.failed > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFinished(null);
                  scheduleCheck(rows, files);
                }}
              >
                {finished.failed === 1 ? "Sistema la riga da correggere" : `Sistema le ${finished.failed} righe da correggere`}
              </button>
            )}
          </div>
        </div>

        <ul className="panel divide-y divide-border overflow-hidden" data-testid="import-result-list">
          {finished.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 sm:px-4">
              <span className="label-caps w-16 shrink-0">Riga {item.sourceRow}</span>
              <span className="min-w-0 flex-1">
                {item.postId ? (
                  <Link href={`/posts/${item.postId}`} className="font-semibold hover:underline">
                    {item.title}
                  </Link>
                ) : (
                  <span className="font-semibold">{item.title}</span>
                )}
                {item.error && <span className="block text-sm text-error">{item.error}</span>}
              </span>
              {item.status === "created" && <ToneChip tone="success">Bozza creata</ToneChip>}
              {item.status === "existing" && <ToneChip tone="neutral">Già presente</ToneChip>}
              {item.status === "failed" && <ToneChip tone="error">Da sistemare</ToneChip>}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // ── Input and preview ──
  const noRows = rows.length === 0;
  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-error-soft p-3 text-sm text-error" role="alert" data-testid="import-error">
          {error}
        </p>
      )}

      {noRows ? (
        startWith === "paste" ? (
          <>
          <section className="panel space-y-3 p-4 sm:p-6" aria-labelledby="import-paste">
            <div className="space-y-1">
              <h2 id="import-paste" className="text-base font-semibold">
                Incolla le righe
              </h2>
              <p className="text-sm text-muted">
                Copia le celle da Excel o Google Fogli (anche con l&apos;intestazione) e incollale qui sotto.
              </p>
            </div>
            <label htmlFor="import-paste-box" className="sr-only">
              Righe copiate da Excel o Google Fogli
            </label>
            <textarea
              id="import-paste-box"
              className="field min-h-32 font-mono text-sm"
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"Data\tOra\tReti\tTesto\n15/10/2026\t10:30\tInstagram, Facebook\tIl testo del post"}
              spellCheck={false}
              autoFocus
              data-testid="import-paste"
            />
            <button type="button" className="btn btn-primary" disabled={!paste.trim()} onClick={readPasted} data-testid="import-paste-read">
              Leggi le righe
            </button>
          </section>
          <section className="panel space-y-4 p-4 sm:p-6" aria-labelledby="import-file">
            <div className="space-y-1">
              <h2 id="import-file" className="text-base font-semibold">
                Oppure carica il foglio
              </h2>
              <p className="text-sm text-muted">
                Trascina qui il file Excel o CSV con i post. Se ci sono immagini o video, trascina anche quelli: li abbino alle righe dal nome del file.
              </p>
            </div>
            <DropZone
              onFiles={handleFiles}
              accept={ACCEPT}
              title="Trascina qui il foglio e le immagini"
              hint="Excel (.xlsx) o CSV, più foto e video (JPG, PNG, WebP, GIF, MP4, MOV, WebM). Non servono i percorsi: contano i nomi dei file."
              testId="import-drop"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Non hai il foglio?</span>
              <a href="/posts/import/modello" className="btn btn-sm" download data-testid="import-template-xlsx">
                Scarica il modello (con 2 esempi)
              </a>
              <a href="/posts/import/modello?formato=csv" className="btn btn-quiet btn-sm" download data-testid="import-template-csv">
                Modello CSV
              </a>
            </div>
            <TemplateHelp />
          </section>

          </>
        ) : (
          <>
          <section className="panel space-y-4 p-4 sm:p-6" aria-labelledby="import-file">
            <div className="space-y-1">
              <h2 id="import-file" className="text-base font-semibold">
                Carica il foglio
              </h2>
              <p className="text-sm text-muted">
                Trascina qui il file Excel o CSV con i post. Se ci sono immagini o video, trascina anche quelli: li abbino alle righe dal nome del file.
              </p>
            </div>
            <DropZone
              onFiles={handleFiles}
              accept={ACCEPT}
              title="Trascina qui il foglio e le immagini"
              hint="Excel (.xlsx) o CSV, più foto e video (JPG, PNG, WebP, GIF, MP4, MOV, WebM). Non servono i percorsi: contano i nomi dei file."
              testId="import-drop"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Non hai il foglio?</span>
              <a href="/posts/import/modello" className="btn btn-sm" download data-testid="import-template-xlsx">
                Scarica il modello (con 2 esempi)
              </a>
              <a href="/posts/import/modello?formato=csv" className="btn btn-quiet btn-sm" download data-testid="import-template-csv">
                Modello CSV
              </a>
            </div>
            <TemplateHelp />
          </section>

          <section className="panel space-y-3 p-4 sm:p-6" aria-labelledby="import-paste">
            <div className="space-y-1">
              <h2 id="import-paste" className="text-base font-semibold">
                Oppure incolla le righe
              </h2>
              <p className="text-sm text-muted">
                Copia le celle da Excel o Google Fogli (anche con l&apos;intestazione) e incollale qui sotto.
              </p>
            </div>
            <label htmlFor="import-paste-box" className="sr-only">
              Righe copiate da Excel o Google Fogli
            </label>
            <textarea
              id="import-paste-box"
              className="field min-h-32 font-mono text-sm"
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"Data\tOra\tReti\tTesto\n15/10/2026\t10:30\tInstagram, Facebook\tIl testo del post"}
              spellCheck={false}
              data-testid="import-paste"
            />
            <button type="button" className="btn btn-primary" disabled={!paste.trim()} onClick={readPasted} data-testid="import-paste-read">
              Leggi le righe
            </button>
          </section>
          </>
        )
      ) : (
        <>
          <section className="panel space-y-3 p-4 sm:p-5" aria-label="Origine e file">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-base font-semibold" data-testid="import-source">
                {source} · {plural(rows.length, "riga", "righe")}
              </h2>
              <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={startOver} disabled={busy !== null}>
                Ricomincia
              </button>
            </div>
            {notices.map((notice, i) => (
              <p key={i} className={`text-sm ${notice.tone === "warning" ? "text-warning" : "text-muted"}`}>
                {notice.text}
              </p>
            ))}
            <DropZone
              compact
              onFiles={handleFiles}
              accept={ACCEPT}
              disabled={busy !== null}
              title={files.length > 0 ? `${plural(files.length, "file caricato", "file caricati")} (${formatBytes(totalBytes)})` : "Aggiungi immagini e video"}
              hint="Trascina qui le foto e i video che mancano: li abbino per nome alla colonna «Immagini»."
              testId="import-media-drop"
            />
            {(invalidCount > 0 || onlyInvalid) && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={onlyInvalid}
                  onChange={(e) => setOnlyInvalid(e.target.checked)}
                  data-testid="import-only-invalid"
                />
                Mostra solo da correggere
              </label>
            )}
            {unused.length > 0 && (
              <p className="text-sm text-warning" data-testid="import-unused">
                File non usati da nessuna riga: {unused.map((f) => f.ref.name).join(", ")}.
              </p>
            )}
          </section>

          <ul className="space-y-3" data-testid="import-rows">
            {visibleStates.map((s) => (
              <ImportRow
                key={s.row.id}
                row={s.row}
                evaluation={s.evaluation}
                extraIssues={s.extra}
                existing={s.existing}
                checking={isChecking(s)}
                files={fileMap}
                disabled={busy !== null}
                zone={client.timezone}
                onChange={updateRow}
                onRemove={removeRow}
              />
            ))}
          </ul>

          {/* Compact on phones (QA-02): the bar stays over the rows, so each line it adds is a line of the sheet hidden. */}
          <section className="panel sticky bottom-3 z-10 space-y-2 p-3 sm:space-y-3 sm:p-4" aria-label="Crea le bozze" data-testid="import-bar">
            <ImportSummary ready={ready.length} already={already.length} invalid={invalidCount} awaiting={awaiting} />
            {progress ? (
              <div className="space-y-1" data-testid="import-progress">
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-sunken"
                  role="progressbar"
                  aria-label="Bozze create"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                >
                  <span className="block h-full bg-accent" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                </div>
                <p className="text-xs text-muted">Tieni aperta la pagina fino alla fine.</p>
              </div>
            ) : (
              ready.length > MAX_IMPORT_ROWS && (
                <p className="text-xs text-muted" data-testid="import-batches-note">
                  Il foglio ha {ready.length} righe pronte: le creo a gruppi di {MAX_IMPORT_ROWS}. Tieni aperta la pagina fino alla fine.
                </p>
              )
            )}
            {sendable.length > 0 &&
              (planMonth ? (
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                    checked={withPlan}
                    disabled={busy !== null}
                    onChange={(e) => setWithPlan(e.target.checked)}
                    data-testid="import-plan-check"
                  />
                  <span>Crea anche il piano di {planMonthLabel(planMonth)}</span>
                </label>
              ) : (
                <p className="text-sm text-muted" data-testid="import-plan-multi">
                  Le righe sono in mesi diversi ({months.map((m) => planMonthLabel(m)).join(", ")}): il piano riguarda un mese solo, lo crei dopo dalla pagina Piani.
                </p>
              ))}
            <div className="flex items-center gap-2 sm:flex-wrap sm:gap-3">
              {invalidCount > 0 && (
                <button
                  type="button"
                  className="btn btn-sm min-w-0 flex-1 px-3 whitespace-normal! py-1 leading-tight sm:flex-none sm:whitespace-nowrap! sm:py-0 sm:leading-5"
                  onClick={gotoNextInvalid}
                  aria-label="Vai alla prossima da correggere"
                  data-testid="import-goto-invalid"
                >
                  <span className="sm:hidden" aria-hidden="true">Prossima da correggere</span>
                  <span className="hidden sm:inline" aria-hidden="true">Vai alla prossima da correggere</span>
                </button>
              )}
              <button
                type="button"
                // «!»: .btn sets white-space: nowrap outside the utility layer, and a long label («Nessuna riga da creare») must wrap on a phone.
                className="btn btn-primary min-w-0 flex-1 whitespace-normal! py-1 leading-tight sm:flex-none sm:whitespace-nowrap! sm:py-0 sm:leading-5"
                disabled={busy !== null || ready.length === 0 || awaiting}
                onClick={create}
                data-testid="import-create"
              >
                {busy ?? (awaiting ? "Controllo le righe…" : ready.length === 0 ? "Nessuna riga da creare" : ready.length === 1 ? "Crea 1 bozza" : `Crea ${ready.length} bozze`)}
              </button>
              <span className="hidden text-xs text-muted sm:inline">Si creano solo bozze: non parte nulla verso il cliente.</span>
            </div>
          </section>
        </>
      )}

      {noRows && notices.length > 0 && (
        <ul className="space-y-1 text-sm text-warning">
          {notices.map((notice, i) => (
            <li key={i}>{notice.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
