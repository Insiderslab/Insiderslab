/**
 * Stress seed: `npx tsx scripts/stress-seed.ts` (after `npm run db:seed`).
 *
 * Fills the demo workspace with a large, fictional data set to measure load
 * and rendering (docs/QA-2026-10-16-stress.md):
 * - 20 clients "Cliente Prova 01…20", all three services, one reviewer each;
 * - client 01: a monthly plan for NEXT month with 300 social posts IN_REVIEW
 *   (single images, a 10-image carousel every 10th post, a Reel every 7th),
 *   plus 30 articles and 30 ads creatives in the same month;
 * - one post of client 01 with 200 comments (agency and client), one with 50
 *   versions (each one sent to the client);
 * - clients 02…20: ten social posts IN_REVIEW each.
 *
 * Media are reused from the demo seed (no new uploads). Idempotent: a client
 * that already exists is left alone. Refuses NODE_ENV=production. The last
 * stdout line is `STRESS_JSON {...}` (review links, ids) for the load scripts.
 */

import "@/lib/load-env";
import { userActor, reviewerActor } from "@/lib/actor";
import { prisma } from "@/lib/db/client";
import type { MediaItem, Network, NetworkOptions } from "@/lib/domain";
import { zonedDateTimeToUtc } from "@/lib/metricool/payload";
import { addComment, createPost, submitForReview, updatePost } from "@/lib/posts";
import { addPlanMonths, defaultPlanTitle, planMonthOf } from "@/lib/plan-rules";
import { syncPlanStatus } from "@/lib/plans";
import { createReviewer, getReviewUrl } from "@/lib/reviewers";

if (process.env.NODE_ENV === "production") {
  console.error("Stress seed rifiutato in produzione.");
  process.exit(1);
}
process.env.APP_VARIANT = "all";

const OWNER_EMAIL = "stefano@insiderslab.it";
const CLIENTS = 20;
const PLAN_POSTS = Number(process.env.STRESS_PLAN_POSTS ?? 300);
const EXTRA_ARTICLES = 30;
const EXTRA_ADS = 30;
const OTHER_CLIENT_POSTS = 10;
const COMMENTS = 200;
const VERSIONS = 50;

const pad = (n: number) => String(n).padStart(2, "0");

