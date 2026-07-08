import { getPixelFilterOverlap } from "./filters.js";
import {
  chooseTileSize,
  getProcessingPlan,
  type ProcessingPlanStats,
} from "./performance.js";
import {
  RGBA_CHANNELS,
  type PixelFilter,
  type RawRgbaImage,
  assertRgbaLength,
} from "./types.js";
import type { ImageFileFormat, ImageEncodeOptions } from "./image-codecs.js";

export type PhantomAssetGoal =
  "delivery" | "archive" | "preview" | "transparent-cutout";

export interface PhantomAssetPlanOptions {
  readonly goal?: PhantomAssetGoal;
  readonly maxWorkerBytes?: number;
  readonly preferredFormat?: ImageFileFormat;
  readonly filters?: readonly PixelFilter[];
}

export interface PhantomAssetPlan {
  readonly goal: PhantomAssetGoal;
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly rgbaBytes: number;
  readonly hasAlpha: boolean;
  readonly filters: readonly PixelFilter[];
  readonly tileSize: number;
  readonly overlap: number;
  readonly processing: ProcessingPlanStats;
  readonly encode: ImageEncodeOptions & { readonly format: ImageFileFormat };
}

const DEFAULT_WORKER_BYTES = 32 * 1024 * 1024;

/**
 * Builds a one-call SDK recipe for choosing filters, tile size,
 * and output format before running a production image job.
 */
export function createAssetPlan(
  image: RawRgbaImage,
  options: PhantomAssetPlanOptions = {},
): PhantomAssetPlan {
  assertRgbaLength(image);
  const goal = options.goal ?? "delivery";
  const hasAlpha = hasVisibleTransparency(image);
  const filters = options.filters ?? defaultFilters(goal);
  const overlap = filters.reduce(
    (max, filter) => Math.max(max, getPixelFilterOverlap(filter)),
    0,
  );
  const tileSize = chooseTileSize({
    maxBytes: options.maxWorkerBytes ?? DEFAULT_WORKER_BYTES,
    overlap,
  });
  const processing = getProcessingPlan(image, {
    tileSize,
    overlap,
    filter: filters[0] ?? "identity",
  });
  const format = options.preferredFormat ?? recommendedFormat(goal, hasAlpha);
  const quality = recommendedQuality(goal, format);

  return {
    goal,
    width: image.width,
    height: image.height,
    pixels: image.width * image.height,
    rgbaBytes: image.data.byteLength,
    hasAlpha,
    filters,
    tileSize,
    overlap,
    processing,
    encode: {
      format,
      ...(quality === undefined ? {} : { quality }),
    },
  };
}

function defaultFilters(goal: PhantomAssetGoal): readonly PixelFilter[] {
  switch (goal) {
    case "archive":
      return [];
    case "preview":
      return ["smoothEnhance"];
    case "transparent-cutout":
      return ["unsharpMask"];
    case "delivery":
      return ["smoothEnhance"];
  }
}

function recommendedFormat(
  goal: PhantomAssetGoal,
  hasAlpha: boolean,
): ImageFileFormat {
  switch (goal) {
    case "archive":
      return "png";
    case "preview":
      return "webp";
    case "transparent-cutout":
      return "webp";
    case "delivery":
      return hasAlpha ? "webp" : "jpeg";
  }
}

function recommendedQuality(
  goal: PhantomAssetGoal,
  format: ImageFileFormat,
): number | undefined {
  if (format === "png" || format === "bmp" || format === "gif") {
    return undefined;
  }
  switch (goal) {
    case "archive":
      return 0.98;
    case "transparent-cutout":
      return 0.95;
    case "preview":
      return 0.84;
    case "delivery":
      return 0.92;
  }
}

function hasVisibleTransparency(image: RawRgbaImage): boolean {
  for (let index = 3; index < image.data.length; index += RGBA_CHANNELS) {
    if ((image.data[index] ?? 255) < 255) {
      return true;
    }
  }
  return false;
}
