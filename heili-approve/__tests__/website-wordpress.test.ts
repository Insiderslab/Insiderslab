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
function current_user_can($c) { return $GLOBALS['can'] ?? true; }
function is_admin() { return false; }
function add_settings_error($s, $c, $m) { $GLOBALS['errors'][] = $c; }
function __($s, $d = null) { return $s; }
function esc_url($u) { return htmlspecialchars($u, ENT_QUOTES); }
function esc_attr($u) { return htmlspecialchars($u, ENT_QUOTES); }
if (($argv[3] ?? '') === 'nocap') { $GLOBALS['can'] = false; }
require $argv[1];
$input = json_decode($argv[2], true);
if (($argv[4] ?? '') !== '') { $GLOBALS['options']['heili_approve_review'] = json_decode($argv[4], true); }
if (($argv[5] ?? '') !== 'raw') { $GLOBALS['options']['heili_approve_review'] = heili_approve_sanitize($input); }
foreach ($GLOBALS['actions']['wp_footer'] as $cb) { $cb(); }
echo "\\nERRORS:" . implode(',', $GLOBALS['errors']);
`;

/** `raw`: skip the settings form and print what is stored (a value written by something else than the form). */
function footer(input: Record<string, string>, opts: { can?: boolean; saved?: Record<string, string>; raw?: boolean } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "heili-wp-"));
  const harness = path.join(dir, "harness.php");
  writeFileSync(harness, HARNESS);
  return execFileSync(
    "php",
    [harness, PLUGIN, JSON.stringify(input), opts.can === false ? "nocap" : "", opts.saved ? JSON.stringify(opts.saved) : "", opts.raw ? "raw" : ""],
    { encoding: "utf8" }
  );
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

describe.skipIf(!hasPhp)("WordPress plugin: security", () => {
  it("refuses an address with credentials, a strange host or a wrong port", () => {
    for (const base of ["https://user:pw@approve.heili.cloud", "https://approve.heili.cloud:99999", "https://exa mple.it", "javascript:alert(1)"]) {
      const out = footer({ site_key: KEY, base_url: base });
      expect(out, base).toContain("ERRORS:base_url");
      // The key is kept, the default address is used.
      expect(out).toContain('src="https://approve.heili.cloud/heili-review.js"');
    }
  });

  it("does not change anything without the manage_options capability", () => {
    const out = footer({ site_key: KEY, base_url: "https://evil.example.it" }, { can: false, saved: { site_key: "", base_url: "https://approve.heili.cloud" } });
    expect(out).not.toContain("<script");
  });

  it("never prints a stored key or address that has the wrong shape", () => {
    const evil = { site_key: '"><img src=x onerror=alert(1)>', base_url: "https://approve.heili.cloud" };
    expect(footer({}, { saved: evil, raw: true })).not.toContain("<script");
    // A path with markup in the stored address is cut: only the origin is printed.
    const cut = footer({}, { saved: { site_key: KEY, base_url: 'https://x.example.it/"><script>' }, raw: true });
    expect(cut).toContain('src="https://x.example.it/heili-review.js"');
    expect(cut.match(/<script/g)).toHaveLength(1);
    expect(footer({}, { saved: { site_key: KEY, base_url: "https://approve.heili.cloud" }, raw: true })).toContain(`data-site="${KEY}"`);
  });
});

describe("WordPress plugin: source and files", () => {
  const source = readFileSync(PLUGIN, "utf8");

  it("has the version in the header, the constant and the readme (one number)", () => {
    const header = /^\s*\*\s*Version:\s*(\S+)/m.exec(source)?.[1];
    const constant = /HEILI_APPROVE_VERSION = '([^']+)'/.exec(source)?.[1];
    const readme = readFileSync(path.join(ROOT, "wordpress", "heili-approve-review", "readme.txt"), "utf8");
    const stable = /^Stable tag:\s*(\S+)/m.exec(readme)?.[1];
    expect(header).toMatch(/^\d+\.\d+\.\d+$/);
    expect(constant).toBe(header);
    expect(stable).toBe(header);
    expect(readme).toMatch(new RegExp(`^= ${header!.replace(/\./g, "\\.")} =$`, "m"));
  });

  it("has a standard readme.txt", () => {
    const readme = readFileSync(path.join(ROOT, "wordpress", "heili-approve-review", "readme.txt"), "utf8");
    expect(readme.startsWith("=== Heili Approve")).toBe(true);
    for (const field of ["Requires at least:", "Requires PHP:", "Stable tag:", "License:", "License URI:"]) expect(readme).toContain(field);
    for (const section of ["== Description ==", "== Installation ==", "== Frequently Asked Questions ==", "== Changelog =="]) expect(readme).toContain(section);
    expect(readme).toContain("== External services ==");
  });

  it("checks the capability, uses the Settings API nonce and never reads the request by hand", () => {
    expect(source).toContain("manage_options");
    expect(source).toContain("settings_fields(");
    expect(source).toContain("sanitize_callback");
    expect(source).toMatch(/if \(!defined\('ABSPATH'\)\)/);
    expect(source).not.toMatch(/\$_(POST|GET|REQUEST|COOKIE|SERVER)\b/);
    expect(source).not.toMatch(/wp_remote_|curl_|file_get_contents|eval\(|base64_decode/);
  });

  it("escapes every printed value", () => {
    // Every echo / printf in the plugin goes through an esc_* function (or prints the already escaped tag).
    const echoes = source.split("\n").filter((line) => /\becho\b|\bprintf\(/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    for (const line of echoes) expect(line, line).toMatch(/esc_(attr|html|url)|\$tag/);
  });

  it("removes its option on uninstall, and only that", () => {
    const uninstall = readFileSync(path.join(ROOT, "wordpress", "heili-approve-review", "uninstall.php"), "utf8");
    expect(uninstall).toContain("WP_UNINSTALL_PLUGIN");
    expect(uninstall).toContain("delete_option('heili_approve_review')");
    expect(uninstall.match(/delete_option\(/g)).toHaveLength(1);
  });
});

describe("WordPress plugin zip", () => {
  it("holds the current plugin, readme and uninstall files, nothing else", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(readFileSync(path.join(ROOT, "public", "wordpress", "heili-approve-review.zip")));
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
    expect(names).toEqual(["heili-approve-review/heili-approve-review.php", "heili-approve-review/readme.txt", "heili-approve-review/uninstall.php"]);
    for (const name of names) {
      const inside = await zip.file(name)!.async("string");
      expect(inside, name).toBe(readFileSync(path.join(ROOT, "wordpress", name), "utf8"));
    }
  });
});
