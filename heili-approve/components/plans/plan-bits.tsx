"use client";

/**
 * Small pieces of the monthly plan shared by the agency pages and the client
 * portal: status chip (always with a word) and the progress bar
 * "8 di 12 approvati". Presentational, no hooks.
 */

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PlanStatus } from "@/app/generated/prisma/client";
import { ToneChip } from "@/components/status-badge";
import { planStatusLabel, planStatusTone, type PlanProgress } from "@/lib/plan-rules";

export function PlanStatusChip({ status, sent }: { status: PlanStatus; sent: boolean }) {
  return <ToneChip tone={planStatusTone(status)}>{planStatusLabel(status, sent)}</ToneChip>;
}

export function PlanProgressBar({
  progress,
  size = "md",
  label,
}: {
  progress: Pick<PlanProgress, "approved" | "total"> & Partial<Pick<PlanProgress, "changes">>;
  size?: "sm" | "md";
  /** Defaults to "8 di 12 approvati". */
  label?: string;
}) {
  const changes = progress.changes ?? 0;
  const completed = Math.min(progress.total, progress.approved + changes);
  const percent = progress.total > 0 ? Math.round((completed / progress.total) * 100) : 0;
  const text = label ?? `${completed} di ${progress.total} revisionati`;
  return (
    <div className="space-y-1.5">
      <p className={`tabular font-semibold ${size === "sm" ? "text-sm" : "text-base"}`}>{text}</p>
      <div
        className={`overflow-hidden rounded-full bg-surface-sunken ${size === "sm" ? "h-1.5" : "h-2.5"}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(progress.total, 1)}
        aria-valuenow={completed}
        aria-label={text}
      >
        <span className="block h-full bg-node" style={{ width: `${percent}%` }} />
      </div>
      {size === "md" && progress.total > 0 && (
        <p className="text-xs text-muted">{progress.approved} approvati{changes > 0 ? ` · ${changes} con modifiche richieste` : ""}</p>
      )}
    </div>
  );
}

export function PlanViews({
  list,
  calendar,
  instagram,
}: {
  list: ReactNode;
  calendar?: ReactNode;
  instagram: ReactNode;
}) {
  const id = useId();
  const [view, setView] = useState<"list" | "calendar" | "instagram">("list");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const views = [
    { id: "list" as const, label: "Elenco", content: list },
    ...(calendar === undefined ? [] : [{ id: "calendar" as const, label: "Calendario", content: calendar }]),
    { id: "instagram" as const, label: "Anteprima Instagram", content: instagram },
  ];
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % views.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + views.length) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault();
    setView(views[next].id);
    tabRefs.current[next]?.focus();
  }
  return (
    <section className="space-y-4" aria-labelledby={`${id}-title`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="label-caps">Contenuti del piano</p><h2 id={`${id}-title`} className="mt-1 text-xl font-semibold">Scegli come controllarli</h2></div>
        <div className="studio-view-tabs" role="tablist" aria-label="Vista del piano">
          {views.map((item, index) => <button key={item.id} ref={element => { tabRefs.current[index] = element; }} id={`${id}-${item.id}-tab`} type="button" role="tab" aria-selected={view === item.id} aria-controls={`${id}-${item.id}`} tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)} onKeyDown={event => moveTab(event, index)} className="studio-view-tab">{item.label}</button>)}
        </div>
      </div>
      {views.map(item => <div key={item.id} id={`${id}-${item.id}`} role="tabpanel" aria-labelledby={`${id}-${item.id}-tab`} tabIndex={0} hidden={view !== item.id}>{item.content}</div>)}
    </section>
  );
}
