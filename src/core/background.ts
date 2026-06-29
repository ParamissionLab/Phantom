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

export interface BackgroundRemovalOptions {
  readonly background?: RgbColor;
  readonly threshold?: number;
  readonly softness?: number;
  readonly edgeSampleSize?: number;
  readonly preserveShadows?: boolean;
  readonly colorClusters?: number;
  readonly edgeSensitivity?: number;
  readonly featherRadius?: number;
  readonly foregroundBias?: number;
  readonly mode?: "fuzzy" | "plain";
}

export interface BackgroundRemovalResult extends RawRgbaImage {
  readonly background: RgbColor;
  readonly removedPixels: number;
  readonly diagnostics: BackgroundRemovalDiagnostics;
}

export interface BackgroundRemovalDiagnostics {
  readonly mode: "fuzzy" | "plain";
  readonly palette: readonly RgbColor[];
  readonly edgeConnectedPixels: number;
  readonly uncertainPixels: number;
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

const DEFAULT_THRESHOLD = 38;
const DEFAULT_SOFTNESS = 34;
const DEFAULT_EDGE_SAMPLE_SIZE = 8;
const DEFAULT_COLOR_CLUSTERS = 5;
const DEFAULT_EDGE_SENSITIVITY = 46;
const DEFAULT_FEATHER_RADIUS = 1;
const DEFAULT_FOREGROUND_BIAS = 0.68;
const MAX_EDGE_SAMPLES = 4096;

/**
 * Estimates a mostly-uniform background color from image border pixels.
 */
export function estimateBackgroundColor(
  image: RawRgbaImage,
  edgeSampleSize = DEFAULT_EDGE_SAMPLE_SIZE,
): RgbColor {
  const samples = collectEdgeSamples(image, edgeSampleSize, MAX_EDGE_SAMPLES);
  let red = 0;
  let green = 0;
  let blue = 0;

  for (const color of samples) {
    red += color.r;
    green += color.g;
    blue += color.b;
  }

  return {
    r: Math.round(red / samples.length),
    g: Math.round(green / samples.length),
    b: Math.round(blue / samples.length),
  };
}

/**
 * Estimates the dominant edge colors that likely describe the background.
 */
export function estimateBackgroundPalette(
  image: RawRgbaImage,
  edgeSampleSize = DEFAULT_EDGE_SAMPLE_SIZE,
  colorClusters = DEFAULT_COLOR_CLUSTERS,
): readonly RgbColor[] {
  const samples = collectEdgeSamples(image, edgeSampleSize, MAX_EDGE_SAMPLES);
  const clusterCount = clampInteger(colorClusters, 1, 8, "colorClusters");

  if (samples.length <= clusterCount) {
    return samples;
  }

  return clusterColors(samples, clusterCount);
}

/**
 * Removes a background by converting edge-connected background pixels to alpha.
 *
 * The default fuzzy mode combines a multi-color edge palette, color confidence,
 * local edge barriers, connected-component expansion, and edge feathering. It is
 * still deterministic and lightweight, but avoids the destructive global color
 * matching that removes skin, fabric, or highlights inside the subject.
 */
export function removeBackground(
  image: RawRgbaImage,
  options: BackgroundRemovalOptions = {},
): BackgroundRemovalResult {
  assertRgbaLength(image);
  const mode = options.mode ?? "fuzzy";
  const background =
    options.background ??
    estimateBackgroundColor(image, options.edgeSampleSize);
  const palette =
    options.background === undefined && mode === "fuzzy"
      ? estimateBackgroundPalette(
          image,
          options.edgeSampleSize,
          options.colorClusters,
        )
      : [background];
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const softness = options.softness ?? DEFAULT_SOFTNESS;
  const preserveShadows = options.preserveShadows ?? true;
  const edgeSensitivity = options.edgeSensitivity ?? DEFAULT_EDGE_SENSITIVITY;
  const featherRadius = options.featherRadius ?? DEFAULT_FEATHER_RADIUS;
  const foregroundBias = options.foregroundBias ?? DEFAULT_FOREGROUND_BIAS;

  if (
    threshold < 0 ||
    softness < 0 ||
    edgeSensitivity < 0 ||
    featherRadius < 0 ||
    foregroundBias < 0 ||
    foregroundBias > 1
  ) {
    throw new PhantomError(
      "threshold, softness, edgeSensitivity, featherRadius, and foregroundBias must be valid non-negative values.",
    );
  }

  const output = new Uint8Array(image.data);
  const pixelCount = image.width * image.height;
  const alpha = new Uint8Array(pixelCount);
  const connected =
    mode === "plain"
      ? buildPlainMask(image, palette, threshold, softness)
      : buildFuzzyConnectedMask(image, palette, {
          threshold,
          softness,
          edgeSensitivity,
          foregroundBias,
        });
  let removedPixels = 0;
  let uncertainPixels = 0;
  let edgeConnectedPixels = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * RGBA_CHANNELS;
    const red = output[index] ?? 0;
    const green = output[index + 1] ?? 0;
    const blue = output[index + 2] ?? 0;
    const confidence =
      connected[pixel] === 1
        ? fuzzyBackgroundConfidence(
            { r: red, g: green, b: blue },
            palette,
            threshold,
            softness,
          )
        : 0;
    const matteAlpha =
      connected[pixel] === 1 ? Math.round((1 - confidence) * 255) : 255;

    if (connected[pixel] === 1) {
      edgeConnectedPixels += 1;
    }
    if (matteAlpha > 0 && matteAlpha < 255) {
      uncertainPixels += 1;
    }

    alpha[pixel] = preserveShadows
      ? Math.min(output[index + 3] ?? 255, matteAlpha)
      : matteAlpha;
  }

