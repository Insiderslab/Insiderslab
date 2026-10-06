"use client";

/**
 * Assistant Transcript
 *
 * Read-only view, for the agency, of one conversation between a client
 * reviewer and the AI review assistant: verdict, summary, action items (with
 * media and video moments) and the full transcript with times. Accepts the
 * Prisma rows as they come from getPostForWorkspace (reviewSessions + messages).
 *
 * Video moments — action item times and "[al momento 0:07 del video]" markers
 * in client messages — become chips; with onSeek the agency's player jumps there.
 * Blog passages ("[passaggio «…»]") and ads variants ("[variante B · …]") the
 * client pointed at, and those of the action items, are shown as tags.
 */

import { formatTimecode } from "@/lib/domain";
import {
  ACTION_AREA_LABELS,
  ACTION_PRIORITY_LABELS,
  SESSION_STATUS_LABELS,
  VERDICT_LABELS,
  formatActionItemTime,
  isVerdict,
  mediaLabel,
  parseActionItems,
  shortQuote,
  splitMessageMarkers,
  variantNameFor,
  type ReviewInputModeValue,
  type ReviewMessageRoleValue,
  type ReviewSessionStatusValue,
} from "@/lib/review-assistant/shared";

export interface AssistantTranscriptSession {
  id: string;
  status: ReviewSessionStatusValue;
  versionNumber: number;
  verdict: string | null;
  summary: string | null;
  /** ReviewSession.actionItems (JSON), parsed defensively. */
  actionItems: unknown;
  model?: string | null;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  messages: Array<{
    id: string;
    role: ReviewMessageRoleValue;
    content: string;
    inputMode: ReviewInputModeValue;
    createdAt: Date | string;
  }>;
}

export interface AssistantTranscriptProps {
  session: AssistantTranscriptSession;
  /** Shown as the author of client messages. */
  reviewerName?: string | null;
  /** IANA zone for the times (the client's); defaults to Europe/Rome. */
  timezone?: string;
  /**
   * Jump the agency's video player to a moment (mediaIndex null = the post's
   * video). Ads: variantId names the variant whose media mediaIndex refers to.
   */
  onSeek?: (target: { mediaIndex: number | null; timeSec: number; variantId?: string | null }) => void;
  /** Ads: variant names by id ("Variante B — Prima/dopo"). */
  variantNames?: Record<string, string>;
  /** Open the full transcript by default (the summary is always visible). */
  defaultExpanded?: boolean;
}

const VERDICT_TONES: Record<string, string> = {
  approve: "text-success",
  changes: "text-warning",
  unclear: "text-muted",
};

function formatTime(value: Date | string, timezone: string, withDate: boolean): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const options: Intl.DateTimeFormatOptions = withDate
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("it-IT", { ...options, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("it-IT", { ...options, timeZone: "Europe/Rome" }).format(date);
  }
}

