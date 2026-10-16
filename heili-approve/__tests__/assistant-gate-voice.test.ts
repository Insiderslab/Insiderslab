import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The voice gate is the same as the text one: IN_REVIEW or CHANGES_REQUESTED, current version only. */

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  getPostForReviewer: vi.fn(),
  requestRuntimeClose: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/posts", () => ({ getPostForReviewer: mocks.getPostForReviewer }));
vi.mock("@/lib/review-assistant/live-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review-assistant/live-runtime")>();
  return { ...actual, requestRuntimeClose: mocks.requestRuntimeClose };
});

import { NotFoundError } from "@/lib/errors";
import { buildPostContext, buildTurnSystemPrompt } from "@/lib/review-assistant/prompt";
import { liveBackendInstructions, liveConversationInstructions, liveVoiceConfigured, voiceAvailability } from "@/lib/review-assistant/live-config";
import { VOICE_COPY, voiceUnavailableMessage } from "@/lib/review-assistant/shared";
import { prepareLiveCall, startLiveCall, sweepLiveCalls } from "@/lib/review-assistant/live-service";
import { feedbackHint } from "@/components/portal/review-pieces";

const reviewer = { id: "reviewer-a", clientId: "client-1", name: "Ada" };
const other = { id: "reviewer-x", clientId: "client-2", name: "Xena" };

