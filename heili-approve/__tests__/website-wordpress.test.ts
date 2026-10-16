import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findReviewTags } from "../lib/website/verify";

const ROOT = path.join(__dirname, "..");
const PLUGIN = path.join(ROOT, "wordpress", "heili-approve-review", "heili-approve-review.php");
const KEY = "hs_abcdefghijklmnopqrstuv";
const hasPhp = spawnSync("php", ["-v"]).status === 0;

// Minimal WordPress stubs: enough to load the plugin, save options and print the footer.
const HARNESS = `<?php
define('ABSPATH', __DIR__);
$GLOBALS['actions'] = []; $GLOBALS['options'] = []; $GLOBALS['errors'] = [];
function add_action($h, $cb, $p = 10) { $GLOBALS['actions'][$h][] = $cb; }
function add_filter($h, $cb, $p = 10) {}
function register_uninstall_hook($f, $cb) {}
function plugin_basename($f) { return 'heili-approve-review/heili-approve-review.php'; }
function get_option($k) { return $GLOBALS['options'][$k] ?? false; }
function wp_parse_args($a, $d) { return array_merge($d, $a); }
function wp_parse_url($u) { return parse_url($u); }
function sanitize_text_field($s) { return trim(strip_tags((string) $s)); }
function wp_unslash($s) { return $s; }
function add_settings_error($s, $c, $m) { $GLOBALS['errors'][] = $c; }
function __($s, $d = null) { return $s; }
function esc_url($u) { return htmlspecialchars($u, ENT_QUOTES); }
function esc_attr($u) { return htmlspecialchars($u, ENT_QUOTES); }
require $argv[1];
$input = json_decode($argv[2], true);
$GLOBALS['options']['heili_approve_review'] = heili_approve_sanitize($input);
foreach ($GLOBALS['actions']['wp_footer'] as $cb) { $cb(); }
echo "\\nERRORS:" . implode(',', $GLOBALS['errors']);
`;

function footer(input: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "heili-wp-"));
  const harness = path.join(dir, "harness.php");
  writeFileSync(harness, HARNESS);
  return execFileSync("php", [harness, PLUGIN, JSON.stringify(input)], { encoding: "utf8" });
}

describe.skipIf(!hasPhp)("WordPress plugin", () => {
  it("prints the review tag with the key, which «Verifica installazione» recognises", () => {
    const out = footer({ site_key: KEY, base_url: "https://approve.heili.cloud/qualcosa" });
    expect(out).toContain(`<script src="https://approve.heili.cloud/heili-review.js" data-site="${KEY}"`);
    expect(out).toContain(" defer></script>");
    expect(findReviewTags(out)).toEqual([KEY]);
    expect(out).toContain("ERRORS:");
  });

  it("prints nothing without a valid key and refuses http:// on a public host", () => {
    expect(footer({ site_key: "", base_url: "https://approve.heili.cloud" })).not.toContain("<script");
    const bad = footer({ site_key: '"><script>alert(1)</script>', base_url: "http://approve.example.it" });
    expect(bad).not.toContain("<script");
    expect(bad).toContain("ERRORS:site_key,base_url");
    expect(footer({ site_key: KEY, base_url: "http://localhost:3301" })).toContain('src="http://localhost:3301/heili-review.js"');
  });
});

describe("WordPress plugin zip", () => {
  it("is the current plugin file", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(readFileSync(path.join(ROOT, "public", "wordpress", "heili-approve-review.zip")));
    const inside = await zip.file("heili-approve-review/heili-approve-review.php")!.async("string");
    expect(inside).toBe(readFileSync(PLUGIN, "utf8"));
  });
});
