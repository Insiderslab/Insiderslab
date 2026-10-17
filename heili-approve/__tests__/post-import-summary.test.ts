import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImportSummary, { importSummaryLine } from "@/components/posts/import/import-summary";

const text = (props: { ready?: number; already?: number; invalid?: number; awaiting?: boolean }) =>
  renderToStaticMarkup(createElement(ImportSummary, { ready: 0, already: 0, invalid: 0, awaiting: false, ...props }))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("import bar summary (QA-07)", () => {
  it("agrees «non verrà / non verranno importate» with the number of rows to fix", () => {
    expect(text({ ready: 5, invalid: 1 })).toBe("5 righe pronte · 1 riga da correggere, non verrà importata");
    expect(text({ ready: 5, invalid: 8 })).toBe("5 righe pronte · 8 righe da correggere, non verranno importate");
  });

  it("keeps singular and plural of the other counts", () => {
    expect(text({ ready: 1, already: 1 })).toBe("1 riga pronta · 1 già importata");
    expect(text({ ready: 0, already: 3, awaiting: true })).toBe("0 righe pronte · 3 già importate · Controllo le righe…");
  });
});

describe("result line after the import", () => {
  it("says what was created and what is left to fix", () => {
    expect(importSummaryLine({ created: 12, existing: 0, failed: 2 })).toBe("12 bozze create · 2 da sistemare");
    expect(importSummaryLine({ created: 1, existing: 3, failed: 0 })).toBe("1 bozza creata · 3 già presenti");
    expect(importSummaryLine({ created: 0, existing: 1, failed: 1 })).toBe("0 bozze create · 1 da sistemare · 1 già presente");
  });
});
