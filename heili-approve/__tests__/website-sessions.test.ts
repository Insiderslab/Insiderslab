import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../lib/crypto";

// ─── In-memory stand-in for the few Prisma calls of lib/website/sessions ─────

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const db = {
  sites: [] as Row[],
  sessions: [] as Row[],
  posts: [] as Row[],
  reviewers: [] as Row[],
  members: [] as Row[],
};

function matchWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !(cond instanceof Date) && "gt" in cond) return row[key] > (cond as { gt: Date }).gt;
    if (cond === null) return row[key] === null || row[key] === undefined;
    return row[key] === cond;
  });
}

const prismaMock = {
  websiteSite: {
    findUnique: async ({ where }: { where: Row }) => db.sites.find((s) => matchWhere(s, where)) ?? null,
    findFirst: async ({ where }: { where: Row }) =>
      db.sites.find((s) => s.revokedAt === null && (where.origins?.has ? s.origins.includes(where.origins.has) : true)) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(db.sites.find((s) => s.id === where.id)!, data),
  },
  websiteSession: {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `ws${db.sessions.length + 1}`, launchUsedAt: null, sessionHash: null, lastUsedAt: null, expiresAt: null, absoluteExpiresAt: null, ...data };
      db.sessions.push(row);
      return row;
    },
    // Atomic on purpose: the check and the write happen in one synchronous step, like UPDATE … WHERE.
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = db.sessions.filter((s) => matchWhere(s, where));
      rows.forEach((s) => Object.assign(s, data));
      return { count: rows.length };
    },
    findUnique: async ({ where }: { where: Row }) => {
      const row = db.sessions.find((s) => matchWhere(s, where));
      return row ? { ...row, site: db.sites.find((s) => s.id === row.siteId) } : null;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(db.sessions.find((s) => s.id === where.id)!, data),
  },
  post: { findUnique: async ({ where }: { where: Row }) => db.posts.find((p) => p.id === where.id) ?? null },
  clientReviewer: {
    findUnique: async ({ where }: { where: Row }) => {
      const r = db.reviewers.find((x) => x.id === where.id);
      return r ? { ...r, client: { archivedAt: r.clientArchived ? new Date() : null } } : null;
    },
  },
  workspaceMember: {
    findUnique: async ({ where }: { where: Row }) =>
      db.members.find((m) => m.workspaceId === where.workspaceId_userId.workspaceId && m.userId === where.workspaceId_userId.userId) ?? null,
  },
};

vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }));

const { SESSION_ABSOLUTE_MS, SESSION_SLIDING_MS, LAUNCH_TTL_MS, createLaunch, exchangeLaunch, resolveSiteSession, slidingExpiry, newSiteKey, isSiteKey } =
  await import("../lib/website/sessions");
const { preflight } = await import("../lib/website/http");

const ORIGIN = "https://prova.esempio.it";
const KEY = "hs_abcdefghijklmnopqrstuv";

function reset() {
  db.sites = [{ id: "site1", siteKey: KEY, workspaceId: "w1", origins: [ORIGIN], revokedAt: null }];
  db.sessions = [];
  db.posts = [{ id: "p1", status: "IN_REVIEW", currentVersionNumber: 2, clientId: "c1", workspaceId: "w1", kind: "WEBSITE" }];
  db.reviewers = [{ id: "r1", clientId: "c1", name: "Chiara", active: true }];
  db.members = [{ workspaceId: "w1", userId: "u1" }];
}

async function launch(role: "REVIEWER" | "AGENCY" = "REVIEWER", now = new Date()) {
  return createLaunch(
    { siteId: "site1", postId: "p1", versionNumber: 2, role, reviewerId: role === "REVIEWER" ? "r1" : null, userId: role === "AGENCY" ? "u1" : null },
    undefined,
    now
  );
}

describe("site keys and expiry", () => {
  it("makes public keys with the hs_ prefix", () => {
    const key = newSiteKey();
    expect(isSiteKey(key)).toBe(true);
    expect(isSiteKey("hs_short")).toBe(false);
    expect(isSiteKey("xx_abcdefghijklmnopqrstuv")).toBe(false);
  });
  it("slides 2 h but never past the absolute 8 h", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    expect(slidingExpiry(now, new Date(now.getTime() + SESSION_ABSOLUTE_MS)).getTime()).toBe(now.getTime() + SESSION_SLIDING_MS);
    expect(slidingExpiry(now, new Date(now.getTime() + 60_000)).getTime()).toBe(now.getTime() + 60_000);
  });
});

