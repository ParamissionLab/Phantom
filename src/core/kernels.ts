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

function smoothEnhanceCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
  detailNumerator: number,
  detailDenominator: number,
): void {
  let outputIndex = 0;

  for (let y = 0; y < outputRect.height; y += 1) {
    for (let x = 0; x < outputRect.width; x += 1) {
      const sourceX = outputRect.x + x - inputRect.x;
      const sourceY = outputRect.y + y - inputRect.y;
      const centerIndex = (sourceY * inputRect.width + sourceX) * RGBA_CHANNELS;

      for (let channel = 0; channel < 3; channel += 1) {
        const center = input[centerIndex + channel] ?? 0;
        const blur = gaussianBlur3x3(
          input,
          inputRect,
          sourceX,
          sourceY,
          channel,
        );
        const detail = center - blur;
        output[outputIndex + channel] = clampU8(
          center + Math.trunc((detail * detailNumerator) / detailDenominator),
        );
      }

      output[outputIndex + 3] = input[centerIndex + 3] ?? 255;
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
  let outputIndex = 0;

  for (let y = 0; y < outputRect.height; y += 1) {
    for (let x = 0; x < outputRect.width; x += 1) {
      const sourceX = outputRect.x + x - inputRect.x;
      const sourceY = outputRect.y + y - inputRect.y;

      for (let channel = 0; channel < 3; channel += 1) {
        let total = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            total += sampleChannel(
              input,
              inputRect,
              sourceX + dx,
              sourceY + dy,
              channel,
            );
          }
        }
        output[outputIndex + channel] = Math.round(total / 9);
      }

      const alphaIndex =
        (sourceY * inputRect.width + sourceX) * RGBA_CHANNELS + 3;
      output[outputIndex + 3] = input[alphaIndex] ?? 255;
      outputIndex += RGBA_CHANNELS;
    }
  }
}

function gaussianBlur3x3(
  input: Uint8Array,
  inputRect: Rect,
  sourceX: number,
  sourceY: number,
  channel: number,
): number {
  const top = sampleChannel(input, inputRect, sourceX, sourceY - 1, channel);
  const bottom = sampleChannel(input, inputRect, sourceX, sourceY + 1, channel);
  const left = sampleChannel(input, inputRect, sourceX - 1, sourceY, channel);
  const right = sampleChannel(input, inputRect, sourceX + 1, sourceY, channel);
  const center = sampleChannel(input, inputRect, sourceX, sourceY, channel);
  const topLeft = sampleChannel(
    input,
    inputRect,
    sourceX - 1,
    sourceY - 1,
    channel,
  );
  const topRight = sampleChannel(
    input,
    inputRect,
    sourceX + 1,
    sourceY - 1,
    channel,
  );
  const bottomLeft = sampleChannel(
    input,
    inputRect,
    sourceX - 1,
    sourceY + 1,
    channel,
  );
  const bottomRight = sampleChannel(
    input,
    inputRect,
    sourceX + 1,
    sourceY + 1,
    channel,
  );

  return (
    (topLeft +
      topRight +
      bottomLeft +
      bottomRight +
      (top + bottom + left + right) * 2 +
      center * 4) >>
    4
  );
}

function sampleChannel(
  input: Uint8Array,
  inputRect: Rect,
  x: number,
  y: number,
  channel: number,
): number {
  const sampleX = clamp(x, 0, inputRect.width - 1);
  const sampleY = clamp(y, 0, inputRect.height - 1);
  const sampleIndex =
    (sampleY * inputRect.width + sampleX) * RGBA_CHANNELS + channel;
  return input[sampleIndex] ?? 0;
}

function copyCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
): void {
  forEachOutputPixel(inputRect, outputRect, (inputIndex, outputIndex) => {
    output[outputIndex] = input[inputIndex] ?? 0;
    output[outputIndex + 1] = input[inputIndex + 1] ?? 0;
    output[outputIndex + 2] = input[inputIndex + 2] ?? 0;
    output[outputIndex + 3] = input[inputIndex + 3] ?? 255;
  });
}

function invertCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
): void {
  forEachOutputPixel(inputRect, outputRect, (inputIndex, outputIndex) => {
    output[outputIndex] = 255 - (input[inputIndex] ?? 0);
    output[outputIndex + 1] = 255 - (input[inputIndex + 1] ?? 0);
    output[outputIndex + 2] = 255 - (input[inputIndex + 2] ?? 0);
    output[outputIndex + 3] = input[inputIndex + 3] ?? 255;
  });
}

function grayscaleCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
): void {
  forEachOutputPixel(inputRect, outputRect, (inputIndex, outputIndex) => {
    const red = input[inputIndex] ?? 0;
    const green = input[inputIndex + 1] ?? 0;
    const blue = input[inputIndex + 2] ?? 0;
    const luma = clampU8(
      (red * LUMA_R + green * LUMA_G + blue * LUMA_B) >> FIXED_SHIFT,
    );
    output[outputIndex] = luma;
    output[outputIndex + 1] = luma;
    output[outputIndex + 2] = luma;
    output[outputIndex + 3] = input[inputIndex + 3] ?? 255;
  });
}

function convolutionCore(
  input: Uint8Array,
  inputRect: Rect,
  outputRect: Rect,
  output: Uint8Array,
  kernel: readonly number[],
): void {
  let outputIndex = 0;

  for (let y = 0; y < outputRect.height; y += 1) {
    for (let x = 0; x < outputRect.width; x += 1) {
      const sourceX = outputRect.x + x - inputRect.x;
      const sourceY = outputRect.y + y - inputRect.y;

      for (let channel = 0; channel < 3; channel += 1) {
        let accumulator = 0;
        let kernelIndex = 0;

        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const sampleX = clamp(sourceX + kx, 0, inputRect.width - 1);
            const sampleY = clamp(sourceY + ky, 0, inputRect.height - 1);
            const sampleIndex =
              (sampleY * inputRect.width + sampleX) * RGBA_CHANNELS + channel;
            accumulator +=
              (input[sampleIndex] ?? 0) * (kernel[kernelIndex] ?? 0);
            kernelIndex += 1;
          }
        }

        output[outputIndex + channel] = clampU8(accumulator >> FIXED_SHIFT);
      }

      const alphaIndex =
        (sourceY * inputRect.width + sourceX) * RGBA_CHANNELS + 3;
      output[outputIndex + 3] = input[alphaIndex] ?? 255;
      outputIndex += RGBA_CHANNELS;
    }
  }
}

function forEachOutputPixel(
  inputRect: Rect,
  outputRect: Rect,
  visitor: (inputIndex: number, outputIndex: number) => void,
): void {
  let outputIndex = 0;

  for (let y = 0; y < outputRect.height; y += 1) {
    for (let x = 0; x < outputRect.width; x += 1) {
      const inputX = outputRect.x + x - inputRect.x;
      const inputY = outputRect.y + y - inputRect.y;
      const inputIndex = (inputY * inputRect.width + inputX) * RGBA_CHANNELS;
      visitor(inputIndex, outputIndex);
      outputIndex += RGBA_CHANNELS;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
