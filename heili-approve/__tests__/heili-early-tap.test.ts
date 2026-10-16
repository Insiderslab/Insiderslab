import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HEILI_EARLY_TAP_SCRIPT,
  earlyTapTab,
  releaseEarlyHeiliTap,
  takeEarlyHeiliTap,
  type HeiliEarlyWindow,
} from "@/components/portal/heili/early-tap";

/** A tiny element: attributes and closest() on a fixed ancestor chain. */
class FakeElement {
  attributes = new Map<string, string>();
  constructor(
    attrs: Record<string, string>,
    readonly parent: FakeElement | null = null
  ) {
    for (const [name, value] of Object.entries(attrs)) this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  closest(selector: string): FakeElement | null {
    const name = selector.replace(/^\[|\]$/g, "");
    if (this.hasAttribute(name)) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }
}

function runScript() {
  const listeners: Array<{ type: string; listener: (event: { target: unknown }) => void; capture: unknown }> = [];
  const elements: FakeElement[] = [];
  const document = {
    addEventListener: (type: string, listener: (event: { target: unknown }) => void, capture: unknown) =>
      listeners.push({ type, listener, capture }),
    querySelectorAll: (selector: string) => elements.filter((element) => element.closest(selector) === element),
  };
  const window: HeiliEarlyWindow = {};
  new Function("window", "document", HEILI_EARLY_TAP_SCRIPT)(window, document);
  const click = (target: unknown) => listeners.filter((l) => l.type === "click").forEach((l) => l.listener({ target }));
  return { window, document, listeners, elements, click };
}

describe("Heili: tocco prima che la pagina sia pronta", () => {
  it("annota il tocco sul pulsante e lo segna subito come in attesa", () => {
    const page = runScript();
    expect(page.listeners).toHaveLength(1);
    expect(page.listeners[0].capture).toBe(true);
    const button = new FakeElement({ "data-heili-open": "auto" });
    const icon = new FakeElement({}, button);
    page.elements.push(button);
    page.click(icon);
    expect(page.window.__heiliEarly?.pending).toBe("auto");
    expect(button.hasAttribute("data-heili-pending")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("ignora i tocchi altrove e quelli dopo che il dock è pronto", () => {
    const page = runScript();
    page.click(new FakeElement({}));
    page.click(null);
    expect(page.window.__heiliEarly?.pending).toBeNull();
    page.window.__heiliReady = true;
    page.click(new FakeElement({ "data-heili-open": "feedback" }));
    expect(page.window.__heiliEarly?.pending).toBeNull();
  });

  it("il dock montato riceve la scheda chiesta e pulisce i segni", () => {
    const page = runScript();
    const composer = new FakeElement({ "data-heili-open": "feedback" });
    page.elements.push(composer);
    page.click(composer);
    expect(takeEarlyHeiliTap(page.window, page.document as unknown as Document)).toBe("feedback");
    expect(composer.hasAttribute("data-heili-pending")).toBe(false);
    expect(composer.hasAttribute("aria-busy")).toBe(false);
    expect(page.window.__heiliReady).toBe(true);
    // Consumed once: a remount does not reopen the dock.
    expect(takeEarlyHeiliTap(page.window, page.document as unknown as Document)).toBeNull();
    releaseEarlyHeiliTap(page.window);
    expect(page.window.__heiliReady).toBe(false);
  });

  it("senza tocco non apre nulla; un valore sconosciuto apre la scheda predefinita", () => {
    const empty = runScript();
    expect(takeEarlyHeiliTap(empty.window, empty.document as unknown as Document)).toBeNull();
    expect(takeEarlyHeiliTap({}, { querySelectorAll: () => [] as unknown as NodeListOf<Element> })).toBeNull();
    expect(earlyTapTab("guide")).toBe("guide");
    expect(earlyTapTab("feedback")).toBe("feedback");
    expect(earlyTapTab("auto")).toBeNull();
    expect(earlyTapTab("<script>")).toBeNull();
    const page = runScript();
    page.click(new FakeElement({ "data-heili-open": "" }));
    expect(takeEarlyHeiliTap(page.window, page.document as unknown as Document)).toBe("auto");
  });

  it("lo script si installa una sola volta", () => {
    const page = runScript();
    new Function("window", "document", HEILI_EARLY_TAP_SCRIPT)(page.window, page.document);
    expect(page.listeners).toHaveLength(1);
  });

  it("il layout del portale inserisce lo script e i pulsanti di Heili lo dichiarano", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    expect(read("app/review/[token]/layout.tsx")).toContain("HEILI_EARLY_TAP_SCRIPT");
    expect(read("components/portal/heili/heili-dock.tsx")).toContain('data-heili-open="auto"');
    expect(read("components/portal/review-pieces.tsx")).toContain('data-heili-open="feedback"');
    expect(read("components/portal/home-steps.tsx")).toContain('data-heili-open="guide"');
    expect(read("app/globals.css")).toContain("[data-heili-pending]");
  });
});
