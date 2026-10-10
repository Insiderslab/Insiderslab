import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Heili after «Chiedi modifiche» (post in CHANGES_REQUESTED): its conclusion is
 * saved as extra client feedback on the current version, with the same checks
 * as a typed comment. It never approves, never changes the status and never
 * creates a second change request.
 */

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  notifyChangesRequested: vi.fn(),
  notifyApproved: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/notifications", () => ({
  notifyApproved: mocks.notifyApproved,
  notifyChangesRequested: mocks.notifyChangesRequested,
  notifyReviewRequested: vi.fn(),
}));

import { ConflictError, NotFoundError } from "@/lib/errors";
import { addAssistantFeedback } from "@/lib/posts";

type PostRow = {
  id: string;
  clientId: string;
  status: string;
  currentVersionNumber: number;
  submittedAt: Date | null;
  kind: "SOCIAL_POST" | "BLOG_ARTICLE" | "AD_CREATIVE";
  planId: string | null;
  client: { id: string };
};

const reviewer = { id: "reviewer-1", clientId: "client-1" };
const media = [{ type: "image", url: "https://example.com/a.png" }, { type: "video", url: "https://example.com/b.mp4", durationSec: 12 }];

let post: PostRow;
let reviewerRow: { clientId: string; active: boolean } | null;
let session: { id: string } | null;
let sentEvents: Array<{ metadata: unknown }>;
let lastSubmitted: number | null;

function installDb() {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    post: {
      findUnique: vi.fn(async () => post),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => post),
    },
    clientReviewer: { findUnique: vi.fn(async () => reviewerRow) },
    reviewSession: { findFirst: vi.fn(async () => session) },
    postVersion: {
      findUniqueOrThrow: vi.fn(async () => ({ id: "version-3", media, content: null })),
    },
    postComment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `comment-${tx.postComment.create.mock.calls.length}`, ...data })),
    },
    postEvent: {
      groupBy: vi.fn(async () => (lastSubmitted === null ? [] : [{ postId: "post-1", _max: { versionNumber: lastSubmitted } }])),
      findMany: vi.fn(async () => sentEvents),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
    },
    creativeDecision: { create: vi.fn(), upsert: vi.fn() },
  };
  Object.assign(mocks.prisma, {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    post: { findUniqueOrThrow: vi.fn(async () => post) },
  });
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  post = {
    id: "post-1",
    clientId: "client-1",
    status: "CHANGES_REQUESTED",
    currentVersionNumber: 3,
    submittedAt: new Date("2026-10-09T10:00:00Z"),
    kind: "SOCIAL_POST",
    planId: null,
    client: { id: "client-1" },
  };
  reviewerRow = { clientId: "client-1", active: true };
  session = { id: "session-1" };
  sentEvents = [];
  lastSubmitted = 3;
});

const OPTS = { reviewSessionId: "session-1", actionItems: [] };

