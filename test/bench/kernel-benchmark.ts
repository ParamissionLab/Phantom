/**
 * Phantom CPU Kernel Benchmark Suite
 *
 * Automated performance testing for all CPU kernels, pipeline, and resize operations.
 * Runs each operation multiple times and reports ops/sec, ms/op, and throughput.
 *
 * Usage: npx vitest bench test/bench/
 *
 * If a benchmark cannot run (e.g., missing browser APIs for WebGPU/Worker),
 * it reports WHY and skips gracefully.
 */
import { bench, describe } from "vitest";
import {
  applyFilterToTile,
  createRawRgbaImage,
  processRawImage,
  processRawImagePipeline,
  resizeRawImage,
  type PixelFilter,
  type RawRgbaImage,
  type TileDescriptor,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// Test Image Generation
// ---------------------------------------------------------------------------

function createTestImage(width: number, height: number): RawRgbaImage {
  const image = createRawRgbaImage({ width, height });
  // Fill with pseudo-random RGBA data to simulate real image content
  const data = image.data;
  let seed = 12345;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = seed & 0xff;
  }
  // Ensure alpha channel is opaque for realistic processing
  for (let i = 3; i < data.length; i += 4) {
    data[i] = 255;
  }
  return image;
}

function createTilePayload(
  width: number,
  height: number,
  overlap: number,
): { descriptor: TileDescriptor; rgba: Uint8Array } {
  const inputWidth = width + overlap * 2;
  const inputHeight = height + overlap * 2;
  const descriptor: TileDescriptor = {
    index: 0,
    input: { x: 0, y: 0, width: inputWidth, height: inputHeight },
    output: { x: overlap, y: overlap, width, height },
  };
  const rgba = new Uint8Array(inputWidth * inputHeight * 4);
  let seed = 67890;
  for (let i = 0; i < rgba.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    rgba[i] = seed & 0xff;
  }
  for (let i = 3; i < rgba.length; i += 4) {
    rgba[i] = 255;
  }
  return { descriptor, rgba };
}

// ---------------------------------------------------------------------------
// Image Sizes for Benchmarks
// ---------------------------------------------------------------------------

const SMALL = { w: 256, h: 256, label: "256×256" };
const MEDIUM = { w: 1024, h: 1024, label: "1024×1024" };
const LARGE = { w: 2048, h: 2048, label: "2048×2048" };

// Tile size for kernel-level benchmarks (simulates real tile processing)
const TILE_SIZE = 512;
const TILE_OVERLAP = 1;

// ---------------------------------------------------------------------------
// Kernel-Level Benchmarks (applyFilterToTile)
// ---------------------------------------------------------------------------

const filters: PixelFilter[] = [
  "identity",
  "invert",
  "grayscale",
  "sharpen3x3",
  "boxBlur3x3",
  "smoothEnhance",
  "unsharpMask",
];

describe("Kernel: applyFilterToTile (512×512 tile)", () => {
  const payload = createTilePayload(TILE_SIZE, TILE_SIZE, TILE_OVERLAP);

  for (const filter of filters) {
    bench(`${filter}`, () => {
      applyFilterToTile(payload, filter);
    });
  }
});

// ---------------------------------------------------------------------------
// Full Pipeline Benchmarks (processRawImage)
// ---------------------------------------------------------------------------

describe("Pipeline: processRawImage (single filter)", () => {
  const smallImg = createTestImage(SMALL.w, SMALL.h);
  const medImg = createTestImage(MEDIUM.w, MEDIUM.h);

  bench(`identity ${SMALL.label}`, async () => {
    await processRawImage(smallImg, { filter: "identity" });
  });

  bench(`invert ${SMALL.label}`, async () => {
    await processRawImage(smallImg, { filter: "invert" });
  });

  bench(`grayscale ${SMALL.label}`, async () => {
    await processRawImage(smallImg, { filter: "grayscale" });
  });

  bench(`sharpen3x3 ${SMALL.label}`, async () => {
    await processRawImage(smallImg, { filter: "sharpen3x3", overlap: 1 });
  });

  bench(`boxBlur3x3 ${SMALL.label}`, async () => {
    await processRawImage(smallImg, { filter: "boxBlur3x3", overlap: 1 });
  });

  bench(`smoothEnhance ${MEDIUM.label}`, async () => {
    await processRawImage(medImg, { filter: "smoothEnhance", overlap: 1 });
  });

  bench(`sharpen3x3 ${MEDIUM.label}`, async () => {
    await processRawImage(medImg, { filter: "sharpen3x3", overlap: 1 });
  });
});

