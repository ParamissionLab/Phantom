import { describe, expect, it } from "vitest";
import phantomDefault, {
  applyFilter,
  applyFilters,
  applyMask,
  cropImage,
  makeImage,
  phantom,
  replaceBackground,
  resizeImage,
  type RawRgbaImage,
} from "../src/index.js";

function sampleImage(): RawRgbaImage {
  return {
    width: 2,
    height: 2,
    data: Uint8Array.from([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
    ]),
  };
}

describe("default phantom API", () => {
  it("creates, crops, and resizes images with short helper names", () => {
    const base = makeImage(2, 2, { r: 20, g: 30, b: 40 });
    const cropped = cropImage(base, { x: 1, y: 0, width: 1, height: 2 });
    const resized = resizeImage(cropped, 2, 2, { method: "nearest" });

    expect(base.data[3]).toBe(255);
    expect(cropped.width).toBe(1);
    expect(cropped.height).toBe(2);
    expect(resized.width).toBe(2);
    expect(resized.height).toBe(2);
  });

  it("exposes a single default facade", async () => {
    const image = phantom.makeImage(1, 1, { r: 10, g: 20, b: 30 });
    const output = await phantom.applyFilter(image, "invert");

    expect(Array.from(output.data)).toEqual([245, 235, 225, 255]);
  });

  it("supports default import for the main API", async () => {
    const image = phantomDefault.makeImage(1, 1, { r: 10, g: 20, b: 30 });
    const output = await phantomDefault.applyFilter(image, "invert");

    expect(Array.from(output.data)).toEqual([245, 235, 225, 255]);
  });

  it("applies a filter without requiring overlap knowledge", async () => {
    const output = await applyFilter(sampleImage(), "sharpen3x3");

    expect(output.width).toBe(2);
    expect(output.height).toBe(2);
    expect(output.data).toHaveLength(sampleImage().data.length);
  });

  it("applies multiple filters with safe defaults", async () => {
    const output = await applyFilters(
      {
        width: 1,
        height: 1,
        data: Uint8Array.from([10, 20, 30, 255]),
      },
      ["grayscale", "invert"],
      { tileSize: 1 },
    );

    expect(Array.from(output.data)).toEqual([237, 237, 237, 255]);
  });

  it("uses simple aliases for masks and backgrounds", () => {
    const masked = applyMask(sampleImage(), {
      width: 1,
      height: 1,
      data: Uint8Array.of(128),
    });
    const flattened = replaceBackground(masked, { r: 0, g: 0, b: 0 });

    expect(masked.data[3]).toBeGreaterThan(0);
    expect(flattened.data[3]).toBe(255);
  });
});
