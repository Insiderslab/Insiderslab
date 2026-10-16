import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  /** The generated class the cached instance was built from. */
  prismaClass?: typeof PrismaClient;
  /** Development only: the one adapter (pool) shared by every client generation. */
  prismaAdapter?: PrismaPg;
};

/**
 * Interactive transactions wait up to 10 s for a free connection (Prisma's
 * default is 2 s) and may run 15 s. With the default, 50 comments sent at
 * once on one post lost 5 of them with «errore imprevisto» (P2028): they
 * queue on the post's row lock, hold the 10 pooled connections, and the
 * others gave up after 2 s instead of waiting their turn (QA 2026-10-16).
 */
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

/** Pool size per process: DATABASE_POOL_MAX (1–100), else pg's default of 10. */
export function poolMax(value = process.env.DATABASE_POOL_MAX): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 10;
}

function adapterFor(databaseUrl: string): PrismaPg {
  return new PrismaPg({ connectionString: databaseUrl, max: poolMax() });
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  // Development: one pool per process, on globalThis like the client. A hot
  // reload (or `prisma generate`) re-evaluates the generated module and
  // PrismaClient becomes a new class: we swap the client but never end the
  // pool — ending it under queries in flight was "Cannot use a pool after
  // calling end on the pool".
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prismaAdapter ??= adapterFor(databaseUrl);
    return new PrismaClient({ adapter: globalForPrisma.prismaAdapter, transactionOptions: TRANSACTION_OPTIONS });
  }
  // Production: unchanged. A build can evaluate the generated module once
  // per server chunk, so several identical PrismaClient classes coexist,
  // each with its own pool; the schema cannot change under a running build.
  return new PrismaClient({ adapter: adapterFor(databaseUrl), transactionOptions: TRANSACTION_OPTIONS });
}

export function getPrisma(): PrismaClient {
  // In `next dev` the instance survives hot reloads on globalThis. After
  // `prisma generate` (schema change) the generated module is re-evaluated
  // and PrismaClient is a new class: drop the stale client, which would
  // still validate queries against the old schema. The old client is NOT
  // disconnected: it shares the process pool and is garbage-collected.
  if (
    process.env.NODE_ENV !== "production" &&
    globalForPrisma.prisma &&
    globalForPrisma.prismaClass !== PrismaClient
  ) {
    globalForPrisma.prisma = undefined;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
    globalForPrisma.prismaClass = PrismaClient;
  }

  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrisma(), prop, receiver);
  },
});
