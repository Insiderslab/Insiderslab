import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_LABELS, PLATFORMS, PLATFORM_IDS, WORDPRESS_PLUGIN_PATH, nextStepSentence, platformGuide } from "../lib/website/install";
import { describeVerification } from "../lib/website/verify";
import { OUTCOMES } from "../lib/website/verify-outcomes";

const ROOT = path.join(__dirname, "..");

describe("install guide per platform", () => {
  it("has HTML, WordPress, Webflow, Shopify and Google Tag Manager, three steps each", () => {
    expect(PLATFORMS.map((p) => p.id)).toEqual([...PLATFORM_IDS]);
    expect(PLATFORMS.map((p) => p.label)).toEqual(["HTML", "WordPress", "Webflow", "Shopify", "Google Tag Manager"]);
    for (const platform of PLATFORMS) {
      expect(platform.steps, platform.id).toHaveLength(3);
      for (const step of platform.steps) expect(step.text.length, platform.id).toBeGreaterThan(15);
      expect(platform.summary.length).toBeGreaterThan(10);
    }
  });

  it("puts a copy button where something must be pasted, and the plugin download for WordPress", () => {
    for (const id of ["html", "webflow", "shopify", "gtm"] as const) {
      expect(platformGuide(id).steps[0].action, id).toBe("copy-line");
    }
    const wordpress = platformGuide("wordpress");
    expect(wordpress.steps.map((s) => s.action)).toEqual(["download-plugin", undefined, "copy-key"]);
    expect(existsSync(path.join(ROOT, "public", WORDPRESS_PLUGIN_PATH))).toBe(true);
    for (const label of Object.values(ACTION_LABELS)) expect(label.idle.length).toBeGreaterThan(3);
  });

  it("names the menus the person will really see", () => {
    const text = (id: "wordpress" | "webflow" | "shopify" | "gtm") => platformGuide(id).steps.map((s) => s.text).join(" ");
    expect(text("wordpress")).toContain("Plugin → Aggiungi nuovo → Carica plugin");
    expect(text("wordpress")).toContain("Impostazioni → Heili Approve");
    expect(text("webflow")).toContain("Codice personalizzato");
    expect(text("shopify")).toContain("theme.liquid");
    expect(text("gtm")).toContain("HTML personalizzato");
    expect(text("gtm")).toContain("All Pages");
  });

  it("warns where «Verifica installazione» cannot see the line (Tag Manager, an unpublished Shopify theme)", () => {
    expect(platformGuide("gtm").verifiable).toBe(false);
    expect(platformGuide("gtm").note).toMatch(/invia comunque/);
    expect(platformGuide("shopify").note).toMatch(/tema pubblicato/);
  });

  it("falls back to HTML for an unknown platform", () => {
    expect(platformGuide("joomla").id).toBe("html");
  });

  it("says what to do next, in order", () => {
    const base = { revoked: false, verified: false, waived: false, originRegistered: true };
    expect(nextStepSentence(base)).toMatch(/Passo 1: installa la riga/);
    expect(nextStepSentence({ ...base, originRegistered: false })).toMatch(/consenti l'indirizzo/);
    expect(nextStepSentence({ ...base, verified: true })).toMatch(/Puoi inviare/);
    expect(nextStepSentence({ ...base, waived: true })).toMatch(/senza verifica/);
    expect(nextStepSentence({ ...base, revoked: true })).toMatch(/revocata/);
  });
});

describe("«Verifica installazione» explained", () => {
  it("every outcome has a title, a group, a tone and at least one thing to do", () => {
    for (const [kind, outcome] of Object.entries(OUTCOMES)) {
      expect(outcome.title.length, kind).toBeGreaterThan(8);
      expect(outcome.hints.length, kind).toBeGreaterThan(0);
      for (const hint of outcome.hints) expect(hint.length, kind).toBeGreaterThan(20);
    }
    // Titles are what is stored: they must be unique to be read back.
    const titles = Object.values(OUTCOMES).map((o) => o.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("reads each stored title back to the same outcome", () => {
    for (const outcome of Object.values(OUTCOMES)) expect(describeVerification(outcome.title)).toBe(outcome);
    expect(describeVerification(null)).toBeNull();
    expect(describeVerification("  ")).toBeNull();
  });

  it("groups them as found / not found and what to do / site not reachable", () => {
    expect(describeVerification("Script trovato sul sito")).toMatchObject({ group: "found", tone: "success", retry: false });
    expect(describeVerification("Script non trovato sul sito")).toMatchObject({ group: "missing", retry: true });
    expect(describeVerification("Script non trovato sul sito")?.hints.join(" ")).toMatch(/cache/);
    expect(describeVerification("Il sito non si trova")).toMatchObject({ group: "unreachable", tone: "error" });
    expect(describeVerification("Il sito chiede una password")).toMatchObject({ group: "blocked", retry: false });
    expect(describeVerification("Il sito chiede una password")?.hints.join(" ")).toMatch(/invia comunque/);
    expect(describeVerification("Lo script c'è ma con un'altra chiave")?.hints.join(" ")).toMatch(/Copia di nuovo la riga/);
  });

  it("explains HTTP errors, a server fault differently from a wrong address", () => {
    expect(describeVerification("Il sito risponde con un errore (404).")?.hints[0]).toMatch(/indirizzo/);
    expect(describeVerification("Il sito risponde con un errore (503).")?.hints[0]).toMatch(/server/);
  });

  it("still understands the messages stored by the earlier version", () => {
    expect(describeVerification("Non trovato: controlla di aver salvato, la cache del sito e il plugin di ottimizzazione.")?.group).toBe("missing");
    expect(describeVerification("Lo script c'è ma con un'altra chiave: copia di nuovo la riga di codice.")?.group).toBe("wrong");
    expect(describeVerification("Il sito chiede una password o blocca l'accesso: non si può verificare da qui.")?.group).toBe("blocked");
    expect(describeVerification("Il dominio non esiste o non risponde.")?.group).toBe("unreachable");
    expect(describeVerification("Certificato non valido: controlla l'https del sito.")?.group).toBe("unreachable");
    // Unknown text is shown as it is, with a retry.
    expect(describeVerification("Qualcosa di strano")).toMatchObject({ title: "Qualcosa di strano", retry: true });
  });

  it("keeps technical words out of what the agency reads", () => {
    for (const outcome of Object.values(OUTCOMES)) {
      expect([outcome.title, ...outcome.hints].join(" ")).not.toMatch(/SSRF|DNS|TLS|timeout|socket|ECONN|stack/i);
    }
  });
});
