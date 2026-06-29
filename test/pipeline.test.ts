import { describe, expect, it } from "vitest";
import { processRawImage, type RawRgbaImage } from "../src/index.js";

function makeImage(): RawRgbaImage {
  return {
    width: 3,
    height: 2,
    data: Uint8Array.from([
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255, 13, 14, 15,
      255, 16, 17, 18, 255,
    ]),
  };
}

describe("processRawImage", () => {
  it("processes every tile and preserves image dimensions", async () => {
    const seen: number[] = [];
    const output = await processRawImage(makeImage(), {
      tileSize: 2,
      overlap: 1,
      filter: "invert",
      onTile: (tile) => {
        seen.push(tile.index);
      },
    });

    expect(output.width).toBe(3);
    expect(output.height).toBe(2);
    expect(seen).toEqual([0, 1]);
    expect(Array.from(output.data.subarray(0, 8))).toEqual([
      254, 253, 252, 255, 251, 250, 249, 255,
    ]);
  });

  it("rejects malformed RGBA input", async () => {
    await expect(
      processRawImage({
        width: 2,
        height: 2,
        data: Uint8Array.from([1, 2, 3]),
      }),
    ).rejects.toThrow(/length mismatch/i);
  });
});
