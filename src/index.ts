export {
  FixedByteRingBuffer,
  streamChunksToFixedBuffer,
} from "./core/ring-buffer.js";
export { applyFilterToTile } from "./core/kernels.js";
export {
  applyAlphaMask,
  estimateBackgroundColor,
  estimateBackgroundPalette,
  refineAlphaMask,
  removeBackground,
  replaceTransparentBackground,
  type AlphaMask,
  type AlphaMaskRefinementOptions,
  type AlphaMaskResult,
  type BackgroundRemovalDiagnostics,
  type BackgroundRemovalOptions,
  type BackgroundRemovalResult,
  type RgbColor,
} from "./core/background.js";
export {
  getPixelFilterOverlap,
  getPixelFilterProfile,
  listPixelFilters,
  PIXEL_FILTER_PROFILES,
  type PixelFilterProfile,
} from "./core/filters.js";
export {
  chooseTileSize,
  describeProcessingPlan,
  estimateRgbaBytes,
  estimateTileScratchBytes,
  type MemoryBudget,
  type ProcessingPlanStats,
} from "./core/performance.js";
export {
  createRawTileSink,
  createRawTileSource,
  processRawImage,
  processTileSource,
} from "./core/pipeline.js";
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
  instantiateZigBackend,
  type WasmKernelBackend,
  type WasmKernelExports,
} from "./wasm/index.js";
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
  type ProcessOptions,
  type RawRgbaImage,
  type Rect,
  type StreamBufferOptions,
  type TileDescriptor,
  type TilePayload,
  type TileResult,
  type TileSink,
  type TileSource,
} from "./core/types.js";
