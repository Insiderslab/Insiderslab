import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImportRow, { type EditableRow } from "@/components/posts/import/import-row";
import { evaluateRow, type FileRef } from "@/lib/post-import/rows";

const NOW = new Date("2026-10-10T10:00:00Z");
const reel: FileRef = { name: "reel.mp4", size: 2000, type: "video", mimeType: "video/mp4" };

function render(patch: Partial<EditableRow>) {
  const row: EditableRow = {
    id: 1, sourceRow: 2, date: "15/10/2026", time: "10:30", networks: "Instagram", text: "Il reel", firstComment: "",
    title: "", images: "reel.mp4", ...patch,
  };
  const evaluation = evaluateRow(row, { timeZone: "Europe/Rome", now: NOW, clientNetworks: ["instagram", "facebook"], files: [reel] });
  return renderToStaticMarkup(
    createElement(ImportRow, {
      row, evaluation, extraIssues: [], existing: false, checking: false, files: new Map(), disabled: false,
      zone: "Europe/Rome", onChange: () => {}, onRemove: () => {},
    })
  );
}

describe("ImportRow «Formato» cell", () => {
  it("has a labelled menu with Post, Reel and Storia, and the value read", () => {
    const html = render({ format: "Reel" });
    expect(html).toContain('for="import-row-1-format"');
    expect(html).toMatch(/<select[^>]*id="import-row-1-format"/);
    for (const word of ["Predefinito (Post)", ">Post<", ">Reel<", ">Storia<"]) expect(html).toContain(word);
    expect(html).toMatch(/<option value="Reel" selected="">Reel<\/option>/);
    expect(html).toContain("Instagram: Reel");
    expect(html).not.toContain("aria-invalid");
  });

  it("keeps a format the menu does not know selectable and marks the cell red until it is changed", () => {
    const html = render({ format: "Video" });
    expect(html).toMatch(/<option value="Video" selected="">«Video»<\/option>/);
    expect(html).toMatch(/<select[^>]*aria-invalid="true"[^>]*id="import-row-1-format"|<select[^>]*id="import-row-1-format"[^>]*aria-invalid="true"/);
    expect(html).toContain("Formato non riconosciuto: «Video»");
    expect(html).toContain("Da correggere");
  });

  it("shows the blank cell as the default", () => {
    expect(render({})).toMatch(/<option value="" selected="">Predefinito \(Post\)<\/option>/);
  });
});

describe("ImportRow as a focus target (QA-02)", () => {
  it("can be focused by script and is named by its row number, with the reasons as its description", () => {
    const html = render({ date: "01/01/2020" });
    const li = html.match(/<li[^>]*data-testid="import-row"[^>]*>|<li[^>]*id="import-row-1"[^>]*>/)?.[0] ?? "";
    expect(li).toContain('tabindex="-1"');
    expect(li).toContain('aria-labelledby="import-row-1-name"');
    expect(li).toContain('aria-describedby="import-row-1-issues"');
    expect(html).toContain('id="import-row-1-name"');
    expect(html).toContain('id="import-row-1-issues"');
    expect(li).toContain("scroll-mt-3");
  });

  it("has no description when the row is fine", () => {
    expect(render({})).not.toContain("aria-describedby");
  });
});
