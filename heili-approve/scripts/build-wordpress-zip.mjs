#!/usr/bin/env node
// Packs the WordPress plugin (wordpress/heili-approve-review/: the plugin file,
// readme.txt and uninstall.php) into
// public/wordpress/heili-approve-review.zip, downloadable from the agency's
// «Sul sito» panel. Deterministic (fixed dates) so the committed zip only
// changes when the plugin does.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["heili-approve-review.php", "readme.txt", "uninstall.php"].map((name) => `heili-approve-review/${name}`);
const FIXED_DATE = new Date("2026-10-17T00:00:00Z");

export async function buildWordpressZip() {
  const zip = new JSZip();
  zip.file("heili-approve-review/", null, { dir: true, date: FIXED_DATE });
  for (const file of FILES) zip.file(file, readFileSync(path.join(root, "wordpress", file)), { date: FIXED_DATE });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const buffer = await buildWordpressZip();
  const target = path.join(root, "public", "wordpress", "heili-approve-review.zip");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  console.log(`heili-approve-review.zip: ${buffer.length} byte`);
}
