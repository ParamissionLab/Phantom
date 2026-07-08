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
  type TileProcessor,
} from "./types.js";
import { adjustRawImage, type ImageAdjustOptions } from "./adjust.js";
import { applyTextWatermark, type TextWatermarkOptions, type WatermarkResult } from "./watermark.js";
import { computeHistogram, autoLevelSuggestion, type ImageHistogram } from "./histogram.js";
import {
  registerProcessor,
  getRegisteredProcessor,
  getPendingInit,
  setPendingInit,
  loadWasmBytes,
} from "./wasm-registry.js";

export interface FilterOptions {
  readonly tileSize?: number;
  readonly signal?: AbortSignal;
  readonly tileProcessor?: TileProcessor;
  readonly onProgress?: (progress: ProcessProgress) => void;
}

export interface PhantomEditPipeline {
  crop(rect: Rect): PhantomEditPipeline;
  resize(
    width: number,
    height: number,
    options?: ResizeRawImageOptions,
  ): PhantomEditPipeline;
  filter(filter?: PixelFilter, options?: FilterOptions): PhantomEditPipeline;
  filters(
    filters: readonly PixelFilter[],
    options?: FilterOptions,
  ): PhantomEditPipeline;
  mask(
    mask: AlphaMask,
    options?: AlphaMaskRefinementOptions,
  ): PhantomEditPipeline;
  background(color: RgbColor): PhantomEditPipeline;
  /** Apply tone/color adjustments (brightness, contrast, saturation, temperature, hue, gamma). */
  adjust(options: ImageAdjustOptions): PhantomEditPipeline;
  /** Burn a text watermark into the image (requires browser Canvas API). */
  watermark(options: TextWatermarkOptions): PhantomEditPipeline;
  plan(options?: PhantomAssetPlanOptions): Promise<PhantomAssetPlan>;
  run(): Promise<RawRgbaImage>;
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
 * Applies tone and color adjustments to a raw RGBA image.
 * Accepts brightness, contrast, saturation, temperature, hue, and gamma.
 */
export function adjustImage(
  image: RawRgbaImage,
  options: ImageAdjustOptions,
): RawRgbaImage {
  return adjustRawImage(image, options);
}

/**
 * Burns a text watermark onto a raw RGBA image using the browser Canvas API.
 */
export function watermarkImage(
  image: RawRgbaImage,
  options: TextWatermarkOptions,
): WatermarkResult {
  return applyTextWatermark(image, options);
}

/**
 * Computes per-channel RGB and luminance histograms for an image.
 */
export function analyzeImage(image: RawRgbaImage): ImageHistogram {
  return computeHistogram(image);
}

/**
 * Returns suggested brightness/contrast adjustments based on histogram analysis.
 */
export function autoLevelImage(
  image: RawRgbaImage,
): { brightness: number; contrast: number } {
  return autoLevelSuggestion(computeHistogram(image));
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

/**
 * Loads the Zig WASM kernel and registers it as the global tile processor.
 *
 * After this call every `applyFilter`, `applyFilters`, `processRawImage`,
 * `edit().filter()`, and `processTileSource` call that does NOT supply its
 * own `tileProcessor` option will run through the compiled Zig kernel
 * automatically — no extra configuration needed at any call site.
 *
 * @param source  URL string, `URL`, `ArrayBuffer`, or `BufferSource` that
 *                points to (or contains) `phantom_kernel.wasm`.
 *
 * @example
 *   // Call once at app startup — all subsequent phantom calls use WASM.
 *   import phantom, { configureWasm } from "@paramission-lab/phantom";
 *
 *   await configureWasm("/assets/phantom_kernel.wasm");
 *   const output = await phantom.applyFilter(image, "smoothEnhance");
 *
 * Pass `null` to revert to the CPU TypeScript baseline:
 *   await configureWasm(null);
 */
export async function configureWasm(
  source: string | URL | BufferSource | null,
): Promise<void> {
  // ── Reset path ──────────────────────────────────────────────────────────
  if (source === null) {
    registerProcessor(null); // also clears pendingInit via registerProcessor
    return;
  }

  // ── Already loaded ───────────────────────────────────────────────────────
  if (isWasmReady()) {
    return;
  }

  // ── Dedup: if another call is already in-flight, await that one ──────────
  const existing = getPendingInit();
  if (existing !== null) {
    return existing;
  }

  // ── Start a new init ─────────────────────────────────────────────────────
  const init = (async (): Promise<void> => {
    // Lazy-import — WASM code is never bundled unless configureWasm() runs.
    const { instantiateZigBackend, createZigTileProcessor } = await import(
      "../wasm/zig-backend.js"
    );

    // Resolve bytes from any source type without requiring the caller to know
    // which API to use.
    let bytes: BufferSource;
    if (typeof source === "string" || source instanceof URL) {
      bytes = await loadWasmBytes(source);
    } else {
      bytes = source;
    }

    const backend = await instantiateZigBackend(bytes);
    registerProcessor(createZigTileProcessor(backend));
  })();

  // Store so concurrent callers can join.
  setPendingInit(init);

  try {
    await init;
  } finally {
    // Whether it succeeded or failed, clear the pending slot so a retry is
    // possible without calling configureWasm(null) first.
    if (!isWasmReady()) {
      setPendingInit(null);
    }
  }
}

/**
 * Returns true when a WASM backend has been loaded via `configureWasm()`.
 */
export function isWasmReady(): boolean {
  return getRegisteredProcessor() !== null;
}

/**
 * Starts a beginner-friendly image editing pipeline. It keeps the common flow
 * on one object while preserving the lower-level functions for advanced use.
 */
export function editImage(
  image: RawRgbaImage | Promise<RawRgbaImage>,
): PhantomEditPipeline {
  return new PhantomEditSession(Promise.resolve(image));
}

/** Short alias for `editImage()` when callers think in processing pipelines. */
export const processImage = editImage;

export const phantom = {
  makeImage,
  edit: editImage,
  process: processImage,
  cropImage,
  resizeImage,
  applyFilter,
  applyFilters,
  applyMask,
  replaceBackground,
  adjustImage,
  watermarkImage,
  analyzeImage,
  autoLevelImage,
  planAsset,
  convertImage,
  optimizeImage,
  /** @see configureWasm */
  configureWasm,
  /** @see isWasmReady */
  isWasmReady,
} as const;

class PhantomEditSession implements PhantomEditPipeline {
  public constructor(private readonly imagePromise: Promise<RawRgbaImage>) {}

  public crop(rect: Rect): PhantomEditPipeline {
    return this.next((image) => cropImage(image, rect));
  }

  public resize(
    width: number,
    height: number,
    options: ResizeRawImageOptions = {},
  ): PhantomEditPipeline {
    return this.next((image) => resizeImage(image, width, height, options));
  }

  public filter(
    filter: PixelFilter = "smoothEnhance",
    options: FilterOptions = {},
  ): PhantomEditPipeline {
    return this.nextAsync((image) => applyFilter(image, filter, options));
  }

  public filters(
    filters: readonly PixelFilter[],
    options: FilterOptions = {},
  ): PhantomEditPipeline {
    return this.nextAsync((image) => applyFilters(image, filters, options));
  }

  public mask(
    mask: AlphaMask,
    options: AlphaMaskRefinementOptions = {},
  ): PhantomEditPipeline {
    return this.next((image) => applyMask(image, mask, options));
  }

  public background(color: RgbColor): PhantomEditPipeline {
    return this.next((image) => replaceBackground(image, color));
  }

  public adjust(options: ImageAdjustOptions): PhantomEditPipeline {
    return this.next((image) => adjustImage(image, options));
  }

  public watermark(options: TextWatermarkOptions): PhantomEditPipeline {
    return this.next((image) => watermarkImage(image, options).image);
  }

  public async plan(
    options: PhantomAssetPlanOptions = {},
  ): Promise<PhantomAssetPlan> {
    return planAsset(await this.imagePromise, options);
  }

  public run(): Promise<RawRgbaImage> {
    return this.imagePromise;
  }

  private next(
    transform: (image: RawRgbaImage) => RawRgbaImage,
  ): PhantomEditPipeline {
    return new PhantomEditSession(this.imagePromise.then(transform));
  }

  private nextAsync(
    transform: (image: RawRgbaImage) => Promise<RawRgbaImage>,
  ): PhantomEditPipeline {
    return new PhantomEditSession(this.imagePromise.then(transform));
  }
}

function toProcessOptions(
  options: FilterOptions,
): Omit<ProcessOptions, "filter" | "overlap"> {
  return {
    ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.tileProcessor === undefined
      ? {}
      : { tileProcessor: options.tileProcessor }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  };
}
