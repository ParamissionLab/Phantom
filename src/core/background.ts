import {
  PhantomError,
  RGBA_CHANNELS,
  type RawRgbaImage,
  assertRgbaLength,
} from "./types.js";

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface AlphaMaskRefinementOptions {
  /** Discards model noise below this alpha value. */
  readonly threshold?: number;
  /** Width of the confidence transition around the threshold. */
  readonly softness?: number;
  /** Radius of the color-guided edge filter. Capped at 3 pixels. */
  readonly featherRadius?: number;
  /** RGB distance that allows neighboring mask samples to mix. */
  readonly edgeSensitivity?: number;
}

export interface AlphaMaskResult extends RawRgbaImage {
  readonly mask: Uint8Array;
  readonly removedPixels: number;
  readonly partialPixels: number;
}

/** Stable edge-preserving defaults shared by AI removal and browser demos. */
export const DEFAULT_ALPHA_MASK_REFINEMENT_OPTIONS = {
  threshold: 4,
  softness: 12,
  featherRadius: 2,
  edgeSensitivity: 48,
} as const satisfies Required<AlphaMaskRefinementOptions>;

/**
 * Resizes and refines a model-produced alpha mask against source image edges.
 * The color-guided filter smooths noisy mask pixels without blurring across
 * strong hair, skin, clothing, or product boundaries.
 */
export function refineAlphaMask(
  image: RawRgbaImage,
  mask: AlphaMask,
  options: AlphaMaskRefinementOptions = {},
): Uint8Array {
  assertRgbaLength(image);
  assertAlphaMask(mask);
  const threshold =
    options.threshold ?? DEFAULT_ALPHA_MASK_REFINEMENT_OPTIONS.threshold;
  const softness =
    options.softness ?? DEFAULT_ALPHA_MASK_REFINEMENT_OPTIONS.softness;
  const featherRadius =
    options.featherRadius ??
    DEFAULT_ALPHA_MASK_REFINEMENT_OPTIONS.featherRadius;
  const edgeSensitivity =
    options.edgeSensitivity ??
    DEFAULT_ALPHA_MASK_REFINEMENT_OPTIONS.edgeSensitivity;

  if (
    threshold < 0 ||
    threshold > 255 ||
    softness < 0 ||
    softness > 255 ||
    !Number.isInteger(featherRadius) ||
    featherRadius < 0 ||
    edgeSensitivity <= 0
  ) {
    throw new PhantomError(
      "Alpha mask options must use byte thresholds, a non-negative integer featherRadius, and a positive edgeSensitivity.",
    );
  }

  const resized = resizeAlphaMask(mask, image.width, image.height);
  const radius = Math.min(3, featherRadius);
  const refined =
    radius === 0
      ? resized
      : guidedFeather(image, resized, radius, edgeSensitivity);
  const transitionEnd = Math.min(255, threshold + softness);

  for (let pixel = 0; pixel < refined.length; pixel += 1) {
    const value = refined[pixel] ?? 0;
    refined[pixel] = Math.round(
      smoothstep(threshold, transitionEnd, value) * 255,
    );
  }

  return refined;
}

/**
 * Applies a semantic alpha mask while preserving any transparency already
 * present in the source image.
 */
export function applyAlphaMask(
  image: RawRgbaImage,
  mask: AlphaMask,
  options: AlphaMaskRefinementOptions = {},
): AlphaMaskResult {
  const refined = refineAlphaMask(image, mask, options);
  const output = new Uint8Array(image.data);
  let removedPixels = 0;
  let partialPixels = 0;

  for (let pixel = 0; pixel < refined.length; pixel += 1) {
    const index = pixel * RGBA_CHANNELS + 3;
    const sourceAlpha = output[index] ?? 255;
    const matteAlpha = refined[pixel] ?? 0;
    const alpha = Math.round((sourceAlpha * matteAlpha) / 255);
    output[index] = alpha;

    if (alpha < 250) {
      removedPixels += 1;
    }
    if (alpha > 0 && alpha < 255) {
      partialPixels += 1;
    }
  }

  return {
    width: image.width,
    height: image.height,
    data: output,
    mask: refined,
    removedPixels,
    partialPixels,
  };
}

