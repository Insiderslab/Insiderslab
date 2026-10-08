import { beforeEach, describe, expect, it, vi } from "vitest";

// Reviewers without email: the services run against a fake Prisma, and no
// email ever leaves (sendEmail is a spy).
const { mockPrisma, sendEmail } = vi.hoisted(() => ({
  mockPrisma: {
    client: { findFirst: vi.fn() },
    clientReviewer: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    workspace: { findUnique: vi.fn() },
    post: { findMany: vi.fn() },
  },
  sendEmail: vi.fn<(message: { to: unknown }) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail,
}));

import {
  clientLinkMessage,
  firstName,
  nobodyEmailed,
  postLinkMessage,
  submitFollowUp,
  whatsappHref,
} from "../components/share/messages";
import PostSharePanel from "../components/share/post-share-panel";
import { issueReviewerToken } from "../lib/reviewers";
import { notifyReviewReminder, notifyReviewRequested } from "../lib/notifications";
import { NO_EMAIL_MESSAGE, createReviewer, reactivateReviewer, sendReviewerLink } from "../lib/reviewers";

const URL = "https://approve.example.com/review/abc";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  vi.stubEnv("PUBLIC_BASE_URL", "https://approve.example.com");
});

describe("share messages", () => {
  it("greets by first name", () => {
    expect(firstName("  Chiara  Fabbri ")).toBe("Chiara");
    expect(firstName("")).toBe("");
  });

  it("writes the client link message", () => {
    expect(
      clientLinkMessage({ reviewerName: "Chiara Fabbri", clientName: "Agriturismo Le Querce", url: URL })
    ).toBe(`Ciao Chiara, ecco il link per rivedere e approvare i contenuti di Agriturismo Le Querce: ${URL}`);
    expect(clientLinkMessage({ reviewerName: "", clientName: "Caffè Aurora", url: URL, contentsThe: "i post" })).toBe(
      `Ciao, ecco il link per rivedere e approvare i post di Caffè Aurora: ${URL}`
    );
  });

  it("writes the item message by kind", () => {
    const base = { reviewerName: "Chiara Fabbri", title: "Weekend d'autunno", url: URL };
    expect(postLinkMessage({ ...base, kind: "SOCIAL_POST", status: "IN_REVIEW" })).toBe(
      `Ciao Chiara, c'è un nuovo post da approvare: «Weekend d'autunno». Lo trovi qui: ${URL}`
    );
    expect(postLinkMessage({ ...base, kind: "BLOG_ARTICLE" })).toBe(
      `Ciao Chiara, c'è un nuovo articolo da approvare: «Weekend d'autunno». Lo trovi qui: ${URL}`
    );
    expect(postLinkMessage({ ...base, kind: "AD_CREATIVE" })).toBe(
      `Ciao Chiara, ci sono nuove creatività da approvare: «Weekend d'autunno». Le trovi qui: ${URL}`
    );
    expect(postLinkMessage({ ...base, kind: "BLOG_ARTICLE", status: "CHANGES_REQUESTED" })).toBe(
      `Ciao Chiara, ecco il link per rivedere l'articolo «Weekend d'autunno»: ${URL}`
    );
  });

  it("encodes the WhatsApp text", () => {
    const href = whatsappHref("Ciao Chiara, «Titolo» & altro: https://x.it/review/a?b=1");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(href).not.toContain(" ");
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(
      "Ciao Chiara, «Titolo» & altro: https://x.it/review/a?b=1"
    );
  });

  it("explains who is told after «Invia in revisione»", () => {
    const linkOnly = { clientCount: 1, clientsWithoutReviewers: [], clientsWithoutEmail: ["Le Querce"] };
    expect(nobodyEmailed(linkOnly)).toBe(true);
    expect(submitFollowUp(linkOnly)).toContain("«Condividi con il cliente»");
    expect(submitFollowUp(linkOnly)).toContain("Nessun referente ha un'email");

    const mixed = { clientCount: 2, clientsWithoutReviewers: [], clientsWithoutEmail: ["Le Querce"] };
    expect(nobodyEmailed(mixed)).toBe(false);
    expect(submitFollowUp(mixed)).toBe(
      "I referenti di Le Querce non hanno un'email: manda tu il link dal riquadro «Condividi con il cliente»."
    );

    const everyoneEmailed = { clientCount: 1, clientsWithoutReviewers: [], clientsWithoutEmail: [] };
    expect(nobodyEmailed(everyoneEmailed)).toBe(false);
    expect(submitFollowUp(everyoneEmailed)).toBe("");

    expect(submitFollowUp({ clientCount: 1, clientsWithoutReviewers: ["Aurora"], clientsWithoutEmail: [] })).toContain(
      "Aurora non ha referenti attivi"
    );
  });
});

