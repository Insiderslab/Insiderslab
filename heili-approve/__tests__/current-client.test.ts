import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();
const findFirst = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined) }),
}));
vi.mock("@/lib/db/client", () => ({ prisma: { client: { findFirst: (...args: unknown[]) => findFirst(...args) } } }));

const {
  CURRENT_CLIENT_COOKIE,
  decodeCurrentClient,
  encodeCurrentClient,
  getCurrentClientId,
  resolveClientScope,
} = await import("@/lib/current-client");
const { hrefAfterSwitch } = await import("@/lib/client-switch");

describe("current client cookie", () => {
  beforeEach(() => {
    cookieStore.clear();
    findFirst.mockReset();
  });

  it("round-trips workspace and client", () => {
    expect(decodeCurrentClient(encodeCurrentClient("ws1", "cl1"), "ws1")).toBe("cl1");
  });

  it("ignores another workspace's choice and malformed values", () => {
    expect(decodeCurrentClient(encodeCurrentClient("ws1", "cl1"), "ws2")).toBeNull();
    expect(decodeCurrentClient(undefined, "ws1")).toBeNull();
    expect(decodeCurrentClient("cl1", "ws1")).toBeNull();
    expect(decodeCurrentClient("ws1:../../etc", "ws1")).toBeNull();
    expect(decodeCurrentClient("ws1:", "ws1")).toBeNull();
  });

  it("returns the client only when it still belongs to the workspace and is not archived", async () => {
    cookieStore.set(CURRENT_CLIENT_COOKIE, "ws1:cl1");
    findFirst.mockResolvedValueOnce({ id: "cl1" });
    await expect(getCurrentClientId("ws1")).resolves.toBe("cl1");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "cl1", workspaceId: "ws1", archivedAt: null },
      select: { id: true },
    });

    findFirst.mockResolvedValueOnce(null);
    await expect(getCurrentClientId("ws1")).resolves.toBeNull();
  });

  it("does not query without a cookie", async () => {
    await expect(getCurrentClientId("ws1")).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("resolveClientScope", () => {
  const ids = ["a", "b"];
  it("prefers a valid client in the URL", () => {
    expect(resolveClientScope("b", ids, "a")).toBe("b");
  });
  it("falls back to the menu's client", () => {
    expect(resolveClientScope("", ids, "a")).toBe("a");
    expect(resolveClientScope("zzz", ids, "a")).toBe("a");
  });
  it("is empty (all clients) when neither is valid", () => {
    expect(resolveClientScope("", ids, null)).toBe("");
    expect(resolveClientScope("", ids, "gone")).toBe("");
  });
});

describe("hrefAfterSwitch", () => {
  const params = (q = "") => new URLSearchParams(q);
  it("moves from a client page to the new client's page", () => {
    expect(hrefAfterSwitch("/clients/a", params(), "b")).toBe("/clients/b");
    expect(hrefAfterSwitch("/clients/a", params(), null)).toBe("/clients");
    expect(hrefAfterSwitch("/clients/new", params(), "b")).toBeNull();
  });
  it("leaves a content page for the list", () => {
    expect(hrefAfterSwitch("/posts/p1", params(), "b")).toBe("/posts");
    expect(hrefAfterSwitch("/posts/p1", params("kind=blog"), "b")).toBe("/posts?kind=blog");
    expect(hrefAfterSwitch("/posts/new", params(), "b")).toBeNull();
  });
  it("drops an explicit clientId filter so the menu choice applies", () => {
    expect(hrefAfterSwitch("/posts", params("clientId=a&status=IN_REVIEW&pagina=2"), "b")).toBe("/posts?status=IN_REVIEW");
    expect(hrefAfterSwitch("/calendar", params("clientId=a"), null)).toBe("/calendar");
  });
  it("just refreshes elsewhere", () => {
    expect(hrefAfterSwitch("/dashboard", params(), "b")).toBeNull();
  });
});
