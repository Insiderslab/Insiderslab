import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where Heili is allowed (text chat, summary, voice): IN_REVIEW and
 * CHANGES_REQUESTED, on the current version only, for a reviewer of the post's
 * client. Everything else stays closed.
 */

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

import { NotFoundError } from "@/lib/errors";
import { assistantModeForStatus, checkAssistantAccess, ASSISTANT_FEEDBACK_COPY } from "@/lib/review-assistant/shared";
import { checkMessageLimits, pickSessionForVersion } from "@/lib/review-assistant/rules";
import { getAssistantState, finalizeSession, sendAssistantMessage, type AssistantReviewer } from "@/lib/review-assistant/service";

const reviewer: AssistantReviewer = { id: "reviewer-a", clientId: "client-1", name: "Ada" };
const otherClientReviewer: AssistantReviewer = { id: "reviewer-x", clientId: "client-2", name: "Xena" };

// ─── The allowed-states helper ───────────────────────────────────────────────

describe("assistant allowed states", () => {
  it("maps IN_REVIEW to the decision and CHANGES_REQUESTED to extra feedback, nothing else", () => {
    expect(assistantModeForStatus("IN_REVIEW")).toBe("decision");
    expect(assistantModeForStatus("CHANGES_REQUESTED")).toBe("feedback");
    for (const status of ["DRAFT", "APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "CANCELLED", "DELIVERED", ""]) {
      expect(assistantModeForStatus(status)).toBeNull();
    }
  });

  it("allows IN_REVIEW and CHANGES_REQUESTED on the current version", () => {
    expect(checkAssistantAccess({ status: "IN_REVIEW", currentVersionNumber: 2, canAct: true }, 2)).toEqual({ ok: true, mode: "decision" });
    expect(checkAssistantAccess({ status: "CHANGES_REQUESTED", currentVersionNumber: 2, canAct: false }, 2)).toEqual({ ok: true, mode: "feedback" });
    // A database row has no canAct.
    expect(checkAssistantAccess({ status: "CHANGES_REQUESTED", currentVersionNumber: 2 }, 2)).toEqual({ ok: true, mode: "feedback" });
    expect(checkAssistantAccess({ status: "IN_REVIEW", currentVersionNumber: 2 }, 2)).toEqual({ ok: true, mode: "decision" });
  });

  it("refuses an old version in both states", () => {
    expect(checkAssistantAccess({ status: "IN_REVIEW", currentVersionNumber: 3, canAct: true }, 2)).toEqual({ ok: false, reason: "stale" });
    expect(checkAssistantAccess({ status: "CHANGES_REQUESTED", currentVersionNumber: 3 }, 2)).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses every other state, and an IN_REVIEW post the client was not sent", () => {
    for (const status of ["DRAFT", "APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "CANCELLED", "DELIVERED"]) {
      expect(checkAssistantAccess({ status, currentVersionNumber: 1, canAct: false }, 1)).toEqual({ ok: false, reason: "closed" });
    }
    expect(checkAssistantAccess({ status: "IN_REVIEW", currentVersionNumber: 1, canAct: false }, 1)).toEqual({ ok: false, reason: "closed" });
  });
});

describe("conversations already sent to the agency", () => {
  const at = (minutes: number) => new Date(2026, 9, 10, 10, minutes);
  const s = (id: string, status: "OPEN" | "COMPLETED" | "ABANDONED", version: number, minutes: number) => ({
    id,
    status,
    versionNumber: version,
    startedAt: at(minutes),
  });

  it("skips a submitted conversation so the next message starts a new one", () => {
    const sessions = [s("sent", "COMPLETED", 2, 1), s("older", "COMPLETED", 2, 0)];
    expect(pickSessionForVersion(sessions, 2)?.id).toBe("sent");
    expect(pickSessionForVersion(sessions, 2, new Set(["sent"]))?.id).toBe("older");
    expect(pickSessionForVersion(sessions, 2, new Set(["sent", "older"]))).toBeNull();
  });

  it("keeps the extra-feedback wording of the limits free of approvals", () => {
    const full = { hasCurrentSession: false, sessionsOnPost: 5, clientMessagesInSession: 0, clientMessagesLast24h: 0 };
    expect(checkMessageLimits(full)).toContain("approvarlo");
    expect(checkMessageLimits(full, "feedback")).toBe(ASSISTANT_FEEDBACK_COPY.exhausted);
    expect(checkMessageLimits(full, "feedback")).not.toMatch(/approv/i);
  });
});

// ─── Server gates (text chat and summary) ────────────────────────────────────

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

let sessions: Session[];
let attempts: Array<{ sessionId: string; createdAt: Date }>;
let sentSessionIds: string[];
/** What getPostForReviewer reports (the client's view). */
let postStatus: string;
let postVersion: number;
let postCanAct: boolean;
/** The database row the transactions re-read. */
let rowStatus: string;
let rowVersion: number;

function makeSession(overrides: Partial<Session> = {}): Session {
  const startedAt = new Date(Date.now() - 60_000);
  return {
    id: "session-1",
    postId: "post-1",
    reviewerId: reviewer.id,
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
      { id: "m1", sessionId: "session-1", role: "CLIENT", content: "Il titolo è troppo lungo", inputMode: "TEXT", createdAt: new Date(startedAt.getTime() + 1_000) },
    ],
    ...overrides,
  };
}

function postFor(reviewerId: string) {
  return {
    id: "post-1",
    title: "Post",
    kind: "SOCIAL_POST" as const,
    status: postStatus,
    currentVersionNumber: postVersion,
    canAct: postCanAct,
    client: { id: "client-1", name: "Cliente", logoUrl: null, timezone: "Europe/Rome" },
    versions: [{ id: "v1", number: 1, text: "T", firstCommentText: null, media: [], content: null }, { id: "v2", number: 2, text: "T2", firstCommentText: null, media: [], content: null }],
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
  return true;
}

function installPrismaMock() {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    reviewVoiceCall: { findFirst: vi.fn(async () => null) },
    post: {
      findUnique: vi.fn(async () => ({ workspaceId: "workspace-1", clientId: "client-1", status: rowStatus, currentVersionNumber: rowVersion })),
    },
    postEvent: {
      findMany: vi.fn(async () => sentSessionIds.map((id) => ({ metadata: { reviewSessionId: id } }))),
    },
    reviewProviderAttempt: {
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: { sessionId: string; createdAt: Date } }) => {
        attempts.push({ sessionId: data.sessionId, createdAt: data.createdAt });
        return data;
      }),
    },
    reviewSession: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => sessions.filter((session) => matchesSession(session, where))),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => sessions.find((session) => matchesSession(session, where)) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => sessions.find((s) => s.id === where.id)!),
      create: vi.fn(async ({ data }: { data: { postId: string; reviewerId: string; versionNumber: number; model: string; turnStartedAt: Date } }) => {
        const created = makeSession({ id: `session-${sessions.length + 1}`, ...data, messages: [] });
        sessions.push(created);
        return { id: created.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Session> }) => {
        const session = sessions.find((s) => s.id === where.id)!;
        Object.assign(session, data);
        return session;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Session> }) => {
        const matching = sessions.filter((session) => matchesSession(session, where));
        matching.forEach((session) => Object.assign(session, data));
        return { count: matching.length };
      }),
    },
    reviewMessage: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Pick<Message, "sessionId" | "role" | "content" | "inputMode"> }) => {
        const session = sessions.find((s) => s.id === data.sessionId)!;
        const message: Message = { id: `m${session.messages.length + 1}`, ...data, createdAt: new Date() };
        session.messages.push(message);
        return message;
      }),
    },
  };
  Object.assign(mocks.prisma, tx, {
    $transaction: vi.fn(async (input: unknown) => (input as (client: typeof tx) => Promise<unknown>)(tx)),
  });
  return tx;
}

