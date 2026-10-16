"use client";

/**
 * The line of code to paste on the test site, with «Copia» and short
 * instructions per platform (HTML / Next / Webflow / Shopify, the WordPress
 * plugin, Google Tag Manager). The full guide for non-technical people is
 * docs/INSTALLARE-SUL-SITO.md.
 */

import { useState } from "react";

export default function InstallSnippet({ snippet, siteKey }: { snippet: string; siteKey: string }) {
  const [copied, setCopied] = useState<null | "line" | "key">(null);

  async function copy(text: string, what: "line" | "key", id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      const field = document.getElementById(id) as HTMLTextAreaElement | HTMLInputElement | null;
      field?.select();
    }
  }

  return (
    <div className="space-y-3">
      <label htmlFor="site-snippet" className="block text-sm font-medium">
        Riga di codice da incollare nel sito di prova
      </label>
      <textarea
        id="site-snippet"
        readOnly
        rows={2}
        value={snippet}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full resize-none rounded border border-border bg-surface px-3 py-2 font-mono text-xs"
        data-testid="site-snippet"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(snippet, "line", "site-snippet")}>
          {copied === "line" ? "Copiata" : "Copia la riga"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => copy(siteKey, "key", "site-key")}>
          {copied === "key" ? "Chiave copiata" : "Copia solo la chiave"}
        </button>
        <input id="site-key" readOnly value={siteKey} className="sr-only" aria-label="Chiave del sito" />
      </div>
      <details className="rounded border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Come si installa</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
          <li>
            <strong className="text-foreground">Sito HTML, Next.js, Webflow, Shopify:</strong> incolla la riga prima di
            &lt;/body&gt; (Webflow: Impostazioni del sito → Codice personalizzato → Footer; Shopify: tema → Modifica
            codice → theme.liquid).
          </li>
          <li>
            <strong className="text-foreground">WordPress:</strong>{" "}
            <a href="/wordpress/heili-approve-review.zip" className="text-accent underline" download>
              scarica il plugin
            </a>
            , installalo da Plugin → Aggiungi nuovo → Carica, poi incolla la chiave in Impostazioni → Heili Approve.
          </li>
          <li>
            <strong className="text-foreground">Google Tag Manager:</strong> nuovo tag «HTML personalizzato» con la riga,
            attivatore «All Pages», poi Pubblica.
          </li>
          <li>
            Per i visitatori lo script non fa nulla: si attiva solo quando il cliente apre il sito dal portale. Toglilo
            quando il sito va online.
          </li>
        </ul>
      </details>
    </div>
  );
}
