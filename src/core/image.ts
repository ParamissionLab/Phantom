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
    const pixel =
      (rgba.a << 24) | (rgba.b << 16) | (rgba.g << 8) | rgba.r;
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
// OPTIMIZED RESIZE IMPLEMENTATIONS
// ---------------------------------------------------------------------------

function resizeNearest(input: RawRgbaImage, output: RawRgbaImage): void {
  const outW = output.width;
  const outH = output.height;
  const inW = input.width;
  const inH = input.height;
  const inputData = input.data;
  const outputData = output.data;

  // Precompute X lookup table — avoids repeated division in inner loop
  const xLookup = new Uint32Array(outW);
  for (let x = 0; x < outW; x += 1) {
    xLookup[x] = Math.min(inW - 1, (x * inW / outW) | 0) * RGBA_CHANNELS;
  }

  for (let y = 0; y < outH; y += 1) {
    const sourceY = Math.min(inH - 1, (y * inH / outH) | 0);
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

function resizeBilinear(input: RawRgbaImage, output: RawRgbaImage): void {
  const outW = output.width;
  const outH = output.height;
  const inW = input.width;
  const inH = input.height;
  const inputData = input.data;
  const outputData = output.data;
  const inStride = inW * RGBA_CHANNELS;

  const scaleX = inW / outW;
  const scaleY = inH / outH;
  const maxXi = inW - 1;
  const maxYi = inH - 1;

  // Precompute X interpolation table:
  // For each output X, store x0 offset, x1 offset, and fx (as fixed-point 8-bit)
  const xTable = new Uint32Array(outW * 3);
  for (let x = 0; x < outW; x += 1) {
    const srcX = Math.max(0, (x + 0.5) * scaleX - 0.5);
    const x0 = Math.min(maxXi, srcX | 0);
    const x1 = Math.min(maxXi, x0 + 1);
    const fx = ((srcX - x0) * 256) | 0; // 8-bit fixed point fraction
    const base = x * 3;
    xTable[base] = x0 * RGBA_CHANNELS;
    xTable[base + 1] = x1 * RGBA_CHANNELS;
    xTable[base + 2] = fx;
  }

  for (let y = 0; y < outH; y += 1) {
    const srcY = Math.max(0, (y + 0.5) * scaleY - 0.5);
    const y0 = Math.min(maxYi, srcY | 0);
    const y1 = Math.min(maxYi, y0 + 1);
    const fy = ((srcY - y0) * 256) | 0;
    const invFy = 256 - fy;

    const row0Base = y0 * inStride;
    const row1Base = y1 * inStride;
    const outRowBase = y * outW * RGBA_CHANNELS;

    for (let x = 0; x < outW; x += 1) {
      const xtBase = x * 3;
      const x0off = xTable[xtBase]!;
      const x1off = xTable[xtBase + 1]!;
      const fx = xTable[xtBase + 2]!;
      const invFx = 256 - fx;

      const i00 = row0Base + x0off;
      const i10 = row0Base + x1off;
      const i01 = row1Base + x0off;
      const i11 = row1Base + x1off;

      const ti = outRowBase + x * RGBA_CHANNELS;

      // Bilinear interpolation using 8-bit fixed-point
      // result = (top_left * invFx + top_right * fx) * invFy
      //        + (bot_left * invFx + bot_right * fx) * fy
      // All >> 16 to normalize (8-bit fx * 8-bit fy = 16-bit total shift)
      for (let ch = 0; ch < RGBA_CHANNELS; ch += 1) {
        const top = inputData[i00 + ch]! * invFx + inputData[i10 + ch]! * fx;
        const bot = inputData[i01 + ch]! * invFx + inputData[i11 + ch]! * fx;
        outputData[ti + ch] = (top * invFy + bot * fy + 32768) >> 16;
      }
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
