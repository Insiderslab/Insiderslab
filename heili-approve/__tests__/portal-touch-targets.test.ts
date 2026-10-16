import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(path.join(__dirname, "..", ...parts), "utf8");

/**
 * QA-11: i controlli del portale cliente restano ≥ 44 px su telefono. La misura
 * vera è in e2e/portal-layout.spec.mjs; qui si guardano le classi dei controlli
 * che compaiono solo in certi stati (errore di Heili, commenti con un momento…).
 */
describe("aree toccabili del portale (44 px)", () => {
  it("il link dell'intestazione è alto almeno 44 px", () => {
    expect(read("components", "portal", "portal-header.tsx")).toContain("flex min-h-11 min-w-0 items-center gap-3");
  });

  it("«Riprova» di Heili, il chip del momento, «Mostra nel testo» e il chip delle varianti: min-h-11", () => {
    for (const file of [
      ["components", "review", "assistant-panel.tsx"],
      ["components", "portal", "comment-list.tsx"],
      ["components", "portal", "blog-review.tsx"],
      ["components", "ads", "ad-variant-review.tsx"],
    ]) {
      expect(read(...file), file.join("/")).not.toContain("min-h-9");
    }
    expect(read("components", "review", "assistant-panel.tsx")).toContain("min-h-11 shrink-0 font-medium underline");
  });

  it("le schede delle superfici Google Ads sono da 44 px su telefono, invariate dal desktop", () => {
    expect(read("components", "ads", "google-mockups.tsx")).toContain("min-h-9 shrink-0 rounded-full border px-3 text-[13px] font-medium max-sm:min-h-11");
  });

  it("«altro» dell'anteprima ha un'area di tocco invisibile attorno alla parola", () => {
    const caption = read("components", "post-preview", "caption.tsx");
    expect(caption).toContain("after:absolute");
    expect(caption).toContain("after:-inset-x-3");
    expect(caption).toContain("after:-inset-y-3.5");
  });
});
