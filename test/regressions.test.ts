import { describe, expect, it } from "vitest";

import { chooseTileSize, getProcessingPlan } from "../src/core/performance.js";
import { resolveKernelUrl } from "../src/core/wasm-registry.js";
import { isWasmReady } from "../src/core/phantom.js";
import { registerProcessor } from "../src/core/wasm-registry.js";
import { cpuTileProcessor } from "../src/core/pipeline.js";

describe("getProcessingPlan", () => {
  it("computes peak tile bytes for plans with hundreds of thousands of tiles", () => {
    // 262144 tiles — Math.max(...tiles) overflowed the argument limit here.
    const plan = getProcessingPlan(
      { width: 262144, height: 512 },
      { tileSize: 512, overlap: 1 },
    );

    expect(plan.tileCount).toBe(512);
    expect(plan.peakTileBytes).toBeGreaterThan(0);
  });
});

describe("chooseTileSize", () => {
  it("never returns a tile smaller than minTileSize", () => {
    // 512 needs ~2.1 MB and does not fit; halving lands on 256, which is below
    // the caller's 300 floor. The clamp must return 300, not 256.
    const tileSize = chooseTileSize({
      maxBytes: 1_000_000,
      overlap: 1,
      minTileSize: 300,
      maxTileSize: 4096,
    });

    expect(tileSize).toBe(300);
  });

  it("rejects a floor above the ceiling", () => {
    expect(() =>
      chooseTileSize({
        maxBytes: 1024 * 1024,
        overlap: 1,
        minTileSize: 2048,
        maxTileSize: 512,
      }),
    ).toThrow();
  });
});

describe("resolveKernelUrl", () => {
  it("points one directory above the core module, matching dist layout", () => {
    const url = resolveKernelUrl();
    expect(url).not.toBeNull();
    expect(url?.href.endsWith("/phantom_kernel.wasm")).toBe(true);
    expect(url?.href.includes("/core/phantom_kernel.wasm")).toBe(false);
  });
});

describe("isWasmReady", () => {
  it("stays false for a processor installed via registerProcessor", () => {
    try {
      registerProcessor(cpuTileProcessor);
      expect(isWasmReady()).toBe(false);
    } finally {
      registerProcessor(null);
    }
  });
});