function setPost(status: string, version = 1, canAct = status === "IN_REVIEW") {
  postStatus = status;
  rowStatus = status;
  postVersion = version;
  rowVersion = version;
  postCanAct = canAct;
}

beforeEach(() => {
  sessions = [makeSession()];
  attempts = [];
  sentSessionIds = [];
  setPost("IN_REVIEW");
  installPrismaMock();
  mocks.getPostForReviewer.mockImplementation(async (_postId: string, who: { id: string; clientId: string }) => {
    // The real function never returns another client's post.
    if (who.clientId !== "client-1") throw new NotFoundError("Post non trovato");
    return postFor(who.id);
  });
  mocks.getProvider.mockReturnValue({ model: () => "test-model" });
  mocks.runTurn.mockReset();
  mocks.runTurn.mockResolvedValue({ reply: "Quale titolo?", readiness: "exploring", model: "test-model" });
  mocks.runFinalize.mockReset();
  mocks.runFinalize.mockResolvedValue({ verdict: "changes", summary: "Titolo più corto.", actionItems: [], model: "test-model", refused: false });
  process.env.REVIEW_ASSISTANT_ATTEMPT_COOLDOWN_MS = "1";
});

afterEach(() => {
  delete process.env.REVIEW_ASSISTANT_ATTEMPT_COOLDOWN_MS;
  vi.clearAllMocks();
});

const message = { postId: "post-1", versionNumber: 1, inputMode: "TEXT" as const, message: "Anche il colore del bottone" };

describe("assistant chat while the post waits for a decision (IN_REVIEW)", () => {
  it("answers, and reports the decision mode", async () => {
    const turn = await sendAssistantMessage(reviewer, message);
    expect(turn.readiness).toBe("exploring");
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    expect(await getAssistantState(reviewer, "post-1", 1)).toMatchObject({ canChat: true, mode: "decision" });
  });
});

