export {
  FixedByteRingBuffer,
  pipeChunksToBuffer,
} from "./core/ring-buffer.js";
export { applyFilterToTile } from "./core/kernels.js";
export {
  applyAlphaMask,
  featherAlphaMask,
  fillTransparentWith,
  type AlphaMask,
  type AlphaMaskRefinementOptions,
  type AlphaMaskResult,
  type RgbColor,
} from "./core/background.js";
export {
  createAssetPlan,
  type PhantomAssetGoal,
  type PhantomAssetPlan,
  type PhantomAssetPlanOptions,
} from "./core/asset-plan.js";
export {
  canEncodeImageFormat,
  convertImageFile,
  encodeRawImage,
  getImageFormatProfile,
  listImageFormats,
  normalizeImageFormat,
  optimizeImageFile,
  type BrowserEncodableImageFormat,
  type BrowserImageInput,
  type ImageConversionResult,
  type ImageEncodeOptions,
  type ImageFileFormat,
  type ImageFormatProfile,
  type ImageOptimizationOptions,
} from "./core/image-codecs.js";
export {
  getPixelFilterOverlap,
  getPixelFilterProfile,
  listPixelFilters,
  PIXEL_FILTER_PROFILES,
  type PixelFilterProfile,
} from "./core/filters.js";
export {
  chooseTileSize,
  getProcessingPlan,
  estimateRgbaBytes,
  estimateTileScratchBytes,
  type MemoryBudget,
  type ProcessingPlanStats,
} from "./core/performance.js";
export {
  cloneRawImage,
  createRawRgbaImage,
  cropRawImage,
  resizeRawImage,
  type ResizeMethod,
  type ResizeRawImageOptions,
  type RgbaColor,
} from "./core/image.js";
export {
  adjustImage,
  analyzeImage,
  applyFilter,
  applyFilters,
  applyMask,
  autoAdjustImage,
  configureWasm,
  useWasm,
  convertImage,
  cropImage,
  createImage,
  editImage,
  isWasmReady,
  optimizeImage,
  phantom,
  replaceBackground,
  resizeImage,
  watermarkImage,
  type FilterOptions,
  type PhantomEditPipeline,
} from "./core/phantom.js";
export { phantom as default } from "./core/phantom.js";
export {
  registerProcessor,
  getRegisteredProcessor,
} from "./core/wasm-registry.js";
export {
  adjustRawImage,
  type ImageAdjustOptions,
} from "./core/adjust.js";
export {
  applyTextWatermark,
  type TextWatermarkOptions,
  type WatermarkPosition,
  type WatermarkResult,
  type WatermarkTileMode,
} from "./core/watermark.js";
export {
  suggestAutoAdjust,
  computeHistogram,
  type ImageHistogram,
} from "./core/histogram.js";
export {
  createRawTileSink,
  createRawTileSource,
  cpuTileProcessor,
  processRawImage,
  processRawImagePipeline,
  processRawImageWithStats,
  processTileSource,
  processTileSourceWithStats,
} from "./core/pipeline.js";
export {
  TileBufferPool,
  type TileBufferPoolStats,
} from "./core/tile-buffer-pool.js";
export { clampRect, planTiles, rectByteLength } from "./core/tiling.js";
export {
  FIXED_ONE,
  FIXED_SHIFT,
  clampU8,
  fromFixed,
  multiplyFixed,
  toFixed,
} from "./core/fixed-point.js";
export {
  detectCapabilities,
  WebGlRgbaRenderer,
  WebGpuComputeBackend,
  WebGpuRgbaRenderer,
  type CapabilityReport,
  type ComputeBackend,
} from "./gpu/index.js";
export {
  createWasmTileProcessor,
  instantiateWasmBackend,
  type WasmKernelBackend,
  type WasmKernelExports,
} from "./wasm/index.js";
export {
  AI_BACKGROUND_DEFAULTS,
  BrowserBackgroundRemover,
  aiRemoveBackground,
  createAiRemover,
  normalizeAiMaskOptions,
  type AiBackend,
  type AiBackendPreference,
  type AiBackgroundRemovalOptions,
  type AiBackgroundRemovalResult,
  type AiBackgroundRemoverOptions,
  type AiMaskResult,
  type AiPreloadResult,
  type AiProgress,
} from "./ai/index.js";
export {
  SharedTileBuffer,
  TileWorkerPool,
  type SharedTileBufferOptions,
} from "./workers/index.js";
export {
  PhantomError,
  RGBA_CHANNELS,
  type ImageDimensions,
  type PixelFilter,
  type ProcessPipelineStep,
  type ProcessProgress,
  type ProcessOptions,
  type ProcessStats,
  type RawRgbaProcessResult,
  type RawRgbaImage,
  type Rect,
  type StreamBufferOptions,
  type TileDescriptor,
  type TilePayload,
  type TileProcessor,
  type TileResult,
  type TileSink,
  type TileSource,
} from "./core/types.js";
