import { afterEach, describe, expect, it } from "vitest";
import { ValidationError } from "../lib/errors";
import {
  InvalidAppVariantError,
  assertKindEnabled,
  defaultKind,
  enabledKinds,
  getAppVariant,
  isKindEnabled,
  isMetricoolEnabled,
  kindParam,
  navItems,
  newPostHref,
  parseAppVariant,
  parseKindParam,
  postsHref,
  productName,
  productShortName,
  resolveKindFilter,
} from "../lib/variant";

const originalVariant = process.env.APP_VARIANT;

afterEach(() => {
  if (originalVariant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = originalVariant;
});

describe("APP_VARIANT parsing", () => {
  it("defaults to social when absent or empty", () => {
    expect(parseAppVariant(undefined)).toBe("social");
    expect(parseAppVariant(null)).toBe("social");
    expect(parseAppVariant("")).toBe("social");
    expect(parseAppVariant("   ")).toBe("social");
  });

  it("accepts the four variants, case- and space-insensitive", () => {
    expect(parseAppVariant("social")).toBe("social");
    expect(parseAppVariant("blog")).toBe("blog");
    expect(parseAppVariant(" ADS ")).toBe("ads");
    expect(parseAppVariant("All")).toBe("all");
  });

  it("throws a clear error on anything else", () => {
    expect(() => parseAppVariant("blogs")).toThrow(InvalidAppVariantError);
    expect(() => parseAppVariant("metricool")).toThrow(/APP_VARIANT="metricool" non è valido.*social, blog, ads, all/);
  });

  it("reads the environment at call time", () => {
    process.env.APP_VARIANT = "blog";
    expect(getAppVariant()).toBe("blog");
    process.env.APP_VARIANT = "ads";
    expect(getAppVariant()).toBe("ads");
    delete process.env.APP_VARIANT;
    expect(getAppVariant()).toBe("social");
    process.env.APP_VARIANT = "nope";
    expect(() => getAppVariant()).toThrow(InvalidAppVariantError);
  });
});

describe("kinds per variant", () => {
  it("enables the right kinds", () => {
    expect(enabledKinds("social")).toEqual(["SOCIAL_POST"]);
    expect(enabledKinds("blog")).toEqual(["BLOG_ARTICLE"]);
    expect(enabledKinds("ads")).toEqual(["AD_CREATIVE"]);
    expect(enabledKinds("all")).toEqual(["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"]);
    expect(defaultKind("ads")).toBe("AD_CREATIVE");
  });

  it("returns a copy (callers cannot change the configuration)", () => {
    enabledKinds("all").pop();
    expect(enabledKinds("all")).toHaveLength(3);
  });

  it("shows Metricool only with social posts", () => {
    expect(isMetricoolEnabled("social")).toBe(true);
    expect(isMetricoolEnabled("all")).toBe(true);
    expect(isMetricoolEnabled("blog")).toBe(false);
    expect(isMetricoolEnabled("ads")).toBe(false);
  });

  it("refuses kinds that are not enabled", () => {
    expect(isKindEnabled("BLOG_ARTICLE", "social")).toBe(false);
    expect(() => assertKindEnabled("BLOG_ARTICLE", "all")).not.toThrow();
    expect(() => assertKindEnabled("SOCIAL_POST", "blog")).toThrow(ValidationError);
    expect(() => assertKindEnabled("AD_CREATIVE", "blog")).toThrow(
      "Le creatività ads non sono disponibili in Approve by Heili — Blog"
    );
  });

  it("uses the environment when no variant is given", () => {
    process.env.APP_VARIANT = "blog";
    expect(enabledKinds()).toEqual(["BLOG_ARTICLE"]);
    expect(() => assertKindEnabled("SOCIAL_POST")).toThrow(ValidationError);
  });
});

describe("product name", () => {
  it("names each variant", () => {
    expect(productName("social")).toBe("Approve by Heili");
    expect(productName("blog")).toBe("Approve by Heili — Blog");
    expect(productName("ads")).toBe("Approve by Heili — Ads");
    expect(productName("all")).toBe("Approve by Heili");
    expect(productShortName("blog")).toBe("Approve Blog");
  });
});

describe("navigation", () => {
  it("keeps the social menu as before", () => {
    expect(navItems("social").map(({ label, href }) => [label, href])).toEqual([
      ["Dashboard", "/dashboard"],
      ["Post", "/posts"],
      ["Calendario", "/calendar"],
      ["Clienti", "/clients"],
      ["Impostazioni", "/settings"],
    ]);
  });

  it("names the single kind of a blog or ads instance, without ?kind=", () => {
    expect(navItems("blog")[1]).toEqual({ label: "Articoli", href: "/posts", kind: "BLOG_ARTICLE" });
    expect(navItems("ads")[1]).toEqual({ label: "Creatività", href: "/posts", kind: "AD_CREATIVE" });
    expect(newPostHref("AD_CREATIVE", "ads")).toBe("/posts/new");
  });

  it("has one entry per kind with ?kind= when there are several", () => {
    expect(navItems("all").filter((item) => item.kind).map(({ label, href }) => [label, href])).toEqual([
      ["Post", "/posts?kind=social"],
      ["Articoli", "/posts?kind=blog"],
      ["Creatività", "/posts?kind=ads"],
    ]);
    expect(postsHref("BLOG_ARTICLE", "all")).toBe("/posts?kind=blog");
    expect(newPostHref("BLOG_ARTICLE", "all")).toBe("/posts/new?kind=blog");
  });
});

describe("?kind= parameter", () => {
  it("round-trips slugs and accepts enum names", () => {
    for (const kind of ["SOCIAL_POST", "BLOG_ARTICLE", "AD_CREATIVE"] as const) {
      expect(parseKindParam(kindParam(kind))).toBe(kind);
      expect(parseKindParam(kind)).toBe(kind);
    }
    expect(parseKindParam(["blog", "ads"])).toBe("BLOG_ARTICLE");
    expect(parseKindParam(" Ads ")).toBe("AD_CREATIVE");
    expect(parseKindParam("video")).toBeNull();
    expect(parseKindParam(undefined)).toBeNull();
    expect(parseKindParam("")).toBeNull();
  });

  it("resolves the list filter against the enabled kinds", () => {
    expect(resolveKindFilter("blog", "all")).toBe("BLOG_ARTICLE");
    expect(resolveKindFilter(undefined, "all")).toBeNull();
    expect(resolveKindFilter("nope", "all")).toBeNull();
    // A single-kind instance always shows its kind, whatever the URL says.
    expect(resolveKindFilter("social", "blog")).toBe("BLOG_ARTICLE");
    expect(resolveKindFilter(undefined, "ads")).toBe("AD_CREATIVE");
  });
});
