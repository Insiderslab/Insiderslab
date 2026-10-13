import { describe, expect, it } from "vitest";
import {
  dockTabs,
  draftMarker,
  filterDestinations,
  guideStatusSentence,
  introStorageKey,
  isPortalHref,
  nextStepDestination,
  registrationKey,
  registrationReducer,
  resolveDockTab,
  shortcutDestinations,
} from "@/components/portal/heili/rules";
import type { HeiliDestination, HeiliPageContext, HeiliReviewContext } from "@/components/portal/heili/types";

const token = "tok-123";

function destination(overrides: Partial<HeiliDestination>): HeiliDestination {
  return { id: "d1", label: "Apri", href: `/review/${token}`, kind: "view", ...overrides };
}

function context(overrides: Partial<HeiliPageContext> = {}): HeiliPageContext {
  return {
    page: "home",
    title: "Questa è la tua pagina di revisione",
    destinations: [],
    services: ["SOCIAL_POST"],
    ...overrides,
  };
}

const review: HeiliReviewContext = {
  postId: "p1",
  versionNumber: 1,
  mode: "decision",
  kind: "SOCIAL_POST",
  heading: "Post 3 di 12 · Instagram",
  sessionKey: 0,
  async onSubmitChanges() {},
};

describe("HeiliDestinations", () => {
  it("keeps only hrefs inside this token's portal", () => {
    const destinations = [
      destination({ id: "ok-home", href: `/review/${token}` }),
      destination({ id: "ok-post", href: `/review/${token}/posts/p1` }),
      destination({ id: "outside", href: "https://example.com" }),
      destination({ id: "other-token", href: "/review/altro/posts/p1" }),
      destination({ id: "agency", href: "/dashboard" }),
      destination({ id: "escape", href: `/review/${token}/../dashboard` }),
    ];
    expect(filterDestinations(token, destinations).map((d) => d.id)).toEqual(["ok-home", "ok-post"]);
    expect(isPortalHref(token, `/review/${token}/piani/1`)).toBe(true);
    expect(isPortalHref(token, "/review/")).toBe(false);
    expect(isPortalHref(token, "/posts/1")).toBe(false);
  });

  it("picks the first next destination, else the first post one", () => {
    const plan = destination({ id: "plan", href: `/review/${token}/piani/1`, kind: "plan" });
    const view = destination({ id: "view", href: `/review/${token}/mese/2026-10`, kind: "view" });
    const next = destination({ id: "next", href: `/review/${token}/posts/p2`, kind: "next" });
    expect(nextStepDestination([plan, view, next])?.id).toBe("next");
    expect(nextStepDestination([plan, view])).toBeNull();
    expect(shortcutDestinations([plan, view, next], next).map((d) => d.id)).toEqual(["plan", "view"]);
  });
});

describe("Heili dock tabs", () => {
  it("shows Feedback and Guida only for content pages with a review context", () => {
    expect(dockTabs(context())).toEqual(["guide"]);
    expect(dockTabs(context({ review }))).toEqual(["feedback", "guide"]);
    expect(resolveDockTab(["feedback", "guide"], null)).toBe("feedback");
    expect(resolveDockTab(["guide"], "feedback")).toBe("guide");
    expect(resolveDockTab(["feedback", "guide"], "guide")).toBe("guide");
  });
});

describe("registrazione della pagina", () => {
  it("the latest page wins and a late clear never wipes a newer registration", () => {
    const first = { id: 1, key: "home", read: () => context() };
    const second = { id: 2, key: "plan", read: () => context({ page: "plan" }) };
    let state = { current: null, lastId: 0 } as ReturnType<typeof registrationReducer>;
    state = registrationReducer(state, { type: "register", registration: first });
    state = registrationReducer(state, { type: "register", registration: second });
    // The previous page unmounts after the new one registered: ignored.
    state = registrationReducer(state, { type: "clear", id: 1 });
    expect(state.current?.id).toBe(2);
    // Leaving the current page clears the dock.
    state = registrationReducer(state, { type: "clear", id: 2 });
    expect(state.current).toBeNull();
  });

  it("changes the registration key when page, mode or content changes", () => {
    const base = context({ page: "post", review });
    expect(registrationKey(base)).toBe(registrationKey({ ...base, review: { ...review } }));
    expect(registrationKey(base)).not.toBe(registrationKey({ ...base, review: { ...review, mode: "feedback" } }));
    expect(registrationKey(base)).not.toBe(registrationKey({ ...base, review: { ...review, sessionKey: 1 } }));
    expect(registrationKey(base)).not.toBe(registrationKey({ ...base, page: "article" }));
  });
});

describe("frase di stato della Guida", () => {
  it("speaks per page, with the numbers of the context", () => {
    expect(guideStatusSentence(context())).toBe("Questa è la tua pagina di revisione.");
    expect(guideStatusSentence(context({ page: "home", summary: "3 contenuti da rivedere" }))).toBe(
      "Questa è la tua pagina di revisione: 3 contenuti da rivedere."
    );
    expect(guideStatusSentence(context({ page: "plan", title: "Piano social di novembre", summary: "12 post, 3 da rivedere" }))).toBe(
      "Sei nel piano social di novembre: 12 post, 3 da rivedere."
    );
    expect(guideStatusSentence(context({ page: "plan-grid", title: "Piano social di novembre" }))).toBe(
      "Sei nella griglia del piano social di novembre."
    );
    expect(guideStatusSentence(context({ page: "browse", title: "Piano social di novembre" }))).toBe(
      "Stai sfogliando piano social di novembre."
    );
    expect(guideStatusSentence(context({ page: "month", title: "i post di novembre" }))).toBe("Stai rivedendo i post di novembre.");
    expect(guideStatusSentence(context({ page: "post", title: "Post 3 di 12 · Instagram" }))).toBe(
      "Stai rivedendo post 3 di 12 · Instagram."
    );
  });
});

describe("«Indica un punto» e prima visita", () => {
  it("turns a tapped point or moment into the same marker the chat uses", () => {
    expect(draftMarker({ kind: "pin", mediaIndex: 0, x: 1.2, y: -0.1 })).toBe(
      "[punto media=0 x=1.0000 y=0.0000 variante=- tempo=-]"
    );
    expect(draftMarker({ kind: "moment", mediaIndex: 1, timeSec: 7 })).toBe("[al momento 0:07 del video]");
    expect(draftMarker({ kind: "moment", mediaIndex: 1, timeSec: 7, x: 0.5, y: 0.5 })).toContain(
      "x=0.5000 y=0.5000 variante=- tempo=7"
    );
  });

  it("remembers the first visit per token", () => {
    expect(introStorageKey("abc")).toBe("heili.intro.abc");
    expect(introStorageKey("abc")).not.toBe(introStorageKey("def"));
  });
});