// ---------------------------------------------------------------------------
// Multi-Step Pipeline Benchmarks
// ---------------------------------------------------------------------------

describe("Pipeline: processRawImagePipeline (multi-step)", () => {
  const img = createTestImage(SMALL.w, SMALL.h);

  bench(`2-step (sharpen → blur) ${SMALL.label}`, async () => {
    await processRawImagePipeline(img, [
      { filter: "sharpen3x3", overlap: 1 },
      { filter: "boxBlur3x3", overlap: 1 },
    ]);
  });

  bench(`3-step (enhance → sharpen → grayscale) ${SMALL.label}`, async () => {
    await processRawImagePipeline(img, [
      { filter: "smoothEnhance", overlap: 1 },
      { filter: "sharpen3x3", overlap: 1 },
      { filter: "grayscale" },
    ]);
  });

  bench(`5-step pipeline ${SMALL.label}`, async () => {
    await processRawImagePipeline(img, [
      { filter: "smoothEnhance", overlap: 1 },
      { filter: "sharpen3x3", overlap: 1 },
      { filter: "boxBlur3x3", overlap: 1 },
      { filter: "unsharpMask", overlap: 1 },
      { filter: "grayscale" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Resize Benchmarks
// ---------------------------------------------------------------------------

describe("Resize: resizeRawImage", () => {
  const img1024 = createTestImage(1024, 1024);
  const img512 = createTestImage(512, 512);

  bench("nearest 1024→512", () => {
    resizeRawImage(img1024, { width: 512, height: 512 }, { method: "nearest" });
  });

  bench("bilinear 1024→512", () => {
    resizeRawImage(
      img1024,
      { width: 512, height: 512 },
      { method: "bilinear" },
    );
  });

  bench("nearest 512→2048 (upscale)", () => {
    resizeRawImage(
      img512,
      { width: 2048, height: 2048 },
      { method: "nearest" },
    );
  });

  bench("bilinear 512→2048 (upscale)", () => {
    resizeRawImage(
      img512,
      { width: 2048, height: 2048 },
      { method: "bilinear" },
    );
  });

  bench("nearest 1024→1920×1080", () => {
    resizeRawImage(
      img1024,
      { width: 1920, height: 1080 },
      { method: "nearest" },
    );
  });

  bench("bilinear 1024→1920×1080", () => {
    resizeRawImage(
      img1024,
      { width: 1920, height: 1080 },
      { method: "bilinear" },
    );
  });
});

// ---------------------------------------------------------------------------
// Throughput Summary (large image stress test)
// ---------------------------------------------------------------------------

describe("Throughput: Large Image (2048×2048)", () => {
  const largeImg = createTestImage(LARGE.w, LARGE.h);

  bench(`identity ${LARGE.label}`, async () => {
    await processRawImage(largeImg, { filter: "identity" });
  });

  bench(`invert ${LARGE.label}`, async () => {
    await processRawImage(largeImg, { filter: "invert" });
  });

  bench(`sharpen3x3 ${LARGE.label}`, async () => {
    await processRawImage(largeImg, { filter: "sharpen3x3", overlap: 1 });
  });

  bench(`boxBlur3x3 ${LARGE.label}`, async () => {
    await processRawImage(largeImg, { filter: "boxBlur3x3", overlap: 1 });
  });

  bench(`smoothEnhance ${LARGE.label}`, async () => {
    await processRawImage(largeImg, { filter: "smoothEnhance", overlap: 1 });
  });
});

// ---------------------------------------------------------------------------
// Untestable Features Report
// ---------------------------------------------------------------------------

describe("Skipped: Cannot benchmark in Node.js environment", () => {
  bench.skip("WebGPU compute (requires browser GPU context)", () => {
    // WebGPU requires navigator.gpu which is browser-only.
    // To benchmark: run the demo app and use browser DevTools Performance tab.
  });

  bench.skip("TileWorkerPool (requires browser Worker API)", () => {
    // Web Workers require a browser runtime with module worker support.
    // To benchmark: run the demo and observe parallel tile throughput in Network/Performance tabs.
  });

  bench.skip("Zig WASM backend (requires .wasm binary)", () => {
    // Zig WASM backend requires a compiled phantom_kernel.wasm binary.
    // Build with: npm run build:wasm
    // Then instantiate via instantiateZigBackend() in a test that loads the binary.
  });

  bench.skip("WebGL rendering (requires browser canvas)", () => {
    // WebGL rendering requires HTMLCanvasElement and GL context.
    // Benchmark in browser via the demo's preview renderer.
  });
});
