import { describe, expect, it } from "vitest";
import { messageLooksLong } from "@/components/portal/helpers";

/** Portal simplification of 17/10/2026 (docs/notte/PORTALE-2026-10-17.md). */

describe("K-09: the agency's message of a plan in four lines", () => {
  it("offers «Leggi tutto» only when the message is long", () => {
    expect(messageLooksLong("Ecco il piano di novembre. Buona revisione!")).toBe(false);
    expect(messageLooksLong("uno\ndue\ntre\nquattro")).toBe(false);
    expect(messageLooksLong("uno\ndue\ntre\nquattro\ncinque")).toBe(true);
    expect(messageLooksLong("parola ".repeat(40))).toBe(true);
    // Trailing blank lines do not count.
    expect(messageLooksLong("uno\ndue\n\n\n\n")).toBe(false);
  });
});
