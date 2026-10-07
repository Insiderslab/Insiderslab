"use client";

/** "Aggiungi al piano" on the agency's plan page (posts of the month added after the plan was opened). */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPostsToPlanAction } from "@/app/(dashboard)/plans/actions";

export function AddToPlanButton({ planId, postIds, label }: { planId: string; postIds: string[]; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className="btn btn-sm"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await addPostsToPlanAction(planId, postIds);
            if (!result.ok) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Aggiungo…" : label}
      </button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}
