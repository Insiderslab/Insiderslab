import { describe, expect, it } from "vitest";
import { UNDO_SAFETY_MS, UNDO_TOAST_MS, UNDO_WINDOW_MS, undoToastDurationMs } from "@/lib/undo-rules";

describe("undoToastDurationMs", () => {
  it("keeps the usual 10 seconds when the approval answered quickly", () => {
    expect(undoToastDurationMs(0)).toBe(UNDO_TOAST_MS);
    expect(undoToastDurationMs(800)).toBe(UNDO_TOAST_MS);
    expect(undoToastDurationMs(UNDO_WINDOW_MS - UNDO_TOAST_MS - UNDO_SAFETY_MS)).toBe(UNDO_TOAST_MS);
  });

  it("shortens the toast under load so «Annulla» never outlives the server window", () => {
    // Measured on 2026-10-16: «Approva» answered in 6.2 s, «Annulla» at 9.8 s was «Troppo tardi».
    const duration = undoToastDurationMs(6_200);
    expect(duration).toBe(UNDO_WINDOW_MS - 6_200 - UNDO_SAFETY_MS);
    expect(6_200 + duration + UNDO_SAFETY_MS).toBeLessThanOrEqual(UNDO_WINDOW_MS);
  });

  it("offers no toast when there is no time left, and ignores a clock going backwards", () => {
    expect(undoToastDurationMs(12_000)).toBe(0);
    expect(undoToastDurationMs(60_000)).toBe(0);
    expect(undoToastDurationMs(-5_000)).toBe(UNDO_TOAST_MS);
  });
});
