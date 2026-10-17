import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_MB, uploadProblem } from "@/components/posts/upload";

describe("uploadProblem: what is said before uploading", () => {
  it("lets supported pictures and videos go", () => {
    expect(uploadProblem({ name: "foto.jpg", size: 1000, type: "image/jpeg" })).toBeNull();
    expect(uploadProblem({ name: "reel.mov", size: 1000, type: "video/quicktime" })).toBeNull();
    // No type: the server sniffs the content.
    expect(uploadProblem({ name: "senza-tipo", size: 1000, type: "" })).toBeNull();
  });

  it("says the limit for a file too big", () => {
    expect(uploadProblem({ name: "lungo.mp4", size: MAX_UPLOAD_MB * 1024 * 1024 + 1, type: "video/mp4" })).toBe(
      `File troppo grande: max ${MAX_UPLOAD_MB} MB.`
    );
  });

  it("names an unsupported format and the ones that work", () => {
    expect(uploadProblem({ name: "IMG_0001.HEIC", size: 1000, type: "image/heic" })).toBe(
      "Formato non supportato (HEIC): usa JPG, PNG, WebP, GIF, MP4, MOV o WebM."
    );
    expect(uploadProblem({ name: "vuoto.png", size: 0, type: "image/png" })).toBe("Il file è vuoto.");
  });
});
