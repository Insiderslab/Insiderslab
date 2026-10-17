// Source checks for the simplicity fixes of the «Sul sito» review (S-02, 17/10): what the browser does is covered
// by e2e/website-live.spec.mjs; these keep the rules from being undone by accident.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("Heili inside the site (embed)", () => {
  const embed = read("components/website/embed-app.tsx");

  it("closes the open panel with Esc and cancels the picking with Esc", () => {
    const onKey = embed.slice(embed.indexOf("const onKey"), embed.indexOf('window.addEventListener("keydown"'));
    expect(onKey).toContain('event.key !== "Escape"');
    expect(onKey).toContain("pickingRef.current");
    expect(onKey).toContain("openRef.current");
    expect(onKey).toContain('post("ui", { state: "closed" })');
  });

  it("moves the focus into the panel, into the note after «Indica un punto», and back to Heili's button", () => {
    expect(embed).toContain("panelRef.current");
    expect(embed).toContain("focusNote.current = true");
    expect(embed).toContain('document.getElementById("embed-note")');
    expect(embed).toContain("launcherRef.current?.focus()");
    expect(embed).toMatch(/role="dialog"/);
  });

  it("tells what went wrong and offers «Riprova» when it is worth another try", () => {
    expect(embed).toContain('data-testid="embed-retry"');
    expect(embed).toContain("retryable");
    // Network failures and server errors are retryable; a refusal of the server (with a code) is not, except «rate».
    expect(embed).toMatch(/error\.retryable = !json\?\.code \|\| json\.code === "rate"/);
    // A tap on the button while it failed opens the message (or retries when the site is not known yet): never nothing.
    expect(embed).toMatch(/else if \(phase === "error"\)/);
    expect(embed).toContain("retryRef.current?.()");
    // The message is not only in a tooltip: there is a badge and an accessible name.
    expect(embed).toContain("qualcosa non va, tocca per i dettagli");
  });

  it("keeps the 44 px rule: the link to the portal is a button", () => {
    expect(embed).toMatch(/className="btn w-full" data-testid="embed-portal"/);
    expect(embed).not.toMatch(/>\s*Apri il portale\s*<\/a>\s*\)}\s*<\/p>/);
  });
});

describe("«Apri il sito» in the portal", () => {
  const launch = read("components/portal/website-launch.tsx");

  it("turns into «Riprova» after an error and says what else can be done", () => {
    expect(launch).toContain('const label = error ? "Riprova"');
    expect(launch).toContain("scrivi le note qui nel portale");
  });
});

describe("«Sul sito» panel for the agency", () => {
  const panel = read("components/website/site-panel.tsx");

  it("never uses the browser's confirm box: revoking asks inline", () => {
    expect(panel).not.toContain("window.confirm");
    expect(panel).toContain('role="alertdialog"');
    expect(panel).toContain("Sì, revoca la chiave");
  });

  it("shows «Riprova» after an error and keeps the action to run again", () => {
    expect(panel).toContain('data-testid="site-retry"');
    expect(panel).toContain("setFailed(() => action)");
  });

  it("gives the next step instead of a disabled button without a reason", () => {
    expect(panel).toContain("nextStepSentence(");
    expect(panel).toContain('data-testid="site-origin-callout"');
    expect(panel).toContain('data-testid="site-origin-allow"');
    expect(panel).toContain('id="site-verify-why"');
    expect(panel).toContain("aria-describedby");
  });

  it("explains the verification outcome and offers «Verifica di nuovo»", () => {
    expect(panel).toContain("<VerifyResult");
    expect(read("components/website/verify-result.tsx")).toContain("Verifica di nuovo");
    expect(read("components/website/verify-result.tsx")).toContain('data-testid="site-verify-hints"');
  });

  it("has the platform tabs of the install guide", () => {
    const guide = read("components/website/install-guide.tsx");
    expect(guide).toContain('role="tablist"');
    expect(guide).toContain("aria-selected");
    expect(guide).toContain("flex flex-wrap gap-2"); // wraps, no sideways scrolling at 390 px
    expect(guide).toContain('data-testid="site-step"');
    expect(guide).toContain("navigator.clipboard.writeText");
    // Clipboard blocked: the text is selected so it can be copied by hand.
    expect(guide).toContain("field?.select()");
  });
});

describe("touch targets on phones (agency)", () => {
  it("page move buttons are at least 44 px wide, links of the review are 44 px high", () => {
    const editor = read("components/website/website-editor.tsx");
    expect(editor.match(/btn btn-quiet btn-sm min-w-11/g)).toHaveLength(2);
    const review = read("components/posts/website-review.tsx");
    expect(review.match(/inline-flex min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
