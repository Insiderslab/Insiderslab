"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makePlanAvailableAction, makePlanAvailableFormAction } from "@/app/(dashboard)/plans/actions";

export default function PlanAvailabilityButton({ planId }: { planId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // The form posts the bound server action even before hydration, so the
  // first click right after the page loads always works (K-09). Once
  // hydrated, the click handler takes over and shows errors inline instead.
  const postDirectly = makePlanAvailableFormAction.bind(null, planId);
  return <div className="space-y-2">
    <form action={postDirectly}>
      <button type="submit" className="btn btn-primary min-h-11" disabled={pending} onClick={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          try {
            const result = await makePlanAvailableAction(planId);
            if (!result.ok) setError(result.error);
            else router.refresh();
          } catch {
            setError("Connessione interrotta. Controlla il piano e riprova.");
          }
        });
      }}>{pending ? "Preparazione…" : "Rendi disponibile il piano"}</button>
    </form>
    <p className="text-xs text-muted">Mostra i post già condivisi. Le bozze restano private; nessun nuovo invito viene inviato.</p>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </div>;
}
