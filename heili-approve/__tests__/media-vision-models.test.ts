import { describe, expect, it } from "vitest";
import { DEFAULT_VISION_MODELS, visionModels } from "@/lib/media-analysis/processor";

describe("vision model fallback", () => {
  it("tries the configured model first, then current Qwen vision models", () => {
    // qwen3-vl-flash was retired: a production .env may still name it.
    expect(visionModels("qwen3-vl-flash")).toEqual(["qwen3-vl-flash", ...DEFAULT_VISION_MODELS]);
  });

  it("uses the defaults when nothing is configured, without duplicates", () => {
    expect(visionModels(undefined)).toEqual(DEFAULT_VISION_MODELS);
    expect(visionModels("  ")).toEqual(DEFAULT_VISION_MODELS);
    expect(visionModels("qwen3-vl-plus")).toEqual(DEFAULT_VISION_MODELS);
  });
});
