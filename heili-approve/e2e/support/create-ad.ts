/**
 * Used by e2e/variant-gating.spec.mjs: tries to create an ad set through the
 * service (the same path as the agency's server action) and prints the
 * outcome as `RESULT ...`. Run with APP_VARIANT=blog to check the refusal.
 *
 *   APP_VARIANT=blog npx tsx e2e/support/create-ad.ts <workspaceId> <clientId> <userId>
 */

import "@/lib/load-env";
import { userActor } from "@/lib/actor";
import { emptyAdContent } from "@/lib/content/ads";
import { prisma } from "@/lib/db/client";
import { createPost } from "@/lib/posts";

async function main() {
  const [workspaceId, clientId, userId] = process.argv.slice(2);
  if (!workspaceId || !clientId || !userId) throw new Error("Uso: create-ad.ts <workspaceId> <clientId> <userId>");
  try {
    const post = await createPost(
      workspaceId,
      { clientId, kind: "AD_CREATIVE", title: "Prova variante", publishAt: new Date(), content: emptyAdContent() },
      userActor(userId)
    );
    // Never leave it behind (it only exists when the variant allows ads).
    await prisma.post.delete({ where: { id: post.id } });
    console.log("RESULT created");
  } catch (error) {
    console.log(`RESULT ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
}

main().finally(() => prisma.$disconnect());
