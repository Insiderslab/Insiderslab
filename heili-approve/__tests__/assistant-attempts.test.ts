import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  getPostForReviewer: vi.fn(),
  runTurn: vi.fn(),
  runFinalize: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/posts", () => ({ getPostForReviewer: mocks.getPostForReviewer }));
vi.mock("@/lib/review-assistant/prompt", () => ({ buildPostContext: vi.fn(() => ({})) }));
vi.mock("@/lib/review-assistant/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review-assistant/provider")>();
  return {
    ...actual,
    getAssistantProvider: mocks.getProvider,
    runAssistantTurn: mocks.runTurn,
    runAssistantFinalize: mocks.runFinalize,
  };
});

import { AssistantError } from "@/lib/review-assistant/provider";
import { finalizeSession, sendAssistantMessage, type AssistantReviewer } from "@/lib/review-assistant/service";

type Message = {
  id: string;
  sessionId: string;
  role: "CLIENT" | "ASSISTANT";
  content: string;
  inputMode: "TEXT" | "VOICE";
  createdAt: Date;
};

type Session = {
  id: string;
  postId: string;
  reviewerId: string;
  versionNumber: number;
  status: "OPEN" | "COMPLETED" | "ABANDONED";
  verdict: string | null;
  summary: string | null;
  actionItems: unknown[];
  model: string | null;
  startedAt: Date;
  completedAt: Date | null;
  turnStartedAt: Date | null;
  messages: Message[];
};

type Attempt = { sessionId: string; createdAt: Date };
type AttemptWhere = {
  createdAt?: { gte: Date };
  session?: { reviewerId?: string; post?: { workspaceId?: string } };
};
type SessionWhere = Record<string, unknown> & { id?: string };
type SessionCreateData = {
  postId: string;
  reviewerId: string;
  versionNumber: number;
  model: string;
  turnStartedAt: Date;
};
type MessageCreateData = Pick<Message, "sessionId" | "role" | "content" | "inputMode">;

const reviewerA: AssistantReviewer = { id: "reviewer-a", clientId: "client-1", name: "Ada" };
const reviewerB: AssistantReviewer = { id: "reviewer-b", clientId: "client-1", name: "Bruno" };

let sessions: Session[];
let attempts: Attempt[];
let transactionTail: Promise<unknown>;
let currentPostVersion = 1;

function makeSession(reviewerId: string, id = `session-${reviewerId}`): Session {
  const startedAt = new Date(Date.now() - 60_000);
  return {
    id,
    postId: "post-1",
    reviewerId,
    versionNumber: 1,
    status: "OPEN",
    verdict: null,
    summary: null,
    actionItems: [],
    model: "test-model",
    startedAt,
    completedAt: null,
    turnStartedAt: null,
    messages: [
      {
        id: `message-${reviewerId}`,
        sessionId: id,
        role: "CLIENT",
        content: "Vorrei un testo più corto",
        inputMode: "TEXT",
        createdAt: new Date(startedAt.getTime() + 1_000),
      },
    ],
  };
}

function sessionFor(id: string): Session {
  const session = sessions.find((item) => item.id === id);
  if (!session) throw new Error(`Missing session ${id}`);
  return session;
}

function postFor(reviewerId: string) {
  return {
    id: "post-1",
    title: "Post autunno",
    kind: "SOCIAL_POST" as const,
    status: "IN_REVIEW" as const,
    publishAt: new Date("2026-10-20T10:00:00.000Z"),
    networks: ["instagram"],
    networkOptions: {},
    currentVersionNumber: 1,
    reviewDueAt: null,
    submittedAt: new Date("2026-10-08T10:00:00.000Z"),
    approvedAt: null,
    scheduledAt: null,
    canAct: true,
    planId: null,
    client: { id: "client-1", name: "Cliente", logoUrl: null, timezone: "Europe/Rome" },
    versions: [
      {
        id: "version-1",
        number: 1,
        text: "Testo",
        firstCommentText: null,
        media: [],
        videoCoverMs: null,
        content: null,
        schedule: null,
        changeNote: null,
        createdAt: new Date("2026-10-08T10:00:00.000Z"),
      },
    ],
    comments: [],
    decisions: [],
    reviewSessions: sessions.filter((session) => session.reviewerId === reviewerId),
  };
}

function matchesSession(session: Session, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && where.id !== session.id) return false;
  if (where.postId !== undefined && where.postId !== session.postId) return false;
  if (where.reviewerId !== undefined && where.reviewerId !== session.reviewerId) return false;
  if (where.status !== undefined && where.status !== session.status) return false;
  if (where.turnStartedAt instanceof Date && session.turnStartedAt?.getTime() !== where.turnStartedAt.getTime()) return false;
  return true;
}

