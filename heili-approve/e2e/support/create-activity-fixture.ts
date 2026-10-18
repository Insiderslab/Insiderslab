/**
 * Used by e2e/activity.spec.mjs: everything «Attività» needs, fresh on every
 * run so the spec never depends on what the other specs did to the seed.
 *
 * - a second member of the agency (Marta Bianchi, with her own session) to
 *   assign tasks to;
 * - a new social client with one reviewer and two social posts in review;
 * - a second, unrelated agency (workspace, owner, session, client) with an
 *   open task and a notification, to prove that workspaces never mix;
 * - a third agency with nothing in it, for the empty states.
 *
 * Prints `RESULT {json}`.
 *
 *   npx tsx e2e/support/create-activity-fixture.ts <workspaceId> <userId> <suffix>
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

const fixtures = path.join(process.cwd(), "e2e", "fixtures");
const DAY = 86_400_000;

/** A user with a database session, owner of a workspace of the given name. */
async function agencyWithSession(email: string, userName: string, workspaceName: string, token: string, expires: Date) {
  const owner = await prisma.user.upsert({
    where: { email },
    update: { name: userName },
    create: { email, name: userName },
  });
  const workspace =
    (await prisma.workspace.findFirst({ where: { name: workspaceName, ownerId: owner.id } })) ??
    (await prisma.workspace.create({
      data: { name: workspaceName, ownerId: owner.id, members: { create: { userId: owner.id, role: "OWNER" } } },
    }));
  await prisma.session.upsert({
    where: { sessionToken: token },
    update: { userId: owner.id, expires },
    create: { sessionToken: token, userId: owner.id, expires },
  });
  return { owner, workspace };
}

async function main() {
  const [workspaceId, userId, suffix] = process.argv.slice(2);
  if (!workspaceId || !userId || !suffix) {
    throw new Error("Uso: create-activity-fixture.ts <workspaceId> <userId> <suffix>");
  }
  const actor = userActor(userId);
  const expires = new Date(Date.now() + 30 * DAY);

  // ── Second member of the agency, with a session of her own ──
  const marta = await prisma.user.upsert({
    where: { email: "marta.bianchi@example.com" },
    update: { name: "Marta Bianchi" },
    create: { email: "marta.bianchi@example.com", name: "Marta Bianchi" },
  });
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: marta.id } },
    update: {},
    create: { workspaceId, userId: marta.id, role: "MEMBER" },
  });
  const martaToken = "dev-session-marta-bianchi-0000000001";
  await prisma.session.upsert({
    where: { sessionToken: martaToken },
    update: { userId: marta.id, expires },
    create: { sessionToken: martaToken, userId: marta.id, expires },
  });

  // ── The client and two posts in review ──
  const client = await prisma.client.create({
    data: {
      workspaceId,
      name: `Attività e2e ${suffix}`,
      metricoolBlogId: "123456",
      timezone: "Europe/Rome",
      networks: ["instagram"],
      autoSchedule: true,
      services: ["SOCIAL_POST"],
    },
  });
  const { reviewUrl } = await createReviewer(client.id, workspaceId, {
    name: "Giulia Ferri",
    email: `giulia+att${suffix}@example.com`,
  });
  const image = readFileSync(path.join(fixtures, "post-image.png"));
  async function social(title: string, file: string) {
    const { media } = await saveMediaStream({
      workspaceId,
      fileName: file,
      source: Readable.toWeb(Readable.from([image])) as ReadableStream<Uint8Array>,
      alt: "Immagine di prova",
    });
    return createPost(
      workspaceId,
      {
        clientId: client.id,
        title: `${title} ${suffix}`,
        publishAt: new Date(Date.now() + 8 * DAY),
        networks: ["instagram"],
        networkOptions: { instagramData: { type: "POST" } },
        text: `${title}: il menu d'autunno è arrivato. Vi aspettiamo da giovedì. #autunno`,
        firstCommentText: null,
        media: [media],
      },
      actor
    );
  }
  const post = await social("Lancio autunno", `attivita-1-${suffix}.png`);
  const second = await social("Storia del giovedì", `attivita-2-${suffix}.png`);
  await submitForReview([post.id, second.id], workspaceId, actor, { notify: false });

  // ── Another agency: its tasks must never show up here ──
  const other = await agencyWithSession(
    "paolo.altro@example.com",
    "Paolo Altrove",
    "Altra Agenzia e2e",
    "dev-session-other-agency-0000000001",
    expires
  );
  const otherClient =
    (await prisma.client.findFirst({ where: { workspaceId: other.workspace.id, name: "Cliente dell'altra agenzia" } })) ??
    (await prisma.client.create({
      data: {
        workspaceId: other.workspace.id,
        name: "Cliente dell'altra agenzia",
        networks: ["instagram"],
        services: ["SOCIAL_POST"],
        ownerUserId: other.owner.id,
      },
    }));
  const otherTaskTitle = `Modifiche richieste: Segreto altra agenzia ${suffix}`;
  const otherInfoTitle = `Approvato: Notizia altra agenzia ${suffix}`;
  const base = { workspaceId: other.workspace.id, clientId: otherClient.id, assigneeUserId: other.owner.id };
  await prisma.agencyActivity.createMany({
    data: [
      {
        ...base,
        type: "CHANGES_REQUESTED",
        kind: "TASK",
        title: otherTaskTitle,
        summary: "Testo riservato dell'altra agenzia",
        dedupeKey: `e2e-other-task:${suffix}`,
      },
      { ...base, type: "APPROVED", kind: "INFO", title: otherInfoTitle, dedupeKey: `e2e-other-info:${suffix}` },
    ],
    skipDuplicates: true,
  });

  // ── A third agency with nothing in it, for the empty states ──
  const empty = await agencyWithSession(
    "agenzia.vuota@example.com",
    "Elisa Vuoti",
    "Agenzia vuota e2e",
    "dev-session-empty-agency-0000000001",
    expires
  );
  await prisma.agencyActivity.deleteMany({ where: { workspaceId: empty.workspace.id } });

  console.log(
    `RESULT ${JSON.stringify({
      clientId: client.id,
      clientName: client.name,
      reviewUrl,
      postId: post.id,
      postTitle: post.title,
      secondId: second.id,
      secondTitle: second.title,
      marta: { id: marta.id, name: "Marta Bianchi", sessionToken: martaToken },
      empty: { sessionToken: "dev-session-empty-agency-0000000001" },
      other: {
        clientId: otherClient.id,
        sessionToken: "dev-session-other-agency-0000000001",
        taskTitle: otherTaskTitle,
        infoTitle: otherInfoTitle,
      },
    })}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
