"use client";

/**
 * Archive / restore a client. Archiving keeps posts and history but hides
 * the client from lists and disables every reviewer link.
 */

import { useState, useTransition } from "react";
import { archiveClientAction, restoreClientAction } from "@/app/(dashboard)/clients/actions";

interface ArchiveButtonProps {
  clientId: string;
  clientName: string;
  archived: boolean;
}

export default function ArchiveButton({ clientId, clientName, archived }: ArchiveButtonProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function handleClick() {
    if (
      !archived &&
      !confirm(
        `Archiviare ${clientName}? I link dei referenti smettono di funzionare e il cliente sparisce dagli elenchi. Post e storico restano, e puoi ripristinarlo quando vuoi.`
      )
    ) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = archived ? await restoreClientAction(clientId) : await archiveClientAction(clientId);
      setMessage(
        result.ok
          ? { tone: "success", text: result.message ?? "Fatto." }
          : { tone: "error", text: result.error }
      );
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={
          archived
            ? "rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            : "rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-colors hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
        }
      >
        {pending
          ? archived
            ? "Ripristino…"
            : "Archiviazione…"
          : archived
            ? "Ripristina cliente"
            : "Archivia cliente"}
      </button>
      {message && (
        <p className={`text-sm ${message.tone === "error" ? "text-error" : "text-success"}`}>{message.text}</p>
      )}
    </div>
  );
}