function attemptMatches(attempt: Attempt, where: AttemptWhere): boolean {
  const session = sessionFor(attempt.sessionId);
  if (where.createdAt?.gte && attempt.createdAt < where.createdAt.gte) return false;
  if (where.session?.reviewerId && session.reviewerId !== where.session.reviewerId) return false;
  // Every fixture post is in workspace-1. This branch makes the mock verify
  // the same relation path used by the production query.
  if (where.session?.post?.workspaceId && where.session.post.workspaceId !== "workspace-1") return false;
  return true;
}

function installPrismaMock() {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    post: { findUnique: vi.fn(async () => ({ workspaceId: "workspace-1", clientId: "client-1", status: "IN_REVIEW", currentVersionNumber: currentPostVersion })) },
    reviewProviderAttempt: {
      findFirst: vi.fn(async ({ where }: { where: AttemptWhere }) => {
        const found = attempts
          .filter((attempt) => attemptMatches(attempt, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return found ? { createdAt: found.createdAt } : null;
      }),
      count: vi.fn(async ({ where }: { where: AttemptWhere }) =>
        attempts.filter((attempt) => attemptMatches(attempt, where)).length
      ),
      create: vi.fn(async ({ data }: { data: { sessionId: string; createdAt: Date } }) => {
        const attempt = { sessionId: data.sessionId, createdAt: data.createdAt };
        attempts.push(attempt);
        return attempt;
      }),
    },
    reviewSession: {
      findMany: vi.fn(async ({ where }: { where: SessionWhere }) =>
        sessions.filter((session) => matchesSession(session, where))
      ),
      findUnique: vi.fn(async ({ where }: { where: SessionWhere }) =>
        sessions.find((session) => matchesSession(session, where)) ?? null
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => sessionFor(where.id)),
      create: vi.fn(async ({ data }: { data: SessionCreateData }) => {
        const created: Session = {
          ...makeSession(data.reviewerId, `session-${sessions.length + 1}`),
          postId: data.postId,
          versionNumber: data.versionNumber,
          model: data.model,
          turnStartedAt: data.turnStartedAt,
          messages: [],
        };
        sessions.push(created);
        return { id: created.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Session> }) => {
        const session = sessionFor(where.id);
        Object.assign(session, data);
        return session;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: SessionWhere; data: Partial<Session> }) => {
        const matching = sessions.filter((session) => matchesSession(session, where));
        matching.forEach((session) => Object.assign(session, data));
        return { count: matching.length };
      }),
    },
    reviewMessage: {
      count: vi.fn(async () => 1),
      create: vi.fn(async ({ data }: { data: MessageCreateData }) => {
        const session = sessionFor(data.sessionId);
        const message: Message = {
          id: `message-${session.messages.length + 1}`,
          sessionId: data.sessionId,
          role: data.role,
          content: data.content,
          inputMode: data.inputMode,
          createdAt: new Date(),
        };
        session.messages.push(message);
        return message;
      }),
    },
  };

  Object.assign(mocks.prisma, tx, {
    $transaction: vi.fn((input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      const execute = input as (client: typeof tx) => Promise<unknown>;
      const result = transactionTail.then(() => execute(tx));
      transactionTail = result.catch(() => undefined);
      return result;
    }),
  });
}

function expireCooldown(): void {
  for (const attempt of attempts) attempt.createdAt = new Date(Date.now() - 5_000);
}

beforeEach(() => {
  currentPostVersion = 1;
  sessions = [makeSession(reviewerA.id)];
  attempts = [];
  transactionTail = Promise.resolve();
  installPrismaMock();
  mocks.getPostForReviewer.mockImplementation(async (_postId: string, reviewer: { id: string }) => postFor(reviewer.id));
  mocks.getProvider.mockReturnValue({ model: () => "test-model" });
  mocks.runTurn.mockReset();
  mocks.runFinalize.mockReset();
  process.env.REVIEW_ASSISTANT_REVIEWER_DAILY_ATTEMPTS = "2";
  process.env.REVIEW_ASSISTANT_WORKSPACE_DAILY_ATTEMPTS = "10";
  process.env.REVIEW_ASSISTANT_ATTEMPT_COOLDOWN_MS = "1";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.REVIEW_ASSISTANT_REVIEWER_DAILY_ATTEMPTS;
  delete process.env.REVIEW_ASSISTANT_WORKSPACE_DAILY_ATTEMPTS;
  delete process.env.REVIEW_ASSISTANT_ATTEMPT_COOLDOWN_MS;
  vi.clearAllMocks();
});

