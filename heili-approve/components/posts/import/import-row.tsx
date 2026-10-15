"use client";

/**
 * One row of the "Importa post" preview: the cells as editable fields (date,
 * time, networks, format, text, pictures, title, first comment), what was understood
 * from them (the date in words, the networks, a thumbnail per picture) and,
 * when the row cannot become a draft, the reasons in Italian. A row with
 * problems is red and always says "Da correggere".
 */

import { ToneChip } from "@/components/status-badge";
import { NETWORK_LABELS } from "@/lib/domain";
import { FORMAT_CHOICES, fileKey, formatChoice, type FileRef, type RawRow, type RowEvaluation, type RowField, type RowIssue } from "@/lib/post-import/rows";

export type EditableRow = RawRow & { id: number };

/** A file dropped on the page, with the URL its thumbnail is read from. */
export interface DroppedFile {
  key: string;
  file: File;
  ref: FileRef;
  url: string;
}

interface ImportRowProps {
  row: EditableRow;
  evaluation: RowEvaluation;
  /** Problems found by the server on top of the local ones. */
  extraIssues: RowIssue[];
  /** An earlier import already created this exact post. */
  existing: boolean;
  /** True while the server check for this row is scheduled or in flight. */
  checking: boolean;
  files: Map<string, DroppedFile>;
  disabled: boolean;
  zone: string;
  onChange: (id: number, patch: Partial<RawRow>) => void;
  onRemove: (id: number) => void;
}

function Cell({
  id,
  label,
  invalid,
  className = "",
  children,
}: {
  id: string;
  label: string;
  invalid: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`} data-invalid={invalid || undefined}>
      <label htmlFor={id} className="label-caps block">
        {label}
      </label>
      {children}
    </div>
  );
}

function Thumb({ dropped }: { dropped: DroppedFile }) {
  return dropped.ref.type === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a site image
    <img src={dropped.url} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-surface-sunken object-cover" />
  ) : (
    <video src={`${dropped.url}#t=0.1`} muted playsInline preload="metadata" className="h-12 w-12 shrink-0 rounded-lg bg-surface-sunken object-cover" aria-hidden="true" />
  );
}

