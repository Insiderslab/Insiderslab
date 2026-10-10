/**
 * Used by e2e/month-review.spec.mjs: two fresh social clients so reruns stay
 * independent.
 *
 * - Client A ("Mese e2e …", Metricool brand, automatic scheduling, one
 *   reviewer) with a SENT plan for `planMonth` with five Instagram posts in
 *   review (one image, a two-image carousel, a Reel, an Instagram + Facebook
 *   image, one at 23:30 on the last day), and three posts in review for
 *   `looseMonth` that belong to no plan.
 * - Client B ("Mese e2e B …") with two posts in review in `otherMonth`, a
 *   month client A has nothing in: A's link to it must answer 404.
 *
 * Prints `RESULT {json}`.
 *
 *   npx tsx e2e/support/create-month-fixture.ts <workspaceId> <userId> <planMonth> <looseMonth> <otherMonth> <suffix>
 */

import "@/lib/load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { userActor } from "@/lib/actor";
import { prisma } from "@/lib/db/client";
import type { MediaItem, NetworkOptions } from "@/lib/domain";
import { zonedDateTimeToUtc } from "@/lib/metricool/payload";
import { createPlan, sendPlan } from "@/lib/plans";
import { createPost, submitForReview } from "@/lib/posts";
import { createReviewer } from "@/lib/reviewers";
import { saveMediaStream } from "@/lib/storage";

const fixtures = path.join(process.cwd(), "e2e", "fixtures");

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return String(new Date(Date.UTC(y, m, 0)).getUTCDate());
}

async function main() {
  const [workspaceId, userId, planMonth, looseMonth, otherMonth, suffix] = process.argv.slice(2);
  if (!workspaceId || !userId || !suffix || ![planMonth, looseMonth, otherMonth].every((m) => /^\d{4}-\d{2}$/.test(m ?? ""))) {
    throw new Error("Uso: create-month-fixture.ts <workspaceId> <userId> <planMonth> <looseMonth> <otherMonth> <suffix>");
  }
  const actor = userActor(userId);
  const image = readFileSync(path.join(fixtures, "post-image.png"));
  const video = readFileSync(path.join(fixtures, "reel-test.mp4"));

  async function upload(fileName: string, bytes: Buffer, alt: string): Promise<MediaItem> {
    const { media } = await saveMediaStream({
      workspaceId,
      fileName,
      source: Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>,
      alt,
    });
    return media;
  }

  async function makeClient(name: string) {
    const client = await prisma.client.create({
      data: {
        workspaceId,
        name,
        metricoolBlogId: "123456",
        timezone: "Europe/Rome",
        networks: ["instagram", "facebook"],
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

  async function makePost(
    clientId: string,
    month: string,
    day: string,
    time: string,
    title: string,
    opts: { networks?: Array<"instagram" | "facebook">; media: MediaItem[]; options?: NetworkOptions }
  ) {
    const publishAt = zonedDateTimeToUtc(`${month}-${(day === "last" ? lastDay(month) : day).padStart(2, "0")}T${time}`, "Europe/Rome");
    if (!publishAt) throw new Error("Data non valida");
    const post = await createPost(
      workspaceId,
      {
        clientId,
        title: `${title} ${suffix}`,
        publishAt,
        networks: opts.networks ?? ["instagram"],
        networkOptions: opts.options ?? { instagramData: { type: "POST" }, facebookData: { type: "POST" } },
        text: `${title}: il nostro post del mese. Una seconda frase per vedere come si taglia il testo nell'anteprima. #e2e`,
        firstCommentText: null,
        media: opts.media,
      },
      actor
    );
    return { id: post.id, title: post.title };
  }

  // ── Client A: a sent plan, plus posts of another month outside any plan ──
  const a = await makeClient(`Mese e2e ${suffix}`);
  const planPosts = [
    await makePost(a.client.id, planMonth, "04", "09:00", "Lancio del mese", {
      media: [await upload("mese-1.png", image, "Lancio")],
    }),
    await makePost(a.client.id, planMonth, "11", "12:30", "Carosello dietro le quinte", {
      media: [await upload("mese-2a.png", image, "Prima"), await upload("mese-2b.png", image, "Seconda")],
    }),
    await makePost(a.client.id, planMonth, "15", "18:00", "Reel della settimana", {
      media: [await upload("mese-3.mp4", video, "Reel")],
      options: { instagramData: { type: "REEL" } },
    }),
    await makePost(a.client.id, planMonth, "20", "10:00", "Ricetta su due reti", {
      networks: ["instagram", "facebook"],
      media: [await upload("mese-4.png", image, "Ricetta")],
    }),
    await makePost(a.client.id, planMonth, "last", "23:30", "Saluti di fine mese", {
      media: [await upload("mese-5.png", image, "Saluti")],
    }),
  ];
  const { plan } = await createPlan(workspaceId, { clientId: a.client.id, month: planMonth }, actor);
  await sendPlan(plan.id, workspaceId, actor);

  const loosePosts = [
    await makePost(a.client.id, looseMonth, "06", "09:30", "Singolo uno", { media: [await upload("mese-6.png", image, "Uno")] }),
    await makePost(a.client.id, looseMonth, "13", "17:00", "Singolo due", { media: [await upload("mese-7.png", image, "Due")] }),
    await makePost(a.client.id, looseMonth, "22", "11:00", "Singolo tre", { media: [await upload("mese-8.png", image, "Tre")] }),
  ];
  await submitForReview(
    loosePosts.map((p) => p.id),
    workspaceId,
    actor,
    { notify: false }
  );

  // ── Client B: a month client A has nothing in ──
  const b = await makeClient(`Mese e2e B ${suffix}`);
  const otherPosts = [
    await makePost(b.client.id, otherMonth, "08", "09:00", "Altro cliente uno", { media: [await upload("mese-9.png", image, "B1")] }),
    await makePost(b.client.id, otherMonth, "16", "09:00", "Altro cliente due", { media: [await upload("mese-10.png", image, "B2")] }),
  ];
  await submitForReview(
    otherPosts.map((p) => p.id),
    workspaceId,
    actor,
    { notify: false }
  );

  console.log(
    `RESULT ${JSON.stringify({
      a: { clientId: a.client.id, clientName: a.client.name, reviewUrl: a.reviewUrl },
      b: { clientId: b.client.id, clientName: b.client.name, reviewUrl: b.reviewUrl },
      planId: plan.id,
      planPosts,
      loosePosts,
      otherPosts,
    })}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
