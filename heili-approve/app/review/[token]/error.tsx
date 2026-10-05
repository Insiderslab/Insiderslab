"use client";

/**
 * Unexpected error inside the portal (database down, network…). Friendly
 * Italian message, no technical details; the digest stays in the server log.
 */

export default function ReviewError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <main className="space-y-4 py-8">
      <h1 className="text-xl font-semibold">Qualcosa non ha funzionato</h1>
      <p className="text-base text-muted">
        Non siamo riusciti a caricare la pagina. Riprova tra qualche istante: se il problema continua, scrivi
        all&apos;agenzia.
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover"
      >
        Riprova
      </button>
    </main>
  );
}