  featherBackgroundSide(alpha, image.width, image.height, featherRadius);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * RGBA_CHANNELS;
    const matteAlpha = alpha[pixel] ?? 255;

    if (matteAlpha < 250) {
      removedPixels += 1;
    }

    output[index + 3] = matteAlpha;
  }

  return {
    width: image.width,
    height: image.height,
    data: output,
    background,
    removedPixels,
    diagnostics: {
      mode,
      palette,
      edgeConnectedPixels,
      uncertainPixels,
    },
  };
}

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
  const threshold = options.threshold ?? 4;
  const softness = options.softness ?? 12;
  const featherRadius = options.featherRadius ?? 2;
  const edgeSensitivity = options.edgeSensitivity ?? 48;

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

interface FuzzyMaskOptions {
  readonly threshold: number;
  readonly softness: number;
  readonly edgeSensitivity: number;
  readonly foregroundBias: number;
}

function buildPlainMask(
  image: RawRgbaImage,
  palette: readonly RgbColor[],
  threshold: number,
  softness: number,
): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const index = pixel * RGBA_CHANNELS;
    const color = {
      r: image.data[index] ?? 0,
      g: image.data[index + 1] ?? 0,
      b: image.data[index + 2] ?? 0,
    };
    mask[pixel] =
      fuzzyBackgroundConfidence(color, palette, threshold, softness) > 0
        ? 1
        : 0;
  }

  return mask;
}

function buildFuzzyConnectedMask(
  image: RawRgbaImage,
  palette: readonly RgbColor[],
  options: FuzzyMaskOptions,
): Uint8Array {
  const pixelCount = image.width * image.height;
  const connected = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const seedCutoff = Math.min(0.92, options.foregroundBias + 0.1);
  const connectCutoff = Math.max(0.22, options.foregroundBias - 0.18);

  const enqueue = (pixel: number): void => {
    if (connected[pixel] === 1) {
      return;
    }
    connected[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < image.width; x += 1) {
    seedIfBackground(image, x, 0, palette, options, seedCutoff, enqueue);
    seedIfBackground(
      image,
      x,
      image.height - 1,
      palette,
      options,
      seedCutoff,
      enqueue,
    );
  }

  for (let y = 1; y < image.height - 1; y += 1) {
    seedIfBackground(image, 0, y, palette, options, seedCutoff, enqueue);
    seedIfBackground(
      image,
      image.width - 1,
      y,
      palette,
      options,
      seedCutoff,
      enqueue,
    );
  }

  while (head < tail) {
    const pixel = queue[head] ?? 0;
    head += 1;
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);

    tryConnectNeighbor(
      image,
      x - 1,
      y,
      palette,
      options,
      connectCutoff,
      connected,
      enqueue,
    );
    tryConnectNeighbor(
      image,
      x + 1,
      y,
      palette,
      options,
      connectCutoff,
      connected,
      enqueue,
    );
    tryConnectNeighbor(
      image,
      x,
      y - 1,
      palette,
      options,
      connectCutoff,
      connected,
      enqueue,
    );
    tryConnectNeighbor(
      image,
      x,
      y + 1,
      palette,
      options,
      connectCutoff,
      connected,
      enqueue,
    );
  }

  return connected;
}