export default function ImportRow({
  row,
  evaluation,
  extraIssues,
  existing,
  checking,
  files,
  disabled,
  zone,
  onChange,
  onRemove,
}: ImportRowProps) {
  const issues = [...evaluation.issues, ...extraIssues.filter((x) => !evaluation.issues.some((y) => y.message === x.message))];
  const invalid = issues.length > 0;
  const has = (...fields: RowField[]) => issues.some((issue) => fields.includes(issue.field));
  const base = `import-row-${row.id}`;
  // .field and .panel set their own border/background (plain CSS beats utilities): red goes inline.
  const fieldProps = (...fields: RowField[]) =>
    has(...fields)
      ? { className: "field", style: { borderColor: "var(--color-error)" }, "aria-invalid": true as const }
      : { className: "field" };
  const characters = Array.from(row.text).length;
  // «Formato» is a menu of the three words; anything else typed in the sheet
  // ("Video", "Instagram: Reel") stays selectable as it is until it is changed.
  const choice = formatChoice(row.format);
  const customFormat = choice === null ? (row.format ?? "").trim() : null;
  const formatSelectValue = choice ?? customFormat ?? "";

  return (
    <li
      id={`import-row-${row.id}`}
      className="panel space-y-3 p-3 sm:p-4"
      style={invalid ? { borderColor: "var(--color-error)", background: "var(--color-error-soft)" } : undefined}
      data-testid="import-row"
      data-state={invalid ? "invalid" : existing ? "existing" : checking ? "checking" : "ready"}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label-caps">Riga {row.sourceRow}</span>
        {invalid ? (
          <ToneChip tone="error">Da correggere</ToneChip>
        ) : existing ? (
          <ToneChip tone="neutral">Già importata</ToneChip>
        ) : checking ? (
          <ToneChip tone="neutral">Controllo…</ToneChip>
        ) : (
          <ToneChip tone="success">Pronta</ToneChip>
        )}
        {evaluation.when && (
          <span className="tabular text-sm text-muted">
            {evaluation.when} <span className="text-xs">({zone})</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          disabled={disabled}
          className="btn btn-quiet btn-sm ml-auto"
          aria-label={`Togli la riga ${row.sourceRow}`}
        >
          Togli la riga
        </button>
      </div>

      {invalid && (
        <ul className="space-y-1 text-sm text-error" data-testid="import-row-issues">
          {issues.map((issue) => (
            <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[7.5rem_5.5rem_13rem_minmax(0,1fr)_15rem]">
        <Cell id={`${base}-date`} label="Data" invalid={has("date")}>
          <input
            id={`${base}-date`}
            {...fieldProps("date")}
            value={row.date}
            disabled={disabled}
            inputMode="numeric"
            placeholder="15/10/2026"
            onChange={(e) => onChange(row.id, { date: e.target.value })}
          />
        </Cell>
        <Cell id={`${base}-time`} label="Ora" invalid={has("time")}>
          <input
            id={`${base}-time`}
            {...fieldProps("time")}
            value={row.time}
            disabled={disabled}
            inputMode="numeric"
            placeholder="10:30"
            onChange={(e) => onChange(row.id, { time: e.target.value })}
          />
        </Cell>
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-1 lg:grid-cols-1 lg:content-start">
          <Cell id={`${base}-networks`} label="Reti" invalid={has("networks")}>
            <input
              id={`${base}-networks`}
              {...fieldProps("networks")}
              value={row.networks}
              disabled={disabled}
              placeholder="Instagram, Facebook"
              onChange={(e) => onChange(row.id, { networks: e.target.value })}
            />
            {evaluation.networks.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {evaluation.networks.map((network) => (
                  <span key={network} className="chip chip-brand">
                    {NETWORK_LABELS[network]}
                  </span>
                ))}
              </span>
            )}
          </Cell>
          <Cell id={`${base}-format`} label="Formato" invalid={has("format")}>
            <select
              id={`${base}-format`}
              {...fieldProps("format")}
              value={formatSelectValue}
              disabled={disabled}
              onChange={(e) => onChange(row.id, { format: e.target.value })}
              data-testid="import-format"
            >
              <option value="">Predefinito (Post)</option>
              {FORMAT_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.value}
                </option>
              ))}
              {customFormat !== null && <option value={customFormat}>«{customFormat}»</option>}
            </select>
            {evaluation.formats.length > 0 && (
              <span className="flex flex-wrap gap-1" data-testid="import-format-read">
                {evaluation.formats.map(({ network, label }) => (
                  <span key={network} className="chip chip-brand">
                    {NETWORK_LABELS[network]}: {label}
                  </span>
                ))}
              </span>
            )}
          </Cell>
        </div>
        <Cell id={`${base}-text`} label="Testo" invalid={has("text")} className="sm:col-span-2 lg:col-span-1">
          <textarea
            id={`${base}-text`}
            {...fieldProps("text")}
            className="field min-h-24 resize-y"
            rows={4}
            value={row.text}
            disabled={disabled}
            onChange={(e) => onChange(row.id, { text: e.target.value })}
          />
          <span className="tabular block text-xs text-muted">{characters.toLocaleString("it-IT")} caratteri</span>
        </Cell>
        <Cell id={`${base}-images`} label="Immagini" invalid={has("images")} className="sm:col-span-2 lg:col-span-1">
          <input
            id={`${base}-images`}
            {...fieldProps("images")}
            value={row.images}
            disabled={disabled}
            placeholder="foto-1.jpg, foto-2.jpg"
            onChange={(e) => onChange(row.id, { images: e.target.value })}
          />
          {evaluation.images.length > 0 && (
            <ul className="space-y-1" aria-label="File della riga">
              {evaluation.images.map(({ name, file }) => {
                const dropped = file ? files.get(fileKey(file.name)) : undefined;
                return (
                  <li key={name} className="flex items-center gap-2 text-sm">
                    {dropped ? <Thumb dropped={dropped} /> : null}
                    <span className="min-w-0 flex-1 truncate" title={name}>
                      {file?.name ?? name}
                    </span>
                    {file ? <ToneChip tone="success">Trovato</ToneChip> : <ToneChip tone="error">Manca</ToneChip>}
                  </li>
                );
              })}
            </ul>
          )}
        </Cell>
      </div>

      <details className="text-sm" open={has("title", "firstComment")}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted hover:text-foreground">
          Titolo e primo commento
          {!row.title.trim() && evaluation.title ? <span className="ml-2 truncate text-xs">· titolo: {evaluation.title}</span> : null}
        </summary>
        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          <Cell id={`${base}-title`} label="Titolo (visibile al cliente)" invalid={has("title")}>
            <input
              id={`${base}-title`}
              {...fieldProps("title")}
              value={row.title}
              disabled={disabled}
              placeholder={evaluation.title || "Prime parole del testo"}
              onChange={(e) => onChange(row.id, { title: e.target.value })}
            />
          </Cell>
          <Cell id={`${base}-comment`} label="Primo commento" invalid={has("firstComment")}>
            <input
              id={`${base}-comment`}
              {...fieldProps("firstComment")}
              value={row.firstComment}
              disabled={disabled}
              onChange={(e) => onChange(row.id, { firstComment: e.target.value })}
            />
          </Cell>
        </div>
      </details>

    </li>
  );
}
