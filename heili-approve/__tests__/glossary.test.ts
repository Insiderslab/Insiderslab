import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PORTAL_STATUS_LABELS, portalKindTabs, portalStatusLabel, portalTagline } from "../components/portal/helpers";
import { browseSummaryText } from "../lib/month-rules";
import { postLinkMessage } from "../components/share/messages";
import { reviewEmailCopy } from "../lib/notifications";
import { clientServicesSentence, kindCountPhrase, servicesSentence } from "../lib/variant";

/**
 * The glossary (QA-17): agency side says "Post social", "Articoli",
 * "Creatività ads"; the client — portal, emails, WhatsApp — reads "Annunci",
 * never "ads" or "creatività".
 */
describe("glossary: the client reads «Annunci», the agency «Creatività ads»", () => {
  it("counts and lists services with the client words", () => {
    expect(kindCountPhrase({ AD_CREATIVE: 3 })).toBe("3 annunci");
    expect(kindCountPhrase({ AD_CREATIVE: 1 }, { adSets: true })).toBe("1 set di annunci");
    expect(clientServicesSentence(["AD_CREATIVE", "SOCIAL_POST"])).toBe("post social e annunci");
    // The agency side keeps its own term.
    expect(servicesSentence(["AD_CREATIVE", "SOCIAL_POST"])).toBe("post social e creatività ads");
  });

  it("uses «Annunci» in the portal header and tabs", () => {
    expect(portalTagline(["AD_CREATIVE"])).toBe("I tuoi annunci da approvare");
    const tabs = portalKindTabs("tok", ["SOCIAL_POST", "AD_CREATIVE"], [], null);
    expect(tabs.map((tab) => tab.label)).toEqual(["Tutti", "Post social", "Annunci"]);
  });

  it("uses «annunci» in the client's emails and WhatsApp messages", () => {
    const at = new Date("2026-10-10T08:00:00Z");
    const email = reviewEmailCopy(
      [{ title: "Saldi", kind: "AD_CREATIVE", publishAt: at, networks: [] }],
      { kind: "request", clientName: "Le Querce", agencyName: "InsidersLab" }
    );
    expect(JSON.stringify(email)).toContain("annunc");
    expect(JSON.stringify(email)).not.toMatch(/creativit/i);

    const whatsapp = postLinkMessage({
      kind: "AD_CREATIVE",
      status: "IN_REVIEW",
      reviewerName: "Chiara",
      title: "Saldi",
      url: "https://approve.example.com/review/abc",
    });
    expect(whatsapp).toContain("annunci");
    expect(whatsapp).not.toMatch(/creativit/i);
  });

  it("never shows «creatività» anywhere in the client portal source", () => {
    const roots = [path.join(__dirname, "..", "components", "portal"), path.join(__dirname, "..", "app", "review")];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/creativit/i);
    }
  });
});

describe("glossary: websites («Sito web», «Sul sito», «Apri nel punto»)", () => {
  it("names websites the same way for agency and client", () => {
    expect(kindCountPhrase({ WEBSITE: 2, BLOG_ARTICLE: 1 })).toBe("1 articolo e 2 siti web");
    expect(clientServicesSentence(["WEBSITE", "SOCIAL_POST"])).toBe("post social e siti web");
    expect(servicesSentence(["WEBSITE"])).toBe("siti web");
    expect(portalTagline(["WEBSITE"])).toBe("I tuoi siti da approvare");
    expect(portalKindTabs("tok", ["SOCIAL_POST", "WEBSITE"], [], null).map((tab) => tab.label)).toEqual(["Tutti", "Post social", "Siti web"]);
    const email = reviewEmailCopy([{ title: "Nuovo sito", kind: "WEBSITE", publishAt: new Date(), networks: [] }], {
      kind: "request",
      clientName: "Officina Nord",
      agencyName: "Studio Forma",
    });
    expect(email.subject).toBe("Un sito da approvare: Nuovo sito");
  });

  it("never says «live» or «snapshot» to the client", () => {
    const files = ["website-review.tsx", "website-launch.tsx"].map((f) => path.join(__dirname, "..", "components", "portal", f));
    for (const file of files) {
      const visible = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(visible, file).not.toMatch(/[«"> ](live|snapshot)\b/i);
    }
  });
});

/**
 * QA-14: one name per state in the whole client portal. A content waiting for
 * the client is «Da approvare» (never «In revisione», «da rivedere» or «da
 * decidere»; ads variants keep «da decidere», they are decisions, not states);
 * changes asked are «Modifiche richieste»; done is «Approvato».
 */
describe("glossary: one name per state in the client portal (QA-14)", () => {
  it("names each state once", () => {
    expect(PORTAL_STATUS_LABELS.IN_REVIEW).toBe("Da approvare");
    expect(PORTAL_STATUS_LABELS.CHANGES_REQUESTED).toBe("Modifiche richieste");
    expect(PORTAL_STATUS_LABELS.APPROVED).toBe("Approvato");
    // Scheduling problems are the agency's business: the client still reads «Approvato».
    expect(portalStatusLabel("SOCIAL_POST", "SCHEDULING")).toBe("Approvato");
    expect(portalStatusLabel("SOCIAL_POST", "FAILED")).toBe("Approvato");
    expect(browseSummaryText({ approved: 1, withComments: 1, waiting: 3 })).toBe(
      "1 approvato, 1 con commento, 3 da approvare"
    );
  });

  it("never uses another word for «Da approvare» in the portal source", () => {
    const root = path.join(__dirname, "..");
    const files = [path.join(root, "lib", "month-rules.ts")];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    [path.join(root, "components", "portal"), path.join(root, "app", "review")].forEach(walk);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const visible = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
        .replace(/variant[ei] da decidere/gi, "");
      expect(visible, file).not.toMatch(/in revisione|da rivedere|da decidere|"Rivisto"/i);
    }
  });
});
