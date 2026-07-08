/* eslint-disable @typescript-eslint/no-non-null-assertion */
// ^ Disabled for this file: all typed-array indices in resize loops are
// pre-validated via lookup tables with clamped bounds. Using ?? 0 would
// add a conditional branch per pixel in inner loops.

import {
  PhantomError,
  RGBA_CHANNELS,
  type ImageDimensions,
  type RawRgbaImage,
  type Rect,
  assertPositiveInteger,
  assertRgbaLength,
} from "./types.js";

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

export type ResizeMethod = "nearest" | "bilinear";

export interface ResizeRawImageOptions {
  readonly method?: ResizeMethod;
}

/**
 * Allocates a raw RGBA image, optionally filled with a solid color.
 */
export function createRawRgbaImage(
  dimensions: ImageDimensions,
  color?: RgbaColor,
): RawRgbaImage {
  assertDimensions(dimensions);
  const data = new Uint8Array(rgbaByteLength(dimensions));

  if (color !== undefined) {
    const rgba = normalizeRgbaColor(color);
    // Use Uint32Array for 4x faster fill with packed RGBA pixel
    const pixel = (rgba.a << 24) | (rgba.b << 16) | (rgba.g << 8) | rgba.r;
    const u32 = new Uint32Array(data.buffer);
    u32.fill(pixel);
  }

  return {
    width: dimensions.width,
    height: dimensions.height,
    data,
  };
}

/**
 * Returns a defensive copy of a raw RGBA image.
 */
export function cloneRawImage(image: RawRgbaImage): RawRgbaImage {
  assertRgbaLength(image);
  return {
    width: image.width,
    height: image.height,
    data: new Uint8Array(image.data),
  };
}

/**
 * Copies a rectangular region into a new raw RGBA image.
 */
export function cropRawImage(image: RawRgbaImage, rect: Rect): RawRgbaImage {
  assertRgbaLength(image);
  assertRectWithinImage(rect, image);

  const output = createRawRgbaImage({
    width: rect.width,
    height: rect.height,
  });

  const rowBytes = rect.width * RGBA_CHANNELS;
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
    const targetStart = row * rowBytes;
    output.data.set(
      image.data.subarray(sourceStart, sourceStart + rowBytes),
      targetStart,
    );
  }

  return output;
}

/**
 * Resizes a raw RGBA image with nearest-neighbor or bilinear sampling.
 */
export function resizeRawImage(
  image: RawRgbaImage,
  dimensions: ImageDimensions,
  options: ResizeRawImageOptions = {},
): RawRgbaImage {
  assertRgbaLength(image);
  assertDimensions(dimensions);
  const method = options.method ?? "bilinear";

  if (method !== "nearest" && method !== "bilinear") {
    throw new PhantomError(`Unsupported resize method: ${String(method)}.`);
  }

  if (image.width === dimensions.width && image.height === dimensions.height) {
    return cloneRawImage(image);
  }

  const output = createRawRgbaImage(dimensions);

  if (method === "nearest") {
    resizeNearest(image, output);
  } else {
    resizeBilinear(image, output);
  }

  return output;
}

// ---------------------------------------------------------------------------
// MAXIMUM PERFORMANCE RESIZE IMPLEMENTATIONS
// ---------------------------------------------------------------------------

function resizeNearest(input: RawRgbaImage, output: RawRgbaImage): void {
  const outW = output.width;
  const outH = output.height;
  const inW = input.width;
  const inH = input.height;
  const inputData = input.data;
  const outputData = output.data;

  // Precompute X lookup table
  const xLookup = new Uint32Array(outW);
  for (let x = 0; x < outW; x += 1) {
    xLookup[x] = Math.min(inW - 1, ((x * inW) / outW) | 0) * RGBA_CHANNELS;
  }

  // Use Uint32Array for 4-byte pixel copy when aligned
  const canUse32 =
    inputData.byteOffset % 4 === 0 && outputData.byteOffset % 4 === 0;

  if (canUse32) {
    const inU32 = new Uint32Array(
      inputData.buffer,
      inputData.byteOffset,
      inW * inH,
    );
    const outU32 = new Uint32Array(
      outputData.buffer,
      outputData.byteOffset,
      outW * outH,
    );
    // X lookup for Uint32 (pixel index, not byte index)
    const xLookup32 = new Uint32Array(outW);
    for (let x = 0; x < outW; x += 1) {
      xLookup32[x] = Math.min(inW - 1, ((x * inW) / outW) | 0);
    }

    for (let y = 0; y < outH; y += 1) {
      const sourceY = Math.min(inH - 1, ((y * inH) / outH) | 0);
      const sourceRowBase = sourceY * inW;
      const targetRowBase = y * outW;

      for (let x = 0; x < outW; x += 1) {
        outU32[targetRowBase + x] = inU32[sourceRowBase + xLookup32[x]!]!;
      }
    }
    return;
  }

  // Byte-level fallback
  for (let y = 0; y < outH; y += 1) {
    const sourceY = Math.min(inH - 1, ((y * inH) / outH) | 0);
    const sourceRowBase = sourceY * inW * RGBA_CHANNELS;
    const targetRowBase = y * outW * RGBA_CHANNELS;

    for (let x = 0; x < outW; x += 1) {
      const si = sourceRowBase + xLookup[x]!;
      const ti = targetRowBase + x * RGBA_CHANNELS;
      outputData[ti] = inputData[si]!;
      outputData[ti + 1] = inputData[si + 1]!;
      outputData[ti + 2] = inputData[si + 2]!;
      outputData[ti + 3] = inputData[si + 3]!;
    }
  }
}