function seedIfBackground(
  image: RawRgbaImage,
  x: number,
  y: number,
  palette: readonly RgbColor[],
  options: FuzzyMaskOptions,
  cutoff: number,
  enqueue: (pixel: number) => void,
): void {
  const pixel = y * image.width + x;
  if (pixelBackgroundConfidence(image, x, y, palette, options) >= cutoff) {
    enqueue(pixel);
  }
}

function tryConnectNeighbor(
  image: RawRgbaImage,
  x: number,
  y: number,
  palette: readonly RgbColor[],
  options: FuzzyMaskOptions,
  cutoff: number,
  connected: Uint8Array,
  enqueue: (pixel: number) => void,
): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return;
  }

  const pixel = y * image.width + x;
  if (connected[pixel] === 1) {
    return;
  }

  if (pixelBackgroundConfidence(image, x, y, palette, options) >= cutoff) {
    enqueue(pixel);
  }
}

function pixelBackgroundConfidence(
  image: RawRgbaImage,
  x: number,
  y: number,
  palette: readonly RgbColor[],
  options: FuzzyMaskOptions,
): number {
  const index = (y * image.width + x) * RGBA_CHANNELS;
  const color = {
    r: image.data[index] ?? 0,
    g: image.data[index + 1] ?? 0,
    b: image.data[index + 2] ?? 0,
  };
  const colorConfidence = fuzzyBackgroundConfidence(
    color,
    palette,
    options.threshold,
    options.softness,
  );
  const gradient = luminanceGradient(image, x, y);
  const edgeBarrier =
    1 -
    smoothstep(
      options.edgeSensitivity * 0.45,
      options.edgeSensitivity,
      gradient,
    );

  return clamp01(colorConfidence * (0.55 + edgeBarrier * 0.45));
}

function fuzzyBackgroundConfidence(
  color: RgbColor,
  palette: readonly RgbColor[],
  threshold: number,
  softness: number,
): number {
  const distance = nearestPaletteDistance(color, palette);
  if (distance <= threshold) {
    return 1;
  }
  if (softness === 0 || distance >= threshold + softness) {
    return 0;
  }

  return 1 - smoothstep(threshold, threshold + softness, distance);
}

function nearestPaletteDistance(
  color: RgbColor,
  palette: readonly RgbColor[],
): number {
  let distance = Number.POSITIVE_INFINITY;

  for (const background of palette) {
    distance = Math.min(distance, colorDistance(color, background));
  }

  return distance;
}

function luminanceGradient(image: RawRgbaImage, x: number, y: number): number {
  const left = luminanceAt(image, Math.max(0, x - 1), y);
  const right = luminanceAt(image, Math.min(image.width - 1, x + 1), y);
  const top = luminanceAt(image, x, Math.max(0, y - 1));
  const bottom = luminanceAt(image, x, Math.min(image.height - 1, y + 1));

  return Math.abs(right - left) + Math.abs(bottom - top);
}

function luminanceAt(image: RawRgbaImage, x: number, y: number): number {
  const index = (y * image.width + x) * RGBA_CHANNELS;
  return (
    (image.data[index] ?? 0) * 0.2126 +
    (image.data[index + 1] ?? 0) * 0.7152 +
    (image.data[index + 2] ?? 0) * 0.0722
  );
}

function featherBackgroundSide(
  alpha: Uint8Array,
  width: number,
  height: number,
  radius: number,
): void {
  const featherRadius = Math.min(4, Math.floor(radius));
  if (featherRadius <= 0) {
    return;
  }

  const source = new Uint8Array(alpha);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const current = source[pixel] ?? 255;

      if (current >= 255 || !touchesOpaquePixel(source, width, height, x, y)) {
        continue;
      }

      let total = 0;
      let count = 0;

      for (let dy = -featherRadius; dy <= featherRadius; dy += 1) {
        for (let dx = -featherRadius; dx <= featherRadius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          total += source[ny * width + nx] ?? 255;
          count += 1;
        }
      }

      alpha[pixel] = Math.max(current, Math.round(total / Math.max(count, 1)));
    }
  }
}

