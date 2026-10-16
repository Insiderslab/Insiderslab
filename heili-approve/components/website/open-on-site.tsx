"use client";

/**
 * «Apri nel punto»: opens the site at the element of a client's comment, with
 * a read-only agency session. A phone comment opens a window of the client's
 * size; otherwise a new tab.
 */

import { useState } from "react";
import { openOnSiteAction } from "@/app/(dashboard)/posts/website-actions";

export default function OpenOnSite({ commentId }: { commentId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    // Opened during the click (popup blockers), filled once the code is ready.
    const win = window.open("about:blank", "_blank");
    const result = await openOnSiteAction(commentId);
    setBusy(false);
    if (!result.ok) {
      win?.close();
      setMessage(result.error);
      return;
    }
    const { url, viewport, device } = result.data;
    if (device === "phone") {
      setMessage(`Commento fatto da telefono (${viewport.w}×${viewport.h}): se la finestra è più larga, usa la modalità dispositivo del browser.`);
      try {
        win?.resizeTo(viewport.w, viewport.h + 80);
      } catch {
        // some browsers do not resize tabs
      }
    }
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      window.location.href = url;
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={open} disabled={busy} className="btn btn-sm" data-testid="open-on-site">
        {busy ? "Apro…" : "Apri nel punto"}
      </button>
      {message && <span className="max-w-xs text-right text-xs text-muted">{message}</span>}
    </span>
  );
}
