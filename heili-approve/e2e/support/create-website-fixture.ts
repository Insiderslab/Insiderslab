/**
 * Used by e2e/website-live.spec.mjs.
 *
 *   npx tsx e2e/support/create-website-fixture.ts client <workspaceId> <suffix>
 *     a fresh client with the «Siti web» service and one reviewer
 *   npx tsx e2e/support/create-website-fixture.ts launch <postId> <reviewerId>
 *     a one-time launch code (as «Apri il sito» makes), for the negative checks
 *
 * Prints `RESULT {json}`.
 */

import "@/lib/load-env";
import { prisma } from "@/lib/db/client";
import { coerceWebsiteContent } from "@/lib/content/website";
import { createReviewer } from "@/lib/reviewers";
import { createLaunch } from "@/lib/website/sessions";

async function main() {
  const [command, a, b] = process.argv.slice(2);
  if (command === "client") {
    if (!a || !b) throw new Error("Uso: client <workspaceId> <suffix>");
    const client = await prisma.client.create({
      data: { workspaceId: a, name: `Officina Nord e2e ${b}`, timezone: "Europe/Rome", networks: [], autoSchedule: false, services: ["WEBSITE"] },
    });
    const { reviewer, reviewUrl } = await createReviewer(client.id, a, { name: "Chiara Fabbri", email: `chiara+sito${b}@example.com` });
    console.log(`RESULT ${JSON.stringify({ clientId: client.id, reviewerId: reviewer.id, reviewUrl })}`);
    return;
  }
  if (command === "launch") {
    if (!a || !b) throw new Error("Uso: launch <postId> <reviewerId>");
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: a },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });
    const content = coerceWebsiteContent(post.versions[0]?.content);
    if (!content.siteId) throw new Error("Il sito non ha una chiave");
    const { code } = await createLaunch({
      siteId: content.siteId,
      postId: post.id,
      versionNumber: post.currentVersionNumber,
      role: "REVIEWER",
      reviewerId: b,
    });
    console.log(`RESULT ${JSON.stringify({ code })}`);
    return;
  }
  throw new Error("Comando sconosciuto");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
