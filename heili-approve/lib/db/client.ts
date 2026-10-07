import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  /** The generated class the cached instance was built from. */
  prismaClass?: typeof PrismaClient;
};

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  return new PrismaClient({
    adapter: new PrismaPg(databaseUrl),
  });
}

export function getPrisma(): PrismaClient {
  // In `next dev` the instance survives hot reloads on globalThis. After
  // `prisma generate` (schema change) the generated module is re-evaluated
  // and PrismaClient is a new class: drop the stale instance, which would
  // still validate queries against the old schema.
  if (globalForPrisma.prisma && globalForPrisma.prismaClass !== PrismaClient) {
    void globalForPrisma.prisma.$disconnect().catch(() => {});
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
