import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/db/client.ts in development (NODE_ENV=test here): one pg pool per
 * process, a new client per generated-class generation, never a $disconnect
 * that would end the pool under queries in flight ("Cannot use a pool after
 * calling end on the pool", K-11).
 */

const state = vi.hoisted(() => ({
  adapters: [] as Array<{ id: number }>,
  clients: [] as Array<{ adapter: unknown; disconnected: boolean }>,
  nextAdapterId: 0,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    id = ++state.nextAdapterId;
    constructor(public url: string) {
      state.adapters.push(this as unknown as { id: number });
    }
  },
}));

// Two generations of the generated class: before and after a hot reload.
class ClientGen1 {
  disconnected = false;
  constructor(public options: { adapter: unknown }) {
    state.clients.push(this as unknown as { adapter: unknown; disconnected: boolean });
  }
  async $disconnect() {
    this.disconnected = true;
  }
}
class ClientGen2 extends ClientGen1 {}

async function loadModule(generatedClass: unknown) {
  vi.resetModules();
  vi.doMock("@/app/generated/prisma/client", () => ({ PrismaClient: generatedClass }));
  return import("@/lib/db/client");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/test");
  // A clean globalThis cache for every test.
  const g = globalThis as Record<string, unknown>;
  delete g.prisma;
  delete g.prismaClass;
  delete g.prismaAdapter;
  state.adapters.length = 0;
  state.clients.length = 0;
  state.nextAdapterId = 0;
});

describe("the development Prisma client (K-11)", () => {
  it("keeps one client and one pool across reads", async () => {
    const { getPrisma } = await loadModule(ClientGen1);
    expect(getPrisma()).toBe(getPrisma());
    expect(state.adapters).toHaveLength(1);
  });

  it("after a hot reload (new generated class) swaps the client but never ends the pool", async () => {
    const first = await loadModule(ClientGen1);
    const oldClient = first.getPrisma();
    const poolAfterFirst = state.adapters.length;

    const second = await loadModule(ClientGen2);
    const newClient = second.getPrisma();

    expect(newClient).not.toBe(oldClient);
    // No new pool, and the old client was never disconnected: nothing can
    // hit a closed pool, even with a query still in flight.
    expect(state.adapters).toHaveLength(poolAfterFirst);
    expect((oldClient as unknown as ClientGen1).disconnected).toBe(false);
    expect((newClient as unknown as ClientGen2).options.adapter).toBe(
      (oldClient as unknown as ClientGen1).options.adapter
    );
  });

  it("without DATABASE_URL it says so", async () => {
    vi.unstubAllEnvs();
    delete process.env.DATABASE_URL;
    const { getPrisma } = await loadModule(ClientGen1);
    expect(() => getPrisma()).toThrow("DATABASE_URL");
  });
});
