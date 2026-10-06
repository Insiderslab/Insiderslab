/**
 * Export buttons of the internal kinds (plain links, no hooks: server-safe).
 *
 * - Blog: Markdown with front matter, or clean HTML for WordPress
 *   (GET /api/export/blog/<id>?format=md|html). Before approval the file is
 *   the current version marked "non approvato": the buttons say so.
 * - Ads: ZIP of the approved variants, copy.csv and README with the client's
 *   decisions (GET /api/export/ads/<id>). Only once approved with at least one
 *   approved variant, otherwise the route answers 409: the button is replaced
 *   by the reason.
 */

const buttonClass =
  "inline-flex items-center justify-center rounded border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:border-border-hover";

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="mr-2 h-4 w-4" aria-hidden>
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BlogExportButtons({
  postId,
  approved,
  approvedVersion,
}: {
  postId: string;
  /** APPROVED or DELIVERED: the export is the approved version. */
  approved: boolean;
  approvedVersion: number | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <a href={`/api/export/blog/${postId}?format=md`} download className={buttonClass}>
          <DownloadIcon />
          Scarica Markdown
        </a>
        <a href={`/api/export/blog/${postId}?format=html`} download className={buttonClass}>
          <DownloadIcon />
          Scarica HTML per WordPress
        </a>
      </div>
      <p className={`text-xs ${approved ? "text-muted" : "text-warning"}`}>
        {approved
          ? `Il file contiene la versione approvata dal cliente${approvedVersion ? ` (versione ${approvedVersion})` : ""}.`
          : "Non ancora approvato: il file contiene la versione attuale ed è segnato come non approvato."}
      </p>
    </div>
  );
}

export function AdsExportButton({
  postId,
  approved,
  approvedVariants,
}: {
  postId: string;
  /** APPROVED or DELIVERED. */
  approved: boolean;
  /** Variants the client approved on the approved version. */
  approvedVariants: number;
}) {
  if (!approved || approvedVariants === 0) {
    return (
      <p className="text-sm text-muted">
        Il pacchetto con le creatività da caricare si scarica quando il cliente ha approvato il set (almeno una
        variante approvata).
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <a href={`/api/export/ads/${postId}`} download className={`${buttonClass} w-full sm:w-auto`}>
        <DownloadIcon />
        Scarica pacchetto ZIP
      </a>
      <p className="text-xs text-muted">
        {approvedVariants === 1 ? "1 variante approvata" : `${approvedVariants} varianti approvate`}: file rinominati,
        copy.csv con i testi e README con le decisioni e le note del cliente.
      </p>
    </div>
  );
}