function post(status: string, version = 2, canAct = status === "IN_REVIEW") {
  return {
    id: "post-1",
    title: "Post",
    kind: "SOCIAL_POST" as const,
    status,
    publishAt: new Date("2026-10-20T10:00:00Z"),
    networks: ["instagram"],
    networkOptions: {},
    currentVersionNumber: version,
    reviewDueAt: null,
    submittedAt: new Date(),
    approvedAt: null,
    scheduledAt: null,
    canAct,
    client: { id: "client-1", name: "Cliente", logoUrl: null, timezone: "Europe/Rome" },
    versions: [{ id: "v2", number: 2, text: "Testo", firstCommentText: null, media: [], videoCoverMs: null, content: null, schedule: null, changeNote: null, createdAt: new Date() }],
    comments: [],
    decisions: [],
    reviewSessions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Voice configured: these cases are about the review gate, not the configuration.
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  Object.assign(mocks.prisma, {
    post: { findUnique: vi.fn(async () => ({ workspaceId: "workspace-1" })) },
    reviewVoiceCall: { findMany: vi.fn(async () => []), updateMany: vi.fn(), findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
  });
  mocks.getPostForReviewer.mockImplementation(async (_id: string, who: { clientId: string }) => {
    if (who.clientId !== "client-1") throw new NotFoundError("Post non trovato");
    return current;
  });
  current = post("IN_REVIEW");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

let current = post("IN_REVIEW");

describe("voice preparation and start gate", () => {
  it.each(["IN_REVIEW", "CHANGES_REQUESTED"])("is allowed in %s on the current version", async (status) => {
    current = post(status);
    await expect(prepareLiveCall(reviewer, { postId: "post-1", versionNumber: 2 })).resolves.toMatchObject({ status: "ready" });
  });

  it.each(["DRAFT", "APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "CANCELLED", "DELIVERED"])("is refused in %s", async (status) => {
    current = post(status);
    await expect(prepareLiveCall(reviewer, { postId: "post-1", versionNumber: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it("is refused on an old version, also after «Chiedi modifiche»", async () => {
    current = post("CHANGES_REQUESTED", 3);
    await expect(prepareLiveCall(reviewer, { postId: "post-1", versionNumber: 2 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("nuova versione"),
    });
  });

  it("does not open another client's post", async () => {
    current = post("CHANGES_REQUESTED");
    await expect(prepareLiveCall(other, { postId: "post-1", versionNumber: 2 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("checks the state before creating a paid session", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    try {
      current = post("APPROVED");
      await expect(startLiveCall(reviewer, { postId: "post-1", versionNumber: 2, sdp: "v=0\r\n" + "x".repeat(20) })).rejects.toMatchObject({ status: 409 });
      expect(mocks.prisma.reviewVoiceCall).not.toHaveProperty("create");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe("voice configuration: said at once, never after the wait", () => {
  it.each([
    ["no OpenAI key", { OPENAI_API_KEY: "" }],
    ["voice switched off", { REVIEW_ASSISTANT_VOICE_ENABLED: "false" }],
  ])("%s: prepare and start refuse with a sentence for the client, before reading the post", async (_label, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    await expect(prepareLiveCall(reviewer, { postId: "post-1", versionNumber: 2 })).rejects.toMatchObject({
      status: 503,
      message: VOICE_COPY.notConfigured,
    });
    await expect(startLiveCall(reviewer, { postId: "post-1", versionNumber: 2, sdp: "v=0\r\n" + "x".repeat(20) })).rejects.toMatchObject({
      status: 503,
      message: VOICE_COPY.notConfigured,
    });
    expect(mocks.getPostForReviewer).not.toHaveBeenCalled();
  });

  it("media analysis off: a post with images is «unavailable» because of the configuration, with the count", async () => {
    vi.stubEnv("MEDIA_ANALYSIS_ENABLED", "false");
    const withMedia = post("IN_REVIEW");
    withMedia.versions[0].media = [
      { type: "image", url: "/media/w/a.png" },
      { type: "video", url: "/media/w/b.mp4" },
    ] as never;
    current = withMedia;
    await expect(prepareLiveCall(reviewer, { postId: "post-1", versionNumber: 2 })).resolves.toEqual({
      status: "unavailable",
      total: 2,
      ready: 0,
      videos: 1,
      reason: "media-analysis-off",
    });
  });

  it("a post without media is ready even with the analysis off", async () => {
    vi.stubEnv("MEDIA_ANALYSIS_ENABLED", "false");
    await expect(prepareLiveCall(reviewer, { postId: "post-1", versionNumber: 2 })).resolves.toEqual({
      status: "ready",
      total: 0,
      ready: 0,
      videos: 0,
      reason: null,
    });
  });
});

describe("voice availability shown before any tap", () => {
  it("needs the key, and the media analysis when the content has media", () => {
    expect(voiceAvailability({ configured: false, mediaCount: 0, mediaAnalysisEnabled: true })).toEqual({
      available: false,
      reason: "not-configured",
    });
    expect(voiceAvailability({ configured: true, mediaCount: 2, mediaAnalysisEnabled: false })).toEqual({
      available: false,
      reason: "media-analysis-off",
    });
    expect(voiceAvailability({ configured: true, mediaCount: 0, mediaAnalysisEnabled: false })).toEqual({ available: true, reason: null });
    expect(voiceAvailability({ configured: true, mediaCount: 3, mediaAnalysisEnabled: true })).toEqual({ available: true, reason: null });
  });

  it("the key alone turns it on; REVIEW_ASSISTANT_VOICE_ENABLED=false turns it off", () => {
    expect(liveVoiceConfigured({ OPENAI_API_KEY: "sk-x" })).toBe(true);
    expect(liveVoiceConfigured({ OPENAI_API_KEY: "  " })).toBe(false);
    expect(liveVoiceConfigured({ OPENAI_API_KEY: "sk-x", REVIEW_ASSISTANT_VOICE_ENABLED: "FALSE" })).toBe(false);
    expect(liveVoiceConfigured({ OPENAI_API_KEY: "sk-x", REVIEW_ASSISTANT_VOICE_ENABLED: "true" })).toBe(true);
  });

  it("every reason has a sentence that says what to do instead", () => {
    expect(voiceUnavailableMessage("not-configured")).toBe(VOICE_COPY.notConfigured);
    expect(voiceUnavailableMessage("media-analysis-off")).toBe(VOICE_COPY.mediaAnalysisOff);
    for (const text of Object.values(VOICE_COPY)) expect(text).toMatch(/scrivere o dettare/);
  });
});

describe("voice sweep", () => {
  const call = (status: string, version: number, sessionVersion = 2) => ({
    id: "call-1",
    status: "ACTIVE",
    providerSessionId: "prov-1",
    providerExpiresAt: null,
    startedAt: new Date(Date.now() - 10_000),
    expiresAt: new Date(Date.now() + 60_000),
    session: {
      versionNumber: sessionVersion,
      reviewer: { active: true, client: { archivedAt: null } },
      post: { status, currentVersionNumber: version },
    },
  });
  const findMany = () => (mocks.prisma.reviewVoiceCall as { findMany: ReturnType<typeof vi.fn> }).findMany;

  it("keeps a call alive in IN_REVIEW and CHANGES_REQUESTED on the same version", async () => {
    findMany().mockResolvedValue([call("IN_REVIEW", 2), call("CHANGES_REQUESTED", 2)]);
    await expect(sweepLiveCalls()).resolves.toMatchObject({ inspected: 0 });
    expect(mocks.requestRuntimeClose).not.toHaveBeenCalled();
  });

  it.each(["APPROVED", "SCHEDULED", "CANCELLED"])("closes a call when the post becomes %s", async (status) => {
    findMany().mockResolvedValue([call(status, 2)]);
    await sweepLiveCalls();
    expect(mocks.requestRuntimeClose).toHaveBeenCalledWith("call-1", "review_invalidated");
  });

  it("closes a call when the agency sends a newer version", async () => {
    findMany().mockResolvedValue([call("CHANGES_REQUESTED", 3, 2)]);
    await sweepLiveCalls();
    expect(mocks.requestRuntimeClose).toHaveBeenCalledWith("call-1", "review_invalidated");
  });
});

describe("what Heili is told after «Chiedi modifiche»", () => {
  it("derives the mode from the post state", () => {
    expect(buildPostContext(post("IN_REVIEW") as never, "Ada", 2).mode).toBe("decision");
    expect(buildPostContext(post("CHANGES_REQUESTED") as never, "Ada", 2).mode).toBe("feedback");
  });

  it("the text prompt drops the approval framing and never promises a new version", () => {
    const decision = buildTurnSystemPrompt(buildPostContext(post("IN_REVIEW") as never, "Ada", 2));
    const feedback = buildTurnSystemPrompt(buildPostContext(post("CHANGES_REQUESTED") as never, "Ada", 2));
    expect(decision).not.toContain("ALREADY asked");
    expect(feedback).toContain("ALREADY asked the agency for changes");
    expect(feedback).toContain("Never tell the client they can approve");
    expect(feedback).toContain("Never promise or imply that a new version will be made");
    expect(feedback).toContain("«Aggiungi al feedback»");
    expect(feedback).toContain('never "ready_approve"');
  });

  it("the voice instructions note it for the agency, without approvals or a new version", () => {
    const decision = liveConversationInstructions("SOCIAL_POST");
    const voice = liveConversationInstructions("SOCIAL_POST", "feedback");
    expect(decision).toContain("Dimmi cosa vorresti cambiare");
    expect(voice).toContain("hai già chiesto modifiche");
    expect(voice).toContain("Non parlare di approvazione");
    expect(voice).toContain("verrà creata una nuova versione");
    expect(voice).toContain("lo segni per l'agenzia");
    expect(voice).toContain("Segno nel riepilogo la richiesta di cambiare il titolo");
    expect(liveBackendInstructions("CONTESTO")).toContain("never say that a new version will be made");
  });
});

describe("hint under «Cosa ne pensi?»", () => {
  it("offers Heili wherever the client can comment and the assistant is on", () => {
    expect(feedbackHint(true, true)).toBe("Scrivilo, dettalo oppure parlane con Heili.");
    expect(feedbackHint(true, true, true)).toContain("Hai già chiesto modifiche");
    expect(feedbackHint(true, true, true)).toBe(
      "Hai già chiesto modifiche: puoi aggiungere altro scrivendo, dettando o parlando con Heili."
    );
  });

  it("does not mention Heili when the assistant is off, and never says it will come back", () => {
    expect(feedbackHint(true, false)).toBe("Scrivilo oppure dettalo.");
    expect(feedbackHint(true, false, true)).toBe("Hai già chiesto modifiche: puoi aggiungere altro scrivendo o dettando.");
    for (const text of [feedbackHint(true, true), feedbackHint(true, true, true), feedbackHint(false, true)]) {
      expect(text).not.toContain("torna disponibile");
    }
  });
});
