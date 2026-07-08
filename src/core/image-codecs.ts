import {
  fillTransparentWith,
  type RgbColor,
} from "./background.js";
import {
  PhantomError,
  RGBA_CHANNELS,
  type RawRgbaImage,
  assertRgbaLength,
} from "./types.js";

export type ImageFileFormat =
  | "png"
  | "jpeg"
  | "jpg"
  | "webp"
  | "avif"
  | "bmp"
  | "gif"
  | "tiff";

export type BrowserEncodableImageFormat =
  | "png"
  | "jpeg"
  | "jpg"
  | "webp"
  | "avif";

export interface ImageFormatProfile {
  readonly format: ImageFileFormat;
  readonly mimeType: string;
  readonly extensions: readonly string[];
  readonly supportsAlpha: boolean;
  readonly browserEncode: boolean;
}

export interface ImageEncodeOptions {
  readonly format?: string;
  readonly quality?: number;
  readonly background?: RgbColor;
}

export interface ImageOptimizationOptions extends ImageEncodeOptions {
  readonly keepOriginalWhenSmaller?: boolean;
}

export interface ImageConversionResult {
  readonly blob: Blob;
  readonly format: ImageFileFormat;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly inputBytes?: number;
  readonly outputBytes: number;
  readonly savedBytes?: number;
  readonly savedRatio?: number;
}

export type BrowserImageInput =
  | Blob
  | File
  | string
  | URL
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | ImageData
  | RawRgbaImage;

const IMAGE_FORMATS: readonly ImageFormatProfile[] = [
  {
    format: "png",
    mimeType: "image/png",
    extensions: ["png"],
    supportsAlpha: true,
    browserEncode: true,
  },
  {
    format: "jpeg",
    mimeType: "image/jpeg",
    extensions: ["jpg", "jpeg", "jpe", "jfif"],
    supportsAlpha: false,
    browserEncode: true,
  },
  {
    format: "webp",
    mimeType: "image/webp",
    extensions: ["webp"],
    supportsAlpha: true,
    browserEncode: true,
  },
  {
    format: "avif",
    mimeType: "image/avif",
    extensions: ["avif", "avifs"],
    supportsAlpha: true,
    browserEncode: true,
  },
  {
    format: "bmp",
    mimeType: "image/bmp",
    extensions: ["bmp", "dib"],
    supportsAlpha: false,
    browserEncode: false,
  },
  {
    format: "gif",
    mimeType: "image/gif",
    extensions: ["gif"],
    supportsAlpha: true,
    browserEncode: false,
  },
  {
    format: "tiff",
    mimeType: "image/tiff",
    extensions: ["tif", "tiff"],
    supportsAlpha: true,
    browserEncode: false,
  },
] as const;

/**
 * Lists common image formats Phantom can identify. Browser encoding support
 * depends on the host canvas implementation.
 */
export function listImageFormats(): readonly ImageFormatProfile[] {
  return IMAGE_FORMATS;
}

/**
 * Normalizes file extensions, MIME types, and common aliases such as jpg/jpeg.
 */
