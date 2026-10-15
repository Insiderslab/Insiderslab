import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decisionButtonClass, hasDecisionFeedback, primaryDecision } from "@/components/portal/decision";

/**
 * U-04: a 390 px i pulsanti della barra delle decisioni restano su una riga,
 * con testo 16 px e altezza 48 px.
 *
 * D1: quale dei due è il principale dipende dal feedback. «Approva» (ads:
 * «Invia le mie decisioni») finché il cliente non ha lasciato feedback sulla
 * versione che vede; appena ce n'è, il principale è «Chiedi modifiche». Cambia
 * solo l'evidenza visiva: ordine, azioni e conferme restano.
 */
describe("barra delle decisioni su telefono", () => {
  const files = ["post-review.tsx", "blog-review.tsx", "ads-review.tsx"].map((name) => ({
    name,
    source: readFileSync(path.join(__dirname, "..", "components", "portal", name), "utf8"),
  }));
  const barOf = (source: string) => source.slice(source.indexOf("<DecisionBar>"), source.indexOf("</DecisionBar>"));

  it("ogni pulsante: 48 px, 16 px e niente ritorno a capo, in entrambi gli stati", () => {
    for (const primary of [true, false]) {
      for (const width of ["flex", "natural"] as const) {
        const classes = decisionButtonClass(primary, width);
        expect(classes).toContain("min-h-12");
        expect(classes).toContain("text-base");
        expect(classes).toContain("whitespace-nowrap");
      }
    }
  });

  it("le tre pagine disegnano i due pulsanti con lo stesso helper", () => {
    for (const { name, source } of files) {
      const bar = barOf(source);
      expect(bar.match(/decisionButtonClass\(/g)?.length, name).toBe(2);
      expect(bar, name).toContain('data-testid="decision-changes"');
      expect(bar, name).toContain('data-testid="decision-approve"');
      // Nessuna classe di colore scritta a mano: il principale lo decide la regola.
      expect(bar, name).not.toContain("bg-accent");
    }
  });

  it("la riga usa un gap stretto e lascia respirare il pulsante lungo", () => {
    const ads = files.find((file) => file.name === "ads-review.tsx")!.source;
    // Il pulsante lungo («Invia le mie decisioni») può restare della sua larghezza: nessun ritorno a capo.
    expect(barOf(ads)).toContain('decisionButtonClass(primary === "approve", "natural")');
    expect(decisionButtonClass(true, "natural")).toContain("shrink-0");
    expect(decisionButtonClass(true, "flex")).toContain("flex-1");
    expect(barOf(ads)).toContain('<div className="flex gap-2">');
  });

  it("l'ordine non cambia: «Chiedi modifiche» prima, «Approva» dopo", () => {
    for (const { name, source } of files) {
      const bar = barOf(source);
      expect(bar.indexOf("decision-changes"), name).toBeLessThan(bar.indexOf("decision-approve"));
    }
  });
});

describe("pulsante principale (D1)", () => {
  const none = { savedComments: 0, hasDraft: false, heiliPending: false };

  it("senza feedback il principale è «Approva»", () => {
    expect(primaryDecision({ hasFeedback: hasDecisionFeedback(none) })).toBe("approve");
  });

  it("un commento salvato sulla versione rende principale «Chiedi modifiche»", () => {
    expect(primaryDecision({ hasFeedback: hasDecisionFeedback({ ...none, savedComments: 1 }) })).toBe("changes");
    expect(primaryDecision({ hasFeedback: hasDecisionFeedback({ ...none, savedComments: 4 }) })).toBe("changes");
  });

  it("una bozza di commento con testo non ancora inviata conta come feedback", () => {
    expect(primaryDecision({ hasFeedback: hasDecisionFeedback({ ...none, hasDraft: true }) })).toBe("changes");
  });

  it("il feedback di Heili che «Chiedi modifiche» invierebbe conta come feedback", () => {
    expect(primaryDecision({ hasFeedback: hasDecisionFeedback({ ...none, heiliPending: true }) })).toBe("changes");
  });

  it("torna «Approva» quando il feedback sparisce (commento risolto, bozza svuotata)", () => {
    const withFeedback = hasDecisionFeedback({ ...none, savedComments: 1, hasDraft: true });
    expect(primaryDecision({ hasFeedback: withFeedback })).toBe("changes");
    expect(primaryDecision({ hasFeedback: hasDecisionFeedback(none) })).toBe("approve");
  });

  it("il primario e il secondario si distinguono, e solo uno dei due è pieno", () => {
    const primary = decisionButtonClass(true);
    const secondary = decisionButtonClass(false);
    expect(primary).toContain("bg-accent");
    expect(primary).toContain("text-white");
    expect(secondary).not.toContain("bg-accent");
    expect(secondary).toContain("bg-background");
  });

  it("le pagine ricavano il feedback da commenti salvati, bozza e Heili", () => {
    for (const name of ["post-review.tsx", "blog-review.tsx", "ads-review.tsx"]) {
      const source = readFileSync(path.join(__dirname, "..", "components", "portal", name), "utf8");
      expect(source, name).toContain("savedComments: myOpenComments");
      expect(source, name).toContain("hasDraft: commentDirty");
      expect(source, name).toContain("heiliPending: heili.pendingFeedback");
    }
  });
});
