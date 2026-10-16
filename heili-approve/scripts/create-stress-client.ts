/**
 * Stress-test data for the client portal: one client with `count` Instagram
 * posts of one month all waiting for review (default 300), plus a reviewer
 * link (the portal offers «Rivedi tutto il mese insieme»). Not part of the seed: run it only against a test database.
 *
 *   npx tsx scripts/create-stress-client.ts <workspaceId> <userId> [month=2026-12] [count=300] [suffix]
 *
 * Prints `RESULT {json}` with the client and the review URL.
 */

import "@/lib/load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { userActor } from "@/lib/actor";
import { prisma } from "@/lib/db/client";
import { zonedDateTimeToUtc } from "@/lib/metricool/payload";
import { createPost, submitForReview } from "@/lib/posts";
import { createReviewer } from "@/lib/reviewers";
import { saveMediaStream } from "@/lib/storage";

async function main() {
  const [workspaceId, userId, month = "2026-12", countArg = "300", suffix = Date.now().toString(36)] = process.argv.slice(2);
  const count = Number(countArg);
  if (!workspaceId || !userId || !/^\d{4}-\d{2}$/.test(month) || !Number.isInteger(count) || count < 1) {
    throw new Error("Uso: create-stress-client.ts <workspaceId> <userId> [AAAA-MM] [numero] [suffisso]");
  }
  const actor = userActor(userId);
  const bytes = readFileSync(path.join(process.cwd(), "e2e", "fixtures", "post-image.png"));
  const { media } = await saveMediaStream({
    workspaceId,
    fileName: "stress.png",
    source: Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>,
    alt: "Immagine di prova",
  });

  const client = await prisma.client.create({
    data: {
      workspaceId,
      name: `Stress ${count} ${suffix}`,
      metricoolBlogId: "123456",
      timezone: "Europe/Rome",
      networks: ["instagram"],
      autoSchedule: true,
      services: ["SOCIAL_POST"],
    },
  });
  const { reviewer, reviewUrl } = await createReviewer(client.id, workspaceId, {
    name: "Marta Stress",
    email: `marta+stress${suffix}@example.com`,
  });

  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = String((i % 28) + 1).padStart(2, "0");
    const hour = String(8 + (Math.floor(i / 28) % 12)).padStart(2, "0");
    const publishAt = zonedDateTimeToUtc(`${month}-${day}T${hour}:00`, "Europe/Rome");
    if (!publishAt) throw new Error("Data non valida");
    const post = await createPost(
      workspaceId,
      {
        clientId: client.id,
        title: `Contenuto ${i + 1} del mese`,
        publishAt,
        networks: ["instagram"],
        networkOptions: { instagramData: { type: "POST" } },
        text: `Contenuto numero ${i + 1}: una frase di esempio per vedere come si taglia il testo nell'anteprima. #stress`,
        firstCommentText: null,
        media: [media],
      },
      actor
    );
    ids.push(post.id);
  }
  // submitForReview takes at most 200 posts at a time (so a plan cannot hold more).
  for (let i = 0; i < ids.length; i += 200) {
    await submitForReview(ids.slice(i, i + 200), workspaceId, actor, { notify: false });
  }

  console.log(
    `RESULT ${JSON.stringify({ clientId: client.id, reviewerId: reviewer.id, month, count: ids.length, reviewUrl, firstPostId: ids[0] })}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
