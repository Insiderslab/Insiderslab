import { beforeEach, describe, expect, it, vi } from "vitest";

// The real actions need Next and the database: the wrappers only care that a
// call which throws (no network) comes back as a normal refusal.
const mocks = vi.hoisted(() => ({
  approvePostAction: vi.fn(),
  requestChangesAction: vi.fn(),
}));
vi.mock("@/app/review/[token]/actions", () => mocks);

import { CONNECTION_LOST_MESSAGE, approvePostAction, requestChangesAction } from "@/components/portal/safe-actions";

describe("portal actions without a connection (K-01)", () => {
  beforeEach(() => {
    mocks.approvePostAction.mockReset();
    mocks.requestChangesAction.mockReset();
  });

  it("turns a thrown request error into {ok: false} with a message the page can show", async () => {
    mocks.approvePostAction.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await approvePostAction("token", { postId: "p1", versionNumber: 1 });
    expect(result).toEqual({ ok: false, error: CONNECTION_LOST_MESSAGE });
  });

  it("says what to do, in Italian, without technical words", () => {
    expect(CONNECTION_LOST_MESSAGE).toMatch(/connessione/);
    expect(CONNECTION_LOST_MESSAGE).toMatch(/riprova/);
    expect(CONNECTION_LOST_MESSAGE).not.toMatch(/fetch|server|errore/i);
  });

  it("passes arguments and the server's own answer through untouched", async () => {
    mocks.requestChangesAction.mockResolvedValue({ ok: false, error: "Versione vecchia", stale: true });
    const input = { postId: "p1", versionNumber: 2, feedback: "saved-comments" as const };
    const result = await requestChangesAction("token", input);
    expect(mocks.requestChangesAction).toHaveBeenCalledWith("token", input);
    expect(result).toEqual({ ok: false, error: "Versione vecchia", stale: true });
  });

  it("returns a success as it is", async () => {
    mocks.approvePostAction.mockResolvedValue({ ok: true, data: undefined });
    expect(await approvePostAction("token", { postId: "p1", versionNumber: 1 })).toEqual({ ok: true, data: undefined });
  });
});
