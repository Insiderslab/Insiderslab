"use client";

/**
 * Share Link
 *
 * A reviewer's personal link, ready to send: read-only field (selects on
 * focus), "Copia link", "Invia su WhatsApp" (prefilled message, the agency
 * picks the contact), "Condividi" (the phone's share sheet, only where
 * navigator.share exists), "Apri anteprima" (new tab) and an optional QR
 * code for when the client is sitting in front of you.
 *
 * The URL contains the reviewer's token: render this only for signed-in
 * agency members, never in client-facing pages.
 */

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { whatsappHref } from "./messages";

interface ShareLinkProps {
  url: string;
  /** Prefilled text for WhatsApp / share sheet; it should already contain the URL. */
  message: string;
  reviewerName: string;
  /** Smaller buttons, no QR toggle (lists). */
  compact?: boolean;
  /** Label of the preview button. */
  previewLabel?: string;
}

const noSubscribe = () => () => {};

/** navigator.share exists only in some browsers (mostly phones); false on the server. */
function useCanShare(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}

export default function ShareLink({
  url,
  message,
  reviewerName,
  compact = false,
  previewLabel = "Apri anteprima",
}: ShareLinkProps) {
  const fieldId = useId();
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const canShare = useCanShare();
  const [qrOpen, setQrOpen] = useState(false);
  // Keyed by URL: a new link (rotation) never shows the QR of the old one.
  const [qrImage, setQrImage] = useState<{ url: string; dataUrl: string | null } | null>(null);
  const qrReady = qrImage?.url === url ? qrImage : null;

  useEffect(() => {
    if (!qrOpen || qrReady) return;
    let cancelled = false;
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: "M" }))
      .then((dataUrl) => {
        if (!cancelled) setQrImage({ url, dataUrl });
      })
      .catch(() => {
        if (!cancelled) setQrImage({ url, dataUrl: null });
      });
    return () => {
      cancelled = true;
    };
  }, [qrOpen, qrReady, url]);

  async function handleCopy() {
    const ok = await copyText(url);
    setCopy(ok ? "copied" : "failed");
    window.setTimeout(() => setCopy("idle"), 2000);
  }

  async function handleShare() {
    try {
      await navigator.share({ title: `Link per ${reviewerName}`, text: message });
    } catch {
      // Closed by the user, or not allowed: nothing to do.
    }
  }

  const size = compact ? "btn btn-sm min-h-11" : "btn";

  return (
    <div className="space-y-2" data-testid="share-link">
      <label htmlFor={fieldId} className="sr-only">
        Link personale di {reviewerName}
      </label>
      <input
        id={fieldId}
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.currentTarget.select()}
        className={`field min-w-0 font-mono ${compact ? "!min-h-11 !py-2 text-base" : "text-base"}`}
        data-testid="share-link-url"
      />
      {/* Phones: WhatsApp full width on top, the rest two per row. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={handleCopy}
          className={`${size} order-2 sm:order-none sm:min-w-[7.5rem]`}
          data-testid="share-copy"
          aria-live="polite"
        >
          {copy === "copied" ? "Copiato" : copy === "failed" ? "Copia non riuscita" : "Copia link"}
        </button>
        <a
          href={whatsappHref(message)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${size} btn-whatsapp order-1 col-span-2 sm:order-none`}
          data-testid="share-whatsapp"
        >
          <WhatsAppIcon />
          Invia su WhatsApp
        </a>
        {canShare && (
          <button type="button" onClick={handleShare} className={`${size} order-3 sm:order-none`} data-testid="share-native">
            Condividi
          </button>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${size} btn-quiet order-4 sm:order-none`}
          data-testid="share-preview"
        >
          {previewLabel}
        </a>
        {!compact && (
          <button
            type="button"
            onClick={() => setQrOpen((open) => !open)}
            className={`${size} btn-quiet order-5 sm:order-none`}
            aria-expanded={qrOpen}
            data-testid="share-qr-toggle"
          >
            {qrOpen ? "Nascondi QR" : "Mostra QR"}
          </button>
        )}
      </div>
      {copy === "failed" && (
        <p className="text-xs text-error">Seleziona il link qui sopra e copialo a mano.</p>
      )}
      {qrOpen && (
        <div className="inset flex flex-col items-start gap-2 p-3 sm:flex-row sm:items-center">
          {qrReady?.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrReady.dataUrl}
              alt={`Codice QR del link di ${reviewerName}`}
              width={160}
              height={160}
              className="rounded bg-white p-1"
              data-testid="share-qr"
            />
          ) : (
            <p className="text-sm text-muted">{qrReady ? "QR non disponibile." : "Preparo il QR…"}</p>
          )}
          <p className="text-sm text-muted">
            Inquadralo con la fotocamera del telefono di {reviewerName}: si apre direttamente la revisione.
          </p>
        </div>
      )}
    </div>
  );
}