describe("launch codes and exchange", () => {
  beforeEach(reset);

  it("stores only hashes and exchanges a code once, even in parallel", async () => {
    const { code } = await launch();
    expect(db.sessions[0].launchHash).toBe(hashToken(code));
    expect(JSON.stringify(db.sessions)).not.toContain(code);
    const results = await Promise.allSettled([
      exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN }),
      exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const ok = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof exchangeLaunch>>>;
    expect(db.sessions[0].sessionHash).toBe(hashToken(ok.value.session));
    expect(JSON.stringify(db.sessions)).not.toContain(ok.value.session);
    expect(ok.value.view).toMatchObject({ role: "REVIEWER", canComment: true, reviewer: { id: "r1" } });
    await expect(exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN })).rejects.toMatchObject({ code: "code" });
  });

  it("refuses an expired code, another site, an unregistered origin and a revoked site", async () => {
    const past = new Date(Date.now() - LAUNCH_TTL_MS - 1000);
    const { code: old } = await launch("REVIEWER", past);
    await expect(exchangeLaunch({ siteKey: KEY, code: old, hostOrigin: ORIGIN })).rejects.toMatchObject({ code: "code" });

    const { code } = await launch();
    await expect(exchangeLaunch({ siteKey: KEY, code, hostOrigin: "https://evil.com" })).rejects.toMatchObject({ code: "origin" });
    await expect(exchangeLaunch({ siteKey: KEY, code, hostOrigin: `${ORIGIN}.evil.com` })).rejects.toMatchObject({ code: "origin" });
    await expect(exchangeLaunch({ siteKey: KEY, code, hostOrigin: "null" })).rejects.toMatchObject({ code: "origin" });
    db.sites.push({ id: "site2", siteKey: "hs_zzzzzzzzzzzzzzzzzzzzzz", workspaceId: "w1", origins: [ORIGIN], revokedAt: null });
    await expect(exchangeLaunch({ siteKey: "hs_zzzzzzzzzzzzzzzzzzzzzz", code, hostOrigin: ORIGIN })).rejects.toMatchObject({ code: "code" });
    db.sites[0].revokedAt = new Date();
    await expect(exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN })).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a code when the post is no longer in review or has a new version", async () => {
    const { code } = await launch();
    db.posts[0].status = "APPROVED";
    await expect(exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN })).rejects.toMatchObject({ code: "closed" });
    const { code: second } = await launch();
    db.posts[0].status = "IN_REVIEW";
    db.posts[0].currentVersionNumber = 3;
    await expect(exchangeLaunch({ siteKey: KEY, code: second, hostOrigin: ORIGIN })).rejects.toMatchObject({ code: "stale" });
  });
});

describe("sessions", () => {
  beforeEach(reset);

  it("resolve with the Bearer value, become read-only after the decision and stale after a new version", async () => {
    const { code } = await launch();
    const { session } = await exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN });
    expect((await resolveSiteSession(session)).canComment).toBe(true);
    db.posts[0].status = "APPROVED";
    expect((await resolveSiteSession(session)).canComment).toBe(false);
    db.posts[0].currentVersionNumber = 3;
    await expect(resolveSiteSession(session)).rejects.toMatchObject({ code: "stale", status: 409 });
    await expect(resolveSiteSession("nope")).rejects.toMatchObject({ code: "expired" });
  });

  it("expire (sliding and absolute) and stop with an inactive reviewer or a revoked site", async () => {
    const { code } = await launch();
    const { session } = await exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN });
    const later = new Date(Date.now() + SESSION_SLIDING_MS + 1000);
    await expect(resolveSiteSession(session, later)).rejects.toMatchObject({ code: "expired" });
    db.sessions[0].expiresAt = new Date(Date.now() + 60_000);
    db.sessions[0].absoluteExpiresAt = new Date(Date.now() - 1);
    await expect(resolveSiteSession(session)).rejects.toMatchObject({ code: "expired" });
    db.sessions[0].absoluteExpiresAt = new Date(Date.now() + 60_000);
    db.reviewers[0].active = false;
    await expect(resolveSiteSession(session)).rejects.toMatchObject({ code: "expired" });
    db.reviewers[0].active = true;
    db.sites[0].revokedAt = new Date();
    await expect(resolveSiteSession(session)).rejects.toMatchObject({ code: "not_found" });
  });

  it("agency sessions never comment and need a workspace member", async () => {
    const { code } = await launch("AGENCY");
    const { session, view } = await exchangeLaunch({ siteKey: KEY, code, hostOrigin: ORIGIN });
    expect(view).toMatchObject({ role: "AGENCY", canComment: false, reviewer: null });
    db.members = [];
    await expect(resolveSiteSession(session)).rejects.toMatchObject({ code: "expired" });
  });
});

describe("CORS preflight", () => {
  beforeEach(reset);
  const request = (origin: string | null) =>
    ({ headers: new Headers(origin ? { origin } : {}) }) as unknown as import("next/server").NextRequest;

  it("answers 204 only to a registered origin and 403 to the rest", async () => {
    const ok = await preflight(request(ORIGIN));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    for (const origin of ["https://evil.com", "null", null, `${ORIGIN}/`]) {
      const refused = await preflight(request(origin));
      expect(refused.status).toBe(403);
      expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});
