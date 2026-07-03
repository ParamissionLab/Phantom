import { describe, expect, it } from "vitest";
import {
  PhantomError,
  processRawImage,
  processRawImagePipeline,
  processRawImageWithStats,
  type RawRgbaImage,
} from "../src/index.js";

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

  it("reports progress and runtime stats", async () => {
    const progress: Array<{
      readonly completedTiles: number;
      readonly totalTiles: number;
      readonly percent: number;
    }> = [];

    const result = await processRawImageWithStats(makeImage(), {
      tileSize: 2,
      overlap: 1,
      filter: "identity",
      onProgress: (event) => {
        progress.push({
          completedTiles: event.completedTiles,
          totalTiles: event.totalTiles,
          percent: event.percent,
        });
      },
    });

    expect(result.image.data).toEqual(makeImage().data);
    expect(result.stats.totalTiles).toBe(2);
    expect(result.stats.processedTiles).toBe(2);
    expect(result.stats.outputBytes).toBe(makeImage().data.length);
    expect(result.stats.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(progress).toEqual([
      { completedTiles: 1, totalTiles: 2, percent: 50 },
      { completedTiles: 2, totalTiles: 2, percent: 100 },
    ]);
  });

  it("runs multiple filters as a reusable pipeline", async () => {
    const output = await processRawImagePipeline(
      {
        width: 1,
        height: 1,
        data: Uint8Array.from([10, 20, 30, 255]),
      },
      [{ filter: "grayscale", overlap: 0 }, { filter: "invert", overlap: 0 }],
      { tileSize: 1 },
    );

    expect(Array.from(output.data)).toEqual([237, 237, 237, 255]);
  });

  it("rejects filters when the requested overlap is too small", async () => {
    await expect(
      processRawImage(makeImage(), {
        tileSize: 2,
        overlap: 0,
        filter: "sharpen3x3",
      }),
    ).rejects.toThrow(/requires overlap/i);
  });

  it("rejects unsupported filters with a branded error", async () => {
    await expect(
      processRawImage(makeImage(), {
        filter: "missing" as never,
      }),
    ).rejects.toBeInstanceOf(PhantomError);
  });
});