export function normalizeImageFormat(format: string): ImageFileFormat {
  const normalized = format
    .trim()
    .toLowerCase()
    .replace(/^image\//, "")
    .replace(/^\./, "");

  if (normalized === "jpg" || normalized === "jpe" || normalized === "jfif") {
    return "jpeg";
  }
  if (normalized === "tif") {
    return "tiff";
  }

  const profile = IMAGE_FORMATS.find(
    (entry) =>
      entry.format === normalized || entry.extensions.includes(normalized),
  );
  if (profile === undefined) {
    throw new PhantomError(`Unsupported image format: ${format}.`);
  }
  return profile.format;
}

export function getImageFormatProfile(
  format: string,
): ImageFormatProfile {
  const normalized = normalizeImageFormat(format);
  const profile = IMAGE_FORMATS.find((entry) => entry.format === normalized);
  if (profile === undefined) {
    throw new PhantomError(`Unsupported image format: ${format}.`);
  }
  return profile;
}

export function canEncodeImageFormat(format: string): boolean {
  return getImageFormatProfile(format).browserEncode;
}

/**
 * Encodes a raw RGBA image through the host browser canvas encoder.
 */
export async function encodeRawImage(
  image: RawRgbaImage,
  options: ImageEncodeOptions = {},
): Promise<ImageConversionResult> {
  assertRgbaLength(image);
  const format = normalizeImageFormat(options.format ?? "png");
  const canvas = rawImageToCanvas(image, format, options.background);
  return encodeCanvas(canvas, format, options.quality, image.data.byteLength);
}

/**
 * Converts browser-readable image inputs between common web formats.
 */
export async function convertImageFile(
  input: BrowserImageInput,
  options: ImageEncodeOptions = {},
): Promise<ImageConversionResult> {
  const source = await inputToCanvas(input);
  const format = normalizeImageFormat(
    options.format ?? inferInputFormat(input) ?? "webp",
  );
  const inputBytes = getInputBytes(input);
  const canvas = prepareCanvasForFormat(source.canvas, format, options);

  try {
    return await encodeCanvas(canvas, format, options.quality, inputBytes);
  } finally {
    source.close?.();
  }
}

/**
 * Re-encodes an image with visually conservative defaults and returns the
 * original blob when optimization would increase file size.
 */
export async function optimizeImageFile(
  input: BrowserImageInput,
  options: ImageOptimizationOptions = {},
): Promise<ImageConversionResult> {
  const inputFormat = inferInputFormat(input);
  const format = normalizeImageFormat(options.format ?? inputFormat ?? "webp");
  const quality = options.quality ?? defaultQuality(format);
  const converted = await convertImageFile(input, {
    ...options,
    format,
    ...(quality === undefined ? {} : { quality }),
  });
  const inputBlob = input instanceof Blob ? input : undefined;
  const keepOriginal = options.keepOriginalWhenSmaller ?? true;

  if (
    keepOriginal &&
    inputBlob !== undefined &&
    inputBlob.size > 0 &&
    inputBlob.size <= converted.outputBytes
  ) {
    const originalFormat = normalizeImageFormat(
      inputFormat ?? (inputBlob.type === "" ? format : inputBlob.type),
    );
    return {
      blob: inputBlob,
      format: originalFormat,
      mimeType: inputBlob.type || getImageFormatProfile(originalFormat).mimeType,
      width: converted.width,
      height: converted.height,
      inputBytes: inputBlob.size,
      outputBytes: inputBlob.size,
      savedBytes: 0,
      savedRatio: 0,
    };
  }

  return converted;
}

function defaultQuality(format: ImageFileFormat): number | undefined {
  switch (format) {
    case "jpeg":
    case "webp":
    case "avif":
      return 0.92;
    default:
      return undefined;
  }
}

function inferInputFormat(input: BrowserImageInput): ImageFileFormat | undefined {
  if (input instanceof Blob && input.type !== "") {
    return normalizeImageFormat(input.type);
  }
  if (typeof File !== "undefined" && input instanceof File) {
    return formatFromName(input.name);
  }
  if (typeof input === "string") {
    return formatFromName(input);
  }
  if (input instanceof URL) {
    return formatFromName(input.pathname);
  }
  return undefined;
}

function formatFromName(name: string): ImageFileFormat | undefined {
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(name);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return normalizeImageFormat(match[1]);
}

function getInputBytes(input: BrowserImageInput): number | undefined {
  if (input instanceof Blob) {
    return input.size;
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "data" in input &&
    input.data instanceof Uint8Array
  ) {
    return input.data.byteLength;
  }
  return undefined;
}

async function inputToCanvas(input: BrowserImageInput): Promise<{
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly close?: () => void;
}> {
  if (isRawRgbaImage(input)) {
    return { canvas: rawImageToCanvas(input, "png") };
  }
  if (isCanvas(input)) {
    return { canvas: input };
  }
  if (typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap) {
    return { canvas: drawBitmapToCanvas(input) };
  }
  if (typeof ImageData !== "undefined" && input instanceof ImageData) {
    return { canvas: imageDataToCanvas(input) };
  }

  const blob = await loadImageBlob(input);
  const bitmap = await createImageBitmap(blob);
  return {
    canvas: drawBitmapToCanvas(bitmap),
    close: () => {
      bitmap.close();
    },
  };
}

async function loadImageBlob(input: BrowserImageInput): Promise<Blob> {
  if (input instanceof Blob) {
    return input;
  }
  if (typeof input === "string" || input instanceof URL) {
    if (typeof fetch === "undefined") {
      throw new PhantomError("fetch is required to load image URLs.");
    }
    const response = await fetch(input);
    if (!response.ok) {
      throw new PhantomError(`Unable to load image: HTTP ${response.status}.`);
    }
    return response.blob();
  }
  throw new PhantomError("Unsupported image input.");
}

function rawImageToCanvas(
  image: RawRgbaImage,
  format: ImageFileFormat,
  background?: RgbColor,
): HTMLCanvasElement | OffscreenCanvas {
  const profile = getImageFormatProfile(format);
  const drawable =
    profile.supportsAlpha || background === undefined
      ? image
      : fillTransparentWith(image, background);
  const canvas = createCanvas(drawable.width, drawable.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new PhantomError("Unable to create a 2D canvas context.");
  }
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(drawable.data),
      drawable.width,
      drawable.height,
    ),
    0,
    0,
  );
  return canvas;
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement | OffscreenCanvas {
  const canvas = createCanvas(imageData.width, imageData.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new PhantomError("Unable to create a 2D canvas context.");
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function drawBitmapToCanvas(
  bitmap: ImageBitmap,
): HTMLCanvasElement | OffscreenCanvas {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new PhantomError("Unable to create a 2D canvas context.");
  }
  context.drawImage(bitmap, 0, 0);
  return canvas;
}

function prepareCanvasForFormat(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: ImageFileFormat,
  options: ImageEncodeOptions,
): HTMLCanvasElement | OffscreenCanvas {
  const profile = getImageFormatProfile(format);
  if (profile.supportsAlpha) {
    return canvas;
  }

  const output = createCanvas(canvas.width, canvas.height);
  const context = output.getContext("2d");
  if (context === null) {
    throw new PhantomError("Unable to create a 2D canvas context.");
  }
  const background = options.background ?? { r: 255, g: 255, b: 255 };
  context.fillStyle = `rgb(${background.r}, ${background.g}, ${background.b})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(canvas, 0, 0);
  return output;
}

async function encodeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: ImageFileFormat,
  quality: number | undefined,
  inputBytes: number | undefined,
): Promise<ImageConversionResult> {
  const profile = getImageFormatProfile(format);
  if (!profile.browserEncode) {
    throw new PhantomError(
      `${format} is recognized, but browser canvas encoding is not available for this format.`,
    );
  }
  const normalizedQuality = normalizeQuality(quality);
  const blob = await canvasToBlob(canvas, profile.mimeType, normalizedQuality);
  const savedBytes =
    inputBytes === undefined ? undefined : Math.max(0, inputBytes - blob.size);

  return {
    blob,
    format: profile.format,
    mimeType: blob.type || profile.mimeType,
    width: canvas.width,
    height: canvas.height,
    ...(inputBytes === undefined ? {} : { inputBytes }),
    outputBytes: blob.size,
    ...(savedBytes === undefined ? {} : { savedBytes }),
    ...(savedBytes === undefined || inputBytes === undefined || inputBytes === 0
      ? {}
      : { savedRatio: savedBytes / inputBytes }),
  };
}

function normalizeQuality(quality: number | undefined): number | undefined {
  if (quality === undefined) {
    return undefined;
  }
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new PhantomError("quality must be a number from 0 to 1.");
  }
  return quality;
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mimeType: string,
  quality: number | undefined,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({
      type: mimeType,
      ...(quality === undefined ? {} : { quality }),
    });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new PhantomError(`Unable to encode ${mimeType}.`));
        } else {
          resolve(blob);
        }
      },
      mimeType,
      quality,
    );
  });
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
  throw new PhantomError("Canvas APIs are required for image encoding.");
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

function isRawRgbaImage(value: BrowserImageInput): value is RawRgbaImage {
  return (
    typeof value === "object" &&
    value !== null &&
    "width" in value &&
    "height" in value &&
    "data" in value &&
    value.data instanceof Uint8Array &&
    value.data.length === value.width * value.height * RGBA_CHANNELS
  );
}