function touchesOpaquePixel(
  alpha: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  return (
    readAlpha(alpha, width, height, x - 1, y) >= 250 ||
    readAlpha(alpha, width, height, x + 1, y) >= 250 ||
    readAlpha(alpha, width, height, x, y - 1) >= 250 ||
    readAlpha(alpha, width, height, x, y + 1) >= 250
  );
}

function readAlpha(
  alpha: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  return alpha[y * width + x] ?? 255;
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

function collectEdgeSamples(
  image: RawRgbaImage,
  edgeSampleSize: number,
  maxSamples: number,
): readonly RgbColor[] {
  assertRgbaLength(image);
  if (!Number.isInteger(edgeSampleSize) || edgeSampleSize <= 0) {
    throw new PhantomError("edgeSampleSize must be a positive integer.");
  }

  const sample = Math.min(edgeSampleSize, image.width, image.height);
  const edgeArea =
    image.width * image.height -
    Math.max(0, image.width - sample * 2) *
      Math.max(0, image.height - sample * 2);
  const stride = Math.max(1, Math.ceil(edgeArea / maxSamples));
  const samples: RgbColor[] = [];
  let seen = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const isEdge =
        x < sample ||
        y < sample ||
        x >= image.width - sample ||
        y >= image.height - sample;

      if (!isEdge) {
        continue;
      }

      if (seen % stride === 0) {
        const index = (y * image.width + x) * RGBA_CHANNELS;
        samples.push({
          r: image.data[index] ?? 0,
          g: image.data[index + 1] ?? 0,
          b: image.data[index + 2] ?? 0,
        });
      }
      seen += 1;
    }
  }

  if (samples.length === 0) {
    throw new PhantomError("Unable to sample background color.");
  }

  return samples;
}

function clusterColors(
  samples: readonly RgbColor[],
  clusterCount: number,
): readonly RgbColor[] {
  const fallback = samples[0];
  if (fallback === undefined) {
    throw new PhantomError("Unable to cluster background colors.");
  }

  let clusters: RgbColor[] = Array.from(
    { length: clusterCount },
    (_, index) => {
      const sampleIndex = Math.floor((index / clusterCount) * samples.length);
      return samples[Math.min(sampleIndex, samples.length - 1)] ?? fallback;
    },
  );
  let counts = new Array<number>(clusterCount).fill(0);

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const totals = Array.from({ length: clusterCount }, () => ({
      r: 0,
      g: 0,
      b: 0,
    }));
    counts = new Array<number>(clusterCount).fill(0);

    for (const sample of samples) {
      const clusterIndex = nearestClusterIndex(sample, clusters);
      const total = totals[clusterIndex];
      if (total === undefined) {
        continue;
      }
      total.r += sample.r;
      total.g += sample.g;
      total.b += sample.b;
      counts[clusterIndex] = (counts[clusterIndex] ?? 0) + 1;
    }

    clusters = clusters.map((cluster, index) => {
      const count = counts[index] ?? 0;
      if (count === 0) {
        return cluster;
      }
      const total = totals[index] ?? {
        r: cluster.r,
        g: cluster.g,
        b: cluster.b,
      };
      return {
        r: Math.round(total.r / count),
        g: Math.round(total.g / count),
        b: Math.round(total.b / count),
      };
    });
  }

  return clusters
    .map((color, index) => ({ color, count: counts[index] ?? 0 }))
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((cluster) => cluster.color);
}

function nearestClusterIndex(
  sample: RgbColor,
  clusters: readonly RgbColor[],
): number {
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < clusters.length; index += 1) {
    const distance = colorDistance(sample, clusters[index] ?? sample);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;
  return Math.sqrt(red * red + green * green + blue * blue);
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

function clampInteger(
  value: number,
  min: number,
  max: number,
  name: string,
): number {
  if (!Number.isInteger(value)) {
    throw new PhantomError(`${name} must be an integer.`);
  }

  return Math.min(max, Math.max(min, value));
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
