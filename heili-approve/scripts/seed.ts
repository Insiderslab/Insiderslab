/**
 * Development seed: `npm run db:seed`.
 *
 * Creates (or completes, when re-run) a demo agency workspace:
 * - user stefano@insiderslab.it, OWNER of workspace "InsidersLab";
 * - a database Session with a fixed token, printed to stdout, so a browser can
 *   log in without a magic link (set the `authjs.session-token` cookie);
 * - two clients (one linked to Metricool brand "123456"), one reviewer each,
 *   with their review links printed;
 * - posts in several states with placeholder images saved through lib/storage;
 * - a blog client ("Cantina Valdobbia") with two articles: one IN_REVIEW, one
 *   CHANGES_REQUESTED with a comment anchored to a sentence and version 2
 *   saved but not yet re-sent;
 * - an ads client ("Palestra Kinetik") with a Meta creative set of three
 *   variants (1:1 and 4:5 images, a 9:16 VP9 video with a 9:16 poster),
 *   IN_REVIEW. The video comes from ffmpeg (testsrc); without ffmpeg the e2e
 *   fixture video is used instead.
 *
 * - for the same client a Google Ads set ("Google Ads — prenotazioni
 *   autunno"): a Search variant with headlines, descriptions and keywords and
 *   a Performance Max variant with images and a logo, IN_REVIEW.
 *
 * - a client with all three services ("Agriturismo Le Querce": social posts,
 *   articles and ads creatives) with one item of each kind IN_REVIEW, to see
 *   the unified portal with its tabs. It also has a second reviewer without
 *   email ("Paolo Fabbri"): the agency sends that link by hand (WhatsApp…).
 *
 * - a monthly plan ("Piano del mese") for Caffè Aurora NEXT month: six
 *   social posts IN_REVIEW, attached to the plan, sent with an intro from the
 *   agency (only these posts: other drafts of that month are left alone).
 *
 * Every client gets its services (Client.services): Aurora and Verde social
 * posts, Cantina articles, Kinetik ads creatives, Le Querce all three.
 *
 * Blog and ads content is created whatever APP_VARIANT says (the seed runs
 * as "all"): an instance only shows the kinds it handles.
 *
 * Idempotent: existing rows are reused (matched by email / name / title), so
 * running it twice changes nothing. The last stdout line is `SEED_JSON {...}`
 * for scripts (the e2e test reads it).
 *
 * Refuses to run with NODE_ENV=production (a fixed session token and demo
 * data have no place in production) unless SEED_ALLOW_PRODUCTION=1.
 */

import "@/lib/load-env";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { deflateSync } from "node:zlib";
import type { ContentKind, Post, PostStatus } from "@/app/generated/prisma/client";
import { userActor, reviewerActor, SYSTEM_ACTOR } from "@/lib/actor";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db/client";
import type { MediaItem, Network, NetworkOptions } from "@/lib/domain";
import { recordEvent } from "@/lib/events";
import { zonedDateTimeToUtc } from "@/lib/metricool/payload";
import type { AdContent, BlogContent } from "@/lib/content/types";
import { buildAnchor, htmlToTextWithBlocks, renderMarkdownSafe } from "@/lib/content/blog";
import { addComment, createPost, requestChanges, submitForReview, updatePost } from "@/lib/posts";
import { addPlanMonths, defaultPlanTitle, planMonthName, planMonthOf } from "@/lib/plan-rules";
import { syncPlanStatus } from "@/lib/plans";
import { createReviewer, getReviewUrl } from "@/lib/reviewers";
import { saveMediaStream } from "@/lib/storage";
import { sortKinds } from "@/lib/variant";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
  console.error("Seed rifiutato: NODE_ENV=production (imposta SEED_ALLOW_PRODUCTION=1 se sei sicuro).");
  process.exit(1);
}

// The demo workspace holds every kind; APP_VARIANT only filters what an
// instance shows, so the seed itself always runs as "all".
process.env.APP_VARIANT = "all";

const OWNER_EMAIL = "stefano@insiderslab.it";
const WORKSPACE_NAME = "InsidersLab";
/** Fixed dev session token: cookie `authjs.session-token=<this>`. */
export const DEV_SESSION_TOKEN = process.env.SEED_SESSION_TOKEN ?? "dev-session-stefano-insiderslab-0000000001";
const SESSION_DAYS = 30;

// Muted brand-ish palettes for the placeholder images.
const PALETTES: Record<string, [number[], number[], number[]]> = {
  espresso: [[74, 46, 32], [196, 154, 108], [245, 236, 222]],
  cappuccino: [[139, 94, 60], [230, 204, 170], [255, 250, 242]],
  garden: [[46, 84, 62], [143, 179, 132], [236, 243, 230]],
  concrete: [[70, 76, 84], [168, 176, 186], [240, 242, 245]],
  sunset: [[176, 82, 52], [236, 170, 96], [252, 236, 214]],
};

// ─── PNG generation (plain Node: zlib + a CRC table) ─────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

/**
 * A soft "photo-like" placeholder: vertical gradient, a sun/plate circle and
 * a darker band (table / horizon), with a seed-dependent layout.
 */
function placeholderPng(width: number, height: number, palette: keyof typeof PALETTES, variant: number): Buffer {
  const [dark, mid, light] = PALETTES[palette];
  const cx = width * (0.35 + 0.3 * ((variant * 37) % 10) / 10);
  const cy = height * (0.3 + 0.2 * ((variant * 53) % 10) / 10);
  const radius = Math.min(width, height) * (0.18 + 0.04 * (variant % 3));
  const band = height * (0.68 + 0.05 * (variant % 2));

  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowBytes] = 0; // filter: none
    const base = mix(light, mid, y / height);
    for (let x = 0; x < width; x++) {
      let color = base;
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius) color = mix(mid, dark, 0.35 + 0.4 * (d / radius));
      else if (d < radius + 3) color = mix(color, light, 0.8);
      if (y > band) color = mix(dark, mid, ((y - band) / (height - band)) * 0.5 + ((x % 97) / 97) * 0.08);
      const o = y * rowBytes + 1 + x * 3;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function saveImage(
  workspaceId: string,
  fileName: string,
  palette: keyof typeof PALETTES,
  variant: number,
  alt: string,
  size: { width: number; height: number } = { width: 864, height: 1080 }
): Promise<MediaItem> {
  const png = placeholderPng(size.width, size.height, palette, variant);
  const source = Readable.toWeb(Readable.from([png])) as ReadableStream<Uint8Array>;
  const { media } = await saveMediaStream({ workspaceId, fileName, source, alt });
  return media;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/** `days` from today at hh:mm in Rome, as a UTC instant. */
function romeAt(days: number, time: string): Date {
  const day = new Date(Date.now() + days * 86_400_000);
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(day);
  const result = zonedDateTimeToUtc(`${local}T${time}`, "Europe/Rome");
  if (!result) throw new Error(`Invalid seed date ${local}T${time}`);
  return result;
}

// ─── Seed steps ──────────────────────────────────────────────────────────────

async function seedOwner() {
  const user = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: { email: OWNER_EMAIL, name: "Stefano Finoti", emailVerified: new Date() },
  });

  let workspace =
    (await prisma.workspace.findFirst({ where: { ownerId: user.id, name: WORKSPACE_NAME } })) ??
    // A workspace auto-created at first login ("stefano's workspace") is renamed.
    (await prisma.workspace.findFirst({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" } }));

  workspace = workspace
    ? await prisma.workspace.update({ where: { id: workspace.id }, data: { name: WORKSPACE_NAME } })
    : await prisma.workspace.create({ data: { name: WORKSPACE_NAME, ownerId: user.id } });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });

  // Demo Metricool connection (only meaningful with METRICOOL_FAKE=1).
  if (!workspace.metricoolUserId) {
    workspace = await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        metricoolUserId: "1234567",
        metricoolTokenEncrypted: encryptSecret("demo-token-metricool-fake"),
        metricoolConnectedAt: new Date(),
      },
    });
  }

  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.upsert({
    where: { sessionToken: DEV_SESSION_TOKEN },
    update: { userId: user.id, expires },
    create: { sessionToken: DEV_SESSION_TOKEN, userId: user.id, expires },
  });

  return { user, workspace };
}

