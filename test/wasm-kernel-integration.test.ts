/* eslint-disable @typescript-eslint/no-non-null-assertion */
// ^ Pixel indices are derived from validated width*height*4 dimensions, so
// every typed-array access is in-bounds; `!` keeps the assertions readable.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { instantiateWasmBackend } from "../src/wasm/zig-backend.js";
import type { WasmKernelBackend } from "../src/wasm/types.js";
import type { PixelFilter, RawRgbaImage } from "../src/core/types.js";

// Exercises the REAL compiled Zig kernel (dist/phantom_kernel.wasm), not a
// fake backend. This is the only coverage that proves the WASM memory layout,
// pointer-0 heap writes, and memory.grow() invalidation are sound end-to-end.
//
// The artifact is produced by `npm run build:wasm`, which the `ci` script runs
// before `npm test`. When the binary is absent (e.g. a bare `vitest` run with
// no prior build) the suite skips instead of failing — it never silently
// passes, because CI guarantees the artifact exists.

const wasmPath = fileURLToPath(
  new URL("../dist/phantom_kernel.wasm", import.meta.url),
);
const wasmAvailable = existsSync(wasmPath);

let backend: WasmKernelBackend;

function makeImage(width: number, height: number, seed = 1): RawRgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 1) {
    // Deterministic pseudo-noise so every channel is exercised.
    data[i] = (i * 31 + seed * 17) & 0xff;
  }
  return { width, height, data };
}

beforeAll(async () => {
  const bytes = readFileSync(wasmPath);
  backend = await instantiateWasmBackend(bytes);
});

describe.skipIf(!wasmAvailable)("real Zig WASM kernel", () => {
  it("invert is exact (R,G,B flipped, alpha preserved)", () => {
    const image = makeImage(64, 64);
    const out = backend.process(image, "invert");

    for (let p = 0; p < image.width * image.height; p += 1) {
      const i = p * 4;
      expect(out.data[i]).toBe(255 - image.data[i]!);
      expect(out.data[i + 1]).toBe(255 - image.data[i + 1]!);
      expect(out.data[i + 2]).toBe(255 - image.data[i + 2]!);
      expect(out.data[i + 3]).toBe(image.data[i + 3]!);
    }
  });

  it("grayscale collapses RGB and preserves alpha", () => {
    const image = makeImage(48, 32, 3);
    const out = backend.process(image, "grayscale");

    for (let p = 0; p < image.width * image.height; p += 1) {
      const i = p * 4;
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i + 1]).toBe(out.data[i + 2]);
      expect(out.data[i + 3]).toBe(image.data[i + 3]!);
    }
  });

  it("does not corrupt output when a large image forces memory.grow()", () => {
    // 512x512x4 = 1 MiB input + 1 MiB output = 2 MiB, above the module's 1 MiB
    // initial memory. Forces ensureCapacity() to grow and invalidate heapCache.
    // If the shadow stack overlapped the heap region, invert bytes would be
    // wrong here — this asserts they are exact.
    const image = makeImage(512, 512, 7);
    const out = backend.process(image, "invert");

    expect(out.data.length).toBe(image.data.length);
    for (let p = 0; p < image.width * image.height; p += 64) {
      const i = p * 4;
      expect(out.data[i]).toBe(255 - image.data[i]!);
      expect(out.data[i + 3]).toBe(image.data[i + 3]!);
    }
  });

  it("keeps results correct across repeated calls after a grow", () => {
    // Grow first, then run a small image: reuses the enlarged buffer and the
    // refreshed heap cache. Two sequential inverts must round-trip to identity.
    backend.process(makeImage(512, 512, 2), "invert");

    const image = makeImage(16, 16, 9);
    const once = backend.process(image, "invert");
    const twice = backend.process(once, "invert");

    expect(Array.from(twice.data)).toEqual(Array.from(image.data));
  });

  it("alpha mask matches the documented rounding formula", () => {
    const image = makeImage(8, 8, 5);
    const mask = new Uint8Array(8 * 8);
    for (let p = 0; p < mask.length; p += 1) mask[p] = (p * 13) & 0xff;

    const out = backend.applyAlphaMask(image, mask);

    for (let p = 0; p < mask.length; p += 1) {
      const i = p * 4;
      const alpha = image.data[i + 3]!;
      const matte = mask[p]!;
      const expected = Math.floor((alpha * matte + 127) / 255);
      expect(out.data[i + 3]).toBe(expected);
      // Color channels pass through untouched.
      expect(out.data[i]).toBe(image.data[i]!);
    }
  });

  const spatialFilters: PixelFilter[] = [
    "sharpen3x3",
    "boxBlur3x3",
    "unsharpMask",
    "smoothEnhance",
  ];

  it.each(spatialFilters)(
    "%s runs without trapping and preserves dimensions",
    (filter) => {
      const image = makeImage(40, 24, 11);
      const out = backend.process(
        image,
        filter as Exclude<PixelFilter, "identity">,
      );
      expect(out.width).toBe(image.width);
      expect(out.height).toBe(image.height);
      expect(out.data.length).toBe(image.data.length);
    },
  );
});
