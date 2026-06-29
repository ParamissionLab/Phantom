import {
  applyAlphaMask,
  removeBackground,
  replaceTransparentBackground,
  type AlphaMask,
  type AlphaMaskRefinementOptions,
  type AlphaMaskResult,
  type BackgroundRemovalOptions,
  type BackgroundRemovalResult,
  type RgbColor,
} from "./background.js";
import { getPixelFilterOverlap } from "./filters.js";
import {
  createRawRgbaImage,
  cropRawImage,
  resizeRawImage,
  type ResizeRawImageOptions,
  type RgbaColor,
} from "./image.js";
import { processRawImage, processRawImagePipeline } from "./pipeline.js";
import {
  type PixelFilter,
  type ProcessOptions,
  type ProcessProgress,
  type RawRgbaImage,
  type Rect,
} from "./types.js";

export interface FilterOptions {
  readonly tileSize?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ProcessProgress) => void;
}

/**
 * Allocates a raw RGBA image with a compact width/height signature.
 */
export function makeImage(
  width: number,
  height: number,
  color?: RgbaColor,
): RawRgbaImage {
  return createRawRgbaImage({ width, height }, color);
}

/**
 * Crops a raw RGBA image with the default public API.
 */
export function cropImage(image: RawRgbaImage, rect: Rect): RawRgbaImage {
  return cropRawImage(image, rect);
}

/**
 * Resizes a raw RGBA image with the default public API.
 */
export function resizeImage(
  image: RawRgbaImage,
  width: number,
  height: number,
  options: ResizeRawImageOptions = {},
): RawRgbaImage {
  return resizeRawImage(image, { width, height }, options);
}

/**
 * Applies one filter with safe defaults. The required tile overlap is selected
 * automatically so callers do not need to configure kernel radius details.
 */
export async function applyFilter(
  image: RawRgbaImage,
  filter: PixelFilter = "smoothEnhance",
  options: FilterOptions = {},
): Promise<RawRgbaImage> {
  return processRawImage(image, {
    ...toProcessOptions(options),
    filter,
    overlap: getPixelFilterOverlap(filter),
  });
}

/**
 * Applies multiple filters with safe per-filter overlap defaults.
 */
export async function applyFilters(
  image: RawRgbaImage,
  filters: readonly PixelFilter[],
  options: FilterOptions = {},
): Promise<RawRgbaImage> {
  return processRawImagePipeline(
    image,
    filters.map((filter) => ({
      filter,
      overlap: getPixelFilterOverlap(filter),
    })),
    toProcessOptions(options),
  );
}

/**
 * Removes an image background using the deterministic built-in remover.
 */
export function removeImageBackground(
  image: RawRgbaImage,
  options: BackgroundRemovalOptions = {},
): BackgroundRemovalResult {
  return removeBackground(image, options);
}

/**
 * Applies a provider-generated alpha mask using edge-aware refinement.
 */
export function applyMask(
  image: RawRgbaImage,
  mask: AlphaMask,
  options: AlphaMaskRefinementOptions = {},
): AlphaMaskResult {
  return applyAlphaMask(image, mask, options);
}

/**
 * Flattens transparent pixels onto a solid background color.
 */
export function replaceBackground(
  image: RawRgbaImage,
  color: RgbColor,
): RawRgbaImage {
  return replaceTransparentBackground(image, color);
}

export const phantom = {
  makeImage,
  cropImage,
  resizeImage,
  applyFilter,
  applyFilters,
  removeImageBackground,
  applyMask,
  replaceBackground,
} as const;

function toProcessOptions(
  options: FilterOptions,
): Omit<ProcessOptions, "filter" | "overlap"> {
  return {
    ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  };
}
