import { describe, expect, it } from "vitest";
import { dateTimeFormat, isValidTimeZone } from "@/lib/intl-format";
import { formatDateTime, formatTime } from "@/components/posts/helpers";
import { formatPortalDate } from "@/components/portal/helpers";

describe("shared date formatters", () => {
  it("reuses one formatter per locale and options, with the constructor's output", () => {
    const options = { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" } as const;
    expect(dateTimeFormat("it-IT", options)).toBe(dateTimeFormat("it-IT", { ...options }));
    const date = new Date("2026-11-05T08:30:00Z");
    expect(dateTimeFormat("it-IT", options).format(date)).toBe(new Intl.DateTimeFormat("it-IT", options).format(date));
  });

  it("checks time zones once and keeps the fallbacks of the helpers", () => {
    expect(isValidTimeZone("Europe/Rome")).toBe(true);
    expect(isValidTimeZone("Marte/Olympus")).toBe(false);
    const date = new Date("2026-11-05T08:30:00Z");
    expect(formatTime(date, "Marte/Olympus")).toBe(formatTime(date, "Europe/Rome"));
    expect(formatTime(date, "Europe/Rome")).toBe("09:30");
    expect(formatDateTime(date, "America/New_York", { year: false })).toMatch(/03:30/);
    expect(formatPortalDate(date, "Europe/Rome", { now: new Date("2026-10-16T10:00:00Z") })).toBe("giovedì 5 novembre alle 09:30");
  });
});
