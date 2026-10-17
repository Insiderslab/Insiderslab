import { describe, expect, it } from "vitest";
import { batchProgressLabel, mergeImportResults, mergePlans } from "@/lib/post-import/batches";
import { MAX_IMPORT_ROWS, evaluateRow, importBatches, sheetDuplicates, type RawRow } from "@/lib/post-import/rows";
import { importKeys, type ImportResult } from "@/lib/post-import/service";

const NOW = new Date("2026-10-10T10:00:00Z");
const ctx = { timeZone: "Europe/Rome", now: NOW, clientNetworks: ["facebook"], files: [] };
const row = (n: number, text = `Post ${n}`): RawRow => ({
  sourceRow: n + 1, date: "15/10/2026", time: "10:30", networks: "Facebook", text, firstComment: "", title: "", images: "",
});

describe("long sheets in batches (QA-11)", () => {
  it("splits 450 rows into batches the server accepts, in order", () => {
    const rows = Array.from({ length: 450 }, (_, i) => i);
    const batches = importBatches(rows);
    expect(batches.map((b) => b.length)).toEqual([MAX_IMPORT_ROWS, MAX_IMPORT_ROWS, 50]);
    expect(batches.flat()).toEqual(rows);
    expect(importBatches([])).toEqual([]);
  });

  it("finds identical rows across the whole sheet, even in different batches", () => {
    const rows = Array.from({ length: 450 }, (_, i) => row(i));
    rows[420] = row(420, "Post 3"); // same as row 3, in the third batch
    const drafts = rows.map((r) => evaluateRow(r, ctx).draft);
    const dups = sheetDuplicates("client-1", drafts);
    expect(dups[420]).toBe(3);
    expect(dups.filter((d) => d !== null)).toHaveLength(1);
    // An invalid row (no draft) is never a duplicate.
    expect(sheetDuplicates("client-1", [null, null])).toEqual([null, null]);
  });

  it("gives a row the same import key whatever batch it travels in, so a retried batch is recognised", () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(i));
    const drafts = rows.map((r) => evaluateRow(r, ctx).draft);
    const whole = importKeys("client-1", drafts);
    const inBatches = importBatches(drafts).flatMap((batch) => importKeys("client-1", batch));
    expect(inBatches).toEqual(whole);
    expect(new Set(whole).size).toBe(250);
  });

  it("merges the batches' answers on the whole list", () => {
    const a: ImportResult = {
      outcomes: [
        { index: 0, status: "created", postId: "p1", title: "A" },
        { index: 1, status: "failed", error: "x" },
      ],
      created: 1, existing: 0, failed: 1,
      plan: { status: "ok", id: "plan", title: "Piano", month: "2026-10", created: true },
    };
    const b: ImportResult = {
      outcomes: [{ index: 0, status: "existing", postId: "p3", title: "C" }],
      created: 0, existing: 1, failed: 0,
      plan: { status: "ok", id: "plan", title: "Piano", month: "2026-10", created: false },
    };
    const merged = mergeImportResults([{ offset: 0, result: a }, { offset: 2, result: b }]);
    expect(merged.outcomes.map((o) => o.index)).toEqual([0, 1, 2]);
    expect(merged).toMatchObject({ created: 1, existing: 1, failed: 1 });
    expect(merged.plan).toEqual({ status: "ok", id: "plan", title: "Piano", month: "2026-10", created: true });
  });

  it("reports a plan error only when no batch used the plan", () => {
    expect(mergePlans([null, null])).toBeNull();
    expect(mergePlans([{ status: "error", message: "no" }, null])).toEqual({ status: "error", message: "no" });
    expect(mergePlans([{ status: "error", message: "no" }, { status: "ok", id: "p", title: "T", month: "2026-10", created: false }])).toMatchObject({ status: "ok" });
  });

  it("labels the progress", () => {
    expect(batchProgressLabel(200, 500)).toBe("Creo le bozze: 200 di 500…");
  });
});
