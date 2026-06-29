import { describe, expect, it } from "vitest";
import { applyFilterToTile, type TileDescriptor } from "../src/index.js";

const descriptor: TileDescriptor = {
  index: 0,
  input: { x: 0, y: 0, width: 2, height: 2 },
  output: { x: 0, y: 0, width: 2, height: 2 },
};

const rgba = Uint8Array.from([
  10, 20, 30, 255, 50, 60, 70, 255, 90, 100, 110, 255, 130, 140, 150, 255,
]);

describe("applyFilterToTile", () => {
  it("copies identity output", () => {
    const result = applyFilterToTile({ descriptor, rgba }, "identity");
    expect(Array.from(result.rgba)).toEqual(Array.from(rgba));
  });

  it("inverts rgb and preserves alpha", () => {
    const result = applyFilterToTile({ descriptor, rgba }, "invert");
    expect(Array.from(result.rgba.subarray(0, 4))).toEqual([
      245, 235, 225, 255,
    ]);
  });

  it("converts to fixed-point grayscale", () => {
    const result = applyFilterToTile({ descriptor, rgba }, "grayscale");
    expect(Array.from(result.rgba.subarray(0, 4))).toEqual([18, 18, 18, 255]);
  });

  it("uses overlap data for sharpen output", () => {
    const overlapDescriptor: TileDescriptor = {
      index: 1,
      input: { x: 0, y: 0, width: 3, height: 3 },
      output: { x: 1, y: 1, width: 1, height: 1 },
    };
    const tile = Uint8Array.from([
      10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 100,
      100, 100, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10,
      10, 255,
    ]);

    const result = applyFilterToTile(
      { descriptor: overlapDescriptor, rgba: tile },
      "sharpen3x3",
    );
    expect(Array.from(result.rgba)).toEqual([255, 255, 255, 255]);
  });

  it("smoothly enhances detail without hard clipping highlights", () => {
    const overlapDescriptor: TileDescriptor = {
      index: 2,
      input: { x: 0, y: 0, width: 3, height: 3 },
      output: { x: 1, y: 1, width: 1, height: 1 },
    };
    const tile = Uint8Array.from([
      10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 100,
      100, 100, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10,
      10, 255,
    ]);

    const result = applyFilterToTile(
      { descriptor: overlapDescriptor, rgba: tile },
      "smoothEnhance",
    );
    expect(Array.from(result.rgba)).toEqual([125, 125, 125, 255]);
  });
});