async function seedClient(
  workspaceId: string,
  data: {
    name: string;
    metricoolBlogId: string | null;
    networks: Network[];
    services: ContentKind[];
    reviewer: { name: string; email: string };
  }
) {
  let client = await prisma.client.findFirst({ where: { workspaceId, name: data.name } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        workspaceId,
        name: data.name,
        metricoolBlogId: data.metricoolBlogId,
        timezone: "Europe/Rome",
        networks: data.networks,
        autoSchedule: true,
        services: data.services,
      },
    });
  } else if (data.services.some((kind) => !client!.services.includes(kind))) {
    // Re-run on an older database: add the demo services, keep the others.
    const services = sortKinds([...client.services, ...data.services]);
    client = await prisma.client.update({ where: { id: client.id }, data: { services } });
  }

  let reviewer = await prisma.clientReviewer.findUnique({
    where: { clientId_email: { clientId: client.id, email: data.reviewer.email } },
  });
  if (!reviewer || !reviewer.active) {
    reviewer = (await createReviewer(client.id, workspaceId, data.reviewer)).reviewer;
  }
  return { client, reviewer, reviewUrl: getReviewUrl(reviewer) };
}

/** A reviewer without email (link shared by hand), matched by name on re-runs. */
async function seedLinkOnlyReviewer(workspaceId: string, clientId: string, name: string) {
  let reviewer = await prisma.clientReviewer.findFirst({ where: { clientId, name, email: null, active: true } });
  if (!reviewer) reviewer = (await createReviewer(clientId, workspaceId, { name, email: null })).reviewer;
  return { reviewer, reviewUrl: getReviewUrl(reviewer) };
}

type SeedPost = {
  title: string;
  target: PostStatus;
  days: number;
  time: string;
  networks: Network[];
  networkOptions: NetworkOptions;
  text: string;
  firstCommentText?: string;
  images: Array<{ palette: keyof typeof PALETTES; alt: string }>;
  /** CHANGES_REQUESTED only: what the client asked for. */
  changes?: string;
  /** Second version created after the change request (then re-submitted). */
  revision?: { text: string; changeNote: string };
};

async function seedPost(
  workspaceId: string,
  userId: string,
  clientId: string,
  reviewer: { id: string; clientId: string },
  spec: SeedPost,
  variant: number
): Promise<Post> {
  const existing = await prisma.post.findFirst({ where: { workspaceId, clientId, title: spec.title } });
  if (existing) return existing;

  const actor = userActor(userId);
  const media: MediaItem[] = [];
  for (const [i, image] of spec.images.entries()) {
    media.push(
      await saveImage(workspaceId, `${spec.title.toLowerCase().replace(/\W+/g, "-")}-${i + 1}.png`, image.palette, variant + i, image.alt)
    );
  }

  let post = await createPost(
    workspaceId,
    {
      clientId,
      title: spec.title,
      publishAt: romeAt(spec.days, spec.time),
      networks: spec.networks,
      networkOptions: spec.networkOptions,
      text: spec.text,
      firstCommentText: spec.firstCommentText ?? null,
      media,
    },
    actor
  );

  if (spec.target === "DRAFT") return post;

  await submitForReview([post.id], workspaceId, actor);
  if (spec.target === "IN_REVIEW" && !spec.revision) return refetch(post.id);

  if (spec.target === "CHANGES_REQUESTED" || spec.revision) {
    await requestChanges(post.id, reviewer, 1, spec.changes ?? "Possiamo rivedere il testo?");
    if (spec.revision) {
      post = await updatePost(post.id, workspaceId, { text: spec.revision.text, changeNote: spec.revision.changeNote }, actor);
      await submitForReview([post.id], workspaceId, actor);
    }
    return refetch(post.id);
  }

  if (spec.target === "SCHEDULED") {
    // Written directly (no queue): the approval and the Metricool result are
    // recorded exactly as the real flow would, without waiting on the worker.
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: post.id },
        data: {
          status: "SCHEDULED",
          approvedAt: now,
          approvedByReviewerId: reviewer.id,
          metricoolPostId: `fake-seed-${post.id.slice(-8)}`,
          scheduledAt: now,
          scheduleAttempts: 1,
        },
      });
      await recordEvent(tx, { postId: post.id, type: "CLIENT_VIEWED", actor: reviewerActor(reviewer.id), versionNumber: 1 });
      await recordEvent(tx, { postId: post.id, type: "APPROVED", actor: reviewerActor(reviewer.id), versionNumber: 1 });
      await recordEvent(tx, { postId: post.id, type: "SCHEDULE_REQUESTED", actor: reviewerActor(reviewer.id), versionNumber: 1 });
      await recordEvent(tx, {
        postId: post.id,
        type: "SCHEDULED",
        actor: SYSTEM_ACTOR,
        versionNumber: 1,
        metadata: { metricoolPostId: `fake-seed-${post.id.slice(-8)}`, blogId: "123456", attempt: 1, seed: true },
      });
    });
  }

  return refetch(post.id);
}

async function refetch(id: string): Promise<Post> {
  return prisma.post.findUniqueOrThrow({ where: { id } });
}

const IG_POST: NetworkOptions = { instagramData: { type: "POST" } };
const IG_FB_POST: NetworkOptions = { instagramData: { type: "POST" }, facebookData: { type: "POST" } };

const AURORA_POSTS: SeedPost[] = [
  {
    title: "Colazione d'autunno — cornetto alla zucca",
    target: "IN_REVIEW",
    days: 4,
    time: "08:30",
    networks: ["instagram", "facebook"],
    networkOptions: IG_FB_POST,
    text:
      "L'autunno è arrivato anche al banco 🍂\n\nDa lunedì trovate il nostro cornetto alla zucca e cannella, sfornato ogni mattina alle 7. " +
      "Provatelo con un cappuccino d'avena: è la colazione che ci mancava.\n\n#CaffèAurora #colazione #autunno #zucca #Bologna",
    firstCommentText: "📍 Via Santo Stefano 12, Bologna — aperti tutti i giorni dalle 7 alle 19",
    images: [
      { palette: "sunset", alt: "Cornetto alla zucca su piattino di ceramica" },
      { palette: "cappuccino", alt: "Cappuccino d'avena visto dall'alto" },
    ],
  },
  {
    title: "Nuova miscela Etiopia Sidamo",
    target: "CHANGES_REQUESTED",
    days: 6,
    time: "12:00",
    networks: ["instagram"],
    networkOptions: IG_POST,
    text:
      "Note di bergamotto, pesca e miele: arriva in tostatura la nostra Etiopia Sidamo.\n" +
      "La trovate in grani o macinata per moka, solo in negozio e solo per questo mese. ☕️\n\n#specialtycoffee #Etiopia #tostatura",
    images: [{ palette: "espresso", alt: "Sacchetto di caffè Etiopia Sidamo" }],
    changes:
      "Il testo va bene, ma togliamo \"solo per questo mese\": la miscela resta fino a Natale. Si può usare una foto con i chicchi in primo piano?",
  },
  {
    title: "Aperitivo del giovedì",
    target: "SCHEDULED",
    days: 2,
    time: "18:00",
    networks: ["instagram", "facebook"],
    networkOptions: IG_FB_POST,
    text:
      "Ogni giovedì dalle 18: spritz al caffè, taglieri del Mercato di Mezzo e musica a basso volume. 🎶\n" +
      "Prenotate un tavolo in dehors, i posti vanno via in fretta!\n\n#aperitivo #Bologna #giovedì",
    images: [{ palette: "concrete", alt: "Spritz al caffè sul bancone" }],
  },
  {
    title: "Dietro il bancone: Luca, il nostro barista",
    target: "DRAFT",
    days: 9,
    time: "10:00",
    networks: ["instagram", "linkedin"],
    networkOptions: { instagramData: { type: "POST" }, linkedinData: { type: "post" } },
    text:
      "Luca prepara il primo espresso alle 6:45, prima ancora di accendere le luci della sala.\n" +
      "Da otto anni con noi, ci racconta perché la tazza va sempre scaldata. (bozza — completare la citazione)",
    images: [{ palette: "espresso", alt: "Ritratto del barista Luca dietro il bancone" }],
  },
];

