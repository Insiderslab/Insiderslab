#!/usr/bin/env node
// Builds the «Sul sito» review script (docs/SITO-WEB.md):
//   site-script/src/main.ts → public/heili-review.js and public/heili-review.v1.js
// One minified IIFE, no libraries. Fails when the budget is exceeded
// (12 KB minified, 5 KB gzip). `--check` builds in memory and only compares
// with the committed files (used by the unit test).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 12 * 1024;
const MAX_GZIP = 5 * 1024;
const BANNER =
  "/*! heili-review.js v1 · Approve by Heili · revisione «Sul sito» (docs/SITO-WEB.md). Inerte senza #heili-review=: nessuna richiesta, nessun cookie, nessun valore dei campi. */";

export async function buildSiteScript() {
  const result = await build({
    entryPoints: [path.join(root, "site-script/src/main.ts")],
    bundle: true,
    format: "iife",
    minify: true,
    target: ["es2019"],
    write: false,
    legalComments: "none",
    banner: { js: BANNER },
  });
  const code = result.outputFiles[0].text;
  const bytes = Buffer.byteLength(code);
  const gzip = gzipSync(code).length;
  return { code, bytes, gzip };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { code, bytes, gzip } = await buildSiteScript();
  if (bytes > MAX_BYTES || gzip > MAX_GZIP) {
    console.error(`heili-review.js fuori budget: ${bytes} byte (max ${MAX_BYTES}), gzip ${gzip} (max ${MAX_GZIP})`);
    process.exit(1);
  }
  const targets = ["public/heili-review.js", "public/heili-review.v1.js"].map((p) => path.join(root, p));
  if (process.argv.includes("--check")) {
    const stale = targets.filter((target) => {
      try {
        return readFileSync(target, "utf8") !== code;
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error("public/heili-review*.js non è aggiornato: esegui npm run build:site-script");
      process.exit(1);
    }
  } else {
    for (const target of targets) writeFileSync(target, code);
  }
  console.log(`heili-review.js: ${bytes} byte, gzip ${gzip} byte`);
}
