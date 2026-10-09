"use client";

/**
 * Post List
 *
 * Table on desktop, cards on phones. Drafts (and items with changes
 * requested) can be selected and sent to their clients in one go: each
 * reviewer gets a single email listing all of their items. With several
 * kinds in the list each row shows its kind's icon; statuses are worded for
 * the kind ("Pubblicato" for a delivered article).
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";
import { submitForReviewAction } from "@/app/(dashboard)/posts/actions";
import QuickReviewLink from "@/components/share/quick-review-link";
import { canTransition, type MediaType } from "@/lib/domain";
import { DEFAULT_TIME_ZONE, formatDateTime, localPartsToUtc, timeZoneAbbr } from "./helpers";
import { KindBadge, KindIcon, KindStatusBadge } from "./kind-badge";

export interface PostListRow {
  id: string;
  kind: ContentKind;
  title: string;
  clientId: string;
  clientName: string;
  timezone: string;
  /** Networks (social), slug (blog), platform and variants (ads). */
  detail: string;
  publishAt: Date | string;
  status: PostStatus;
  versionNumber: number;
  openClientComments: number;
  lastError: string | null;
  thumbnail: { url: string; type: MediaType; posterUrl?: string } | null;
}

function Thumbnail({ media, kind }: { media: PostListRow["thumbnail"]; kind: ContentKind }) {
  if (!media) {
    return (
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-muted"
        aria-hidden
      >
        {kind !== "SOCIAL_POST" && <KindIcon kind={kind} className="h-5 w-5" />}
      </div>
    );
  }
  if (media.type === "video") {
    return (
      <video
        src={`${media.url}#t=0.5`}
        poster={media.posterUrl}
        preload="metadata"
        muted
        playsInline
        className="h-11 w-11 shrink-0 rounded-lg object-cover"
        aria-hidden
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- uploaded media, arbitrary sizes
  return <img src={media.url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />;
}

function Extra({ row }: { row: PostListRow }) {
  return (
    <>
      {row.openClientComments > 0 && (
        <span className="text-warning">
          {row.openClientComments === 1 ? "1 commento aperto" : `${row.openClientComments} commenti aperti`}
        </span>
      )}
      {row.status === "FAILED" && row.lastError && <span className="line-clamp-2 text-error">{row.lastError}</span>}
    </>
  );
}

function OpenAction({ row }: { row: PostListRow }) {
  return (
    <Link
      href={`/posts/${row.id}`}
      className="btn btn-quiet btn-sm"
      aria-label={`Apri ${row.title}`}
    >
      Apri
    </Link>
  );
}

function RowActions({ row }: { row: PostListRow }) {
  const clientVisible = row.status === "IN_REVIEW" || row.status === "CHANGES_REQUESTED";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <OpenAction row={row} />
      {clientVisible && <QuickReviewLink kind="post" id={row.id} />}
    </div>
  );
}

export default function PostList({
  rows,
  showKind = false,
  detailLabel = "Reti",
}: {
  rows: PostListRow[];
  /** The list mixes kinds: show each row's kind. */
  showKind?: boolean;
  /** Header of the detail column ("Reti" for social-only lists). */
  detailLabel?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectable = rows.filter((row) => canTransition(row.status, "submit"));
  // Rows can leave the list after a refresh: only count what is still selectable.
  const chosen = selectable.filter((row) => selected.has(row.id));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setNotice(null);
  }

  function toggleAll() {
    setSelected(allChosen ? new Set() : new Set(selectable.map((row) => row.id)));
    setNotice(null);
  }

  function submit() {
    setError(null);
    setNotice(null);
    let reviewDueAt: string | null = null;
    if (dueDate) {
      const due = localPartsToUtc(dueDate, "18:00", DEFAULT_TIME_ZONE);
      if (!due) {
        setError("Scadenza non valida.");
        return;
      }
      reviewDueAt = due.toISOString();
    }
    startTransition(async () => {
      const result = await submitForReviewAction(
        chosen.map((row) => row.id),
        { reviewDueAt }
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
      setDueDate("");
      setNotice(result.message ?? "Inviati in revisione.");
    });
  }

  const checkbox = (row: PostListRow) =>
    canTransition(row.status, "submit") ? (
      <input
        type="checkbox"
        checked={selected.has(row.id)}
        onChange={() => toggle(row.id)}
        aria-label={`Seleziona ${row.title}`}
        className="h-4 w-4 accent-accent"
      />
    ) : (
      <span className="inline-block h-4 w-4" aria-hidden />
    );

  return (
    <div className="space-y-3">
      {selectable.length > 0 && (
        <div className="panel flex flex-col gap-3 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allChosen} onChange={toggleAll} className="h-4 w-4 accent-accent" />
            {chosen.length > 0
              ? `${chosen.length} selezionati`
              : `Seleziona le bozze da inviare (${selectable.length})`}
          </label>
          {chosen.length > 0 && (
            <>
              <label className="flex flex-wrap items-center gap-2 text-muted">
                Risposta entro
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="field !min-h-9 !w-auto !py-1"
                />
                {dueDate && <span className="text-xs">alle 18:00 ({timeZoneAbbr(DEFAULT_TIME_ZONE)})</span>}
              </label>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="btn btn-primary sm:ml-auto"
              >
                {pending ? "Invio…" : `Invia in revisione (${chosen.length})`}
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      {notice && <p className="text-sm text-success">{notice}</p>}

      {/* ── Desktop table ── */}
      <div className="panel hidden overflow-hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-left text-xs text-muted">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2 font-medium">Titolo</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">{detailLabel}</th>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Stato</th>
              <th className="px-3 py-2 font-medium"><span className="sr-only">Azioni</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border align-top hover:bg-background">
                <td className="px-3 py-3">{checkbox(row)}</td>
                <td className="px-3 py-3">
                  <div className="flex min-w-0 gap-3">
                    <Thumbnail media={row.thumbnail} kind={row.kind} />
                    <div className="min-w-0">
                      <Link href={`/posts/${row.id}`} className="font-semibold text-foreground hover:underline">
                        {row.title}
                      </Link>
                      <div className="mt-0.5 flex flex-col gap-0.5 text-xs text-muted">
                        <span className="flex flex-wrap items-center gap-x-2">
                          {showKind && <KindBadge kind={row.kind} />}
                          <span>Versione {row.versionNumber}</span>
                        </span>
                        <Extra row={row} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <Link href={`/posts?clientId=${row.clientId}`} className="text-muted hover:text-foreground hover:underline">
                    {row.clientName}
                  </Link>
                </td>
                <td className="px-3 py-3 text-muted">{row.detail}</td>
                <td className="whitespace-nowrap px-3 py-3">
                  {formatDateTime(row.publishAt, row.timezone, { year: false })}
                  {row.timezone !== DEFAULT_TIME_ZONE && (
                    <span className="block text-xs text-muted">{timeZoneAbbr(row.timezone, row.publishAt)}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <KindStatusBadge kind={row.kind} status={row.status} />
                </td>
                <td className="px-3 py-1"><RowActions row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ── */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="panel flex gap-3 p-3"
          >
            <div className="pt-0.5">{checkbox(row)}</div>
            <Thumbnail media={row.thumbnail} kind={row.kind} />
            <div className="min-w-0 flex-1">
              <Link href={`/posts/${row.id}`} className="block min-w-0 break-words font-semibold hover:underline">
                {row.title}
              </Link>
              <div className="mt-1">
                <KindStatusBadge kind={row.kind} status={row.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {row.clientName} · {formatDateTime(row.publishAt, row.timezone, { year: false })}
              </p>
              <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
                {showKind && <KindBadge kind={row.kind} />}
                <span className="truncate">{row.detail}</span>
              </p>
              <div className="mt-1 flex flex-col gap-0.5 text-xs">
                <Extra row={row} />
              </div>
              <div className="mt-2 flex justify-end">
                <RowActions row={row} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