const VERDE_POSTS: SeedPost[] = [
  {
    title: "Progetto Casa sul Lago — prima e dopo",
    target: "IN_REVIEW",
    days: 5,
    time: "09:00",
    networks: ["instagram", "linkedin"],
    networkOptions: { instagramData: { type: "POST" }, linkedinData: { type: "post" } },
    text:
      "Una casa degli anni '70 sul Lago d'Iseo, riportata alla luce: legno di larice, vetrate a tutta altezza e un tetto verde che ne riduce i consumi del 30%.\n\n" +
      "Scorrete per vedere il prima e il dopo. ➡️\n\n#architettura #ristrutturazione #sostenibilità",
    images: [
      { palette: "concrete", alt: "Facciata della casa prima della ristrutturazione" },
      { palette: "garden", alt: "Facciata dopo la ristrutturazione con tetto verde" },
    ],
    revision: {
      text:
        "Una casa degli anni '70 sul Lago d'Iseo, riportata alla luce: legno di larice, vetrate a tutta altezza e un tetto verde che ne riduce i consumi energetici del 30%.\n\n" +
        "Scorrete per vedere il prima e il dopo. ➡️ Progetto e direzione lavori: Studio Verde.\n\n#architettura #ristrutturazione #sostenibilità #LagoIseo",
      changeNote: "Aggiunti crediti dello studio e hashtag geografico, come richiesto.",
    },
    changes: "Aggiungiamo che progetto e direzione lavori sono nostri, e un hashtag sul lago.",
  },
  {
    title: "Open studio di ottobre",
    target: "DRAFT",
    days: 12,
    time: "17:30",
    networks: ["instagram"],
    networkOptions: IG_POST,
    text: "Sabato 25 apriamo le porte dello studio: modelli, campioni di materiali e un caffè con il team. Vi aspettiamo dalle 10 alle 17.",
    images: [{ palette: "garden", alt: "Plastico in legno sul tavolo dello studio" }],
  },
];

// ─── Monthly plan (Piano del mese) ───────────────────────────────────────────

type PlanSeedPost = {
  day: number;
  time: string;
  title: (month: string) => string;
  networks: Network[];
  networkOptions: NetworkOptions;
  text: (month: string) => string;
  images: Array<{ palette: keyof typeof PALETTES; alt: string }>;
};

const AURORA_PLAN_POSTS: PlanSeedPost[] = [
  {
    day: 3,
    time: "08:30",
    title: (m) => `Buongiorno ${m}: la colazione del mese`,
    networks: ["instagram", "facebook"],
    networkOptions: IG_FB_POST,
    text: (m) =>
      `A ${m} la colazione cambia: cornetto integrale al miele di castagno e cappuccino con latte d'avena tostata. ☕️\n\n#CaffèAurora #colazione #Bologna`,
    images: [{ palette: "sunset", alt: "Cornetto integrale e cappuccino sul bancone" }],
  },
  {
    day: 6,
    time: "18:00",
    title: (m) => `Aperitivo del giovedì — edizione di ${m}`,
    networks: ["instagram"],
    networkOptions: IG_POST,
    text: () => "Il giovedì sera si accende: espresso tonic, taglieri e la playlist scelta dal nostro barista. 🎶\n\n#aperitivo #Bologna",
    images: [{ palette: "concrete", alt: "Espresso tonic e tagliere sul tavolino del dehors" }],
  },
  {
    day: 10,
    time: "10:00",
    title: () => "Dietro il bancone: la tostatura",
    networks: ["instagram"],
    networkOptions: IG_POST,
    text: () =>
      "Ogni lunedì mattina tostiamo in piccoli lotti. Scorrete per vedere i chicchi prima e dopo: dal verde al nocciola in 12 minuti. ➡️\n\n#specialtycoffee #tostatura",
    images: [
      { palette: "garden", alt: "Chicchi di caffè verdi prima della tostatura" },
      { palette: "espresso", alt: "Chicchi tostati appena usciti dal tostatore" },
    ],
  },
  {
    day: 14,
    time: "12:30",
    title: () => "Ricetta: affogato al caffè",
    networks: ["instagram", "facebook"],
    networkOptions: IG_FB_POST,
    text: () =>
      "Una pallina di fiordilatte, un espresso bollente versato sopra e niente altro. La ricetta più corta del mondo, la nostra preferita. 🍨\n\n#ricette #affogato",
    images: [{ palette: "cappuccino", alt: "Affogato al caffè in una coppetta di vetro" }],
  },
  {
    day: 20,
    time: "09:00",
    title: (m) => `I vostri scatti di ${m}`,
    networks: ["instagram"],
    networkOptions: IG_POST,
    text: () =>
      "Ogni mese ripubblichiamo la foto più bella scattata da voi da Aurora. Taggateci con #CaffèAurora per partecipare! 📸",
    images: [{ palette: "garden", alt: "Foto di un cliente: tazzina sul tavolino all'aperto" }],
  },
  {
    day: 27,
    time: "17:30",
    title: () => "Prenota il tavolo per le feste",
    networks: ["instagram", "facebook"],
    networkOptions: IG_FB_POST,
    text: () =>
      "Cene di squadra, auguri tra amici, brindisi di fine anno: la sala di sopra è vostra fino a 20 persone. Scriveteci in DM per prenotare. 🎄",
    images: [{ palette: "sunset", alt: "Sala al piano di sopra apparecchiata per una cena" }],
  },
];

const AURORA_PLAN_INTRO =
  "Ciao Giulia! Questo mese puntiamo su due cose: la colazione nuova (che lanciamo il 3) e le prenotazioni per le feste, " +
  "che spingiamo dall'ultima settimana. In mezzo, un carosello sulla tostatura per raccontare il vostro lavoro e un " +
  "repost dei clienti per la community. Se il ritmo ti torna, puoi approvare tutto in un colpo.";

/**
 * Caffè Aurora's plan for next month: six posts IN_REVIEW attached to the
 * plan and a sent plan with an intro. Written step by step (not with
 * sendPlan) so other posts of that month are never touched; no emails.
 */
