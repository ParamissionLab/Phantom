import { describe, expect, it } from "vitest";
import {
  cloneRawImage,
  createRawRgbaImage,
  cropRawImage,
  resizeRawImage,
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

describe("raw RGBA image utilities", () => {
  it("creates a solid RGBA image", () => {
    const image = createRawRgbaImage(
      { width: 2, height: 1 },
      { r: 12, g: 24, b: 36, a: 48 },
    );

    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(Array.from(image.data)).toEqual([12, 24, 36, 48, 12, 24, 36, 48]);
  });

  it("clones image data defensively", () => {
    const input = sampleImage();
    const clone = cloneRawImage(input);

    clone.data[0] = 255;

    expect(input.data[0]).toBe(10);
    expect(clone.width).toBe(input.width);
    expect(clone.height).toBe(input.height);
  });

  it("crops a rectangular region", () => {
    const cropped = cropRawImage(sampleImage(), {
      x: 1,
      y: 0,
      width: 1,
      height: 2,
    });

    expect(cropped.width).toBe(1);
    expect(cropped.height).toBe(2);
    expect(Array.from(cropped.data)).toEqual([
      40, 50, 60, 255, 100, 110, 120, 255,
    ]);
  });

  it("resizes with nearest-neighbor sampling", () => {
    const resized = resizeRawImage(
      sampleImage(),
      { width: 4, height: 4 },
      {
        method: "nearest",
      },
    );

    expect(resized.width).toBe(4);
    expect(resized.height).toBe(4);
    expect(Array.from(resized.data.subarray(0, 16))).toEqual([
      10, 20, 30, 255, 10, 20, 30, 255, 40, 50, 60, 255, 40, 50, 60, 255,
    ]);
  });

  it("resizes with bilinear sampling by default", () => {
    const resized = resizeRawImage(sampleImage(), { width: 1, height: 1 });

    expect(Array.from(resized.data)).toEqual([55, 65, 75, 255]);
  });

  it("rejects invalid crop rectangles", () => {
    expect(() =>
      cropRawImage(sampleImage(), { x: 1, y: 1, width: 2, height: 1 }),
    ).toThrow(/outside image bounds/i);
  });

  it("rejects invalid fill colors", () => {
    expect(() =>
      createRawRgbaImage({ width: 1, height: 1 }, { r: 256, g: 0, b: 0 }),
    ).toThrow(/color\.r/i);
  });
});