describe("post share panel scope", () => {
  it("loads personal links only through the post client's workspace", async () => {
    mockPrisma.clientReviewer.findMany.mockResolvedValue([]);

    await PostSharePanel({
      workspaceId: "w1",
      post: { id: "p1", title: "Post", kind: "SOCIAL_POST", status: "IN_REVIEW" },
      client: { id: "c1", name: "Le Querce", archivedAt: null },
    });

    expect(mockPrisma.clientReviewer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: "c1", active: true, client: { workspaceId: "w1" } } })
    );
  });
});

describe("reviewers without email", () => {
  const client = { id: "c1", workspaceId: "w1", name: "Le Querce", archivedAt: null };

  it("creates a new reviewer without looking up by email", async () => {
    mockPrisma.client.findFirst.mockResolvedValue(client);
    mockPrisma.clientReviewer.create.mockImplementation(async ({ data }) => ({ id: "r1", ...data }));

    const { reviewer, reviewUrl } = await createReviewer("c1", "w1", { name: "Paolo Fabbri", email: "" });

    expect(mockPrisma.clientReviewer.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.clientReviewer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clientId: "c1", name: "Paolo Fabbri", email: null }),
    });
    expect(reviewer.email).toBeNull();
    expect(reviewUrl).toMatch(/^https:\/\/approve\.example\.com\/review\/[A-Za-z0-9_-]{43}$/);
  });

  it("still reactivates a reviewer re-added with the same email", async () => {
    mockPrisma.client.findFirst.mockResolvedValue(client);
    mockPrisma.clientReviewer.findUnique.mockResolvedValue({ id: "r0", active: false });
    mockPrisma.clientReviewer.update.mockImplementation(async ({ data }) => ({ id: "r0", email: "a@b.it", ...data }));

    await createReviewer("c1", "w1", { name: "Anna", email: "A@B.it" });
    expect(mockPrisma.clientReviewer.findUnique).toHaveBeenCalledWith({
      where: { clientId_email: { clientId: "c1", email: "a@b.it" } },
    });
    expect(mockPrisma.clientReviewer.create).not.toHaveBeenCalled();
  });

  it("refuses to email a reviewer without email", async () => {
    mockPrisma.clientReviewer.findFirst.mockResolvedValue({
      id: "r1",
      name: "Paolo",
      email: null,
      active: true,
      client,
      ...issueReviewerToken(),
    });
    await expect(sendReviewerLink("r1", "w1")).rejects.toThrow(NO_EMAIL_MESSAGE);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reactivates by id with a fresh link", async () => {
    mockPrisma.clientReviewer.findFirst.mockResolvedValue({ id: "r1", active: false, email: null, client });
    mockPrisma.clientReviewer.update.mockImplementation(async ({ data }) => ({ id: "r1", email: null, ...data }));
    const { reviewer } = await reactivateReviewer("r1", "w1");
    expect(reviewer.active).toBe(true);
    expect(mockPrisma.clientReviewer.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({ active: true, tokenHash: expect.any(String) }),
    });
  });
});

describe("notifications skip reviewers without email", () => {
  function inReviewPost(reviewers: Array<{ id: string; name: string; email: string | null }>) {
    return {
      id: "p1",
      clientId: "c1",
      title: "Weekend d'autunno",
      kind: "SOCIAL_POST",
      publishAt: new Date("2026-10-10T09:00:00Z"),
      networks: ["instagram"],
      reviewDueAt: null,
      versions: [{ content: null }],
      workspace: { name: "InsidersLab" },
      client: {
        id: "c1",
        name: "Le Querce",
        timezone: "Europe/Rome",
        archivedAt: null,
        reviewers: reviewers.map((r) => ({ ...r, active: true, ...issueReviewerToken() })),
      },
    };
  }

  it("asks the database only for reviewers with an email", async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);
    await notifyReviewRequested(["p1"]);
    const query = mockPrisma.post.findMany.mock.calls[0][0];
    expect(query.include.client.include.reviewers.where).toEqual({ active: true, email: { not: null } });
  });

  it("emails only the reviewers that have an address, without crashing", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      inReviewPost([
        { id: "r1", name: "Chiara", email: "chiara@querce.it" },
        { id: "r2", name: "Paolo", email: null },
      ]),
    ]);
    await expect(notifyReviewRequested(["p1"])).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "chiara@querce.it" });
  });

  it("sends no reminder when nobody has an email", async () => {
    mockPrisma.post.findMany.mockResolvedValue([inReviewPost([{ id: "r2", name: "Paolo", email: null }])]);
    const reminded = await notifyReviewReminder(["p1"]);
    expect(reminded.size).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