async function seedAuroraPlan(
  workspaceId: string,
  userId: string,
  client: { id: string; timezone: string },
  variant: number
) {
  const month = addPlanMonths(planMonthOf(new Date(), client.timezone), 1);
  const monthName = planMonthName(month);
  let plan = await prisma.contentPlan.findUnique({
    where: { clientId_kind_month: { clientId: client.id, kind: "SOCIAL_POST", month } },
  });
  if (!plan) {
    plan = await prisma.contentPlan.create({
      data: {
        workspaceId,
        clientId: client.id,
        kind: "SOCIAL_POST",
        month,
        title: defaultPlanTitle(month),
        intro: AURORA_PLAN_INTRO,
        createdById: userId,
      },
    });
  }

  const actor = userActor(userId);
  const ids: string[] = [];
  for (const [i, spec] of AURORA_PLAN_POSTS.entries()) {
    const title = spec.title(monthName);
    let post = await prisma.post.findFirst({ where: { workspaceId, clientId: client.id, title, planId: plan.id } });
    if (!post) {
      const publishAt = zonedDateTimeToUtc(`${month}-${String(spec.day).padStart(2, "0")}T${spec.time}`, client.timezone);
      if (!publishAt) throw new Error(`Invalid plan date ${month}-${spec.day}`);
      const media: MediaItem[] = [];
      for (const [j, image] of spec.images.entries()) {
        media.push(await saveImage(workspaceId, `piano-${month}-${i + 1}-${j + 1}.png`, image.palette, variant + i * 2 + j, image.alt));
      }
      post = await createPost(
        workspaceId,
        {
          clientId: client.id,
          title,
          publishAt,
          networks: spec.networks,
          networkOptions: spec.networkOptions,
          text: spec.text(monthName),
          firstCommentText: null,
          media,
        },
        actor
      );
      await prisma.post.update({ where: { id: post.id }, data: { planId: plan.id } });
    }
    ids.push(post.id);
  }

  const drafts = await prisma.post.findMany({ where: { id: { in: ids }, status: "DRAFT" }, select: { id: true } });
  if (drafts.length > 0) {
    // Due on the 1st of the plan's month at 18:00 (in five days if that is less than a day away).
    const due = zonedDateTimeToUtc(`${month}-01T18:00`, client.timezone) ?? undefined;
    const reviewDueAt = due && due.getTime() > Date.now() + 86_400_000 ? due : romeAt(5, "18:00");
    await submitForReview(
      drafts.map((d) => d.id),
      workspaceId,
      actor,
      { reviewDueAt, notify: false }
    );
    await prisma.contentPlan.update({
      where: { id: plan.id },
      data: { sentAt: new Date(), reviewDueAt, completedNotifiedAt: null },
    });
  }
  await syncPlanStatus(plan.id);
  const posts = await prisma.post.findMany({
    where: { planId: plan.id },
    orderBy: { publishAt: "asc" },
    select: { id: true, title: true, status: true },
  });
  return { plan: await prisma.contentPlan.findUniqueOrThrow({ where: { id: plan.id } }), posts };
}

// ─── Blog and ads demo data ──────────────────────────────────────────────────

/** Same as saveImage, without the default portrait size. */
async function savePng(
  workspaceId: string,
  fileName: string,
  palette: keyof typeof PALETTES,
  variant: number,
  alt: string,
  width: number,
  height: number
): Promise<MediaItem> {
  return saveImage(workspaceId, fileName, palette, variant, alt, { width, height });
}

const VIDEO_SIZE = { width: 720, height: 1280 };
const VIDEO_SECONDS = 8;

/**
 * A 9:16 test video (ffmpeg testsrc, VP9 in MP4: Playwright's Chromium has
 * no H.264). Falls back to the e2e fixture when ffmpeg is missing.
 */
