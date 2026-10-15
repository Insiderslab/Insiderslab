import { describe, expect, it } from "vitest";
import { requestSchema, rowSchema } from "@/lib/post-import/request-schema";
import { evaluateRow, type FileRef, type RawRow } from "@/lib/post-import/rows";

// `Required<RawRow>`: adding a column to RawRow without a line here fails the type check.
const everyColumn: Required<RawRow> = {
  sourceRow: 2,
  date: "15/10/2026",
  time: "10:30",
  networks: "Instagram",
  text: "Reel della lievitazione",
  firstComment: "",
  title: "",
  images: "reel-novembre.mp4",
  kind: "social_post",
  format: "Reel",
  networkOptions: '{"facebookData":{"type":"STORY"}}',
};

const reel: FileRef = { name: "reel-novembre.mp4", size: 2000, type: "video", mimeType: "video/mp4" };

describe("importer request schema (server actions)", () => {
  it("keeps every column of a sheet row: zod drops unknown keys, so a missing one is silently lost", () => {
    const parsed = rowSchema.parse(everyColumn);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(everyColumn).sort());
    expect(parsed).toEqual(everyColumn);
  });

  it("QA-01: a row with «Formato = Reel» still becomes a Reel after the action's parsing", () => {
    const request = requestSchema.parse({ clientId: "client-1", rows: [everyColumn], files: [reel] });
    const result = evaluateRow(
      { ...request.rows[0], networkOptions: undefined },
      { timeZone: "Europe/Rome", now: new Date("2026-10-10T10:00:00Z"), clientNetworks: ["instagram"], files: request.files }
    );
    expect(result.issues).toEqual([]);
    expect(result.draft?.networkOptions).toEqual({ instagramData: { type: "REEL" } });
  });

  it("limits the length of the «Formato» cell", () => {
    expect(rowSchema.safeParse({ ...everyColumn, format: "x".repeat(501) }).success).toBe(false);
  });
});
