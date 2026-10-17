/**
 * Under "Scarica il modello": how pictures are matched (one line, always in
 * view) and what goes in each column (closed until asked). Same text as the
 * template's "Istruzioni" sheet.
 */

import { TEMPLATE_HELP } from "@/lib/post-import/template";

export default function TemplateHelp() {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted" data-testid="import-images-hint">
        <strong className="font-semibold text-foreground">Immagini:</strong> nella colonna «Immagini» scrivi il nome del file
        (per esempio foto-1.jpg), poi trascina qui le foto insieme al foglio: le abbino per nome.
      </p>
      <details className="rounded-xl bg-surface-hover px-4 py-2" data-testid="import-columns-help">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Cosa scrivere in ogni colonna</summary>
        <dl className="space-y-2 pb-2">
          {TEMPLATE_HELP.map(([column, text]) => (
            <div key={column}>
              <dt className="font-semibold">{column}</dt>
              <dd className="text-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
