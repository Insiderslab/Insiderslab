import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { portalWording } from "@/components/portal/helpers";
import { ReviewNav } from "@/components/portal/review-pieces";

const wording = portalWording(["SOCIAL_POST"]);

function html(queue: { nextPostId: string | null; toReviewCount: number; position: number | null }) {
  return renderToStaticMarkup(
    createElement(ReviewNav, { homeHref: "/review/t", nextHref: "/review/t/posts/p2", queue, wording, showProgress: true })
  );
}

/**
 * QA-18: la riga «Elenco · n/m · Successivo» ha la stessa griglia con o senza
 * contatore. Senza contatore (post con modifiche già chieste) «Successivo» finiva
 * nella colonna di mezzo, accanto a «Elenco».
 */
describe("riga di navigazione del post", () => {
  it("ogni elemento ha la sua colonna: Elenco 1, contatore 2, Successivo 3", () => {
    const withCounter = html({ nextPostId: "p2", toReviewCount: 7, position: 1 });
    expect(withCounter).toMatch(/class="col-start-1 /);
    expect(withCounter).toContain('class="col-start-2 text-center text-muted"');
    expect(withCounter).toMatch(/class="col-start-3 [^"]*"/);
  });

  it("senza contatore «Successivo» resta nella terza colonna", () => {
    const withoutCounter = html({ nextPostId: "p2", toReviewCount: 7, position: null });
    expect(withoutCounter).not.toContain("col-start-2");
    expect(withoutCounter).toMatch(/class="col-start-1 /);
    expect(withoutCounter).toMatch(/<a[^>]*class="col-start-3 [^"]*"[^>]*>/);
  });
});
