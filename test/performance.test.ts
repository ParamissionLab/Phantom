import { describe, expect, it } from "vitest";
import {
  chooseTileSize,
  getProcessingPlan,
  estimateRgbaBytes,
  estimateTileScratchBytes,
} from "../src/index.js";

describe("performance planning", () => {
  it("estimates full-frame RGBA memory without allocating", () => {
    expect(estimateRgbaBytes({ width: 32768, height: 18432 })).toBe(
      2_415_919_104,
    );
  });

  it("chooses a tile size inside the memory budget", () => {
    const tileSize = chooseTileSize({
      maxBytes: 64 * 1024 * 1024,
      overlap: 1,
      maxTileSize: 4096,
      minTileSize: 256,
    });

    expect(tileSize).toBe(2048);
    expect(estimateTileScratchBytes(tileSize, 1)).toBeLessThanOrEqual(
      64 * 1024 * 1024,
    );
  });

  it("describes 64K processing with bounded scratch memory", () => {
    const stats = getProcessingPlan(
      { width: 65536, height: 32768 },
      { tileSize: 2048, overlap: 1, workerLanes: 4, filter: "sharpen3x3" },
    );

    expect(stats.tileCount).toBe(512);
    expect(stats.fullFrameBytes).toBe(8_589_934_592);
    expect(stats.estimatedScratchBytes).toBeLessThan(stats.fullFrameBytes);
    expect(stats.memoryReductionRatio).toBeGreaterThan(60);
  });
});
