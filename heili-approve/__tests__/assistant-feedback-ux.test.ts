import { describe, expect, it } from "vitest";
import { composerBlockingMessage, formatCountdown } from "../components/review/assistant-panel";
import { liveBackendInstructions, liveConversationInstructions } from "../lib/review-assistant/live-config";

describe("assistant feedback safeguards", () => {
  it("blocks final actions while a written or dictated message is still unsent", () => {
    expect(composerBlockingMessage("  ", false, "send")).toBeNull();
    expect(composerBlockingMessage("Cambia il titolo", false, "send")).toContain("non è ancora incluso");
    expect(composerBlockingMessage("", true, "approve")).toContain("Ferma la dettatura");
  });

  it("shows the provider expiry as a readable countdown", () => {
    expect(formatCountdown(180)).toBe("3:00");
    expect(formatCountdown(61.2)).toBe("1:02");
    expect(formatCountdown(-1)).toBe("0:00");
  });

  it("makes the voice assistant describe notes without pretending to edit", () => {
    const livePrompt = liveConversationInstructions("SOCIAL_POST");
    const backendPrompt = liveBackendInstructions("CONTESTO");
    expect(livePrompt).toContain("Segno nel riepilogo la richiesta di cambiare il titolo");
    expect(livePrompt).toContain("Non dire mai «Cambio il titolo»");
    expect(backendPrompt).toContain("being noted for the summary");
  });
});