describe("assistant chat after «Chiedi modifiche» (CHANGES_REQUESTED)", () => {
  beforeEach(() => setPost("CHANGES_REQUESTED", 1, false));

  it("is allowed on the current version and reports the feedback mode", async () => {
    expect(await getAssistantState(reviewer, "post-1", 1)).toMatchObject({ canChat: true, mode: "feedback" });
    const turn = await sendAssistantMessage(reviewer, message);
    expect(turn.session.messages.at(-1)).toMatchObject({ role: "ASSISTANT", content: "Quale titolo?" });
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    // A reply that wants to approve makes no sense here: it never lights up «Approva».
    mocks.runTurn.mockResolvedValueOnce({ reply: "Perfetto!", readiness: "ready_approve", model: "test-model" });
    const happy = await sendAssistantMessage(reviewer, { ...message, message: "Ora va bene" });
    expect(happy.readiness).toBe("exploring");
  });

  it("does not offer the conversation that was already sent with the change request", async () => {
    sessions = [makeSession({ status: "COMPLETED", summary: "Titolo più corto.", verdict: "changes" })];
    sentSessionIds = ["session-1"];

    expect((await getAssistantState(reviewer, "post-1", 1)).session).toBeNull();
    await sendAssistantMessage(reviewer, message);
    // The sent one stays as it was; the new message opens a new conversation.
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ id: "session-1", status: "COMPLETED", summary: "Titolo più corto." });
    expect(sessions[1].messages[0]).toMatchObject({ role: "CLIENT", content: message.message });
  });

  it("keeps a prepared summary that was not sent yet, so a reload does not lose it", async () => {
    sessions = [makeSession({ status: "COMPLETED", summary: "Titolo più corto.", verdict: "changes" })];

    expect((await getAssistantState(reviewer, "post-1", 1)).session).toMatchObject({ id: "session-1", status: "COMPLETED" });
  });

  it("refuses the old version (a newer one was sent meanwhile)", async () => {
    setPost("CHANGES_REQUESTED", 2, false);
    expect(await getAssistantState(reviewer, "post-1", 1)).toMatchObject({ canChat: false, mode: null });
    await expect(sendAssistantMessage(reviewer, { ...message, versionNumber: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(finalizeSession(reviewer, { postId: "post-1", versionNumber: 1 })).rejects.toMatchObject({ status: 409 });
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
  });

  it("refuses when the agency edited the row meanwhile (fresh re-read, no model call)", async () => {
    // The snapshot looked fine, but the post moved on before the locked re-check.
    rowStatus = "APPROVED";
    await expect(sendAssistantMessage(reviewer, message)).rejects.toMatchObject({ status: 409 });
    rowStatus = "CHANGES_REQUESTED";
    rowVersion = 2;
    await expect(sendAssistantMessage(reviewer, message)).rejects.toMatchObject({ status: 409 });
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
  });

  it("refuses another client's reviewer and keeps the limits of the provider", async () => {
    await expect(sendAssistantMessage(otherClientReviewer, message)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.runTurn).not.toHaveBeenCalled();

    process.env.REVIEW_ASSISTANT_REVIEWER_DAILY_ATTEMPTS = "1";
    const tx = mocks.prisma as unknown as { reviewProviderAttempt: { count: ReturnType<typeof vi.fn> } };
    tx.reviewProviderAttempt.count.mockResolvedValue(1);
    await expect(sendAssistantMessage(reviewer, message)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("commento"),
    });
    delete process.env.REVIEW_ASSISTANT_REVIEWER_DAILY_ATTEMPTS;
  });

  it("finalizes the conversation but never as an approval", async () => {
    mocks.runFinalize.mockResolvedValue({ verdict: "approve", summary: "Va tutto bene.", actionItems: [], model: "test-model", refused: false });

    const result = await finalizeSession(reviewer, { postId: "post-1", versionNumber: 1 });

    expect(result.session.status).toBe("COMPLETED");
    expect(result.session.verdict).toBe("unclear");
    expect(mocks.runFinalize).toHaveBeenCalledTimes(1);
  });
});

describe("assistant chat in every other state", () => {
  it.each(["DRAFT", "APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "CANCELLED", "DELIVERED"])("%s stays closed", async (status) => {
    setPost(status);
    expect(await getAssistantState(reviewer, "post-1", 1)).toMatchObject({ canChat: false, mode: null });
    await expect(sendAssistantMessage(reviewer, message)).rejects.toMatchObject({ status: 409 });
    await expect(finalizeSession(reviewer, { postId: "post-1", versionNumber: 1 })).rejects.toMatchObject({ status: 409 });
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.runFinalize).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
  });

  it("another client's post is not found, even when it is IN_REVIEW", async () => {
    await expect(getAssistantState(otherClientReviewer, "post-1", 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(finalizeSession(otherClientReviewer, { postId: "post-1", versionNumber: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });
});
