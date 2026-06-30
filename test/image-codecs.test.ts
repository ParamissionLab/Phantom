import { describe, expect, it } from "vitest";
import {
  canEncodeImageFormat,
  createPhantomAssetPlan,
  getImageFormatProfile,
  listImageFormats,
  normalizeImageFormat,
  type RawRgbaImage,
} from "../src/index.js";

describe("image format helpers", () => {
  it("normalizes common image extensions and MIME types", () => {
    expect(normalizeImageFormat(".jpg")).toBe("jpeg");
    expect(normalizeImageFormat("image/webp")).toBe("webp");
    expect(normalizeImageFormat("tif")).toBe("tiff");
  });

  it("describes popular decode and encode formats", () => {
    expect(listImageFormats().map((format) => format.format)).toEqual([
      "png",
      "jpeg",
      "webp",
      "avif",
      "bmp",
      "gif",
      "tiff",
    ]);
    expect(canEncodeImageFormat("webp")).toBe(true);
    expect(canEncodeImageFormat("gif")).toBe(false);
    expect(getImageFormatProfile("jpeg")).toMatchObject({
      mimeType: "image/jpeg",
      supportsAlpha: false,
    });
  });
});

describe("Phantom asset plan", () => {
  it("chooses delivery defaults for opaque images", () => {
    const plan = createPhantomAssetPlan(sampleImage(255));

    expect(plan.encode).toMatchObject({ format: "jpeg", quality: 0.92 });
    expect(plan.filters).toEqual(["smoothEnhance"]);
    expect(plan.overlap).toBe(1);
    expect(plan.tileSize).toBeGreaterThan(0);
  });

  it("keeps transparent cutouts in an alpha-capable format", () => {
    const plan = createPhantomAssetPlan(sampleImage(128), {
      goal: "transparent-cutout",
    });

    expect(plan.hasAlpha).toBe(true);
    expect(plan.encode.format).toBe("webp");
    expect(plan.filters).toEqual(["unsharpMask"]);
  });
});

function sampleImage(alpha: number): RawRgbaImage {
  return {
    width: 2,
    height: 1,
    data: Uint8Array.from([10, 20, 30, alpha, 40, 50, 60, 255]),
  };
}
