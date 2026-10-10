"use client";

/**
 * Small pieces shared by the Metricool import page and the brand picker of the
 * client form: the brand logo (initials when it is missing or fails to load)
 * and the network chips, always with words.
 */

import { useState } from "react";
import { clientInitials } from "@/components/clients/helpers";
import { NETWORK_LABELS, isNetwork } from "@/lib/domain";

export function BrandLogo({
  src,
  label,
  className = "h-10 w-10",
}: {
  src: string | null;
  label: string;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  if (src && broken !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(src)}
        className={`${className} shrink-0 rounded-lg border border-border bg-background object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xs font-semibold text-accent`}
    >
      {clientInitials(label)}
    </span>
  );
}

/** One chip per network ("Instagram", "Google Business"…); a muted line when there are none. */
export function NetworkChips({ networks, accounts }: { networks: readonly string[]; accounts?: Record<string, string> }) {
  const known = networks.filter(isNetwork);
  if (known.length === 0) return <span className="text-xs text-muted">Nessuna rete collegata</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Reti collegate">
      {known.map((network) => (
        <li key={network} className="chip" title={accounts?.[network]}>
          {NETWORK_LABELS[network]}
        </li>
      ))}
    </ul>
  );
}