/**
 * Separable bilinear resize: 2-pass (horizontal then vertical).
 * This reduces work from O(outW × outH × 4 samples) to O(outW × inH × 2 + outW × outH × 2).
 * For large images, this is significantly faster because each pass only interpolates in 1D.
 */
function resizeBilinear(input: RawRgbaImage, output: RawRgbaImage): void {
  const outW = output.width;
  const outH = output.height;
  const inW = input.width;
  const inH = input.height;
  const inputData = input.data;
  const outputData = output.data;
  const inStride = inW * RGBA_CHANNELS;
  const outStride = outW * RGBA_CHANNELS;

  const scaleX = inW / outW;
  const scaleY = inH / outH;
  const maxXi = inW - 1;
  const maxYi = inH - 1;

  // Precompute X interpolation coefficients (shared across both passes)
  const xCoeffs = new Uint32Array(outW * 3); // [x0_offset, x1_offset, fx_fixed8]
  for (let x = 0; x < outW; x += 1) {
    const srcX = Math.max(0, (x + 0.5) * scaleX - 0.5);
    const x0 = Math.min(maxXi, srcX | 0);
    const x1 = Math.min(maxXi, x0 + 1);
    const fx = ((srcX - x0) * 256) | 0;
    const base = x * 3;
    xCoeffs[base] = x0 * RGBA_CHANNELS;
    xCoeffs[base + 1] = x1 * RGBA_CHANNELS;
    xCoeffs[base + 2] = fx;
  }

  // Pass 1: Horizontal interpolation — produce temp[inH × outW]
  // Each row of temp has outW pixels, interpolated horizontally from input
  const tempStride = outW * RGBA_CHANNELS;
  const temp = new Uint8Array(inH * tempStride);

  for (let y = 0; y < inH; y += 1) {
    const srcRowBase = y * inStride;
    const tmpRowBase = y * tempStride;

    for (let x = 0; x < outW; x += 1) {
      const cBase = x * 3;
      const x0off = xCoeffs[cBase]!;
      const x1off = xCoeffs[cBase + 1]!;
      const fx = xCoeffs[cBase + 2]!;
      const invFx = 256 - fx;

      const si0 = srcRowBase + x0off;
      const si1 = srcRowBase + x1off;
      const ti = tmpRowBase + x * RGBA_CHANNELS;

      // 1D horizontal lerp — channel unrolled
      temp[ti] = (inputData[si0]! * invFx + inputData[si1]! * fx + 128) >> 8;
      temp[ti + 1] =
        (inputData[si0 + 1]! * invFx + inputData[si1 + 1]! * fx + 128) >> 8;
      temp[ti + 2] =
        (inputData[si0 + 2]! * invFx + inputData[si1 + 2]! * fx + 128) >> 8;
      temp[ti + 3] =
        (inputData[si0 + 3]! * invFx + inputData[si1 + 3]! * fx + 128) >> 8;
    }
  }

  // Pass 2: Vertical interpolation — read from temp[inH × outW], write to output[outH × outW]
  for (let y = 0; y < outH; y += 1) {
    const srcY = Math.max(0, (y + 0.5) * scaleY - 0.5);
    const y0 = Math.min(maxYi, srcY | 0);
    const y1 = Math.min(maxYi, y0 + 1);
    const fy = ((srcY - y0) * 256) | 0;
    const invFy = 256 - fy;

    const row0Base = y0 * tempStride;
    const row1Base = y1 * tempStride;
    const outRowBase = y * outStride;

    for (let x = 0; x < outW; x += 1) {
      const tOff = x * RGBA_CHANNELS;
      const ti0 = row0Base + tOff;
      const ti1 = row1Base + tOff;
      const oi = outRowBase + tOff;

      // 1D vertical lerp — channel unrolled
      outputData[oi] = (temp[ti0]! * invFy + temp[ti1]! * fy + 128) >> 8;
      outputData[oi + 1] =
        (temp[ti0 + 1]! * invFy + temp[ti1 + 1]! * fy + 128) >> 8;
      outputData[oi + 2] =
        (temp[ti0 + 2]! * invFy + temp[ti1 + 2]! * fy + 128) >> 8;
      outputData[oi + 3] =
        (temp[ti0 + 3]! * invFy + temp[ti1 + 3]! * fy + 128) >> 8;
    }
  }
}

function assertDimensions(dimensions: ImageDimensions): void {
  assertPositiveInteger(dimensions.width, "width");
  assertPositiveInteger(dimensions.height, "height");
  rgbaByteLength(dimensions);
}

function rgbaByteLength(dimensions: ImageDimensions): number {
  const bytes = dimensions.width * dimensions.height * RGBA_CHANNELS;
  if (!Number.isSafeInteger(bytes)) {
    throw new PhantomError("RGBA image dimensions are too large.");
  }
  return bytes;
}

function assertRectWithinImage(rect: Rect, image: RawRgbaImage): void {
  assertPositiveInteger(rect.x + 1, "rect.x");
  assertPositiveInteger(rect.y + 1, "rect.y");
  assertPositiveInteger(rect.width, "rect.width");
  assertPositiveInteger(rect.height, "rect.height");

  if (
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    throw new PhantomError(
      `Rectangle is outside image bounds: ${JSON.stringify(rect)}.`,
    );
  }
}

function normalizeRgbaColor(color: RgbaColor): Required<RgbaColor> {
  return {
    r: assertByte(color.r, "color.r"),
    g: assertByte(color.g, "color.g"),
    b: assertByte(color.b, "color.b"),
    a: assertByte(color.a ?? 255, "color.a"),
  };
}

function assertByte(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new PhantomError(`${name} must be an integer from 0 to 255.`);
  }
  return value;
}
