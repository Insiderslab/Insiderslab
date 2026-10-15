import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(dashboard)/settings/automation-actions", () => ({
  createAutomationToken: vi.fn(),
  revokeAutomationToken: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import McpSettings from "@/components/settings/mcp-settings";
import AutomationSettings from "@/components/settings/automation-settings";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const mcp = (props: { oauthConfigured: boolean; canManage?: boolean }) =>
  renderToStaticMarkup(createElement(McpSettings, { url: "https://x.test/mcp", enabled: true, ...props }));

describe("Impostazioni, testi della chiave personale e dell'accesso con account (QA-08)", () => {
  it("the key card says the key also prepares drafts and uploads media", () => {
    const t = text(renderToStaticMarkup(createElement(AutomationSettings, { tokens: [] })));
    expect(t).toMatch(/leggere i contenuti di questo workspace, preparare bozze e caricare media/);
    expect(t).toMatch(/non approva, non invia al cliente e non pubblica/);
  });

  it("without OAuth, no step sends the reader to an account login that does not work", () => {
    const html = mcp({ oauthConfigured: false });
    const t = text(html);
    expect(t).toContain("non configurato");
    expect(html).not.toContain(">Claude</summary>");
    expect(html).not.toContain(">ChatGPT</summary>");
    expect(t).not.toContain("Accedi con il tuo account");
    expect(t).not.toContain("codex mcp add approve --url");
    expect(t).toContain("Authorization: Bearer");
  });

  it("without OAuth the owner is told where to switch it on, a member who to ask", () => {
    expect(text(mcp({ oauthConfigured: false, canManage: true }))).toMatch(/variabili d'ambiente del server/);
    expect(text(mcp({ oauthConfigured: false, canManage: true }))).not.toMatch(/chiedi al titolare/);
    expect(text(mcp({ oauthConfigured: false }))).toMatch(/chiedi a chi gestisce l'installazione/);
  });

  it("with OAuth the Claude and ChatGPT steps and the account commands are there", () => {
    const html = mcp({ oauthConfigured: true });
    expect(html).toContain(">Claude</summary>");
    expect(html).toContain(">ChatGPT</summary>");
    expect(text(html)).toContain("Accedi con il tuo account quando richiesto");
    expect(text(html)).toContain("codex mcp add approve --url https://x.test/mcp");
  });
});
