import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTurnSystemPrompt, type AssistantPostContext } from "../lib/review-assistant/prompt";
import { liveConversationInstructions } from "../lib/review-assistant/live-config";
import { ASSISTANT_BUTTONS, type AssistantMode } from "../lib/review-assistant/shared";

// The prompts (text and voice) must quote the panel's real button labels: the
// panel and the prompts share ASSISTANT_BUTTONS, so they cannot diverge, and
// the conclusion is described as the two steps the client actually sees.

function ctx(mode?: AssistantMode): AssistantPostContext {
  return {
    mode,
    clientName: "Pasticceria Rossi",
    reviewerName: "Giulia",
    postTitle: "Colomba artigianale",
    networks: [],
    networkOptions: {},
    publishAt: new Date("2026-03-20T09:30:00Z"),
    timezone: "Europe/Rome",
    versionNumber: 1,
    text: "Testo del post",
    firstCommentText: null,
    changeNote: null,
    media: [],
    agencyComments: [],
  };
}

describe("assistant button labels in the prompts", () => {
  it("decision mode: two steps, exact labels, called «pulsante»", () => {
    const prompt = buildTurnSystemPrompt(ctx());
    expect(prompt).toContain(`«${ASSISTANT_BUTTONS.prepareSummary}»`);
    expect(prompt).toContain(`«${ASSISTANT_BUTTONS.submitChanges}»`);
    expect(prompt).not.toContain(ASSISTANT_BUTTONS.addToFeedback);
    expect(prompt).toContain('call it "pulsante" (never "button")');
    expect(prompt).not.toMatch(/button «/);
  });

  it("feedback mode: the conclusion is «Aggiungi al feedback», as an override of the base framing", () => {
    const prompt = buildTurnSystemPrompt(ctx("feedback"));
    expect(prompt).toContain(`«${ASSISTANT_BUTTONS.prepareSummary}», then, checking the summary, «${ASSISTANT_BUTTONS.addToFeedback}»`);
    // The base decision framing stays, but the feedback block is last and overrides it.
    expect(prompt.indexOf(ASSISTANT_BUTTONS.addToFeedback)).toBeGreaterThan(prompt.indexOf(ASSISTANT_BUTTONS.submitChanges));
    expect(prompt).toContain("override");
  });

  it("voice instructions quote the same constants, per mode and kind", () => {
    for (const kind of ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"] as const) {
      const decision = liveConversationInstructions(kind, "decision");
      expect(decision).toContain(ASSISTANT_BUTTONS.prepareSummary);
      expect(decision).toContain(ASSISTANT_BUTTONS.submitChanges);
      expect(decision).not.toContain(ASSISTANT_BUTTONS.addToFeedback);
      expect(decision).toContain("«pulsante»");
      const feedback = liveConversationInstructions(kind, "feedback");
      expect(feedback).toContain(ASSISTANT_BUTTONS.prepareSummary);
      expect(feedback).toContain(ASSISTANT_BUTTONS.addToFeedback);
      expect(feedback).not.toContain(ASSISTANT_BUTTONS.submitChanges);
    }
  });

  it("the panel renders the same constants (single source of truth)", () => {
    const source = readFileSync(path.join(__dirname, "..", "components", "review", "assistant-panel.tsx"), "utf8");
    expect(source).toContain("ASSISTANT_BUTTONS.prepareSummary");
    expect(source).toContain("ASSISTANT_BUTTONS.submitChanges");
    expect(source).not.toContain('"Prepara il riepilogo per l\'agenzia"');
    expect(source).not.toContain('"Invia le modifiche all\'agenzia"');
  });
});
