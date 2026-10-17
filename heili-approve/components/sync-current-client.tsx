"use client";

/**
 * QA-16: a page that works on one client (Importa post, Carica contenuti,
 * the client's page) makes it the client of the main menu too, so the two
 * selectors never disagree ("Importa post per Caffè Aurora" with "Tutti i
 * clienti" in the menu). Renders nothing; the server action re-checks the
 * client against the workspace.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { setCurrentClientAction } from "@/app/(dashboard)/current-client-actions";

export default function SyncCurrentClient({ clientId, currentClientId }: { clientId: string; currentClientId: string | null }) {
  const router = useRouter();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (clientId === currentClientId || done.current === clientId) return;
    done.current = clientId;
    void setCurrentClientAction(clientId).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [clientId, currentClientId, router]);
  return null;
}
