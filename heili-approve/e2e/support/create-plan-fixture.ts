/**
 * Used by e2e/monthly-plan.spec.mjs: a fresh social client ("Piano e2e …",
 * Metricool brand, automatic scheduling, one reviewer with an email) with
 * four DRAFT Instagram posts with an image in the given month (Europe/Rome),
 * created through the services like the agency's editor would. A fresh
 * client per run keeps reruns independent (one plan per client and month).
 * Prints `RESULT {json}`.
 *
 *   npx tsx e2e/support/create-plan-fixture.ts <workspaceId> <userId> <YYYY-MM> <suffix>
 */

import "@/lib/load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { userActor } from "@/lib/actor";
import { prisma } from "@/lib/db/client";
import { zonedDateTimeToUtc } from "@/lib/metricool/payload";
import { createPost } from "@/lib/posts";
import { createReviewer } from "@/lib/reviewers";
import { saveMediaStream } from "@/lib/storage";

const POSTS = [
  { day: "04", time: "09:00", title: "Lancio del mese" },
  { day: "11", time: "12:30", title: "Dietro le quinte" },
  { day: "18", time: "18:00", title: "Ricetta della settimana" },
  // 23:30 on the last day: still this month in Rome (first instant of the next in UTC+1 terms).
  { day: "last", time: "23:30", title: "Saluti di fine mese" },
];

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return String(new Date(Date.UTC(y, m, 0)).getUTCDate());
}

async function main() {
  const [workspaceId, userId, month, suffix] = process.argv.slice(2);
  if (!workspaceId || !userId || !/^\d{4}-\d{2}$/.test(month ?? "") || !suffix) {
    throw new Error("Uso: create-plan-fixture.ts <workspaceId> <userId> <YYYY-MM> <suffix>");
  }
  const client = await prisma.client.create({
    data: {
      workspaceId,
      name: `Piano e2e ${suffix}`,
      metricoolBlogId: "123456",
      timezone: "Europe/Rome",
      networks: ["instagram", "facebook"],
      autoSchedule: true,
      services: ["SOCIAL_POST"],
    },
  });
  const { reviewer, reviewUrl } = await createReviewer(client.id, workspaceId, {
    name: "Chiara Fabbri",
    email: `chiara+${suffix}@example.com`,
  });

  const image = readFileSync(path.join(process.cwd(), "e2e", "fixtures", "post-image.png"));
  const posts: Array<{ id: string; title: string }> = [];
  for (const [i, spec] of POSTS.entries()) {
    const day = spec.day === "last" ? lastDay(month) : spec.day;
    const publishAt = zonedDateTimeToUtc(`${month}-${day.padStart(2, "0")}T${spec.time}`, "Europe/Rome");
    if (!publishAt) throw new Error("Data non valida");
    const { media } = await saveMediaStream({
      workspaceId,
      fileName: `piano-e2e-${i + 1}.png`,
      source: Readable.toWeb(Readable.from([image])) as ReadableStream<Uint8Array>,
      alt: spec.title,
    });
    const post = await createPost(
      workspaceId,
      {
        clientId: client.id,
        title: `${spec.title} ${suffix}`,
        publishAt,
        networks: ["instagram"],
        networkOptions: { instagramData: { type: "POST" } },
        text: `${spec.title}: il nostro post del mese. #e2e`,
        firstCommentText: null,
        media: [media],
      },
      userActor(userId)
    );
    posts.push({ id: post.id, title: post.title });
  }
  console.log(`RESULT ${JSON.stringify({ clientId: client.id, clientName: client.name, reviewerId: reviewer.id, reviewUrl, posts })}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
