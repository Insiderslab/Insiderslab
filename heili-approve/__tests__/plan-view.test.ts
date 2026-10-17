import { describe, expect, it } from "vitest";
import { PLAN_LIST_PAGE, parsePlanListLimit, parsePlanView, planViewHref, showMoreLabel } from "@/lib/plan-view";

describe("plan view (QA-09)", () => {
  it("defaults to the list and accepts only known views", () => {
    expect(parsePlanView(undefined)).toBe("elenco");
    expect(parsePlanView("calendario")).toBe("calendario");
    expect(parsePlanView(["instagram", "elenco"])).toBe("instagram");
    expect(parsePlanView("griglia")).toBe("elenco");
    expect(parsePlanView("<script>")).toBe("elenco");
  });

  it("shows one page of rows at first and grows by pages", () => {
    expect(parsePlanListLimit(undefined)).toBe(PLAN_LIST_PAGE);
    expect(parsePlanListLimit("abc")).toBe(PLAN_LIST_PAGE);
    expect(parsePlanListLimit("-5")).toBe(PLAN_LIST_PAGE);
    expect(parsePlanListLimit("100")).toBe(100);
    expect(parsePlanListLimit("101")).toBe(150);
    expect(parsePlanListLimit("999999")).toBe(5000);
  });

  it("builds links that keep the URL short", () => {
    expect(planViewHref("p1", "elenco")).toBe("/plans/p1");
    expect(planViewHref("p1", "instagram")).toBe("/plans/p1?vista=instagram");
    expect(planViewHref("p1", "elenco", { show: 100 })).toBe("/plans/p1?mostra=100");
    expect(planViewHref("p1", "elenco", { show: 50 })).toBe("/plans/p1");
  });

  it("labels the next page", () => {
    expect(showMoreLabel(40, 50)).toBeNull();
    expect(showMoreLabel(300, 50)).toBe("Mostra altri 50 (ne restano 250)");
    expect(showMoreLabel(80, 50)).toBe("Mostra gli altri 30");
  });
});
