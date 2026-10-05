"use client";

/**
 * NetworkPreviewTabs — one tab per selected network, each showing the
 * PostPreview in the format chosen in `networkOptions` ("<network>Data".type).
 *
 * Tabs follow the WAI-ARIA pattern (← → Home End move between tabs). The
 * selection is internal unless `activeNetwork` is given; switching tab
 * remounts the preview, so a playing video stops.
 */

import { useId, useState, type KeyboardEvent } from "react";
import { NETWORK_LABELS, type Network } from "@/lib/domain";
import { formatFromOptions, formatLabel } from "./helpers";
import PostPreview from "./post-preview";
import type { PostPreviewProps } from "./types";

export interface NetworkPreviewTabsProps extends Omit<PostPreviewProps, "network" | "format"> {
  networks: Network[];
  /**
   * Post.networkOptions ({ "<network>Data": { type } }, see NetworkOptions).
   * Typed loosely so Prisma's Json value can be passed as-is.
   */
  networkOptions?: unknown;
  /** Controlled selection; omit to let the tabs manage it. */
  activeNetwork?: Network;
  onNetworkChange?: (network: Network) => void;
}

export default function NetworkPreviewTabs({
  networks,
  networkOptions,
  activeNetwork,
  onNetworkChange,
  className = "",
  ...previewProps
}: NetworkPreviewTabsProps) {
  const baseId = useId();
  const [selected, setSelected] = useState<Network | null>(null);

  const wanted = activeNetwork ?? selected;
  const current = wanted && networks.includes(wanted) ? wanted : networks[0];

  function select(network: Network) {
    setSelected(network);
    onNetworkChange?.(network);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const i = networks.indexOf(current);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (i + 1) % networks.length;
    else if (event.key === "ArrowLeft") next = (i - 1 + networks.length) % networks.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = networks.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(networks[next]);
    document.getElementById(`${baseId}-tab-${networks[next]}`)?.focus();
  }

  if (!current) {
    return (
      <div className={`rounded border border-border bg-surface p-4 text-sm text-muted ${className}`}>
        Nessuna rete selezionata: scegli almeno una rete per vedere l&apos;anteprima.
      </div>
    );
  }

  const tabLabel = (network: Network) => {
    const format = formatLabel(network, formatFromOptions(network, networkOptions));
    return format ? `${NETWORK_LABELS[network]} · ${format}` : NETWORK_LABELS[network];
  };

  return (
    <div className={`w-full min-w-0 ${className}`}>
      {networks.length > 1 ? (
        <div
          role="tablist"
          aria-label="Anteprima per rete"
          onKeyDown={onKeyDown}
          className="mb-3 flex gap-1 overflow-x-auto border-b border-border"
        >
          {networks.map((network) => {
            const active = network === current;
            return (
              <button
                key={network}
                id={`${baseId}-tab-${network}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${baseId}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => select(network)}
                className={`-mb-px min-h-11 shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${
                  active
                    ? "border-accent font-medium text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tabLabel(network)}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mb-3 text-sm font-medium text-muted">{tabLabel(current)}</p>
      )}

      <div
        id={`${baseId}-panel`}
        role={networks.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={networks.length > 1 ? `${baseId}-tab-${current}` : undefined}
      >
        <PostPreview
          key={current}
          {...previewProps}
          network={current}
          format={formatFromOptions(current, networkOptions)}
        />
      </div>
    </div>
  );
}

export { NetworkPreviewTabs };