function collectMedia(value: unknown, out: MediaItem[]) {
  if (Array.isArray(value)) value.forEach((v) => collectMedia(v, out));
  else if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.url === "string" && (v.type === "image" || v.type === "video") && typeof v.mimeType === "string") {
      out.push(v as unknown as MediaItem);
      return;
    }
    Object.values(v).forEach((x) => collectMedia(x, out));
  }
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
  const member = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  const workspaceId = member.workspaceId;
  const actor = userActor(user.id);

  // Media and content templates from the demo seed.
  const versions = await prisma.postVersion.findMany({
    where: { post: { workspaceId } },
    select: { media: true, content: true, post: { select: { kind: true, title: true } } },
  });
  const all: MediaItem[] = [];
  versions.forEach((v) => {
    collectMedia(v.media, all);
    collectMedia(v.content, all);
  });
  const byUrl = new Map(all.map((m) => [m.url, m]));
  const images = [...byUrl.values()].filter((m) => m.type === "image" && m.mimeType !== "image/svg+xml");
  const video = [...byUrl.values()].find((m) => m.type === "video");
  const blog = versions.find((v) => v.post.kind === "BLOG_ARTICLE")?.content;
  const ad = versions.find((v) => v.post.kind === "AD_CREATIVE" && v.post.title.startsWith("Iscrizioni"))?.content;
  if (images.length < 10 || !video || !blog || !ad) throw new Error("Esegui prima npm run db:seed (media di esempio mancanti)");

  const month = addPlanMonths(planMonthOf(new Date(), "Europe/Rome"), 1);
  const at = (day: number, minutes: number) =>
    zonedDateTimeToUtc(`${month}-${pad(day)}T${pad(8 + Math.floor(minutes / 60))}:${pad(minutes % 60)}`, "Europe/Rome")!;

  const out: {
    month: string;
    clients: Array<{ id: string; name: string; reviewerId: string; reviewUrl: string }>;
    planId?: string;
    commentsPostId?: string;
    versionsPostId?: string;
    carouselPostId?: string;
    reelPostId?: string;
  } = { month, clients: [] };

  for (let c = 1; c <= CLIENTS; c++) {
    const name = `Cliente Prova ${pad(c)}`;
    let client = await prisma.client.findFirst({ where: { workspaceId, name } });
    const fresh = !client;
    if (!client) {
      client = await prisma.client.create({
        data: {
          workspaceId,
          name,
          timezone: "Europe/Rome",
          networks: ["instagram", "facebook", "linkedin"],
          metricoolBlogId: `stress-${pad(c)}`,
          autoSchedule: true,
          services: ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"],
        },
      });
    }
    let reviewer = await prisma.clientReviewer.findFirst({ where: { clientId: client.id, active: true } });
    if (!reviewer) {
      reviewer = (await createReviewer(client.id, workspaceId, { name: `Revisore ${pad(c)}`, email: `revisore${pad(c)}@example.com` }))
        .reviewer;
    }
    out.clients.push({ id: client.id, name, reviewerId: reviewer.id, reviewUrl: getReviewUrl(reviewer) });
    if (!fresh) {
      if (c === 1) {
        const plan = await prisma.contentPlan.findFirst({ where: { clientId: client.id, month } });
        out.planId = plan?.id;
      }
      continue;
    }

    const t0 = Date.now();
    if (c === 1) {
      const plan = await prisma.contentPlan.create({
        data: {
          workspaceId,
          clientId: client.id,
          kind: "SOCIAL_POST",
          month,
          title: defaultPlanTitle(month),
          intro: "Piano di prova con molti contenuti, per misurare i tempi.",
          createdById: user.id,
        },
      });
      out.planId = plan.id;
      const ids: string[] = [];
      for (let i = 0; i < PLAN_POSTS; i++) {
        const day = 1 + (i % 28);
        const isCarousel = i % 10 === 3;
        const isReel = !isCarousel && i % 7 === 5;
        const networks: Network[] = isReel ? ["instagram"] : i % 3 === 0 ? ["instagram", "facebook", "linkedin"] : ["instagram", "facebook"];
        const networkOptions: NetworkOptions = isReel
          ? { instagramData: { type: "REEL" } }
          : ({ instagramData: { type: "POST" } } as NetworkOptions);
        const media: MediaItem[] = isReel
          ? [video]
          : isCarousel
            ? Array.from({ length: 10 }, (_, k) => ({ ...images[(i + k) % images.length], alt: `Immagine ${k + 1} di 10` }))
            : [images[i % images.length]];
        const post = await createPost(
          workspaceId,
          {
            clientId: client.id,
            title: `${isReel ? "Reel" : isCarousel ? "Carosello" : "Post"} ${String(i + 1).padStart(3, "0")} del mese`,
            publishAt: at(day, (i * 7) % 600),
            networks,
            networkOptions,
            text:
              `Testo di prova del contenuto ${i + 1}. Una frase per raccontare il prodotto, una per la storia del brand ` +
              `e una chiamata all'azione.\n\n#prova #heili #contenuto${i + 1}`,
            firstCommentText: i % 4 === 0 ? "Primo commento con gli hashtag #prova" : null,
            media,
          },
          actor
        );
        ids.push(post.id);
        if (isCarousel && !out.carouselPostId) out.carouselPostId = post.id;
        if (isReel && !out.reelPostId) out.reelPostId = post.id;
      }
      await prisma.post.updateMany({ where: { id: { in: ids } }, data: { planId: plan.id } });
      const reviewDueAt = at(1, 600);
      for (let i = 0; i < ids.length; i += 50) {
        await submitForReview(ids.slice(i, i + 50), workspaceId, actor, { reviewDueAt, notify: false });
      }
      await prisma.contentPlan.update({ where: { id: plan.id }, data: { sentAt: new Date(), reviewDueAt } });
      await syncPlanStatus(plan.id);

      const extra: string[] = [];
      for (let i = 0; i < EXTRA_ARTICLES; i++) {
        const content = { ...(blog as Record<string, unknown>), slug: `articolo-prova-${i + 1}`, headline: `Articolo di prova ${i + 1}` };
        const p = await createPost(
          workspaceId,
          { clientId: client.id, kind: "BLOG_ARTICLE", title: `Articolo ${pad(i + 1)} del mese`, publishAt: at(1 + (i % 28), 60), content },
          actor
        );
        extra.push(p.id);
      }
      for (let i = 0; i < EXTRA_ADS; i++) {
        const p = await createPost(
          workspaceId,
          { clientId: client.id, kind: "AD_CREATIVE", title: `Creatività ${pad(i + 1)} del mese`, publishAt: at(1 + (i % 28), 120), content: ad },
          actor
        );
        extra.push(p.id);
      }
      for (let i = 0; i < extra.length; i += 50) {
        await submitForReview(extra.slice(i, i + 50), workspaceId, actor, { notify: false });
      }

      // 200 comments on one post (agency and client, some pinned on the image).
      const commented = ids[0];
      out.commentsPostId = commented;
      const rActor = reviewerActor(reviewer.id);
      for (let k = 0; k < COMMENTS; k++) {
        const fromClient = k % 2 === 0;
        await addComment({
          postId: commented,
          body: `${fromClient ? "Commento del cliente" : "Risposta dell'agenzia"} numero ${k + 1}: va bene così? Cambierei una parola.`,
          actor: fromClient ? rActor : actor,
          workspaceId: fromClient ? undefined : workspaceId,
          ...(fromClient && k % 6 === 0 ? { mediaIndex: 0, pinX: 0.3 + (k % 5) / 10, pinY: 0.4 } : {}),
        });
      }

      // 50 versions on another post, each one sent to the client.
      const versioned = ids[1];
      out.versionsPostId = versioned;
      for (let v = 2; v <= VERSIONS; v++) {
        await updatePost(
          versioned,
          workspaceId,
          { text: `Versione ${v} del testo: cambia una parola ogni volta (${v}).\n\n#prova`, changeNote: `Modifica ${v}` },
          actor
        );
        await submitForReview([versioned], workspaceId, actor, { notify: false });
      }
    } else {
      const ids: string[] = [];
      for (let i = 0; i < OTHER_CLIENT_POSTS; i++) {
        const p = await createPost(
          workspaceId,
          {
            clientId: client.id,
            title: `Post ${pad(i + 1)} di ${name}`,
            publishAt: at(1 + i * 2, 60),
            networks: ["instagram"],
            networkOptions: { instagramData: { type: "POST" } } as NetworkOptions,
            text: `Testo di prova ${i + 1} per ${name}.`,
            media: [images[(c + i) % images.length]],
          },
          actor
        );
        ids.push(p.id);
      }
      await submitForReview(ids, workspaceId, actor, { notify: false });
    }
    console.error(`${name}: ${Date.now() - t0} ms`);
  }

  const counts = await prisma.post.groupBy({
    by: ["status"],
    where: { workspaceId },
    _count: true,
  });
  console.error("Post per stato:", JSON.stringify(counts));
  console.log(`STRESS_JSON ${JSON.stringify(out)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
