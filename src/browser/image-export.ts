import { type RgbColor } from "../core/background.js";
import {
  PhantomError,
  RGBA_CHANNELS,
  assertRgbaLength,
  type RawRgbaImage,
} from "../core/types.js";

export type BrowserImageFormat = "image/png" | "image/jpeg" | "image/webp";
export type AdaptiveExportStrategy = "balanced" | "smallest" | "lossless";
export type BrowserImageInput =
  | RawRgbaImage
  | ImageData
  | HTMLCanvasElement
  | OffscreenCanvas
  | Blob
  | string
  | URL;

export interface BrowserImageConversionOptions {
  readonly format: BrowserImageFormat;
  readonly quality?: number;
  /** Background used when an alpha image is encoded as JPEG. */
  readonly matte?: RgbColor;
}

export interface AdaptiveExportOptions {
  readonly strategy?: AdaptiveExportStrategy;
  readonly quality?: number;
  readonly matte?: RgbColor;
}

export interface ImageExportAnalysis {
  readonly sampledPixels: number;
  readonly transparencyRatio: number;
  readonly partialAlphaRatio: number;
  readonly approximateColorCount: number;
  readonly edgeDensity: number;
}

export interface BrowserImageExportResult {
  readonly blob: Blob;
  readonly format: BrowserImageFormat;
  readonly requestedFormat: BrowserImageFormat;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly fallbackUsed: boolean;
}

export interface AdaptiveImageExportResult extends BrowserImageExportResult {
  readonly analysis: ImageExportAnalysis;
  readonly reason: string;
  readonly strategy: AdaptiveExportStrategy;
}

interface PreparedBrowserImage {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly rgba: RawRgbaImage;
  readonly close?: () => void;
}

const DEFAULT_JPEG_MATTE = { r: 255, g: 255, b: 255 } as const;
const MAX_ANALYSIS_SAMPLES = 4096;

/** Converts browser-readable image input to PNG, JPEG, or WebP. */
export async function convertImageFormat(
  input: BrowserImageInput,
  options: BrowserImageConversionOptions,
): Promise<BrowserImageExportResult> {
  const format = assertFormat(options.format);
  const quality = normalizeQuality(options.quality, format);
  const prepared = await prepareBrowserImage(input);

  try {
    const canvas =
      format === "image/jpeg"
        ? flattenCanvas(prepared.canvas, options.matte ?? DEFAULT_JPEG_MATTE)
        : prepared.canvas;
    const blob = await encodeWithFallback(canvas, format, quality);
    const actualFormat = normalizeBlobFormat(blob.type) ?? "image/png";

    return {
      blob,
      format: actualFormat,
      requestedFormat: format,
      width: prepared.rgba.width,
      height: prepared.rgba.height,
      bytes: blob.size,
      fallbackUsed: actualFormat !== format,
    };
  } finally {
    prepared.close?.();
  }
}

/**
 * Phantom Adaptive Export chooses a compact browser format from sampled alpha,
 * palette complexity, and edge density while preserving transparency safely.
 */
export async function smartExportImage(
  input: BrowserImageInput,
  options: AdaptiveExportOptions = {},
): Promise<AdaptiveImageExportResult> {
  const strategy = assertStrategy(options.strategy ?? "balanced");
  const prepared = await prepareBrowserImage(input);

  try {
    const analysis = analyzeImageForExport(prepared.rgba);
    const decision = chooseAdaptiveFormat(analysis, strategy);
    const quality = options.quality ?? (strategy === "smallest" ? 0.78 : 0.86);
    const canvas =
      decision.format === "image/jpeg"
        ? flattenCanvas(prepared.canvas, options.matte ?? DEFAULT_JPEG_MATTE)
        : prepared.canvas;
    const blob = await encodeWithFallback(
      canvas,
      decision.format,
      normalizeQuality(quality, decision.format),
    );
    const actualFormat = normalizeBlobFormat(blob.type) ?? "image/png";

    return {
      blob,
      format: actualFormat,
      requestedFormat: decision.format,
      width: prepared.rgba.width,
      height: prepared.rgba.height,
      bytes: blob.size,
      fallbackUsed: actualFormat !== decision.format,
      analysis,
      reason:
        actualFormat === decision.format
          ? decision.reason
          : `${decision.reason} The browser encoder fell back to PNG.`,
      strategy,
    };
  } finally {
    prepared.close?.();
  }
}

