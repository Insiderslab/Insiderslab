import { describe, expect, it } from "vitest";
import {
  COMMON_TIME_ZONES,
  buildTimeZoneOptions,
  clientInitials,
  formatDateTime,
  groupStatusCounts,
  isValidTimeZoneName,
  statusCountEntries,
  timeZoneOffsetLabel,
  totalPosts,
} from "@/components/clients/helpers";
import {
  normalizeMetricoolUserId,
  secretTail,
  translateMemberApiError,
} from "@/components/settings/helpers";

describe("time zones", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZoneName("Europe/Rome")).toBe(true);
    expect(isValidTimeZoneName("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZoneName("Europe/Roma")).toBe(false);
    expect(isValidTimeZoneName("")).toBe(false);
    expect(isValidTimeZoneName("   ")).toBe(false);
  });

  it("only lists valid, unique zones", () => {
    const values = COMMON_TIME_ZONES.map((z) => z.value);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(isValidTimeZoneName(value)).toBe(true);
  });

  it("labels the offset, following daylight saving time", () => {
    expect(timeZoneOffsetLabel("Europe/Rome", new Date("2026-07-01T12:00:00Z"))).toBe("UTC+2");
    expect(timeZoneOffsetLabel("Europe/Rome", new Date("2026-01-15T12:00:00Z"))).toBe("UTC+1");
    expect(timeZoneOffsetLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("UTC−5");
    expect(timeZoneOffsetLabel("UTC")).toBe("UTC");
    expect(timeZoneOffsetLabel("Not/AZone")).toBe("");
  });

  it("builds select options with city and offset", () => {
    const options = buildTimeZoneOptions(new Date("2026-07-01T12:00:00Z"));
    expect(options[0]).toEqual({ value: "Europe/Rome", label: "Roma (UTC+2)" });
    expect(options.find((o) => o.value === "UTC")?.label).toBe("UTC (UTC)");
  });
});

describe("post counts per status", () => {
  const rows = [
    { clientId: "a", status: "DRAFT" as const, count: 2 },
    { clientId: "a", status: "IN_REVIEW" as const, count: 3 },
    { clientId: "a", status: "CANCELLED" as const, count: 9 },
    { clientId: "a", status: "FAILED" as const, count: 1 },
    { clientId: "b", status: "SCHEDULED" as const, count: 4 },
    { clientId: "b", status: "APPROVED" as const, count: 0 },
  ];

  it("groups by client and drops cancelled / empty rows", () => {
    const grouped = groupStatusCounts(rows);
    expect(grouped.a).toEqual({ DRAFT: 2, IN_REVIEW: 3, FAILED: 1 });
    expect(grouped.b).toEqual({ SCHEDULED: 4 });
    expect(totalPosts(grouped.a)).toBe(6);
    expect(totalPosts(undefined)).toBe(0);
  });

  it("lists what needs attention first, with Italian labels", () => {
    const entries = statusCountEntries(groupStatusCounts(rows).a);
    expect(entries.map((e) => e.status)).toEqual(["FAILED", "IN_REVIEW", "DRAFT"]);
    expect(entries[1]).toEqual({ status: "IN_REVIEW", count: 3, label: "In revisione" });
    expect(statusCountEntries(undefined)).toEqual([]);
  });
});

describe("display helpers", () => {
  it("formats dates in the requested zone", () => {
    const at = new Date("2026-10-05T12:20:00Z");
    expect(formatDateTime(at)).toContain("14:20");
    expect(formatDateTime(at, "UTC")).toContain("12:20");
    expect(formatDateTime("not a date")).toBe("");
  });

  it("derives initials for the logo placeholder", () => {
    expect(clientInitials("Pasticceria Rossi")).toBe("PR");
    expect(clientInitials("heili")).toBe("H");
    expect(clientInitials("Bar  dello   Sport")).toBe("BS");
    expect(clientInitials("  ")).toBe("?");
  });
});

describe("settings helpers", () => {
  it("shows only the last 4 characters of a long secret", () => {
    expect(secretTail("abcdefghijklmnop1234")).toBe("1234");
    expect(secretTail("  abcdefghijkl9876  ")).toBe("9876");
    // Too short: the tail would give away half of it.
    expect(secretTail("abcd1234")).toBe("");
  });

  it("extracts the Metricool userId from a pasted URL", () => {
    expect(normalizeMetricoolUserId(" 1234567 ")).toBe("1234567");
    expect(
      normalizeMetricoolUserId("https://app.metricool.com/evolution/web?blogId=99&userId=1234567")
    ).toBe("1234567");
    expect(normalizeMetricoolUserId("userId=42")).toBe("42");
    expect(normalizeMetricoolUserId("abc")).toBe("abc");
  });

  it("translates the members API errors", () => {
    expect(translateMemberApiError("Member cannot be removed", "x")).toBe(
      "Questa persona non si può rimuovere."
    );
    expect(translateMemberApiError("Something else", "Errore")).toBe("Errore");
    expect(translateMemberApiError(undefined, "Errore")).toBe("Errore");
  });
});
