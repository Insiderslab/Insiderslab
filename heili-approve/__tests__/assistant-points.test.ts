import { describe, expect, it } from "vitest";
import type { MediaItem } from "@/lib/domain";
import { planActionItemCommentFor } from "@/lib/posts";
import { toRequestChangesItems } from "@/lib/review-assistant/content";
import { sanitizeActionItemsFor } from "@/lib/review-assistant/rules";
import {
  parseActionItems,
  pointMarker,
  splitMessageMarkers,
  type ActionItem,
} from "@/lib/review-assistant/shared";

const image: MediaItem = { type: "image", url: "/media/a.jpg", mimeType: "image/jpeg" };
const video: MediaItem = { type: "video", url: "/media/b.mp4", mimeType: "video/mp4", durationSec: 20 };

const item = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  area: "media",
  mediaIndex: 0,
  timeSec: null,
  timeEndSec: null,
  pinX: null,
  pinY: null,
  request: "Sposta il logo",
  priority: "media",
  variantId: null,
  anchorQuote: null,
  ...overrides,
});

describe("assistant selected points", () => {
  it("keeps media, coordinates, variant and time in one formal marker", () => {
    const marker = pointMarker({ mediaIndex: 1, x: 0.28123, y: 0.61999, variantId: "B/reel", timeSec: 7.04 });
    expect(splitMessageMarkers(`Qui ${marker} il logo è piccolo`)).toEqual([
      { type: "text", value: "Qui " },
      {
        type: "point",
        mediaIndex: 1,
        x: 0.2812,
        y: 0.62,
        variantId: "B/reel",
        timeSec: 7,
        label: "Punto sul media 2 · 28%, 62% · Variante B/reel · 0:07",
      },
      { type: "text", value: " il logo è piccolo" },
    ]);
  });

  it("reads old saved action items with empty point coordinates", () => {
    expect(
      parseActionItems([
        {
          area: "testo",
          mediaIndex: null,
          timeSec: null,
          timeEndSec: null,
          request: "Accorcia",
          priority: "bassa",
          variantId: null,
          anchorQuote: null,
        },
      ])[0]
    ).toMatchObject({ pinX: null, pinY: null });
  });

  it("sanitizes a point against the exact social media", () => {
    const [clean] = sanitizeActionItemsFor([item({ mediaIndex: 0, pinX: 0.28123, pinY: 0.61999 })], {
      kind: "SOCIAL_POST",
      media: [image],
    });
    expect(clean).toMatchObject({ mediaIndex: 0, pinX: 0.2812, pinY: 0.62, variantId: null });

    const [incomplete] = sanitizeActionItemsFor([item({ mediaIndex: 0, pinX: 0.2, pinY: null })], {
      kind: "SOCIAL_POST",
      media: [image],
    });
    expect(incomplete).toMatchObject({ pinX: null, pinY: null });
  });

  it("keeps an ads point attached to its named variant through persistence planning", () => {
    const target = {
      kind: "AD_CREATIVE" as const,
      variants: [
        { id: "A", name: "Variante A", media: [image] },
        { id: "B", name: "Variante B", media: [video] },
      ],
    };
    const [clean] = sanitizeActionItemsFor(
      [item({ variantId: "B", mediaIndex: 0, timeSec: 7, pinX: 0.3, pinY: 0.6 })],
      target
    );
    const [requestItem] = toRequestChangesItems("AD_CREATIVE", { content: null }, [clean]);

    expect(requestItem).toMatchObject({ variantId: "B", mediaIndex: 0, timeSec: 7, pinX: 0.3, pinY: 0.6 });
    expect(
      planActionItemCommentFor(requestItem, {
        kind: "AD_CREATIVE",
        variants: [
          { id: "A", media: [image] },
          { id: "B", media: [video] },
        ],
      })
    ).toMatchObject({ variantId: "B", mediaIndex: 0, timeSec: 7, pinX: 0.3, pinY: 0.6 });
  });

  it("drops all point fields for blog actions", () => {
    const [clean] = sanitizeActionItemsFor([item({ pinX: 0.3, pinY: 0.6 })], {
      kind: "BLOG_ARTICLE",
      articleText: "Un testo completo",
    });
    expect(clean).toMatchObject({ mediaIndex: null, timeSec: null, pinX: null, pinY: null, variantId: null });
  });
});
