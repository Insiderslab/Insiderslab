"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makePlanAvailableAction } from "@/app/(dashboard)/plans/actions";

export default function PlanAvailabilityButton({ planId }: { planId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return <div className="space-y-2">
    <button type="button" className="btn btn-primary min-h-11" disabled={pending} onClick={() => startTransition(async () => {
      setError(null);
      try {
        const result = await makePlanAvailableAction(planId);
        if (!result.ok) setError(result.error);
        else router.refresh();
      } catch {
        setError("Connessione interrotta. Controlla il piano e riprova.");
      }
    })}>{pending ? "Preparazione…" : "Rendi disponibile il piano"}</button>
    <p className="text-xs text-muted">Mostra i post già condivisi. Le bozze restano private; nessun nuovo invito viene inviato.</p>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </div>;
}