/** Samples an RGBA image for adaptive export without allocating a histogram. */
export function analyzeImageForExport(
  image: RawRgbaImage,
): ImageExportAnalysis {
  assertRgbaLength(image);
  const pixelCount = image.width * image.height;
  const stride = Math.max(1, Math.ceil(pixelCount / MAX_ANALYSIS_SAMPLES));
  const colors = new Set<number>();
  let sampledPixels = 0;
  let transparentPixels = 0;
  let partialAlphaPixels = 0;
  let edgeSamples = 0;
  let strongEdges = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const index = pixel * RGBA_CHANNELS;
    const red = image.data[index] ?? 0;
    const green = image.data[index + 1] ?? 0;
    const blue = image.data[index + 2] ?? 0;
    const alpha = image.data[index + 3] ?? 255;
    sampledPixels += 1;
    transparentPixels += alpha < 250 ? 1 : 0;
    partialAlphaPixels += alpha > 0 && alpha < 255 ? 1 : 0;
    colors.add((red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4));

    const x = pixel % image.width;
    if (x + 1 < image.width) {
      const neighborIndex = index + RGBA_CHANNELS;
      const difference =
        Math.abs(red - (image.data[neighborIndex] ?? 0)) +
        Math.abs(green - (image.data[neighborIndex + 1] ?? 0)) +
        Math.abs(blue - (image.data[neighborIndex + 2] ?? 0));
      edgeSamples += 1;
      strongEdges += difference >= 72 ? 1 : 0;
    }
  }

  return {
    sampledPixels,
    transparencyRatio: transparentPixels / sampledPixels,
    partialAlphaRatio: partialAlphaPixels / sampledPixels,
    approximateColorCount: colors.size,
    edgeDensity: strongEdges / Math.max(edgeSamples, 1),
  };
}

export function imageFormatExtension(format: BrowserImageFormat): string {
  switch (format) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
  }
}

function chooseAdaptiveFormat(
  analysis: ImageExportAnalysis,
  strategy: AdaptiveExportStrategy,
): { readonly format: BrowserImageFormat; readonly reason: string } {
  if (analysis.transparencyRatio > 0) {
    return {
      format: "image/png",
      reason: "PNG preserves the detected transparent and soft-edge pixels.",
    };
  }
  if (strategy === "lossless") {
    return {
      format: "image/png",
      reason: "PNG was selected by the lossless export strategy.",
    };
  }
  if (analysis.approximateColorCount <= 96 && analysis.edgeDensity >= 0.08) {
    return {
      format: "image/png",
      reason: "PNG fits the limited palette and high-contrast graphic edges.",
    };
  }
  return {
    format: "image/webp",
    reason: "WebP fits an opaque, color-rich image and reduces transfer size.",
  };
}

async function prepareBrowserImage(
  input: BrowserImageInput,
): Promise<PreparedBrowserImage> {
  if (isRawRgbaImage(input)) {
    assertRgbaLength(input);
    const canvas = createCanvas(input.width, input.height);
    writeRawImage(canvas, input);
    return { canvas, rgba: input };
  }
  if (isCanvas(input)) {
    return { canvas: input, rgba: readCanvas(input) };
  }
  if (isImageData(input)) {
    const rgba = {
      width: input.width,
      height: input.height,
      data: new Uint8Array(input.data),
    };
    const canvas = createCanvas(input.width, input.height);
    writeRawImage(canvas, rgba);
    return { canvas, rgba };
  }

  const blob = await loadImageBlob(input);
  if (typeof createImageBitmap === "undefined") {
    throw new PhantomError("createImageBitmap is required to decode images.");
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = get2dContext(canvas);
  context.drawImage(bitmap, 0, 0);
  return {
    canvas,
    rgba: readCanvas(canvas),
    close: () => bitmap.close(),
  };
}

async function loadImageBlob(input: Blob | string | URL): Promise<Blob> {
  if (input instanceof Blob) {
    return input;
  }
  if (typeof fetch === "undefined") {
    throw new PhantomError("fetch is required to load image URLs.");
  }
  const response = await fetch(input);
  if (!response.ok) {
    throw new PhantomError(`Unable to load image: HTTP ${response.status}.`);
  }
  return response.blob();
}

function createCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new PhantomError("Canvas APIs are required for browser image export.");
}

