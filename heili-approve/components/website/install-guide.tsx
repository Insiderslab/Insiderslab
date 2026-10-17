"use client";

/**
 * «Dove la metto?»: the line of code (or the WordPress key) and, per
 * platform, three plain steps with a copy button where something has to be
 * pasted. The data is lib/website/install.ts; the longer guide for
 * non-technical people is docs/INSTALLARE-SUL-SITO.md.
 */

import { useId, useRef, useState } from "react";
import { ACTION_LABELS, PLATFORMS, WORDPRESS_PLUGIN_PATH, platformGuide, type InstallAction, type PlatformId } from "@/lib/website/install";

export default function InstallGuide({ snippet, siteKey }: { snippet: string; siteKey: string }) {
  const id = useId();
  const [platform, setPlatform] = useState<PlatformId>("html");
  const [copied, setCopied] = useState<null | "copy-line" | "copy-key">(null);
  const timer = useRef<number | null>(null);
  const guide = platformGuide(platform);

  async function copy(action: "copy-line" | "copy-key") {
    const text = action === "copy-line" ? snippet : siteKey;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(action);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 2500);
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      const field = document.getElementById(action === "copy-line" ? "site-snippet" : "site-key") as HTMLTextAreaElement | HTMLInputElement | null;
      field?.focus();
      field?.select();
      setCopied(null);
    }
  }

  function actionControl(action: InstallAction) {
    if (action === "download-plugin") {
      return (
        <a href={WORDPRESS_PLUGIN_PATH} download className="btn btn-primary btn-sm" data-testid="site-plugin-download">
          {ACTION_LABELS[action].idle}
        </a>
      );
    }
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(action)} data-testid={`site-${action}`}>
        {copied === action ? `${ACTION_LABELS[action].done} ✓` : ACTION_LABELS[action].idle}
      </button>
    );
  }

  const needsLine = guide.steps.some((step) => step.action === "copy-line");
  const needsKey = guide.steps.some((step) => step.action === "copy-key");

  return (
    <div className="space-y-3" data-testid="site-install">
      <div>
        <p id={`${id}-title`} className="text-sm font-medium">
          Dove la metto?
        </p>
        <p className="text-xs text-muted">Scegli come è fatto il sito di prova: ti diciamo i 3 passi.</p>
      </div>
      <div role="tablist" aria-labelledby={`${id}-title`} className="flex flex-wrap gap-2">
        {PLATFORMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${id}-tab-${item.id}`}
            aria-selected={platform === item.id}
            aria-controls={`${id}-panel`}
            onClick={() => setPlatform(item.id)}
            className={`btn btn-sm ${platform === item.id ? "btn-primary" : ""}`}
            data-testid={`site-platform-${item.id}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${platform}`} className="space-y-3 rounded border border-border p-3">
        <p className="text-sm text-muted">{guide.summary}</p>
        <ol className="space-y-3">
          {guide.steps.map((step, index) => (
            <li key={step.text} className="flex gap-3" data-testid="site-step">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm">
                  <span className="sr-only">Passo {index + 1}: </span>
                  {step.text}
                </p>
                {step.action && <div>{actionControl(step.action)}</div>}
              </div>
            </li>
          ))}
        </ol>
        {needsLine && (
          <div className="space-y-1">
            <label htmlFor="site-snippet" className="block text-xs font-medium text-muted">
              La riga da incollare (puoi anche selezionarla a mano)
            </label>
            <textarea
              id="site-snippet"
              readOnly
              rows={4}
              value={snippet}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full resize-none break-all rounded border border-border bg-surface px-3 py-2 font-mono text-base sm:text-xs"
              data-testid="site-snippet"
            />
          </div>
        )}
        {needsKey && (
          <div className="space-y-1">
            <label htmlFor="site-key" className="block text-xs font-medium text-muted">
              La chiave del sito
            </label>
            <input
              id="site-key"
              readOnly
              value={siteKey}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full rounded border border-border bg-surface px-3 py-2 font-mono text-base sm:text-xs"
              data-testid="site-key"
            />
          </div>
        )}
        {guide.note && <p className="rounded bg-surface p-3 text-sm text-muted">{guide.note}</p>}
        <p className="sr-only" role="status" aria-live="polite">
          {copied === "copy-line" ? "Riga copiata" : copied === "copy-key" ? "Chiave copiata" : ""}
        </p>
      </div>
      <p className="text-xs text-muted">
        Per i visitatori la riga non fa nulla: si accende solo quando il cliente apre il sito dal portale. Toglila quando il sito va online.
      </p>
    </div>
  );
}
