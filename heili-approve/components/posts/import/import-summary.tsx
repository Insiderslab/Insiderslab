/** The one-line count of the import bar: ready rows, already imported, rows to fix. */

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default function ImportSummary({
  ready,
  already,
  invalid,
  awaiting,
}: {
  ready: number;
  already: number;
  invalid: number;
  awaiting: boolean;
}) {
  return (
    <p className="text-sm" data-testid="import-summary">
      <span className="font-semibold">{plural(ready, "riga pronta", "righe pronte")}</span>
      {already > 0 && <span className="text-muted"> · {plural(already, "già importata", "già importate")}</span>}
      {invalid > 0 && (
        <span className="text-error">
          {" "}
          · {plural(invalid, "riga da correggere", "righe da correggere")}, {invalid === 1 ? "non verrà importata" : "non verranno importate"}
        </span>
      )}
      {awaiting && <span className="text-muted"> · Controllo le righe…</span>}
    </p>
  );
}