function sortByTime<T extends { createdAt: Date | string; id: string }>(messages: T[]): T[] {
  const time = (m: T) => new Date(m.createdAt).getTime();
  return [...messages].sort((a, b) => time(a) - time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function AssistantTranscript({
  session,
  reviewerName,
  timezone = "Europe/Rome",
  onSeek,
  defaultExpanded = false,
  variantNames,
}: AssistantTranscriptProps) {
  const labels = { variantNames };
  const actionItems = parseActionItems(session.actionItems);
  const verdict = isVerdict(session.verdict) ? session.verdict : null;
  const messages = sortByTime(session.messages);
  const clientLabel = reviewerName?.trim() || "Cliente";

  return (
    <article className="panel rounded-lg p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Conversazione con l&apos;assistente · versione {session.versionNumber}</h3>
          <p className="text-xs text-muted">
            {clientLabel} · {formatTime(session.startedAt, timezone, true)}
            {session.completedAt ? ` – ${formatTime(session.completedAt, timezone, true)}` : ""} ·{" "}
            {SESSION_STATUS_LABELS[session.status]}
          </p>
        </div>
        {verdict && <span className={`text-xs font-medium ${VERDICT_TONES[verdict]}`}>{VERDICT_LABELS[verdict]}</span>}
      </header>

      {session.summary ? (
        <section className="space-y-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Riepilogo</h4>
          <p className="whitespace-pre-wrap text-sm">{session.summary}</p>
        </section>
      ) : (
        <p className="text-sm text-muted">
          {session.status === "OPEN"
            ? "Il cliente non ha ancora chiuso la conversazione: nessun riepilogo."
            : "Nessun riepilogo disponibile."}
        </p>
      )}

      {actionItems.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Modifiche richieste</h4>
          <ul className="space-y-2">
            {actionItems.map((item, i) => {
              const time = formatActionItemTime(item);
              const { mediaIndex, timeSec, variantId } = item;
              return (
                <li key={i} className="rounded border border-border bg-background p-2 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>{ACTION_AREA_LABELS[item.area]}</span>
                    {variantId && <span>· {variantNameFor(variantId, labels)}</span>}
                    {item.mediaIndex !== null && <span>· {mediaLabel(item.mediaIndex)}</span>}
                    {time && timeSec !== null && (
                      <TimeChip
                        label={time}
                        onClick={onSeek ? () => onSeek({ mediaIndex, timeSec, variantId }) : undefined}
                      />
                    )}
                    <span
                      className={
                        item.priority === "alta" ? "text-error" : item.priority === "bassa" ? "text-muted" : "text-warning"
                      }
                    >
                      · {ACTION_PRIORITY_LABELS[item.priority]}
                    </span>
                  </div>
                  {item.anchorQuote && (
                    <blockquote className="mb-1 border-l-2 border-warning pl-2 text-xs italic text-muted">
                      {shortQuote(item.anchorQuote, 200)}
                    </blockquote>
                  )}
                  <p>{item.request}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <details open={defaultExpanded} className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">
          Trascrizione completa ({messages.length} messaggi)
        </summary>
        <ol className="mt-3 space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
                <span className="font-medium text-foreground">{m.role === "CLIENT" ? clientLabel : "Assistente"}</span>
                <time dateTime={new Date(m.createdAt).toISOString()}>{formatTime(m.createdAt, timezone, false)}</time>
                {m.role === "CLIENT" && m.inputMode === "VOICE" && <span>· dettato a voce</span>}
              </div>
              <p className={`mt-0.5 whitespace-pre-wrap break-words ${m.role === "CLIENT" ? "" : "text-muted"}`}>
                {splitMessageMarkers(m.content).map((segment, i) => {
                  if (segment.type === "text") return <span key={i}>{segment.value}</span>;
                  if (segment.type === "moment") {
                    return (
                      <TimeChip
                        key={i}
                        label={formatTimecode(segment.timeSec)}
                        onClick={onSeek ? () => onSeek({ mediaIndex: null, timeSec: segment.timeSec }) : undefined}
                      />
                    );
                  }
                  if (segment.type === "passage") {
                    return (
                      <span key={i} className="mx-0.5 inline-block rounded-full border border-border px-2 text-xs italic">
                        Passaggio {shortQuote(segment.quote, 80)}
                      </span>
                    );
                  }
                  const { timeSec, variantId } = segment;
                  const name = variantNames?.[variantId] ?? segment.variantName ?? `Variante ${variantId}`;
                  return (
                    <span key={i} className="mx-0.5 inline-flex flex-wrap items-center gap-1">
                      <span className="inline-block rounded-full border border-border px-2 text-xs">
                        {[name, segment.placementLabel].filter(Boolean).join(" · ")}
                      </span>
                      {timeSec !== null && (
                        <TimeChip
                          label={formatTimecode(timeSec)}
                          onClick={onSeek ? () => onSeek({ mediaIndex: null, timeSec, variantId }) : undefined}
                        />
                      )}
                    </span>
                  );
                })}
              </p>
            </li>
          ))}
        </ol>
      </details>

      {session.model && <p className="text-[11px] text-muted">Modello: {session.model}</p>}
    </article>
  );
}

function TimeChip({ label, onClick }: { label: string; onClick?: () => void }) {
  const className = "mx-0.5 inline-block rounded-full border border-border px-2 text-xs font-mono";
  if (!onClick) return <span className={className}>{label}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} text-accent hover:border-accent`}
      title={`Vai a ${label}`}
    >
      {label}
    </button>
  );
}

export default AssistantTranscript;
