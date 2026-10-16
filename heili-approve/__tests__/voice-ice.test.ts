import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleIceCandidates } from "@/components/voice/use-live-conversation";

/** A peer that only gathers candidates when told to. */
class FakePeer extends EventTarget {
  iceGatheringState: RTCIceGatheringState = "gathering";
  candidate(value: object | null) {
    const event = new Event("icecandidate") as Event & { candidate: object | null };
    event.candidate = value;
    this.dispatchEvent(event);
  }
  complete() {
    this.iceGatheringState = "complete";
    this.dispatchEvent(new Event("icegatheringstatechange"));
  }
}

const settled = (peer: FakePeer) => {
  let done = false;
  void settleIceCandidates(peer as unknown as RTCPeerConnection, 600, 2_500).then(() => (done = true));
  return () => done;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("offerta WebRTC: non aspetta per sempre la raccolta dei candidati", () => {
  it("già completa: parte subito", async () => {
    const peer = new FakePeer();
    peer.iceGatheringState = "complete";
    await expect(settleIceCandidates(peer as unknown as RTCPeerConnection)).resolves.toBeUndefined();
  });

  it("raccolta che finisce: parte quando finisce", async () => {
    const peer = new FakePeer();
    const done = settled(peer);
    peer.candidate({ candidate: "host" });
    await vi.advanceTimersByTimeAsync(100);
    expect(done()).toBe(false);
    peer.complete();
    await vi.advanceTimersByTimeAsync(0);
    expect(done()).toBe(true);
  });

  it("raccolta che non finisce mai: parte poco dopo l'ultimo candidato (prima: 10 s e poi errore)", async () => {
    const peer = new FakePeer();
    const done = settled(peer);
    peer.candidate({ candidate: "host 1" });
    await vi.advanceTimersByTimeAsync(400);
    peer.candidate({ candidate: "host 2" });
    await vi.advanceTimersByTimeAsync(500);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(done()).toBe(true);
  });

  it("nessun candidato: parte comunque entro il tetto", async () => {
    const peer = new FakePeer();
    const done = settled(peer);
    await vi.advanceTimersByTimeAsync(2_400);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done()).toBe(true);
  });

  it("il candidato vuoto (fine raccolta) chiude subito", async () => {
    const peer = new FakePeer();
    const done = settled(peer);
    peer.candidate(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(done()).toBe(true);
  });
});
