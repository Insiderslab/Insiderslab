/**
 * Heili brand marks for Approve by Heili.
 *
 * The symbol is the Hagalaz rune (ᚺ) redrawn as two stems joined by a thread
 * that ends on the node (Heili design system 0.1, heili-symbol.svg). The
 * product name is set in the display font next to it; the "heili" logotype
 * itself is never typeset (public/brand/heili-wordmark.svg).
 */

export function HeiliSymbol({ className = "h-7 w-7", negative = false }: { className?: string; negative?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <path
        d="M15 9v30M33 9v30M15 21.5 28.3 25.6"
        fill="none"
        stroke={negative ? "#ffffff" : "#1f3f73"}
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="33" cy="27" r="5" fill={negative ? "#4fc4bd" : "#0b6b6a"} />
    </svg>
  );
}

/** App icon tile (symbol on a brand tile), for login and the client portal. */
export function HeiliAppIcon({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="11" fill="#1f3f73" />
      <path
        d="M15 9v30M33 9v30M15 21.5 28.3 25.6"
        fill="none"
        stroke="#ffffff"
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="33" cy="27" r="5" fill="#4fc4bd" />
    </svg>
  );
}

/** Symbol + product name ("Approve") + "by Heili". */
export function ApproveLockup({
  name = "Approve",
  subtitle = "by Heili",
  className = "",
}: {
  name?: string;
  /** "by Heili"; single-kind instances show their full product name ("Approve by Heili — Blog"). */
  subtitle?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <HeiliSymbol className="h-8 w-8" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[17px] font-semibold tracking-tight text-foreground">{name}</span>
        <span className="mt-1 text-xs text-muted">{subtitle}</span>
      </span>
    </span>
  );
}
