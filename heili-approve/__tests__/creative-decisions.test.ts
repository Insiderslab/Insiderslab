import { describe, expect, it } from "vitest";
import {
  approvalBlocker,
  buildRejectionMessage,
  decisionInputSchema,
  evaluateCreativeDecisions,
  variantLabel,
} from "../lib/creative-decisions";

const content = {
  variants: [
    { id: "A", name: "Variante A — Prima/dopo" },
    { id: "B", name: "" },
    { id: "C", name: "Variante C — Testimonial" },
  ],
};
const ids = content.variants.map((v) => v.id);

const approve = (variantId: string) => ({ variantId, verdict: "APPROVED" as const, note: null });
const reject = (variantId: string, note: string | null = "Colori troppo spenti") => ({
  variantId,
  verdict: "REJECTED" as const,
  note,
});

describe("evaluateCreativeDecisions (rule 5)", () => {
  it("is incomplete until every variant has a decision", () => {
    const evaluation = evaluateCreativeDecisions(ids, [approve("A"), reject("C")]);
    expect(evaluation).toMatchObject({ outcome: "incomplete", missing: ["B"], approved: ["A"] });
    expect(evaluation.rejected).toEqual([{ variantId: "C", note: "Colori troppo spenti" }]);
  });

  it("approves when complete with at least one approved variant", () => {
    expect(evaluateCreativeDecisions(ids, [approve("A"), reject("B"), reject("C")])).toMatchObject({
      outcome: "approve",
      missing: [],
      approved: ["A"],
    });
    expect(evaluateCreativeDecisions(ids, ids.map(approve)).outcome).toBe("approve");
  });

  it("asks for changes when every variant is discarded", () => {
    expect(evaluateCreativeDecisions(ids, ids.map((id) => reject(id))).outcome).toBe("changes");
  });

  it("ignores decisions on variants that are not in the version", () => {
    expect(evaluateCreativeDecisions(["A"], [reject("A"), approve("Z")])).toMatchObject({
      outcome: "changes",
      approved: [],
    });
  });

  it("never completes a set without variants", () => {
    expect(evaluateCreativeDecisions([], []).outcome).toBe("incomplete");
  });
});

describe("messages", () => {
  it("labels variants by name, falling back to the id", () => {
    expect(variantLabel(content.variants[0], "A")).toBe("Variante A — Prima/dopo");
    expect(variantLabel(content.variants[1], "B")).toBe("Variante B");
    expect(variantLabel(undefined, "Q")).toBe("Variante Q");
  });

  it("explains why a set cannot be approved yet", () => {
    expect(approvalBlocker(evaluateCreativeDecisions(ids, [approve("A")]), content)).toBe(
      "Decidi tutte le varianti prima di inviare: manca Variante B, Variante C — Testimonial"
    );
    expect(approvalBlocker(evaluateCreativeDecisions(ids, ids.map((id) => reject(id))), content)).toMatch(
      /scartato tutte le varianti/
    );
    expect(approvalBlocker(evaluateCreativeDecisions(ids, ids.map(approve)), content)).toBeNull();
    expect(approvalBlocker(evaluateCreativeDecisions([], []), { variants: [] })).toMatch(/non ha varianti/);
  });

  it("builds the change request with every note", () => {
    const evaluation = evaluateCreativeDecisions(ids, [reject("A", "Troppo testo"), reject("B", "CTA debole"), reject("C", null)]);
    expect(buildRejectionMessage(evaluation, content)).toBe(
      [
        "Tutte le varianti sono state scartate.",
        "",
        "- Variante A — Prima/dopo: Troppo testo",
        "- Variante B: CTA debole",
        "- Variante C — Testimonial: scartata senza nota",
      ].join("\n")
    );
  });
});

describe("decision input", () => {
  it("requires a note to discard a variant", () => {
    expect(decisionInputSchema.safeParse({ variantId: "A", verdict: "REJECTED" }).success).toBe(false);
    expect(decisionInputSchema.safeParse({ variantId: "A", verdict: "REJECTED", note: "   " }).success).toBe(false);
    const rejected = decisionInputSchema.safeParse({ variantId: "A", verdict: "REJECTED", note: " Logo piccolo " });
    expect(rejected.success && rejected.data).toEqual({ variantId: "A", verdict: "REJECTED", note: "Logo piccolo" });
  });

  it("accepts an approval with or without a note", () => {
    expect(decisionInputSchema.parse({ variantId: "B", verdict: "APPROVED" })).toEqual({
      variantId: "B",
      verdict: "APPROVED",
      note: null,
    });
    expect(decisionInputSchema.parse({ variantId: "B", verdict: "APPROVED", note: "Perfetta" }).note).toBe("Perfetta");
  });

  it("rejects unknown verdicts and bad ids", () => {
    expect(decisionInputSchema.safeParse({ variantId: "A", verdict: "MAYBE" }).success).toBe(false);
    expect(decisionInputSchema.safeParse({ variantId: "", verdict: "APPROVED" }).success).toBe(false);
    expect(decisionInputSchema.safeParse({ variantId: "x".repeat(65), verdict: "APPROVED" }).success).toBe(false);
  });
});
