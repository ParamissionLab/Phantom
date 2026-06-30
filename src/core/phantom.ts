import {
  applyAlphaMask,
  replaceTransparentBackground,
  type AlphaMask,
  type AlphaMaskRefinementOptions,
  type AlphaMaskResult,
  type RgbColor,
} from "./background.js";
import {
  createPhantomAssetPlan,
  type PhantomAssetPlan,
  type PhantomAssetPlanOptions,
} from "./asset-plan.js";
import { getPixelFilterOverlap } from "./filters.js";
import {
  convertImageFile,
  optimizeImageFile,
  type BrowserImageInput,
  type ImageConversionResult,
  type ImageEncodeOptions,
  type ImageOptimizationOptions,
} from "./image-codecs.js";
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

/**
 * Builds a Phantom-specific image job recipe for filters, tiles, and encoding.
 */
export function planAsset(
  image: RawRgbaImage,
  options: PhantomAssetPlanOptions = {},
): PhantomAssetPlan {
  return createPhantomAssetPlan(image, options);
}

/**
 * Converts browser image inputs between common web image formats.
 */
export function convertImage(
  input: BrowserImageInput,
  options: ImageEncodeOptions = {},
): Promise<ImageConversionResult> {
  return convertImageFile(input, options);
}

/**
 * Re-encodes browser image inputs with conservative clarity-preserving defaults.
 */
export function optimizeImage(
  input: BrowserImageInput,
  options: ImageOptimizationOptions = {},
): Promise<ImageConversionResult> {
  return optimizeImageFile(input, options);
}

export const phantom = {
  makeImage,
  cropImage,
  resizeImage,
  applyFilter,
  applyFilters,
  applyMask,
  replaceBackground,
  planAsset,
  convertImage,
  optimizeImage,
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
