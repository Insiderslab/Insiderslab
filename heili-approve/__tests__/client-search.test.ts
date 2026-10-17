import { describe, expect, it } from "vitest";
import { filterClients, matchesClientQuery, normalizeForSearch, recentClients } from "@/lib/client-search";

const clients = [
  { id: "a", name: "Caffè Aurora" },
  { id: "b", name: "Studio Verde Architetti" },
  { id: "c", name: "Cliente Prova 01" },
  { id: "d", name: "Cliente Prova 12" },
];

describe("client search (QA-15)", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(normalizeForSearch("  Caffè   AURORA ")).toBe("caffe aurora");
    expect(matchesClientQuery("Caffè Aurora", "caffe")).toBe(true);
    expect(matchesClientQuery("Caffè Aurora", "AUR")).toBe(true);
  });

  it("needs every word, in any order", () => {
    expect(filterClients(clients, "prova 12").map((c) => c.id)).toEqual(["d"]);
    expect(filterClients(clients, "architetti studio").map((c) => c.id)).toEqual(["b"]);
    expect(filterClients(clients, "")).toHaveLength(4);
    expect(filterClients(clients, "zzz")).toEqual([]);
  });

  it("keeps recent clients that are still offered, newest first, three at most", () => {
    expect(recentClients(clients, ["d", "gone", "a", "b", "c"]).map((c) => c.id)).toEqual(["d", "a", "b"]);
    expect(recentClients(clients, [])).toEqual([]);
  });
});
