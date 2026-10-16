/**
 * Used by e2e/portal-layout.spec.mjs and e2e/heili-dock-layout.spec.mjs: a fresh
 * client with the three services (social, blog, ads) and one reviewer, so the
 * layout checks do not depend on what other specs did to the seed.
 *
 * - a social post in review with a two-image carousel (media stage, chevrons)
 * - a social post that already has «Chiedi modifiche» (CHANGES_REQUESTED)
 * - a Meta ads set in review with two variants (decision bar with the long
 *   «Invia le mie decisioni» label)
 * - a blog article in review
 *
 * Prints `RESULT {json}`.
 *
 *   npx tsx e2e/support/create-portal-fixture.ts <workspaceId> <userId> <suffix>
 */

import "@/lib/load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { userActor } from "@/lib/actor";
import { emptyBlogContent } from "@/lib/content/blog";
import type { AdContent } from "@/lib/content/ads";
import { prisma } from "@/lib/db/client";
import type { MediaItem } from "@/lib/domain";
import { createPost, requestChanges, submitForReview } from "@/lib/posts";
import { createReviewer } from "@/lib/reviewers";
import { saveMediaStream } from "@/lib/storage";

const fixtures = path.join(process.cwd(), "e2e", "fixtures");

async function main() {
  const [workspaceId, userId, suffix] = process.argv.slice(2);
  if (!workspaceId || !userId || !suffix) {
    throw new Error("Uso: create-portal-fixture.ts <workspaceId> <userId> <suffix>");
  }
  const actor = userActor(userId);
  const image = readFileSync(path.join(fixtures, "post-image.png"));
  const square = readFileSync(path.join(fixtures, "ad-square.png"));

  async function upload(fileName: string, bytes: Buffer, alt: string): Promise<MediaItem> {
    const { media } = await saveMediaStream({
      workspaceId,
      fileName,
      source: Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>,
      alt,
    });
    return media;
  }

  const client = await prisma.client.create({
    data: {
      workspaceId,
      name: `Barra e2e ${suffix}`,
      metricoolBlogId: "123456",
      timezone: "Europe/Rome",
      networks: ["instagram"],
      autoSchedule: true,
      services: ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"],
    },
  });
  const { reviewer, reviewUrl } = await createReviewer(client.id, workspaceId, {
    name: "Chiara Fabbri",
    email: `chiara+barra${suffix}@example.com`,
  });
  const publishAt = new Date(Date.now() + 10 * 86_400_000);

  async function social(title: string, media: MediaItem[]) {
    const post = await createPost(
      workspaceId,
      {
        clientId: client.id,
        title: `${title} ${suffix}`,
        publishAt,
        networks: ["instagram"],
        networkOptions: { instagramData: { type: "POST" } },
        text: `${title}: un testo abbastanza lungo da essere tagliato nell'anteprima, con una seconda frase che continua e continua ancora. #e2e`,
        firstCommentText: null,
        media,
      },
      actor
    );
    return post;
  }

  const carousel = await social("Carosello barra", [
    await upload("barra-1.png", image, "Prima immagine"),
    await upload("barra-2.png", image, "Seconda immagine"),
  ]);
  const asked = await social("Modifiche già chieste", [await upload("barra-3.png", image, "Immagine")]);
  await submitForReview([carousel.id, asked.id], workspaceId, actor, { notify: false });
  await requestChanges(asked.id, { id: reviewer.id, clientId: client.id }, 1, "Il colore è troppo scuro.");

  const url = "https://www.example.com/prova";
  const adContent: AdContent = {
    campaign: { name: "Barra e2e", platform: "meta", objective: "Contatti (lead)", budgetNote: "", audienceNote: "" },
    variants: [
      {
        id: "A",
        name: "Variante A",
        media: [await upload("barra-ad-a.png", square, "Annuncio A")],
        primaryText: "Prova gratis per 7 giorni.",
        headline: "7 giorni di prova",
        description: "Senza vincoli",
        cta: "Iscriviti",
        destinationUrl: url,
        placements: ["meta_feed"],
      },
      {
        id: "B",
        name: "Variante B",
        media: [await upload("barra-ad-b.png", square, "Annuncio B")],
        primaryText: "La prima settimana è gratis.",
        headline: "Prima settimana gratis",
        description: "Nessun obbligo",
        cta: "Scopri di più",
        destinationUrl: url,
        placements: ["meta_feed"],
      },
    ],
  };
  const ads = await createPost(
    workspaceId,
    { clientId: client.id, kind: "AD_CREATIVE", title: `Annunci barra ${suffix}`, publishAt, content: adContent },
    actor
  );

  const blog = await createPost(
    workspaceId,
    {
      clientId: client.id,
      kind: "BLOG_ARTICLE",
      title: `Articolo barra ${suffix}`,
      publishAt,
      content: {
        ...emptyBlogContent(),
        headline: "Un articolo per provare la barra",
        slug: `articolo-barra-${suffix}`,
        bodyMarkdown: `${"Un paragrafo di prova per controllare l'impaginazione della barra. ".repeat(10)}\n\n## Un titolo\n\n${"Un secondo paragrafo di prova per l'articolo. ".repeat(10)}`,
        excerpt: "Una frase di sommario.",
        metaTitle: "Articolo di prova",
        metaDescription: "Descrizione di prova dell'articolo per i controlli di impaginazione.",
        focusKeyword: "prova",
        featuredImage: await upload("barra-blog.png", readFileSync(path.join(fixtures, "blog-featured.png")), "Copertina"),
      },
    },
    actor
  );
  await submitForReview([ads.id, blog.id], workspaceId, actor, { notify: false });

  console.log(
    `RESULT ${JSON.stringify({
      clientId: client.id,
      clientName: client.name,
      reviewUrl,
      carouselId: carousel.id,
      carouselTitle: carousel.title,
      askedId: asked.id,
      adsId: ads.id,
      blogId: blog.id,
    })}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