describe("addAssistantFeedback", () => {
  it("adds the summary as a client comment on the current version and logs a COMMENTED event", async () => {
    const tx = installDb();

    const result = await addAssistantFeedback("post-1", reviewer, 3, "Aggiungere un secondo logo.", OPTS);

    expect(tx.postComment.create).toHaveBeenCalledTimes(1);
    expect(tx.postComment.create).toHaveBeenCalledWith({
      data: {
        postId: "post-1",
        versionId: "version-3",
        authorType: "CLIENT",
        reviewerId: "reviewer-1",
        body: "Aggiungere un secondo logo.",
      },
    });
    expect(tx.postEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.postEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        postId: "post-1",
        type: "COMMENTED",
        reviewerId: "reviewer-1",
        versionNumber: 3,
        metadata: { commentId: result.comment.id, reviewSessionId: "session-1" },
      }),
    });
  });

  it("never changes the status, approves, opens a second change request or notifies as a decision", async () => {
    const tx = installDb();

    await addAssistantFeedback("post-1", reviewer, 3, "Altro feedback", OPTS);

    expect(tx.post.updateMany).not.toHaveBeenCalled();
    expect(tx.post.update).not.toHaveBeenCalled();
    const types = tx.postEvent.create.mock.calls.map(([arg]) => (arg as { data: { type: string } }).data.type);
    expect(types).toEqual(["COMMENTED"]);
    expect(types).not.toContain("CHANGES_REQUESTED");
    expect(types).not.toContain("APPROVED");
    expect(mocks.notifyChangesRequested).not.toHaveBeenCalled();
    expect(mocks.notifyApproved).not.toHaveBeenCalled();
  });

  it("puts the located items on their media and moment, like the change request does", async () => {
    const tx = installDb();

    const result = await addAssistantFeedback("post-1", reviewer, 3, "Due cose in più", {
      reviewSessionId: "session-1",
      actionItems: [
        { area: "media", mediaIndex: 0, timeSec: null, timeEndSec: null, pinX: 0.4, pinY: 0.3, request: "Spostare il logo", priority: "media" },
        { area: "media", mediaIndex: 1, timeSec: 5, timeEndSec: null, request: "Rallentare la scritta", priority: "alta" },
        { area: "altro", mediaIndex: null, timeSec: null, timeEndSec: null, request: "Cambiare l'orario", priority: "bassa" },
      ],
    });

    // Summary + the two items that point at a media; the third stays in the summary only.
    expect(tx.postComment.create).toHaveBeenCalledTimes(3);
    expect(result.actionComments).toHaveLength(2);
    expect(tx.postComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ body: "Spostare il logo", mediaIndex: 0, pinX: 0.4, pinY: 0.3, authorType: "CLIENT", reviewerId: "reviewer-1" }),
    });
    expect(tx.postComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ body: "Rallentare la scritta", mediaIndex: 1, timeSec: 5 }),
    });
    expect(tx.postEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "COMMENTED",
        metadata: expect.objectContaining({ reviewSessionId: "session-1", actionCommentIds: result.actionComments.map((c) => c.id) }),
      }),
    });
  });

  it.each(["IN_REVIEW", "APPROVED", "SCHEDULING", "SCHEDULED", "FAILED", "DELIVERED"])("refuses a post in %s: not the 'extra feedback' state", async (status) => {
    const tx = installDb();
    post.status = status;

    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(ConflictError);

    expect(tx.postComment.create).not.toHaveBeenCalled();
    expect(tx.postEvent.create).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "CANCELLED"])("refuses a %s post (not visible to the client)", async (status) => {
    const tx = installDb();
    post.status = status;

    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(NotFoundError);
    expect(tx.postComment.create).not.toHaveBeenCalled();
  });

  it("refuses an old version (the agency already sent a newer one)", async () => {
    const tx = installDb();
    post.currentVersionNumber = 4;
    lastSubmitted = 4;

    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(ConflictError);
    expect(tx.postComment.create).not.toHaveBeenCalled();
  });

  it("refuses while the agency has an unsent revision (the client still sees the previous version)", async () => {
    const tx = installDb();
    post.currentVersionNumber = 4;
    lastSubmitted = 3;

    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(ConflictError);
    await expect(addAssistantFeedback("post-1", reviewer, 4, "Altro", OPTS)).rejects.toBeInstanceOf(NotFoundError);
    expect(tx.postComment.create).not.toHaveBeenCalled();
  });

  it("does not leak another client's post", async () => {
    const tx = installDb();

    await expect(
      addAssistantFeedback("post-1", { id: "reviewer-9", clientId: "client-2" }, 3, "Altro", OPTS)
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(tx.postComment.create).not.toHaveBeenCalled();
  });

  it("refuses a deactivated reviewer or one that belongs to another client", async () => {
    const tx = installDb();
    reviewerRow = { clientId: "client-1", active: false };
    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(NotFoundError);
    reviewerRow = { clientId: "client-2", active: true };
    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(NotFoundError);
    expect(tx.postComment.create).not.toHaveBeenCalled();
  });

  it("refuses a conversation that is not this reviewer's on this version", async () => {
    const tx = installDb();
    session = null;

    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(NotFoundError);
    expect(tx.reviewSession.findFirst).toHaveBeenCalledWith({
      where: { id: "session-1", postId: "post-1", reviewerId: "reviewer-1", versionNumber: 3 },
      select: { id: true },
    });
    expect(tx.postComment.create).not.toHaveBeenCalled();
  });

  it("adds a conversation only once, also when it was sent with the change request", async () => {
    const tx = installDb();
    sentEvents = [{ metadata: { reviewSessionId: "session-1", commentId: "c" } }];

    await expect(addAssistantFeedback("post-1", reviewer, 3, "Altro", OPTS)).rejects.toBeInstanceOf(ConflictError);
    expect(tx.postComment.create).not.toHaveBeenCalled();
    expect(tx.postEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    const tx = installDb();

    await expect(addAssistantFeedback("post-1", reviewer, 3, "   ", OPTS)).rejects.toThrow();
    expect(tx.postComment.create).not.toHaveBeenCalled();
  });
});
