/**
 * What the importer's server actions accept from the browser. Kept out of the
 * "use server" file (which may only export actions) so it can be tested: every
 * column of a sheet row must be listed here, because zod drops unknown keys
 * (that is how «Formato» once vanished and a Reel became a Post).
 */

import { z } from "zod";
import { MAX_IMPORT_ROWS } from "./rows";

const cell = (max: number) => z.string().max(max);

export const rowSchema = z.object({
  sourceRow: z.number().int().min(0).max(1_000_000),
  date: cell(200),
  time: cell(100),
  networks: cell(500),
  text: cell(100_000),
  firstComment: cell(20_000),
  title: cell(1000),
  images: cell(5000),
  kind: cell(100).optional(),
  /** «Formato» column: "Post", "Reel", "Storia" or "Rete: Formato". */
  format: cell(500).optional(),
  networkOptions: cell(5000).optional(),
});

const fileSchema = z.object({
  name: z.string().min(1).max(500),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  type: z.enum(["image", "video"]),
  mimeType: z.string().min(1).max(100),
});

export const requestSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  rows: z.array(rowSchema).min(1, "Non ci sono righe da importare").max(MAX_IMPORT_ROWS, `Puoi importare al massimo ${MAX_IMPORT_ROWS} righe alla volta`),
  files: z.array(fileSchema).max(1000),
});