function flattenCanvas(
  source: HTMLCanvasElement | OffscreenCanvas,
  matte: RgbColor,
): HTMLCanvasElement | OffscreenCanvas {
  assertColor(matte);
  const canvas = createCanvas(source.width, source.height);
  const context = get2dContext(canvas);
  context.fillStyle = `rgb(${matte.r} ${matte.g} ${matte.b})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  return canvas;
}

function writeRawImage(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  image: RawRgbaImage,
): void {
  const context = get2dContext(canvas);
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
}

function readCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): RawRgbaImage {
  const image = get2dContext(canvas).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return {
    width: image.width,
    height: image.height,
    data: new Uint8Array(image.data),
  };
}

function get2dContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (context === null) {
    throw new PhantomError("Unable to create a 2D canvas context.");
  }
  return context;
}

async function encodeWithFallback(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: BrowserImageFormat,
  quality: number | undefined,
): Promise<Blob> {
  const encoded = await canvasToBlob(canvas, format, quality);
  if (format === "image/png" || normalizeBlobFormat(encoded.type) === format) {
    return encoded;
  }
  return canvasToBlob(canvas, "image/png", undefined);
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: BrowserImageFormat,
  quality: number | undefined,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({
      type: format,
      ...(quality === undefined ? {} : { quality }),
    });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new PhantomError(`Unable to encode ${format}.`));
        } else {
          resolve(blob);
        }
      },
      format,
      quality,
    );
  });
}

function normalizeQuality(
  quality: number | undefined,
  format: BrowserImageFormat,
): number | undefined {
  if (format === "image/png") {
    return undefined;
  }
  const value = quality ?? (format === "image/jpeg" ? 0.92 : 0.86);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new PhantomError("Image quality must be between 0 and 1.");
  }
  return value;
}

function assertFormat(format: string): BrowserImageFormat {
  if (
    format !== "image/png" &&
    format !== "image/jpeg" &&
    format !== "image/webp"
  ) {
    throw new PhantomError(`Unsupported image format: ${format}.`);
  }
  return format;
}

function assertStrategy(strategy: string): AdaptiveExportStrategy {
  if (
    strategy !== "balanced" &&
    strategy !== "smallest" &&
    strategy !== "lossless"
  ) {
    throw new PhantomError(
      `Unsupported adaptive export strategy: ${strategy}.`,
    );
  }
  return strategy;
}

function assertColor(color: RgbColor): void {
  for (const [name, value] of Object.entries(color)) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new PhantomError(`matte.${name} must be an integer from 0 to 255.`);
    }
  }
}

function normalizeBlobFormat(value: string): BrowserImageFormat | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (
    normalized === "image/png" ||
    normalized === "image/jpeg" ||
    normalized === "image/webp"
  ) {
    return normalized;
  }
  return undefined;
}

function isRawRgbaImage(value: BrowserImageInput): value is RawRgbaImage {
  return (
    typeof value === "object" &&
    value !== null &&
    "width" in value &&
    "height" in value &&
    "data" in value &&
    value.data instanceof Uint8Array
  );
}

function isImageData(value: BrowserImageInput): value is ImageData {
  return typeof ImageData !== "undefined" && value instanceof ImageData;
}

function isCanvas(
  value: BrowserImageInput,
): value is HTMLCanvasElement | OffscreenCanvas {
  return (
    (typeof HTMLCanvasElement !== "undefined" &&
      value instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
  );
}