describe("persistent review-assistant provider budgets", () => {
  it("charges a new message before a provider failure", async () => {
    sessions = [];
    mocks.runTurn.mockRejectedValue(new AssistantError("Provider non disponibile", 503));

    await expect(
      sendAssistantMessage(reviewerA, {
        postId: "post-1",
        versionNumber: 1,
        inputMode: "TEXT",
        message: "La foto non mi convince",
      })
    ).rejects.toMatchObject({ status: 503 });

    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);
    expect(sessions[0].messages).toEqual([
      expect.objectContaining({ role: "CLIENT", content: "La foto non mi convince" }),
    ]);
  });

  it("enforces a reviewer cooldown before another provider call", async () => {
    // Freeze the clock so the 1 ms test cooldown cannot expire under CPU load.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    attempts.push({ sessionId: sessions[0].id, createdAt: new Date() });

    await expect(
      sendAssistantMessage(reviewerA, {
        postId: "post-1",
        versionNumber: 1,
        inputMode: "TEXT",
        retry: true,
      })
    ).rejects.toMatchObject({ status: 429, message: expect.stringContaining("Attendi") });

    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
  });

  it("charges failed retries and stops them at the reviewer daily limit", async () => {
    mocks.runTurn.mockRejectedValue(new AssistantError("Provider non disponibile", 503));
    const input = { postId: "post-1", versionNumber: 1, inputMode: "TEXT" as const, retry: true };

    await expect(sendAssistantMessage(reviewerA, input)).rejects.toMatchObject({ status: 503 });
    expireCooldown();
    await expect(sendAssistantMessage(reviewerA, input)).rejects.toMatchObject({ status: 503 });
    expireCooldown();
    await expect(sendAssistantMessage(reviewerA, input)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("limite giornaliero"),
    });

    expect(mocks.runTurn).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveLength(2);
  });

  it("charges failed finalize calls and leaves an already completed finalize free", async () => {
    mocks.runFinalize.mockRejectedValue(new AssistantError("Provider non disponibile", 503));
    const input = { postId: "post-1", versionNumber: 1 };

    await expect(finalizeSession(reviewerA, input)).rejects.toMatchObject({ status: 503 });
    expireCooldown();
    await expect(finalizeSession(reviewerA, input)).rejects.toMatchObject({ status: 503 });
    expireCooldown();
    await expect(finalizeSession(reviewerA, input)).rejects.toMatchObject({ status: 429 });
    expect(mocks.runFinalize).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveLength(2);

    const session = sessions[0];
    session.status = "COMPLETED";
    session.summary = "Testo più breve richiesto.";
    session.verdict = "changes";
    const response = await finalizeSession(reviewerA, input);

    expect(response.session.summary).toBe("Testo più breve richiesto.");
    expect(mocks.runFinalize).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveLength(2);
  });

  it("uses one provider attempt when two retries arrive in parallel", async () => {
    let rejectProvider!: (reason: unknown) => void;
    mocks.runTurn.mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejectProvider = reject;
      })
    );
    const input = { postId: "post-1", versionNumber: 1, inputMode: "TEXT" as const, retry: true };

    const first = sendAssistantMessage(reviewerA, input);
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    const second = sendAssistantMessage(reviewerA, input);

    await expect(second).rejects.toMatchObject({ status: 409 });
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);

    rejectProvider(new AssistantError("Provider non disponibile", 503));
    await expect(first).rejects.toMatchObject({ status: 503 });
  });

  it("shares the workspace budget across different reviewers", async () => {
    process.env.REVIEW_ASSISTANT_REVIEWER_DAILY_ATTEMPTS = "10";
    process.env.REVIEW_ASSISTANT_WORKSPACE_DAILY_ATTEMPTS = "1";
    sessions.push(makeSession(reviewerB.id));
    mocks.runTurn.mockRejectedValue(new AssistantError("Provider non disponibile", 503));
    const input = { postId: "post-1", versionNumber: 1, inputMode: "TEXT" as const, retry: true };

    await expect(sendAssistantMessage(reviewerA, input)).rejects.toMatchObject({ status: 503 });
    await expect(sendAssistantMessage(reviewerB, input)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("workspace"),
    });

    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);
  });
});


describe("fresh review version checks", () => {
  it("rejects a stale snapshot before spending a provider call", async () => {
    currentPostVersion = 2;
    await expect(sendAssistantMessage(reviewerA, { postId: "post-1", versionNumber: 1, inputMode: "TEXT", message: "Cambia colore" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
  });
  it("does not store a reply if the agency sends a new version during generation", async () => {
    mocks.runTurn.mockImplementation(async () => { currentPostVersion = 2; return { reply: "Quale colore?", model: "test-model" }; });
    await expect(sendAssistantMessage(reviewerA, { postId: "post-1", versionNumber: 1, inputMode: "TEXT", message: "Cambia colore" })).rejects.toMatchObject({ status: 409 });
    expect(attempts).toHaveLength(1);
    expect(sessions[0].messages.some(m => m.role === "ASSISTANT")).toBe(false);
  });
});
