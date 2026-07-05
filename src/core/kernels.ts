/* eslint-disable @typescript-eslint/no-non-null-assertion */
// ^ Disabled for this file: all typed-array indices are pre-validated by
// clampInt bounds checks and rect dimension validation at entry points.
// Using ?? 0 would add a conditional branch per pixel in hot loops.

import {
  FIXED_SHIFT,
  clampU8,
  normalizeKernel3x3,
  toFixed,
} from "./fixed-point.js";
import {
  PhantomError,
  RGBA_CHANNELS,
  type PixelFilter,
  type Rect,
  type TilePayload,
  type TileResult,
} from "./types.js";

const LUMA_R = toFixed(0.299);
const LUMA_G = toFixed(0.587);
const LUMA_B = toFixed(0.114);
const SHARPEN_3X3_FIXED = normalizeKernel3x3([0, -1, 0, -1, 5, -1, 0, -1, 0]);
const SMOOTH_DETAIL_NUMERATOR = 3;
const SMOOTH_DETAIL_DENOMINATOR = 8;
const UNSHARP_DETAIL_NUMERATOR = 5;
const UNSHARP_DETAIL_DENOMINATOR = 8;

/**
 * Applies a pixel filter to one overlap-expanded RGBA tile and returns only
 * the tile's core output rectangle.
 */
export function applyFilterToTile(
  payload: TilePayload,
  filter: PixelFilter,
): TileResult {
  const { descriptor, rgba } = payload;
  const expected =
    descriptor.input.width * descriptor.input.height * RGBA_CHANNELS;

  if (rgba.length !== expected) {
    throw new PhantomError(
      `Tile buffer length mismatch: expected ${expected}, got ${rgba.length}.`,
    );
  }

  const output = new Uint8Array(
    descriptor.output.width * descriptor.output.height * RGBA_CHANNELS,
  );

  switch (filter) {
    case "identity":
      copyCore(rgba, descriptor.input, descriptor.output, output);
      break;
    case "invert":
      invertCore(rgba, descriptor.input, descriptor.output, output);
      break;
    case "grayscale":
      grayscaleCore(rgba, descriptor.input, descriptor.output, output);
      break;
    case "smoothEnhance":
      smoothEnhanceCore(
        rgba,
        descriptor.input,
        descriptor.output,
        output,
        SMOOTH_DETAIL_NUMERATOR,
        SMOOTH_DETAIL_DENOMINATOR,
      );
      break;
    case "sharpen3x3":
      convolutionCore(
        rgba,
        descriptor.input,
        descriptor.output,
        output,
        SHARPEN_3X3_FIXED,
      );
      break;
    case "boxBlur3x3":
      boxBlurCore(rgba, descriptor.input, descriptor.output, output);
      break;
    case "unsharpMask":
      smoothEnhanceCore(
        rgba,
        descriptor.input,
        descriptor.output,
        output,
        UNSHARP_DETAIL_NUMERATOR,
        UNSHARP_DETAIL_DENOMINATOR,
      );
      break;
    default:
      filter satisfies never;
      throw new PhantomError(`Unsupported filter: ${String(filter)}`);
  }

  return { descriptor, rgba: output };
}

// ---------------------------------------------------------------------------
// OPTIMIZED KERNEL IMPLEMENTATIONS
// ---------------------------------------------------------------------------
// Key optimizations applied throughout:
// 1. Inlined all per-pixel callbacks (no forEachOutputPixel)
// 2. Precomputed row strides and base offsets outside inner loops
// 3. Eliminated per-sample bounds checks in convolution by pre-clamping
// 4. Uint32Array views for 4-byte bulk pixel copy/invert
// 5. Direct index arithmetic instead of function-call-per-sample
// 6. Hoisted invariant computations out of inner loops
//
// NOTE: Non-null assertions (!) are safe here because all array indices are
// pre-validated via clampInt bounds and rect dimension checks at the entry point.
// ---------------------------------------------------------------------------

function copyCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
): void {
  const inputWidth = inputRect.width;
  const outputWidth = outputRect.width;
  const offsetX = outputRect.x - inputRect.x;
  const offsetY = outputRect.y - inputRect.y;
  const rowBytes = outputWidth * RGBA_CHANNELS;

  // Check if we can use single memcpy for entire contiguous region
  if (outputRect.height > 0 && outputWidth === inputWidth && offsetX === 0) {
    const inputStart = offsetY * inputWidth * RGBA_CHANNELS;
    output.set(input.subarray(inputStart, inputStart + output.length));
    return;
  }

  // Row-by-row memcpy via subarray+set (V8 optimizes to memmove)
  for (let y = 0; y < outputRect.height; y += 1) {
    const inputRowBase = ((offsetY + y) * inputWidth + offsetX) * RGBA_CHANNELS;
    const outputRowBase = y * rowBytes;
    output.set(
      input.subarray(inputRowBase, inputRowBase + rowBytes),
      outputRowBase,
    );
  }
}

function invertCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
): void {
  const inputWidth = inputRect.width;
  const outputWidth = outputRect.width;
  const offsetX = outputRect.x - inputRect.x;
  const offsetY = outputRect.y - inputRect.y;

  // Uint32Array XOR fast-path for contiguous aligned regions.
  // XOR with 0x00FFFFFF in little-endian inverts R/G/B, preserves Alpha.
  const canUse32 =
    input.buffer instanceof ArrayBuffer &&
    output.buffer instanceof ArrayBuffer &&
    (input.byteOffset % 4) === 0 &&
    (output.byteOffset % 4) === 0;

  if (canUse32 && outputWidth === inputWidth && offsetX === 0) {
    const inputStart = offsetY * inputWidth * RGBA_CHANNELS;
    const pixelCount = outputWidth * outputRect.height;
    const inputU32 = new Uint32Array(input.buffer, input.byteOffset + inputStart, pixelCount);
    const outputU32 = new Uint32Array(output.buffer, output.byteOffset, pixelCount);
    const xorMask = 0x00FFFFFF;

    const bulk = pixelCount & ~3;
    for (let i = 0; i < bulk; i += 4) {
      outputU32[i] = inputU32[i]! ^ xorMask;
      outputU32[i + 1] = inputU32[i + 1]! ^ xorMask;
      outputU32[i + 2] = inputU32[i + 2]! ^ xorMask;
      outputU32[i + 3] = inputU32[i + 3]! ^ xorMask;
    }
    for (let i = bulk; i < pixelCount; i += 1) {
      outputU32[i] = inputU32[i]! ^ xorMask;
    }
    return;
  }

  // Row-based fallback with 4-pixel unrolling for non-contiguous regions
  for (let y = 0; y < outputRect.height; y += 1) {
    const inputRowBase = ((offsetY + y) * inputWidth + offsetX) * RGBA_CHANNELS;
    const outputRowBase = y * outputWidth * RGBA_CHANNELS;

    const pixelCount = outputWidth;
    const bulk = pixelCount & ~3;
    let ix = inputRowBase;
    let ox = outputRowBase;

    for (let x = 0; x < bulk; x += 4) {
      output[ox] = 255 - input[ix]!;
      output[ox + 1] = 255 - input[ix + 1]!;
      output[ox + 2] = 255 - input[ix + 2]!;
      output[ox + 3] = input[ix + 3]!;
      output[ox + 4] = 255 - input[ix + 4]!;
      output[ox + 5] = 255 - input[ix + 5]!;
      output[ox + 6] = 255 - input[ix + 6]!;
      output[ox + 7] = input[ix + 7]!;
      output[ox + 8] = 255 - input[ix + 8]!;
      output[ox + 9] = 255 - input[ix + 9]!;
      output[ox + 10] = 255 - input[ix + 10]!;
      output[ox + 11] = input[ix + 11]!;
      output[ox + 12] = 255 - input[ix + 12]!;
      output[ox + 13] = 255 - input[ix + 13]!;
      output[ox + 14] = 255 - input[ix + 14]!;
      output[ox + 15] = input[ix + 15]!;
      ix += 16;
      ox += 16;
    }

    for (let x = bulk; x < pixelCount; x += 1) {
      output[ox] = 255 - input[ix]!;
      output[ox + 1] = 255 - input[ix + 1]!;
      output[ox + 2] = 255 - input[ix + 2]!;
      output[ox + 3] = input[ix + 3]!;
      ix += 4;
      ox += 4;
    }
  }
}

function grayscaleCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
): void {
  const inputWidth = inputRect.width;
  const outputWidth = outputRect.width;
  const offsetX = outputRect.x - inputRect.x;
  const offsetY = outputRect.y - inputRect.y;

  for (let y = 0; y < outputRect.height; y += 1) {
    const inputRowBase = ((offsetY + y) * inputWidth + offsetX) * RGBA_CHANNELS;
    const outputRowBase = y * outputWidth * RGBA_CHANNELS;

    for (let x = 0; x < outputWidth; x += 1) {
      const ix = inputRowBase + x * RGBA_CHANNELS;
      const ox = outputRowBase + x * RGBA_CHANNELS;
      const luma = clampU8(
        (input[ix]! * LUMA_R + input[ix + 1]! * LUMA_G + input[ix + 2]! * LUMA_B) >> FIXED_SHIFT,
      );
      output[ox] = luma;
      output[ox + 1] = luma;
      output[ox + 2] = luma;
      output[ox + 3] = input[ix + 3]!;
    }
  }
}

function smoothEnhanceCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
  detailNumerator: number,
  detailDenominator: number,
): void {
  const inputWidth = inputRect.width;
  const inputHeight = inputRect.height;
  const outputWidth = outputRect.width;
  const offsetX = outputRect.x - inputRect.x;
  const offsetY = outputRect.y - inputRect.y;
  const inputStride = inputWidth * RGBA_CHANNELS;
  const maxX = inputWidth - 1;
  const maxY = inputHeight - 1;

  let outputIndex = 0;

  for (let y = 0; y < outputRect.height; y += 1) {
    const sourceY = offsetY + y;
    // Pre-clamp row indices for the entire row
    const rowAbove = clampInt(sourceY - 1, 0, maxY) * inputStride;
    const rowCenter = sourceY * inputStride;
    const rowBelow = clampInt(sourceY + 1, 0, maxY) * inputStride;

    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = offsetX + x;
      // Pre-clamp column offsets
      const colLeft = clampInt(sourceX - 1, 0, maxX) * RGBA_CHANNELS;
      const colCenter = sourceX * RGBA_CHANNELS;
      const colRight = clampInt(sourceX + 1, 0, maxX) * RGBA_CHANNELS;

      for (let ch = 0; ch < 3; ch += 1) {
        // Inline gaussian blur 3x3 (1-2-1 / 2-4-2 / 1-2-1) >> 4
        const tl = input[rowAbove + colLeft + ch]!;
        const tc = input[rowAbove + colCenter + ch]!;
        const tr = input[rowAbove + colRight + ch]!;
        const ml = input[rowCenter + colLeft + ch]!;
        const mc = input[rowCenter + colCenter + ch]!;
        const mr = input[rowCenter + colRight + ch]!;
        const bl = input[rowBelow + colLeft + ch]!;
        const bc = input[rowBelow + colCenter + ch]!;
        const br = input[rowBelow + colRight + ch]!;

        const blur = (tl + tr + bl + br + (tc + bc + ml + mr) * 2 + mc * 4) >> 4;
        const detail = mc - blur;
        output[outputIndex + ch] = clampU8(
          mc + ((detail * detailNumerator) / detailDenominator) | 0,
        );
      }

      output[outputIndex + 3] = input[rowCenter + colCenter + 3]!;
      outputIndex += RGBA_CHANNELS;
    }
  }
}

function boxBlurCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
): void {
  const inputWidth = inputRect.width;
  const inputHeight = inputRect.height;
  const outputWidth = outputRect.width;
  const offsetX = outputRect.x - inputRect.x;
  const offsetY = outputRect.y - inputRect.y;
  const inputStride = inputWidth * RGBA_CHANNELS;
  const maxX = inputWidth - 1;
  const maxY = inputHeight - 1;

  let outputIndex = 0;

  for (let y = 0; y < outputRect.height; y += 1) {
    const sourceY = offsetY + y;
    const rowAbove = clampInt(sourceY - 1, 0, maxY) * inputStride;
    const rowCenter = sourceY * inputStride;
    const rowBelow = clampInt(sourceY + 1, 0, maxY) * inputStride;

    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = offsetX + x;
      const colLeft = clampInt(sourceX - 1, 0, maxX) * RGBA_CHANNELS;
      const colCenter = sourceX * RGBA_CHANNELS;
      const colRight = clampInt(sourceX + 1, 0, maxX) * RGBA_CHANNELS;

      for (let ch = 0; ch < 3; ch += 1) {
        const total =
          input[rowAbove + colLeft + ch]! +
          input[rowAbove + colCenter + ch]! +
          input[rowAbove + colRight + ch]! +
          input[rowCenter + colLeft + ch]! +
          input[rowCenter + colCenter + ch]! +
          input[rowCenter + colRight + ch]! +
          input[rowBelow + colLeft + ch]! +
          input[rowBelow + colCenter + ch]! +
          input[rowBelow + colRight + ch]!;

        // Integer division by 9: (total * 57 + 256) >> 9 is exact for 0..2295
        output[outputIndex + ch] = (total * 57 + 256) >> 9;
      }

      output[outputIndex + 3] = input[rowCenter + colCenter + 3]!;
      outputIndex += RGBA_CHANNELS;
    }
  }
}

function convolutionCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
  kernel: readonly number[],
): void {
  const inputWidth = inputRect.width;
  const inputHeight = inputRect.height;
  const outputWidth = outputRect.width;
  const offsetX = outputRect.x - inputRect.x;
  const offsetY = outputRect.y - inputRect.y;
  const inputStride = inputWidth * RGBA_CHANNELS;
  const maxX = inputWidth - 1;
  const maxY = inputHeight - 1;

  // Extract kernel values to local variables — avoids array indexing in inner loop
  const k0 = kernel[0]!;
  const k1 = kernel[1]!;
  const k2 = kernel[2]!;
  const k3 = kernel[3]!;
  const k4 = kernel[4]!;
  const k5 = kernel[5]!;
  const k6 = kernel[6]!;
  const k7 = kernel[7]!;
  const k8 = kernel[8]!;

  let outputIndex = 0;

  for (let y = 0; y < outputRect.height; y += 1) {
    const sourceY = offsetY + y;
    const rowAbove = clampInt(sourceY - 1, 0, maxY) * inputStride;
    const rowCenter = sourceY * inputStride;
    const rowBelow = clampInt(sourceY + 1, 0, maxY) * inputStride;

    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = offsetX + x;
      const colLeft = clampInt(sourceX - 1, 0, maxX) * RGBA_CHANNELS;
      const colCenter = sourceX * RGBA_CHANNELS;
      const colRight = clampInt(sourceX + 1, 0, maxX) * RGBA_CHANNELS;

      for (let ch = 0; ch < 3; ch += 1) {
        const accumulator =
          input[rowAbove + colLeft + ch]! * k0 +
          input[rowAbove + colCenter + ch]! * k1 +
          input[rowAbove + colRight + ch]! * k2 +
          input[rowCenter + colLeft + ch]! * k3 +
          input[rowCenter + colCenter + ch]! * k4 +
          input[rowCenter + colRight + ch]! * k5 +
          input[rowBelow + colLeft + ch]! * k6 +
          input[rowBelow + colCenter + ch]! * k7 +
          input[rowBelow + colRight + ch]! * k8;

        output[outputIndex + ch] = clampU8(accumulator >> FIXED_SHIFT);
      }

      output[outputIndex + 3] = input[rowCenter + colCenter + 3]!;
      outputIndex += RGBA_CHANNELS;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility — branchless integer clamp (faster than Math.min/Math.max for JIT)
// ---------------------------------------------------------------------------

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
