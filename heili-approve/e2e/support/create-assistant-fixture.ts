/**
 * Used by e2e/assistant-after-changes.spec.mjs: a fresh social client (one
 * reviewer) with one Instagram post in review, so reruns stay independent.
 * Another client of the same workspace gets a post too, to check isolation.
 *
 * Prints `RESULT {json}`.
 *
 *   npx tsx e2e/support/create-assistant-fixture.ts <workspaceId> <userId> <suffix>
 */

import "@/lib/load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { userActor } from "@/lib/actor";
import { prisma } from "@/lib/db/client";
import { createPost, submitForReview } from "@/lib/posts";
import { createReviewer } from "@/lib/reviewers";
import { saveMediaStream } from "@/lib/storage";

async function main() {
  const [workspaceId, userId, suffix] = process.argv.slice(2);
  if (!workspaceId || !userId || !suffix) {
    throw new Error("Uso: create-assistant-fixture.ts <workspaceId> <userId> <suffix>");
  }
  const actor = userActor(userId);
  const image = readFileSync(path.join(process.cwd(), "e2e", "fixtures", "post-image.png"));

  async function makeClient(name: string) {
    const client = await prisma.client.create({
      data: {
        workspaceId,
        name,
        metricoolBlogId: "123456",
        timezone: "Europe/Rome",
        networks: ["instagram"],
        autoSchedule: true,
        services: ["SOCIAL_POST"],
      },
    });
    const { reviewer, reviewUrl } = await createReviewer(client.id, workspaceId, {
      name: "Chiara Fabbri",
      email: `chiara+${name.replace(/\W+/g, "").toLowerCase()}@example.com`,
    });
    return { client, reviewer, reviewUrl };
  }

  async function makePost(clientId: string, title: string) {
    const { media } = await saveMediaStream({
      workspaceId,
      fileName: "heili.png",
      source: Readable.toWeb(Readable.from([image])) as ReadableStream<Uint8Array>,
      alt: title,
    });
    const post = await createPost(
      workspaceId,
      {
        clientId,
        title: `${title} ${suffix}`,
        publishAt: new Date(Date.now() + 10 * 86_400_000),
        networks: ["instagram"],
        networkOptions: { instagramData: { type: "POST" } },
        text: `${title}: un post per provare Heili dopo le modifiche richieste. #e2e`,
        firstCommentText: null,
        media: [media],
      },
      actor
    );
    await submitForReview([post.id], workspaceId, actor, { notify: false });
    return { id: post.id, title: post.title };
  }

  const a = await makeClient(`Heili e2e ${suffix}`);
  const b = await makeClient(`Heili e2e B ${suffix}`);
  const post = await makePost(a.client.id, "Post con Heili");
  const otherPost = await makePost(b.client.id, "Post di un altro cliente");

  console.log(
    `RESULT ${JSON.stringify({
      clientId: a.client.id,
      clientName: a.client.name,
      reviewUrl: a.reviewUrl,
      post,
      otherPost,
    })}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
