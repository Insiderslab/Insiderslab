import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sideband = vi.hoisted(() => {
  class FakeSocket {
    readyState = 0;
    listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    on(event: string, listener: (...args: unknown[]) => void) {
      const set = this.listeners.get(event) ?? new Set();
      set.add(listener);
      this.listeners.set(event, set);
    }
    off(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(listener);
    }
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  class FakeSideband {
    socket = new FakeSocket();
    listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    sent: unknown[] = [];
    constructor() {
      instances.push(this);
      queueMicrotask(() => {
        this.socket.readyState = 1;
        this.socket.emit("open");
      });
    }
    on(event: string, listener: (...args: unknown[]) => void) {
      const set = this.listeners.get(event) ?? new Set();
      set.add(listener);
      this.listeners.set(event, set);
    }
    off(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(listener);
    }
    send(event: unknown) {
      this.sent.push(event);
      if ((event as { type?: string }).type === "session.update") {
        queueMicrotask(() =>
          this.emit("event", {
            type: "session.updated",
            event_id: "updated_1",
            session: { expires_at: Math.floor(Date.now() / 1_000) + 300 },
          })
        );
      }
    }
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  const instances: FakeSideband[] = [];
  return { instances, FakeSideband };
});

vi.mock("openai/resources/live/sideband/ws", () => ({ SidebandWS: sideband.FakeSideband }));
vi.mock("@/lib/db/client", () => ({
  prisma: { reviewVoiceCall: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } },
}));

import { ensureLiveRuntime, resetLiveOpenAIClient } from "../lib/review-assistant/live-runtime";

describe("Live sideband recovery", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    sideband.instances.length = 0;
    resetLiveOpenAIClient();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("discards a socket closed before session.closed so the next sweep reattaches", async () => {
    const call = {
      id: `call_${Date.now()}`,
      providerSessionId: "live_session_1",
      expiresAt: new Date(Date.now() + 60_000),
    };
    await ensureLiveRuntime(call);
    expect(sideband.instances).toHaveLength(1);

    const first = sideband.instances[0];
    first.socket.readyState = 3;
    first.emit("close", 1006, "lost", []);
    await Promise.resolve();

    await ensureLiveRuntime(call);
    expect(sideband.instances).toHaveLength(2);
    expect(sideband.instances[1]).not.toBe(first);

    sideband.instances[1].socket.readyState = 3;
    sideband.instances[1].emit("close", 1000, "done", []);
  });
});