export function replaceTransparentBackground(
  image: RawRgbaImage,
  color: RgbColor,
): RawRgbaImage {
  assertRgbaLength(image);
  const output = new Uint8Array(image.data.length);

  for (let index = 0; index < image.data.length; index += RGBA_CHANNELS) {
    const alpha = (image.data[index + 3] ?? 255) / 255;
    output[index] = blendChannel(image.data[index] ?? 0, color.r, alpha);
    output[index + 1] = blendChannel(
      image.data[index + 1] ?? 0,
      color.g,
      alpha,
    );
    output[index + 2] = blendChannel(
      image.data[index + 2] ?? 0,
      color.b,
      alpha,
    );
    output[index + 3] = 255;
  }

  return {
    width: image.width,
    height: image.height,
    data: output,
  };
}

function assertAlphaMask(mask: AlphaMask): void {
  if (!Number.isInteger(mask.width) || mask.width <= 0) {
    throw new PhantomError("Alpha mask width must be a positive integer.");
  }
  if (!Number.isInteger(mask.height) || mask.height <= 0) {
    throw new PhantomError("Alpha mask height must be a positive integer.");
  }
  const expected = mask.width * mask.height;
  if (mask.data.length !== expected) {
    throw new PhantomError(
      `Alpha mask length mismatch: expected ${expected} bytes, got ${mask.data.length}.`,
    );
  }
}

function resizeAlphaMask(
  mask: AlphaMask,
  width: number,
  height: number,
): Uint8Array {
  if (mask.width === width && mask.height === height) {
    return new Uint8Array(mask.data);
  }

  const output = new Uint8Array(width * height);
  const scaleX = mask.width / width;
  const scaleY = mask.height / height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, (y + 0.5) * scaleY - 0.5);
    const y0 = Math.min(mask.height - 1, Math.floor(sourceY));
    const y1 = Math.min(mask.height - 1, y0 + 1);
    const fy = sourceY - y0;

    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, (x + 0.5) * scaleX - 0.5);
      const x0 = Math.min(mask.width - 1, Math.floor(sourceX));
      const x1 = Math.min(mask.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const top = blendScalar(
        mask.data[y0 * mask.width + x0] ?? 0,
        mask.data[y0 * mask.width + x1] ?? 0,
        fx,
      );
      const bottom = blendScalar(
        mask.data[y1 * mask.width + x0] ?? 0,
        mask.data[y1 * mask.width + x1] ?? 0,
        fx,
      );
      output[y * width + x] = Math.round(blendScalar(top, bottom, fy));
    }
  }

  return output;
}

function guidedFeather(
  image: RawRgbaImage,
  mask: Uint8Array,
  radius: number,
  edgeSensitivity: number,
): Uint8Array {
  const output = new Uint8Array(mask);
  const edgeScale = 1 / (edgeSensitivity * edgeSensitivity);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = y * image.width + x;
      const centerAlpha = mask[pixel] ?? 0;
      if (centerAlpha === 0 || centerAlpha === 255) {
        continue;
      }

      const centerIndex = pixel * RGBA_CHANNELS;
      let weightedAlpha = 0;
      let weightTotal = 0;

      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= image.height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= image.width) continue;
          const neighbor = ny * image.width + nx;
          const neighborIndex = neighbor * RGBA_CHANNELS;
          const dr =
            (image.data[centerIndex] ?? 0) - (image.data[neighborIndex] ?? 0);
          const dg =
            (image.data[centerIndex + 1] ?? 0) -
            (image.data[neighborIndex + 1] ?? 0);
          const db =
            (image.data[centerIndex + 2] ?? 0) -
            (image.data[neighborIndex + 2] ?? 0);
          const colorWeight =
            1 / (1 + (dr * dr + dg * dg + db * db) * edgeScale);
          const spatialWeight = 1 / (1 + dx * dx + dy * dy);
          const weight = colorWeight * spatialWeight;
          weightedAlpha += (mask[neighbor] ?? 0) * weight;
          weightTotal += weight;
        }
      }

      output[pixel] = Math.round(weightedAlpha / Math.max(weightTotal, 1));
    }
  }

  return output;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function blendChannel(
  foreground: number,
  background: number,
  alpha: number,
): number {
  return Math.round(foreground * alpha + background * (1 - alpha));
}

function blendScalar(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
