"use client";

/**
 * Interactive actions for the Attività page: "Fatto" / "Riapri", the
 * "Assegna a…" select and "Segna tutte come lette". Each one calls its server
 * action and shows a short error on failure; the server revalidates the page.
 */

import { useState, useTransition } from "react";
import {
  assignAction,
  markAllNotificationsReadAction,
  markDoneAction,
  reopenAction,
} from "@/app/(dashboard)/attivita/actions";
import { memberLabel } from "@/components/attivita/helpers";

export interface AssigneeMember {
  userId: string;
  name: string | null;
  email: string | null;
}

/** "Fatto" on an open task, "Riapri" on a completed one. */
export function TaskButtons({ id, done }: { id: string; done: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = done ? await reopenAction(id) : await markDoneAction(id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <span className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`btn btn-sm w-full ${done ? "" : "btn-primary"}`}
      >
        {pending ? "…" : done ? "Riapri" : "Fatto"}
      </button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}

/** "Assegna a…": the task's assignee, changeable to any workspace member or "Nessuno". */
export function AssignSelect({
  id,
  members,
  current,
}: {
  id: string;
  members: AssigneeMember[];
  current: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(value: string) {
    setError(null);
    const target = value === "" ? null : value;
    startTransition(async () => {
      const result = await assignAction(id, target);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <span className="flex flex-col items-stretch gap-1">
      <select
        value={current ?? ""}
        onChange={(event) => change(event.target.value)}
        disabled={pending}
        aria-label="Assegna a"
        className="field !w-auto min-w-[120px] text-sm"
      >
        <option value="">Nessuno</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {memberLabel(member)}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}

/** Marks every unread notification of the user as read. */
export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" onClick={run} disabled={pending} className="btn btn-sm btn-quiet !px-0">
        {pending ? "…" : "Segna tutte come lette"}
      </button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}
