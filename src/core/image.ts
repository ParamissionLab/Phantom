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
    for (let index = 0; index < data.length; index += RGBA_CHANNELS) {
      data[index] = rgba.r;
      data[index + 1] = rgba.g;
      data[index + 2] = rgba.b;
      data[index + 3] = rgba.a;
    }
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

  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
    const sourceEnd = sourceStart + rect.width * RGBA_CHANNELS;
    const targetStart = row * rect.width * RGBA_CHANNELS;
    output.data.set(image.data.subarray(sourceStart, sourceEnd), targetStart);
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

function resizeNearest(input: RawRgbaImage, output: RawRgbaImage): void {
  for (let y = 0; y < output.height; y += 1) {
    const sourceY = Math.min(
      input.height - 1,
      Math.floor((y * input.height) / output.height),
    );

    for (let x = 0; x < output.width; x += 1) {
      const sourceX = Math.min(
        input.width - 1,
        Math.floor((x * input.width) / output.width),
      );
      copyPixel(input, output, sourceX, sourceY, x, y);
    }
  }
}

function resizeBilinear(input: RawRgbaImage, output: RawRgbaImage): void {
  const scaleX = input.width / output.width;
  const scaleY = input.height / output.height;

  for (let y = 0; y < output.height; y += 1) {
    const sourceY = Math.max(0, (y + 0.5) * scaleY - 0.5);
    const y0 = Math.min(input.height - 1, Math.floor(sourceY));
    const y1 = Math.min(input.height - 1, y0 + 1);
    const fy = sourceY - y0;

    for (let x = 0; x < output.width; x += 1) {
      const sourceX = Math.max(0, (x + 0.5) * scaleX - 0.5);
      const x0 = Math.min(input.width - 1, Math.floor(sourceX));
      const x1 = Math.min(input.width - 1, x0 + 1);
      const fx = sourceX - x0;
      writeBilinearPixel(input, output, { x0, x1, y0, y1, fx, fy }, x, y);
    }
  }
}

function writeBilinearPixel(
  input: RawRgbaImage,
  output: RawRgbaImage,
  sample: {
    readonly x0: number;
    readonly x1: number;
    readonly y0: number;
    readonly y1: number;
    readonly fx: number;
    readonly fy: number;
  },
  targetX: number,
  targetY: number,
): void {
  const targetIndex = (targetY * output.width + targetX) * RGBA_CHANNELS;

  for (let channel = 0; channel < RGBA_CHANNELS; channel += 1) {
    const top = blendScalar(
      readChannel(input, sample.x0, sample.y0, channel),
      readChannel(input, sample.x1, sample.y0, channel),
      sample.fx,
    );
    const bottom = blendScalar(
      readChannel(input, sample.x0, sample.y1, channel),
      readChannel(input, sample.x1, sample.y1, channel),
      sample.fx,
    );
    output.data[targetIndex + channel] = Math.round(
      blendScalar(top, bottom, sample.fy),
    );
  }
}

function copyPixel(
  input: RawRgbaImage,
  output: RawRgbaImage,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): void {
  const sourceIndex = (sourceY * input.width + sourceX) * RGBA_CHANNELS;
  const targetIndex = (targetY * output.width + targetX) * RGBA_CHANNELS;

  output.data[targetIndex] = input.data[sourceIndex] ?? 0;
  output.data[targetIndex + 1] = input.data[sourceIndex + 1] ?? 0;
  output.data[targetIndex + 2] = input.data[sourceIndex + 2] ?? 0;
  output.data[targetIndex + 3] = input.data[sourceIndex + 3] ?? 255;
}

function readChannel(
  image: RawRgbaImage,
  x: number,
  y: number,
  channel: number,
): number {
  return image.data[(y * image.width + x) * RGBA_CHANNELS + channel] ?? 0;
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

function blendScalar(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
