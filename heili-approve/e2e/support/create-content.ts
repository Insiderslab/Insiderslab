/**
 * Used by e2e/client-services.spec.mjs: tries to create an item of `kind`
 * for a client through the service (the same path as the agency's server
 * actions) and prints the outcome as `RESULT ...`. Anything created is
 * deleted right away.
 *
 *   npx tsx e2e/support/create-content.ts <workspaceId> <clientId> <userId> <SOCIAL_POST|BLOG_ARTICLE|AD_CREATIVE>
 */

import "@/lib/load-env";
import type { ContentKind } from "@/app/generated/prisma/client";
import { userActor } from "@/lib/actor";
import { emptyAdContent } from "@/lib/content/ads";
import { emptyBlogContent } from "@/lib/content/blog";
import { prisma } from "@/lib/db/client";
import { createPost, type PostInput } from "@/lib/posts";

function inputFor(kind: ContentKind, clientId: string): PostInput {
  const base = { clientId, kind, title: "Prova servizio", publishAt: new Date() };
  if (kind === "SOCIAL_POST") return { ...base, networks: ["instagram"], text: "Prova", media: [] };
  return { ...base, content: kind === "BLOG_ARTICLE" ? emptyBlogContent() : emptyAdContent() };
}

async function main() {
  const [workspaceId, clientId, userId, kind] = process.argv.slice(2);
  if (!workspaceId || !clientId || !userId || !kind) {
    throw new Error("Uso: create-content.ts <workspaceId> <clientId> <userId> <kind>");
  }
  try {
    const post = await createPost(workspaceId, inputFor(kind as ContentKind, clientId), userActor(userId));
    await prisma.post.delete({ where: { id: post.id } });
    console.log("RESULT created");
  } catch (error) {
    console.log(`RESULT ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
}

main().finally(() => prisma.$disconnect());
