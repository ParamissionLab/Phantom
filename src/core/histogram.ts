/* eslint-disable @typescript-eslint/no-non-null-assertion */
// ^ All typed-array indices here are computed from validated dimensions and
// a fixed stride — bounds are guaranteed by assertRgbaLength at entry.
import { RGBA_CHANNELS, type RawRgbaImage, assertRgbaLength } from "./types.js";

/**
 * Per-channel histogram data. Each array has 256 entries where
 * index i contains the count of pixels with that channel value.
 */
export interface ImageHistogram {
  /** Red channel histogram (256 buckets) */
  readonly r: Uint32Array;
  /** Green channel histogram (256 buckets) */
  readonly g: Uint32Array;
  /** Blue channel histogram (256 buckets) */
  readonly b: Uint32Array;
  /** Luminance (perceived brightness) histogram (256 buckets) */
  readonly luma: Uint32Array;
  /** Total pixel count */
  readonly pixelCount: number;
  /** Average luminance 0-255 */
  readonly meanLuma: number;
  /** Percentile-based dynamic range: 2nd to 98th percentile */
  readonly dynamicRangeLow: number;
  readonly dynamicRangeHigh: number;
}

/**
 * Computes RGBA histogram data in a single pass.
 * Useful for auto-exposure, color grading decisions, and diagnostics.
 */
export function computeHistogram(image: RawRgbaImage): ImageHistogram {
  assertRgbaLength(image);

  // Single contiguous allocation improves L1 cache locality during the
  // accumulation loop — four disjoint Uint32Array(256) allocations would
  // walk four separate heap regions.
  const hist = new Uint32Array(1024);
  const r = hist.subarray(0, 256);
  const g = hist.subarray(256, 512);
  const b = hist.subarray(512, 768);
  const luma = hist.subarray(768, 1024);
  const pixelCount = image.width * image.height;

  // Single-pass: accumulate all channels simultaneously
  for (let i = 0; i < image.data.length; i += RGBA_CHANNELS) {
    const rv = image.data[i]!;
    const gv = image.data[i + 1]!;
    const bv = image.data[i + 2]!;

    r[rv]! += 1;
    g[gv]! += 1;
    b[bv]! += 1;

    // BT.601 luminance — integer approximation: (r*77 + g*150 + b*29) >> 8
    const lumaVal = (rv * 77 + gv * 150 + bv * 29) >> 8;
    luma[lumaVal]! += 1;
  }

  // Compute mean luma
  let lumaSum = 0;
  for (let i = 0; i < 256; i += 1) {
    lumaSum += i * (luma[i] ?? 0);
  }
  const meanLuma = pixelCount > 0 ? lumaSum / pixelCount : 0;

  // Dynamic range: 2nd–98th percentile of luma
  const low2 = Math.max(1, Math.round(pixelCount * 0.02));
  const high98 = Math.max(1, Math.round(pixelCount * 0.98));
  let accumulated = 0;
  let dynamicRangeLow = 0;
  let dynamicRangeHigh = 255;

  for (let i = 0; i < 256; i += 1) {
    accumulated += luma[i] ?? 0;
    if (accumulated < low2) {
      dynamicRangeLow = i;
    }
    if (accumulated < high98) {
      dynamicRangeHigh = i;
    }
  }

  return {
    r,
    g,
    b,
    luma,
    pixelCount,
    meanLuma,
    dynamicRangeLow,
    dynamicRangeHigh,
  };
}

/**
 * Suggests brightness/contrast adjustments based on histogram stretch.
 * Returns values compatible with `adjustRawImage`.
 */
export function suggestAutoAdjust(histogram: ImageHistogram): {
  brightness: number;
  contrast: number;
} {
  const { dynamicRangeLow, dynamicRangeHigh } = histogram;
  const range = dynamicRangeHigh - dynamicRangeLow;

  if (range <= 0) {
    return { brightness: 0, contrast: 0 };
  }

  // Center the midtone to 128
  const mid = (dynamicRangeLow + dynamicRangeHigh) / 2;
  const brightness = Math.round(((128 - mid) / 127) * 50);

  // Stretch contrast: if range < 200, suggest positive contrast
  const contrastBoost = Math.round(((200 - range) / 200) * 40);
  const contrast = Math.max(-50, Math.min(50, contrastBoost));

  return { brightness, contrast };
}
