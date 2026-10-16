import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCK_PANEL_WIDTH, DOCK_SIDE_MIN_WIDTH, dockLayout } from "@/components/portal/heili/rules";

const read = (...parts: string[]) => readFileSync(path.join(__dirname, "..", ...parts), "utf8");

/**
 * QA-05 / QA-13: il pannello laterale di Heili sta sopra la barra delle
 * decisioni e la pagina gli lascia lo spazio; sotto 1280 px è un foglio modale.
 */
describe("disposizione del dock di Heili (desktop)", () => {
  it("pannello laterale da 1280 px, foglio modale sotto", () => {
    expect(dockLayout(1024)).toBe("sheet");
    expect(dockLayout(1279)).toBe("sheet");
    expect(dockLayout(1280)).toBe("side");
    expect(dockLayout(1366)).toBe("side");
    expect(dockLayout(390)).toBe("sheet");
  });

  it("il CSS riserva a destra la stessa larghezza e usa la stessa soglia del codice", () => {
    const css = read("app", "globals.css");
    const rule = css.match(/@media \(min-width: (\d+)px\) \{\s*html\[data-heili-panel="side"\] body \{\s*padding-right: (\d+)px;/);
    expect(rule, "regola di riserva in globals.css").not.toBeNull();
    expect(Number(rule![1])).toBe(DOCK_SIDE_MIN_WIDTH);
    expect(Number(rule![2])).toBe(DOCK_PANEL_WIDTH);
  });

  it("il <dialog> è largo quanto lo spazio riservato e sta sopra la barra (z-40)", () => {
    const dock = read("components", "portal", "heili", "heili-dock.tsx");
    expect(dock).toContain(`xl:w-[${DOCK_PANEL_WIDTH}px]`);
    expect(dock).toContain(`xl:max-w-[${DOCK_PANEL_WIDTH}px]`);
    expect(dock).toContain("xl:z-50");
    expect(dock).toContain("(min-width: ${DOCK_SIDE_MIN_WIDTH}px)");
    // La barra delle decisioni è z-40: il pannello deve stare più in alto.
    expect(read("components", "portal", "review-pieces.tsx")).toContain("sticky bottom-0 z-40");
    // Il pannello non ha più la soglia di 1024 px.
    expect(dock).not.toMatch(/\blg:/);
  });
});

describe("che cosa apre il pulsante di Heili (QA-16)", () => {
  const withReview = { review: {} as never };

  it("dove si può commentare è la conversazione, altrove la Guida", async () => {
    const { launcherKind, LAUNCHER_LABELS, dockTabs, resolveDockTab } = await import("@/components/portal/heili/rules");
    expect(launcherKind(withReview)).toBe("chat");
    expect(launcherKind({})).toBe("guide");
    expect(launcherKind(null)).toBe("guide");
    // ... e apre davvero quello: la prima scheda è Feedback con la chat, Guida senza.
    expect(resolveDockTab(dockTabs(withReview), null)).toBe("feedback");
    expect(resolveDockTab(dockTabs({}), null)).toBe("guide");
    expect(LAUNCHER_LABELS.chat).toBe("Parla con Heili");
    expect(LAUNCHER_LABELS.guide).not.toBe(LAUNCHER_LABELS.chat);
  });

  it("il pulsante galleggiante mostra il «?» solo quando apre la Guida", () => {
    const dock = read("components", "portal", "heili", "heili-dock.tsx");
    expect(dock).toContain('data-kind={kind}');
    expect(dock).toContain('kind === "guide" && (');
    expect(dock).toContain('data-testid="heili-guide-badge"');
  });
});

describe("«Parla con Heili» da Sfoglia apre la conversazione (QA-16)", () => {
  it("l'apertura all'arrivo (?heili=1) viene dopo la registrazione della pagina nel dock", () => {
    const source = read("components", "portal", "post-review.tsx");
    const register = source.indexOf("useHeiliPage({");
    const open = source.indexOf('if (openedOnArrival) openDock("feedback")');
    expect(register).toBeGreaterThan(0);
    // Prima della registrazione il dock vede ancora la pagina precedente (solo Guida) e si apre sulla Guida.
    expect(open).toBeGreaterThan(register);
  });
});
