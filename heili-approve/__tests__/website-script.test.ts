// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanUrl, findElement, headingOf, pickTarget, selectorOf, textOf } from "../site-script/src/picker";

const ROOT = path.join(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "site-script", "src");
const BUILT = readFileSync(path.join(ROOT, "public", "heili-review.js"), "utf8");
const KEY = "hs_abcdefghijklmnopqrstuv";

describe("source rules of heili-review.js", () => {
  const sources = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(path.join(SOURCE_DIR, f), "utf8") }));

  it.each([
    ["cookies", /document\.cookie/],
    ["localStorage", /localStorage/],
    ["field values", /\.value\b|\.checked\b|\.selectedIndex\b/],
    ["page HTML", /innerHTML|outerHTML|insertAdjacentHTML/],
    ["eval", /\beval\(|new Function/],
    ["network", /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/],
    ["any-origin postMessage", /postMessage\([^)]*["']\*["']/],
  ])("never uses %s", (_name, pattern) => {
    for (const { file, text } of sources) expect(pattern.test(text), `${file}`).toBe(false);
  });

  it("stays within the budget (12 KB minified, 5 KB gzip) and the committed file is the current build", async () => {
    expect(Buffer.byteLength(BUILT)).toBeLessThanOrEqual(12 * 1024);
    expect(gzipSync(BUILT).length).toBeLessThanOrEqual(5 * 1024);
    const { buildSiteScript } = await import("../scripts/build-site-script.mjs");
    const { code } = await buildSiteScript();
    expect(code).toBe(BUILT);
    expect(readFileSync(path.join(ROOT, "public", "heili-review.v1.js"), "utf8")).toBe(BUILT);
  });
});

describe("picker", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header><nav><a href="/">Home</a><a href="/chi-siamo" aria-label="Chi siamo">Chi siamo</a></nav></header>
      <main>
        <section id="hero"><h1>Scopri la collezione</h1><p>Testo <strong>forte</strong></p></section>
        <section class="css-1x2y3z4"><h2>Contatti</h2>
          <form id="form-a1b2c3d4e5"><label>Codice <input name="code" value="SEGRETO-123"></label>
          <input type="password" value="SEGRETO-123"><textarea>SEGRETO-123</textarea>
          <select><option selected>SEGRETO-123</option></select>
          <button data-testid="send">Invia</button></form>
        </section>
        <p data-heili-ignore>Nascosto SEGRETO-123</p>
      </main>`;
  });

  it("builds stable selectors that find the same element", () => {
    const h1 = document.querySelector("h1")!;
    const selector = selectorOf(h1);
    expect(document.querySelector(selector)).toBe(h1);
    expect(selector).toContain("#hero");
    expect(selectorOf(document.querySelector("button")!)).toBe('[data-testid="send"]');
    expect(selectorOf(document.querySelector('a[aria-label]')!)).toBe('a[aria-label="Chi siamo"]');
    expect(selectorOf(document.querySelector("#hero")!)).toBe("#hero");
    // Hash-like ids and classes are never used.
    const form = selectorOf(document.querySelector("form")!);
    expect(form).not.toContain("a1b2c3d4e5");
    expect(form).not.toContain("css-1x2y3z4");
    expect(document.querySelector(form)).toBe(document.querySelector("form"));
  });

  it("reads visible text, never the values of fields", () => {
    expect(textOf(document.querySelector("#hero")!)).toBe("Scopri la collezione Testo forte");
    const form = textOf(document.querySelector("form")!);
    expect(form).toContain("Codice");
    expect(form).not.toContain("SEGRETO-123");
    expect(textOf(document.querySelector("main")!)).not.toContain("SEGRETO-123");
    expect(textOf(document.querySelector("textarea")!)).toBe("");
  });

  it("turns a field into its container", () => {
    const password = document.querySelector('input[type="password"]')!;
    const picked = pickTarget(password);
    expect(picked.field).toBe(true);
    expect(picked.el.tagName).toBe("FORM");
    expect(pickTarget(document.querySelector("input[name=code]")!).el.tagName).toBe("LABEL");
    expect(pickTarget(document.querySelector("h1")!)).toEqual({ el: document.querySelector("h1"), field: false });
  });

  it("finds the heading of a section and the element again", () => {
    expect(headingOf(document.querySelector("form")!)).toBe("Contatti");
    expect(findElement(selectorOf(document.querySelector("h1")!), "Scopri la collezione").method).toBe("selector");
    expect(findElement("main > h9", "Scopri la collezione")).toMatchObject({ method: "text", el: document.querySelector("h1") });
    expect(findElement("main > h9", "Non esiste").method).toBe("scroll");
  });

  it("cleans the page address", () => {
    expect(cleanUrl("https://prova.esempio.it/p?utm_source=a&token=b&ok=1#heili-review=xyz")).toBe("https://prova.esempio.it/p?ok=1");
  });
});

describe("the built script", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    sessionStorage.clear();
    history.replaceState(null, "", "/");
  });

  function run() {
    const script = document.createElement("script");
    script.setAttribute("src", "https://approve.example.test/heili-review.js");
    script.setAttribute("data-site", KEY);
    document.head.append(script);
    // Test-only execution of the committed bundle.
    new Function(BUILT)();
  }

  it("is inert without the fragment: no DOM, no flag, no request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    run();
    expect(document.querySelector("heili-review-root")).toBeNull();
    expect(sessionStorage.getItem("heili-review")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("with a code: removes the fragment, sets the tab flag and hosts the iframe", () => {
    history.replaceState(null, "", "/chi-siamo?x=1#heili-review=ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    run();
    expect(location.hash).toBe("");
    expect(location.pathname + location.search).toBe("/chi-siamo?x=1");
    expect(sessionStorage.getItem("heili-review")).toBe("1");
    const host = document.querySelector("heili-review-root");
    expect(host?.getAttribute("data-heili-state")).toBe("closed");
  });

  it("ignores a key that is not a site key", () => {
    history.replaceState(null, "", "/#heili-review=ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const script = document.createElement("script");
    script.setAttribute("src", "https://approve.example.test/heili-review.js");
    script.setAttribute("data-site", "<img onerror=alert(1)>");
    document.head.append(script);
    new Function(BUILT)();
    expect(document.querySelector("heili-review-root")).toBeNull();
  });
});