function testVideo(): { bytes: Buffer; width: number; height: number; durationSec: number } {
  const dir = mkdtempSync(path.join(tmpdir(), "approve-seed-"));
  const out = path.join(dir, "video.mp4");
  try {
    execFileSync(
      "ffmpeg",
      [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `testsrc=size=${VIDEO_SIZE.width}x${VIDEO_SIZE.height}:rate=25:duration=${VIDEO_SECONDS}`,
        "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "600k",
        "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", out,
      ],
      { stdio: "ignore" }
    );
    return { bytes: readFileSync(out), ...VIDEO_SIZE, durationSec: VIDEO_SECONDS };
  } catch {
    const fixture = path.resolve(process.cwd(), "e2e/fixtures/reel-test.mp4");
    if (!existsSync(fixture)) throw new Error("ffmpeg non disponibile e video di esempio mancante (e2e/fixtures/reel-test.mp4)");
    console.warn("ffmpeg non disponibile: uso il video di esempio dei test e2e.");
    return { bytes: readFileSync(fixture), width: 540, height: 960, durationSec: 12 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function saveVideo(workspaceId: string, fileName: string, alt: string, posterUrl: string): Promise<MediaItem> {
  const video = testVideo();
  const source = Readable.toWeb(Readable.from([video.bytes])) as ReadableStream<Uint8Array>;
  const { asset, media } = await saveMediaStream({ workspaceId, fileName, source, alt, durationSec: video.durationSec });
  // Uploads from the browser get their pixel size measured client-side; here
  // it is known, so it is recorded on the asset too (ads spec checks use it).
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { width: video.width, height: video.height } });
  return { ...media, width: video.width, height: video.height, posterUrl };
}

async function findSeeded(workspaceId: string, clientId: string, kind: ContentKind, title: string) {
  return prisma.post.findFirst({ where: { workspaceId, clientId, kind, title } });
}

const VENDEMMIA_BODY = `La vendemmia 2026 sui Colli Euganei si è chiusa il 3 ottobre, con l'ultima cassetta di Moscato Giallo portata in cantina sotto un cielo finalmente sereno. È stata un'annata piccola nei numeri ma preziosa nel bicchiere: raccontiamo come è andata, vigna per vigna, e cosa aspettarci dai vini che nasceranno.

## Un'estate difficile, un settembre generoso

La primavera è stata piovosa e fresca, con una fioritura arrivata con dieci giorni di ritardo rispetto alla media degli ultimi anni. A luglio, invece, il caldo si è fatto sentire per tre settimane di fila, con temperature sopra i 35 gradi anche nelle zone più ventilate della collina.

Le nostre vigne su terreni vulcanici hanno retto bene: la trachite trattiene l'acqua in profondità e le radici delle piante più vecchie, alcune piantate da nonno Giuseppe nel 1968, sono andate a cercarla dove serviva. Settembre ha poi portato notti fresche e giornate asciutte, l'ideale per far maturare con calma gli zuccheri e, soprattutto, i profumi.

## Quanta uva abbiamo raccolto

Rispetto al 2025 abbiamo raccolto circa il 18% di uva in meno. Non è una cattiva notizia: grappoli più piccoli e acini più concentrati danno vini con più struttura e una vita più lunga in bottiglia. Ecco il bilancio per varietà:

- **Moscato Giallo**: resa in calo del 12%, ma profumi intensissimi di salvia e fiori d'arancio;
- **Merlot**: la varietà che ha sofferto di più il caldo di luglio, raccolta in anticipo per mantenere la freschezza;
- **Cabernet Franc**: l'annata migliore degli ultimi cinque anni, con bucce spesse e tannini maturi;
- **Garganega**: poca, ma sana e croccante, perfetta per il nostro spumante metodo classico.

## Vendemmia a mano, come sempre

Anche quest'anno abbiamo raccolto tutto a mano, in piccole cassette da 15 chili, per non schiacciare i grappoli durante il trasporto. Una squadra di dodici persone, tra famiglia, amici e vendemmiatori che tornano da noi ogni settembre, ha lavorato per diciotto giorni scegliendo i grappoli migliori direttamente in vigna.

La selezione in pianta richiede più tempo, ma ci permette di portare in cantina solo uva perfetta. In cantina non correggiamo nulla: niente lieviti selezionati per i rossi, solo quelli che arrivano dalla vigna, e una pressatura soffice per i bianchi.

![Cassette di Moscato Giallo appena raccolte tra i filari](__INLINE_IMAGE__)

## Cosa aspettarci dai vini

È presto per dare giudizi definitivi, ma le prime fermentazioni promettono bene. Il Moscato Giallo secco sarà più aromatico del solito, con una bella vena sapida che lo renderà perfetto a tavola, non solo con il dessert. Il Cabernet Franc riposerà almeno diciotto mesi in botti grandi di rovere prima di arrivare in bottiglia: sarà un vino da aspettare, e da conservare in cantina per qualche anno.

Il rosso giovane, il nostro Colli Euganei Rosso, sarà invece pronto per la primavera: più leggero e fruttato, pensato per le cene di tutti i giorni e per la cucina veneta più semplice, dai bigoli al ragù d'anatra al baccalà alla vicentina.

## Venite a trovarci in cantina

Per tutto ottobre la cantina è aperta il sabato e la domenica, dalle 10 alle 18. Potete visitare le vigne, vedere le vasche dove fermenta il vino nuovo e assaggiare le annate precedenti insieme a noi. Le visite durano circa un'ora e mezza e si concludono con una degustazione di quattro vini accompagnati da formaggi e salumi del territorio.

Per le visite di gruppo, oltre le otto persone, è meglio prenotare: trovate tutti i dettagli nella pagina [visite e degustazioni](https://www.cantinavaldobbia.it/visite). E se non riuscite a passare, potete sempre ordinare le nostre bottiglie online e riceverle a casa in due giorni lavorativi.

Grazie a tutti quelli che ci hanno aiutato in vigna anche quest'anno: senza di voi la vendemmia non sarebbe la stessa festa.`;

const ABBINAMENTI_V1 = `Cosa bere con i tortellini in brodo? È la domanda che ci fanno più spesso a dicembre, quando in tanti preparano il pranzo delle feste. La risposta classica è un Lambrusco, ma chi ama i bianchi ha più di un'alternativa.

## Il brodo vuole freschezza

Il brodo di cappone è delicato e un po' grasso: serve un vino con una buona acidità, che pulisca la bocca senza coprire il sapore del ripieno. Per questo sconsigliamo i rossi strutturati e invecchiati in legno, che sono sicuramente i vini migliori in assoluto per ogni occasione.

## Le nostre proposte

- **Garganega spumante**: le bollicine sgrassano e il profumo di mela verde accompagna bene la mortadella del ripieno;
- **Moscato Giallo secco**: aromatico ma asciutto, per chi vuole un abbinamento più audace;
- **Colli Euganei Rosso giovane**: servito fresco, a 14 gradi, è un rosso leggero che non stanca.

## E il bollito?

Dopo i tortellini arriva quasi sempre il bollito con la mostarda. Qui un rosso giovane e fruttato è la scelta più sicura: il nostro Colli Euganei Rosso regge il sapore della carne senza scontrarsi con il dolce piccante della mostarda.

Trovate tutti i vini nel nostro [negozio online](https://www.cantinavaldobbia.it/negozio), con consegna in 48 ore fino al 20 dicembre. Buone feste da tutta la famiglia Valdobbia!`;

const ANCHOR_QUOTE = "che sono sicuramente i vini migliori in assoluto per ogni occasione";

const ABBINAMENTI_V2 = ABBINAMENTI_V1.replace(
  ", che sono sicuramente i vini migliori in assoluto per ogni occasione.",
  ": sono vini splendidi, ma qui coprirebbero il profumo del brodo."
);

function blogContent(base: Omit<BlogContent, "categories" | "tags" | "author"> & Partial<BlogContent>): BlogContent {
  return { categories: [], tags: [], author: "Famiglia Valdobbia", ...base };
}

async function seedBlog(workspaceId: string, userId: string, clientId: string, reviewer: { id: string; clientId: string }) {
  const actor = userActor(userId);
  const result: Array<{ client: string; title: string; status: PostStatus; id: string; kind: ContentKind }> = [];
  const push = (post: Post) => result.push({ client: "", title: post.title, status: post.status, id: post.id, kind: post.kind });

  // ── 1. IN_REVIEW: the harvest report ──
  const vendemmiaTitle = "Vendemmia 2026: un'annata piccola ma preziosa";
  let vendemmia = await findSeeded(workspaceId, clientId, "BLOG_ARTICLE", vendemmiaTitle);
  if (!vendemmia) {
    const featured = await savePng(workspaceId, "vendemmia-2026-copertina.png", "sunset", 41, "Filari dei Colli Euganei al tramonto durante la vendemmia", 1600, 900);
    const inline = await savePng(workspaceId, "vendemmia-2026-cassette.png", "garden", 44, "Cassette di Moscato Giallo appena raccolte tra i filari", 1200, 800);
    vendemmia = await createPost(
      workspaceId,
      {
        clientId,
        kind: "BLOG_ARTICLE",
        title: vendemmiaTitle,
        publishAt: romeAt(7, "09:00"),
        content: blogContent({
          headline: "Vendemmia 2026 sui Colli Euganei: un'annata piccola ma preziosa",
          slug: "vendemmia-2026-colli-euganei",
          bodyMarkdown: VENDEMMIA_BODY.replace("__INLINE_IMAGE__", inline.url),
          excerpt: "Meno uva del 2025, ma grappoli concentrati e profumi intensi: il racconto della vendemmia 2026, vigna per vigna.",
          metaTitle: "Vendemmia 2026 sui Colli Euganei | Cantina Valdobbia",
          metaDescription:
            "Com'è andata la vendemmia 2026 sui Colli Euganei: meno uva ma di grande qualità. Il bilancio per varietà e cosa aspettarci dai nuovi vini.",
          focusKeyword: "vendemmia 2026",
          featuredImage: featured,
          categories: ["Dalla vigna"],
          tags: ["vendemmia", "Colli Euganei", "Moscato Giallo"],
        }),
      },
      actor
    );
    await submitForReview([vendemmia.id], workspaceId, actor);
    vendemmia = await refetch(vendemmia.id);
  }
  push(vendemmia);

  // ── 2. CHANGES_REQUESTED: comment on a sentence, version 2 saved, not re-sent ──
  const abbinamentiTitle = "Cosa bere con i tortellini in brodo";
  let abbinamenti = await findSeeded(workspaceId, clientId, "BLOG_ARTICLE", abbinamentiTitle);
  if (!abbinamenti) {
    const featured = await savePng(workspaceId, "tortellini-vino-copertina.png", "cappuccino", 47, "Piatto di tortellini in brodo accanto a un calice di vino bianco", 1600, 900);
    const base = blogContent({
      headline: "Cosa bere con i tortellini in brodo: tre abbinamenti per le feste",
      slug: "vino-tortellini-in-brodo",
      bodyMarkdown: ABBINAMENTI_V1,
      excerpt: "Lambrusco sì, ma non solo: tre vini dei Colli Euganei da portare in tavola con i tortellini e il bollito.",
      metaTitle: "Vino e tortellini in brodo: tre abbinamenti | Cantina Valdobbia",
      metaDescription:
        "Cosa bere con i tortellini in brodo e il bollito delle feste? Tre abbinamenti con i vini dei Colli Euganei, dalle bollicine al rosso giovane.",
      focusKeyword: "tortellini in brodo",
      featuredImage: featured,
      categories: ["In cucina"],
      tags: ["abbinamenti", "Natale"],
    });
    abbinamenti = await createPost(
      workspaceId,
      { clientId, kind: "BLOG_ARTICLE", title: abbinamentiTitle, publishAt: romeAt(10, "09:00"), content: base },
      actor
    );
    await submitForReview([abbinamenti.id], workspaceId, actor);

    // The client selects a sentence in the reader and comments on it.
    const { text, blockStarts } = htmlToTextWithBlocks(renderMarkdownSafe(ABBINAMENTI_V1));
    const start = text.indexOf(ANCHOR_QUOTE);
    if (start === -1) throw new Error("Seed: frase da commentare non trovata nell'articolo");
    const blockIndex = blockStarts.reduce((found, at, i) => (at !== undefined && at <= start ? i : found), 0);
    const anchor = buildAnchor(text, start, start + ANCHOR_QUOTE.length, blockIndex);
    await addComment({
      postId: abbinamenti.id,
      actor: reviewerActor(reviewer.id),
      body: "Questa frase contraddice quella dopo: non diciamo che sono i migliori \"in assoluto\", sembra presuntuoso.",
      anchor,
    });
    await requestChanges(
      abbinamenti.id,
      reviewer,
      1,
      "Bello l'articolo! Sistemate solo la frase sui rossi invecchiati (vedi commento), poi per me va bene."
    );
    await updatePost(
      abbinamenti.id,
      workspaceId,
      { content: { ...base, bodyMarkdown: ABBINAMENTI_V2 }, changeNote: "Riscritta la frase sui rossi invecchiati in legno." },
      actor
    );
    abbinamenti = await refetch(abbinamenti.id);
  }
  push(abbinamenti);
  return result;
}

async function seedAds(workspaceId: string, userId: string, clientId: string) {
  const actor = userActor(userId);
  const title = "Iscrizioni d'autunno — prova gratuita";
  let post = await findSeeded(workspaceId, clientId, "AD_CREATIVE", title);
  if (!post) {
    const square = await savePng(workspaceId, "kinetik-a-1x1.png", "concrete", 61, "Sala pesi della palestra con luce naturale", 1080, 1080);
    const portrait = await savePng(workspaceId, "kinetik-b-4x5.png", "sunset", 63, "Istruttrice che segue un'allieva al rack", 1080, 1350);
    const poster = await savePng(workspaceId, "kinetik-c-9x16.png", "garden", 65, "Copertina del video: corso di functional training", 1080, 1920);
    const video = await saveVideo(workspaceId, "kinetik-c-9x16.mp4", "Video 9:16 del corso di functional training", poster.url);

    const url = "https://www.palestrakinetik.it/prova-gratuita";
    const content: AdContent = {
      campaign: {
        name: "Iscrizioni d'autunno",
        platform: "meta",
        objective: "Contatti (lead)",
        budgetNote: "€25/giorno per 21 giorni, dal 15 ottobre",
        audienceNote: "25–45 anni, entro 8 km dalla palestra, interessi fitness e benessere",
      },
      variants: [
        {
          id: "A",
          name: "Variante A — Sala pesi",
          media: [square],
          primaryText: "Settembre è passato, la voglia di allenarti no. Prova Kinetik gratis per 7 giorni, con un istruttore che ti segue.",
          headline: "7 giorni di prova gratuita",
          description: "Senza vincoli",
          cta: "Iscriviti",
          destinationUrl: url,
          placements: ["meta_feed"],
        },
        {
          id: "B",
          name: "Variante B — Istruttore",
          media: [portrait],
          primaryText: "Allenarti con qualcuno che conosce il tuo nome fa la differenza. Vieni a provare: la prima settimana è gratis.",
          headline: "Il tuo istruttore ti aspetta",
          description: "Prima settimana gratis",
          cta: "Scopri di più",
          destinationUrl: url,
          placements: ["meta_feed"],
        },
        {
          id: "C",
          name: "Variante C — Video functional",
          media: [video],
          primaryText: "45 minuti, tutto il corpo, zero noia. Prova il functional training di Kinetik: la prima settimana è gratis.",
          headline: "Functional training gratis",
          description: "7 giorni di prova",
          cta: "Iscriviti",
          destinationUrl: url,
          placements: ["meta_stories_reels"],
        },
      ],
    };
    post = await createPost(
      workspaceId,
      { clientId, kind: "AD_CREATIVE", title, publishAt: romeAt(9, "08:00"), content },
      actor
    );
    await submitForReview([post.id], workspaceId, actor);
    post = await refetch(post.id);
  }
  return [{ client: "", title: post.title, status: post.status, id: post.id, kind: post.kind }];
}

/**
 * Google Ads set for Kinetik: a Search variant (responsive search ad with
 * headlines, descriptions, paths and keywords of every match type) and a
 * Performance Max variant (asset group with landscape, square and portrait
 * images and a logo, no video), IN_REVIEW.
 */
async function seedGoogleAds(workspaceId: string, userId: string, clientId: string) {
  const actor = userActor(userId);
  const title = "Google Ads — prenotazioni autunno";
  let post = await findSeeded(workspaceId, clientId, "AD_CREATIVE", title);
  if (!post) {
    const landscape = await savePng(workspaceId, "kinetik-pmax-1.91x1.png", "concrete", 81, "Sala corsi della palestra, vista orizzontale", 1200, 628);
    const square = await savePng(workspaceId, "kinetik-pmax-1x1.png", "sunset", 83, "Istruttore che corregge uno squat", 1200, 1200);
    const portrait = await savePng(workspaceId, "kinetik-pmax-4x5.png", "garden", 85, "Allieva al rack, foto verticale", 960, 1200);
    // Variant media get their pixel size from the asset on save; logos carry it here.
    const logo = { ...(await savePng(workspaceId, "kinetik-logo-1x1.png", "espresso", 87, "Logo Palestra Kinetik", 512, 512)), width: 512, height: 512 };
    const url = "https://www.palestrakinetik.it/prova-gratuita";
    const content: AdContent = {
      campaign: {
        name: "Prenotazioni d'autunno",
        platform: "google",
        objective: "Contatti (lead)",
        budgetNote: "€20/giorno su Ricerca e €15/giorno su Performance Max, dal 15 ottobre",
        audienceNote: "Milano e 10 km intorno; chi cerca palestre, corsi e personal trainer in zona",
      },
      variants: [
        {
          id: "A",
          name: "Variante A — Rete di ricerca",
          media: [],
          primaryText: "",
          headline: "",
          description: "",
          cta: "",
          destinationUrl: url,
          placements: ["google_search"],
          google: {
            headlines: [
              "Palestra Kinetik a Milano",
              "Prova gratis per 7 giorni",
              "Istruttore sempre con te",
              "Corsi di functional training",
              "Aperti dalle 6 alle 23",
              "Sala pesi rinnovata",
              "Prenota la prova online",
              "Nessun vincolo di iscrizione",
            ],
            longHeadlines: [],
            descriptions: [
              "Sala pesi, corsi e un istruttore che ti segue. La prima settimana è gratis.",
              "Prenota online la tua prova gratuita: scegli giorno e orario in un minuto.",
              "Parcheggio interno, spogliatoi nuovi e corsi tutti i giorni. Ti aspettiamo.",
            ],
            businessName: "",
            path1: "prova",
            path2: "gratis",
            keywords: [
              { text: "palestra milano", match: "broad" },
              { text: "palestra vicino a me", match: "broad" },
              { text: "functional training milano", match: "broad" },
              { text: "prova gratuita palestra", match: "phrase" },
              { text: "palestra con istruttore", match: "phrase" },
              { text: "corsi palestra milano", match: "phrase" },
              { text: "personal trainer milano", match: "phrase" },
              { text: "palestra kinetik", match: "exact" },
              { text: "kinetik milano", match: "exact" },
              { text: "palestra milano prova gratuita", match: "exact" },
            ],
            negativeKeywords: ["lavoro", '"corso istruttore"', "[palestra gratis]"],
            logos: [],
          },
        },
        {
          id: "B",
          name: "Variante B — Performance Max",
          media: [landscape, square, portrait],
          primaryText: "",
          headline: "",
          description: "",
          cta: "Iscriviti",
          destinationUrl: url,
          placements: ["google_pmax"],
          google: {
            headlines: [
              "Kinetik Milano",
              "Prova gratis 7 giorni",
              "Istruttore dedicato",
              "Functional training",
              "Aperti fino alle 23",
            ],
            longHeadlines: [
              "Allenati con un istruttore che ti segue: la prima settimana da Kinetik è gratis",
              "Sala pesi, corsi e parcheggio interno a Milano. Prenota la prova online",
            ],
            descriptions: [
              "La prima settimana è gratis, senza vincoli.",
              "Sala pesi rinnovata, corsi tutti i giorni e un istruttore che conosce il tuo nome.",
              "Prenota online la prova: scegli giorno e orario in un minuto.",
            ],
            businessName: "Palestra Kinetik",
            path1: "",
            path2: "",
            keywords: [],
            negativeKeywords: [],
            logos: [logo],
          },
        },
      ],
    };
    post = await createPost(
      workspaceId,
      { clientId, kind: "AD_CREATIVE", title, publishAt: romeAt(10, "08:00"), content },
      actor
    );
    await submitForReview([post.id], workspaceId, actor);
    post = await refetch(post.id);
  }
  return { client: "", title: post.title, status: post.status, id: post.id, kind: post.kind };
}

// ─── Multi-service client: one item of each kind in review ───────────────────

const QUERCE_BODY = `Ottobre in Val d'Orcia è il mese che preferiamo: le colline cambiano colore ogni settimana, le giornate sono ancora tiepide e in cucina arrivano funghi, castagne e il primo olio nuovo. Abbiamo preparato un piccolo programma per chi vuole passare un fine settimana con noi senza correre.

## Sabato: vendemmia tardiva e cena in cantina

La mattina si raccolgono gli ultimi grappoli di Sangiovese insieme a Paolo, che racconta come si sceglie il momento giusto. La sera ceniamo in cantina, a lume di candela, con i piatti della nonna e i vini dell'azienda.

## Domenica: frantoio e passeggiata

Dopo colazione andiamo al frantoio di Montepulciano per assaggiare l'olio appena spremuto sul pane abbrustolito. Il pomeriggio è libero: consigliamo il sentiero tra i cipressi che parte dal cancello dell'agriturismo e arriva fino alla pieve.

Le camere per i fine settimana di ottobre sono poche: scriveteci per sapere le date ancora libere.`;

async function seedMultiService(
  workspaceId: string,
  userId: string,
  clientId: string,
  reviewer: { id: string; clientId: string }
) {
  const actor = userActor(userId);
  const result: Array<{ title: string; status: PostStatus; id: string; kind: ContentKind }> = [];
  const push = (post: Post) => result.push({ title: post.title, status: post.status, id: post.id, kind: post.kind });

  // ── Social post ──
  push(
    await seedPost(
      workspaceId,
      userId,
      clientId,
      reviewer,
      {
        title: "Fine settimana d'ottobre in Val d'Orcia",
        target: "IN_REVIEW",
        days: 3,
        time: "11:00",
        networks: ["instagram", "facebook"],
        networkOptions: IG_FB_POST,
        text:
          "Colline che cambiano colore, castagne sul fuoco e olio nuovo sul pane. 🍂\n" +
          "Ottobre alle Querce è così: vi aspettiamo per un fine settimana lento.\n\n#ValdOrcia #agriturismo #autunno",
        images: [{ palette: "garden", alt: "Colline della Val d'Orcia in autunno viste dalla terrazza" }],
      },
      70
    )
  );

  // ── Blog article ──
  const articleTitle = "Un fine settimana d'autunno in Val d'Orcia";
  let article = await findSeeded(workspaceId, clientId, "BLOG_ARTICLE", articleTitle);
  if (!article) {
    const featured = await savePng(workspaceId, "querce-autunno-copertina.png", "sunset", 73, "Cipressi e colline della Val d'Orcia al tramonto", 1600, 900);
    article = await createPost(
      workspaceId,
      {
        clientId,
        kind: "BLOG_ARTICLE",
        title: articleTitle,
        publishAt: romeAt(6, "09:00"),
        content: {
          headline: "Un fine settimana d'autunno in Val d'Orcia: vendemmia, frantoio e cipressi",
          slug: "fine-settimana-autunno-val-d-orcia",
          bodyMarkdown: QUERCE_BODY,
          excerpt: "Vendemmia tardiva, cena in cantina e olio nuovo al frantoio: il nostro programma per i fine settimana di ottobre.",
          metaTitle: "Fine settimana d'autunno in Val d'Orcia | Le Querce",
          metaDescription:
            "Cosa fare in Val d'Orcia a ottobre: vendemmia tardiva, cena in cantina, olio nuovo al frantoio e una passeggiata tra i cipressi.",
          focusKeyword: "Val d'Orcia",
          featuredImage: featured,
          categories: ["Stagioni"],
          tags: ["autunno", "Val d'Orcia", "weekend"],
          author: "Agriturismo Le Querce",
        } satisfies BlogContent,
      },
      actor
    );
    await submitForReview([article.id], workspaceId, actor);
    article = await refetch(article.id);
  }
  push(article);

  // ── Ads creative set ──
  const adsTitle = "Weekend d'autunno — offerta camere";
  let ads = await findSeeded(workspaceId, clientId, "AD_CREATIVE", adsTitle);
  if (!ads) {
    const square = await savePng(workspaceId, "querce-ads-1x1.png", "garden", 76, "Camera con vista sulle colline", 1080, 1080);
    const portrait = await savePng(workspaceId, "querce-ads-4x5.png", "sunset", 78, "Tavola apparecchiata in cantina", 1080, 1350);
    const url = "https://www.agriturismolequerce.it/autunno";
    const content: AdContent = {
      campaign: {
        name: "Weekend d'autunno",
        platform: "meta",
        objective: "Traffico al sito",
        budgetNote: "€15/giorno per 14 giorni",
        audienceNote: "30–60 anni, Toscana, Lazio ed Emilia-Romagna, interessi viaggi ed enogastronomia",
      },
      variants: [
        {
          id: "A",
          name: "Variante A — Camera",
          media: [square],
          primaryText: "Ottobre in Val d'Orcia: colline dorate, olio nuovo e silenzio. Due notti con cena in cantina.",
          headline: "Il tuo weekend d'autunno",
          description: "Cena in cantina inclusa",
          cta: "Prenota ora",
          destinationUrl: url,
          placements: ["meta_feed"],
        },
        {
          id: "B",
          name: "Variante B — Cena",
          media: [portrait],
          primaryText: "Una cena a lume di candela tra le botti, i piatti della nonna e i nostri vini. Solo a ottobre.",
          headline: "Cena in cantina",
          description: "Weekend di ottobre",
          cta: "Scopri di più",
          destinationUrl: url,
          placements: ["meta_feed"],
        },
      ],
    };
    ads = await createPost(workspaceId, { clientId, kind: "AD_CREATIVE", title: adsTitle, publishAt: romeAt(8, "08:00"), content }, actor);
    await submitForReview([ads.id], workspaceId, actor);
    ads = await refetch(ads.id);
  }
  push(ads);
  return result;
}

async function main() {
  const { user, workspace } = await seedOwner();

  const aurora = await seedClient(workspace.id, {
    name: "Caffè Aurora",
    metricoolBlogId: "123456",
    networks: ["instagram", "facebook", "linkedin"],
    services: ["SOCIAL_POST"],
    reviewer: { name: "Giulia Bianchi", email: "giulia@caffeaurora.it" },
  });
  const verde = await seedClient(workspace.id, {
    name: "Studio Verde Architetti",
    metricoolBlogId: null,
    networks: ["instagram", "linkedin"],
    services: ["SOCIAL_POST"],
    reviewer: { name: "Marco Rossi", email: "marco@studioverde.it" },
  });

  const posts: Array<{ client: string; title: string; status: PostStatus; id: string }> = [];
  for (const [i, spec] of AURORA_POSTS.entries()) {
    const post = await seedPost(workspace.id, user.id, aurora.client.id, aurora.reviewer, spec, i * 3);
    posts.push({ client: aurora.client.name, title: post.title, status: post.status, id: post.id });
  }
  for (const [i, spec] of VERDE_POSTS.entries()) {
    const post = await seedPost(workspace.id, user.id, verde.client.id, verde.reviewer, spec, 20 + i * 3);
    posts.push({ client: verde.client.name, title: post.title, status: post.status, id: post.id });
  }

  const auroraPlan = await seedAuroraPlan(workspace.id, user.id, aurora.client, 60);

  // Blog and ads clients: no social networks, no Metricool brand.
  const cantina = await seedClient(workspace.id, {
    name: "Cantina Valdobbia",
    metricoolBlogId: null,
    networks: [],
    services: ["BLOG_ARTICLE"],
    reviewer: { name: "Elena Valdobbia", email: "elena@cantinavaldobbia.it" },
  });
  const kinetik = await seedClient(workspace.id, {
    name: "Palestra Kinetik",
    metricoolBlogId: null,
    networks: [],
    services: ["AD_CREATIVE"],
    reviewer: { name: "Davide Conti", email: "davide@palestrakinetik.it" },
  });
  const articles = (await seedBlog(workspace.id, user.id, cantina.client.id, cantina.reviewer)).map((p) => ({
    ...p,
    client: cantina.client.name,
  }));
  const adSets = (await seedAds(workspace.id, user.id, kinetik.client.id)).map((p) => ({ ...p, client: kinetik.client.name }));
  const googleAds = { ...(await seedGoogleAds(workspace.id, user.id, kinetik.client.id)), client: kinetik.client.name };

  // One client, three services: the unified portal.
  const querce = await seedClient(workspace.id, {
    name: "Agriturismo Le Querce",
    metricoolBlogId: null,
    networks: ["instagram", "facebook"],
    services: ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"],
    reviewer: { name: "Chiara Fabbri", email: "chiara@agriturismolequerce.it" },
  });
  const mixed = await seedMultiService(workspace.id, user.id, querce.client.id, querce.reviewer);
  const querceLinkOnly = await seedLinkOnlyReviewer(workspace.id, querce.client.id, "Paolo Fabbri");

  const baseUrl = (process.env.PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log("");
  console.log("─── Approve by Heili: dati demo pronti ───");
  console.log(`Workspace:   ${workspace.name} (${workspace.id})`);
  console.log(`Utente:      ${OWNER_EMAIL} (OWNER)`);
  console.log(`Sessione:    cookie authjs.session-token=${DEV_SESSION_TOKEN}`);
  console.log(`             (in DevTools su ${baseUrl}, poi apri ${baseUrl}/dashboard)`);
  console.log(`Link revisione ${aurora.client.name} (${aurora.reviewer.name}): ${aurora.reviewUrl}`);
  console.log(`Link revisione ${verde.client.name} (${verde.reviewer.name}): ${verde.reviewUrl}`);
  console.log(`Link revisione ${cantina.client.name} (${cantina.reviewer.name}): ${cantina.reviewUrl}`);
  console.log(`Link revisione ${kinetik.client.name} (${kinetik.reviewer.name}): ${kinetik.reviewUrl}`);
  console.log(
    `Link revisione ${querce.client.name} (${querce.reviewer.name}, portale unificato: post social, articoli e creatività): ${querce.reviewUrl}`
  );
  console.log(
    `Link revisione ${querce.client.name} (${querceLinkOnly.reviewer.name}, senza email: link da mandare a mano): ${querceLinkOnly.reviewUrl}`
  );
  console.log(`Piano del mese ${aurora.client.name}: ${auroraPlan.plan.title} (${auroraPlan.posts.length} post)`);
  console.log(`      cliente: ${aurora.reviewUrl}/piani/${auroraPlan.plan.id}`);
  console.log(`      agenzia: ${baseUrl}/plans/${auroraPlan.plan.id}`);
  console.log("Post social:");
  for (const post of posts) console.log(`  [${post.status}] ${post.client} — ${post.title}`);
  console.log("Articoli (blog):");
  for (const post of articles) {
    console.log(`  [${post.status}] ${post.client} — ${post.title}`);
    console.log(`      cliente: ${cantina.reviewUrl}/posts/${post.id}`);
    console.log(`      agenzia: ${baseUrl}/posts/${post.id}`);
  }
  console.log("Creatività (ads):");
  for (const post of adSets) {
    console.log(`  [${post.status}] ${post.client} — ${post.title}`);
    console.log(`      cliente: ${kinetik.reviewUrl}/posts/${post.id}`);
    console.log(`      agenzia: ${baseUrl}/posts/${post.id}`);
  }
  console.log("Creatività Google Ads (Ricerca e Performance Max):");
  console.log(`  [${googleAds.status}] ${googleAds.client} — ${googleAds.title}`);
  console.log(`      cliente: ${kinetik.reviewUrl}/posts/${googleAds.id}`);
  console.log(`      agenzia: ${baseUrl}/posts/${googleAds.id}`);
  console.log(`Tre servizi (${querce.client.name}):`);
  for (const post of mixed) console.log(`  [${post.status}] ${post.kind} — ${post.title}`);
  console.log(
    "SEED_JSON " +
      JSON.stringify({
        baseUrl,
        workspaceId: workspace.id,
        userId: user.id,
        sessionToken: DEV_SESSION_TOKEN,
        clients: [
          { id: aurora.client.id, name: aurora.client.name, reviewerId: aurora.reviewer.id, reviewUrl: aurora.reviewUrl },
          { id: verde.client.id, name: verde.client.name, reviewerId: verde.reviewer.id, reviewUrl: verde.reviewUrl },
        ],
        posts,
        plan: {
          id: auroraPlan.plan.id,
          month: auroraPlan.plan.month,
          title: auroraPlan.plan.title,
          clientId: aurora.client.id,
          reviewUrl: `${aurora.reviewUrl}/piani/${auroraPlan.plan.id}`,
          posts: auroraPlan.posts,
        },
        blog: {
          client: { id: cantina.client.id, name: cantina.client.name, reviewerId: cantina.reviewer.id, reviewUrl: cantina.reviewUrl },
          posts: articles,
        },
        ads: {
          client: { id: kinetik.client.id, name: kinetik.client.name, reviewerId: kinetik.reviewer.id, reviewUrl: kinetik.reviewUrl },
          posts: adSets,
        },
        googleAds: {
          client: { id: kinetik.client.id, name: kinetik.client.name, reviewerId: kinetik.reviewer.id, reviewUrl: kinetik.reviewUrl },
          post: googleAds,
        },
        multi: {
          client: { id: querce.client.id, name: querce.client.name, reviewerId: querce.reviewer.id, reviewUrl: querce.reviewUrl },
          posts: mixed,
          linkOnlyReviewer: {
            id: querceLinkOnly.reviewer.id,
            name: querceLinkOnly.reviewer.name,
            reviewUrl: querceLinkOnly.reviewUrl,
          },
        },
      })
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
